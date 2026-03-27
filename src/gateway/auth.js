import crypto from 'node:crypto';
import { DeviceRegistry } from './device-registry.js';

const COOKIE_NAME = 'remote_connect_session';
const HEADER_NAME = 'x-remote-connect-session';

export function createAuth(config) {
  const sessionSecret = config.auth?.sessionSecret || crypto.randomBytes(32).toString('hex');
  const pin = `${config.auth?.pin || ''}`;
  const trustedHeader = config.auth?.trustedProxyHeader?.toLowerCase() || null;
  const secureCookies = config.auth?.secureCookies ?? false;
  const loginWindowMs = Number(config.auth?.loginWindowMs || 10 * 60 * 1000);
  const loginBlockMs = Number(config.auth?.loginBlockMs || 15 * 60 * 1000);
  const loginMaxAttempts = Number(config.auth?.loginMaxAttempts || 8);
  const accessTokenTtlMs = Number(config.auth?.accessTokenTtlMs || 30 * 24 * 60 * 60 * 1000);
  const refreshTokenTtlMs = Number(config.auth?.refreshTokenTtlMs || 30 * 24 * 60 * 60 * 1000);
  const browserGrantTtlMs = Number(config.auth?.browserGrantTtlMs || 5 * 60 * 1000);
  const localLoginEnabled = config.auth?.localLoginEnabled ?? true;
  const trustedLocalPinEnabled = config.auth?.trustedLocalPinEnabled ?? true;
  const browserLoginEnabled = config.auth?.browserLoginEnabled ?? Boolean(config.publicBaseUrl);
  const allowedEmails = new Set((Array.isArray(config.auth?.allowedEmails) ? config.auth.allowedEmails : []).map((value) => `${value || ''}`.trim().toLowerCase()).filter(Boolean));
  const deviceRegistry = new DeviceRegistry(config.auth?.deviceStorePath || 'data/gateway/devices.json');
  const loginState = new Map();
  const browserGrants = new Map();

  function sign(payload) {
    const content = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', sessionSecret).update(content).digest('base64url');
    return `${content}.${signature}`;
  }

  function verify(token) {
    if (!token) {
      return null;
    }

    const [content, signature] = `${token}`.split('.');
    if (!content || !signature) {
      return null;
    }

    const expected = crypto.createHmac('sha256', sessionSecret).update(content).digest('base64url');
    if (signature.length !== expected.length) {
      return null;
    }

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(content, 'base64url').toString('utf8'));
    if (Number(payload.expiresAt || 0) <= Date.now()) {
      return null;
    }

    return payload;
  }

  function parseCookie(req) {
    const header = req.headers.cookie || '';
    const cookies = header.split(';').map((entry) => entry.trim());
    for (const cookie of cookies) {
      const [name, value] = cookie.split('=');
      if (name === COOKIE_NAME) {
        return verify(value);
      }
    }

    return null;
  }

  function parseHeader(req) {
    const headerToken = req.headers[HEADER_NAME] || req.headers.authorization;
    if (!headerToken) {
      return null;
    }

    const value = `${headerToken}`.startsWith('Bearer ') ? `${headerToken}`.slice(7) : `${headerToken}`;
    return verify(value);
  }

  function parseRequest(req) {
    const payload = parseHeader(req) || parseCookie(req);
    if (!payload) {
      return null;
    }

    if (!payload.deviceId) {
      return payload;
    }

    const device = deviceRegistry.get(payload.deviceId);
    if (!device) {
      return null;
    }

    if (device.revokedAt && Number(device.revokedAt) >= Number(payload.issuedAt || 0)) {
      return null;
    }

    return payload;
  }

  function requireAuth(req, res, next) {
    const session = parseRequest(req);
    const trustedIdentity = trustedHeader ? req.headers[trustedHeader] : null;

    if (!session) {
      res.status(401).json({
        error: 'Authentication required',
      });
      return;
    }

    if (session.deviceId) {
      deviceRegistry.touch(session.deviceId, {
        lastIp: req.ip,
        lastUserAgent: req.headers['user-agent'] || '',
      });
    }

    req.auth = {
      ...session,
      trustedIdentity: trustedIdentity ? `${trustedIdentity}` : session.trustedIdentity || null,
    };
    next();
  }

  function getPolicy(req = null) {
    const trustedLocalRequest = isTrustedLocalRequest(req);
    const publicMode = Boolean(config.publicBaseUrl && !trustedLocalRequest);
    const directPinPreviewEnabled = Boolean(publicMode && localLoginEnabled && !browserLoginEnabled);
    return {
      publicMode,
      pinRequired: true,
      browserLoginEnabled: Boolean(browserLoginEnabled && publicMode && config.publicBaseUrl && trustedHeader),
      trustedLocalLoginEnabled: Boolean(
        (trustedLocalRequest && (localLoginEnabled || trustedLocalPinEnabled)) || directPinPreviewEnabled,
      ),
      deviceRevocationEnabled: true,
      browserLoginPath: '/api/auth/browser/start',
      localLoginPath: '/api/auth/local-login',
      refreshPath: '/api/auth/refresh',
      devicesPath: '/api/devices',
    };
  }

  function requireValidPin(req, res, body = {}) {
    const blocked = isLoginBlocked(req);
    if (blocked) {
      res.status(429).json({
        error: 'Too many login attempts',
        retryAfterMs: blocked.blockedUntil - Date.now(),
      });
      return false;
    }

    if (`${body.pin || ''}` !== pin) {
      recordLoginFailure(req);
      res.status(401).json({
        error: 'Invalid PIN',
      });
      return false;
    }

    clearLoginFailures(req);
    return true;
  }

  function getLoginKey(req) {
    return `${req.ip || 'unknown-ip'}`;
  }

  function getLoginBucket(req) {
    const key = getLoginKey(req);
    const now = Date.now();
    const current = loginState.get(key);
    if (!current) {
      return {
        key,
        bucket: {
          attempts: 0,
          windowStartedAt: now,
          blockedUntil: 0,
        },
      };
    }

    if (current.windowStartedAt + loginWindowMs <= now) {
      current.attempts = 0;
      current.windowStartedAt = now;
    }

    return {
      key,
      bucket: current,
    };
  }

  function isLoginBlocked(req) {
    const { bucket } = getLoginBucket(req);
    return bucket.blockedUntil > Date.now() ? bucket : null;
  }

  function recordLoginFailure(req) {
    const now = Date.now();
    const { key, bucket } = getLoginBucket(req);
    bucket.attempts += 1;
    if (bucket.attempts >= loginMaxAttempts) {
      bucket.blockedUntil = now + loginBlockMs;
      bucket.attempts = 0;
      bucket.windowStartedAt = now;
    }
    loginState.set(key, bucket);
    return bucket;
  }

  function clearLoginFailures(req) {
    loginState.delete(getLoginKey(req));
  }

  function localLogin(req, res, body = {}, options = {}) {
    if (options.requirePolicy !== false) {
      const policy = getPolicy(req);
      if (!policy.trustedLocalLoginEnabled) {
        res.status(403).json({
          error: policy.publicMode ? 'Local login is only available in trusted local mode' : 'Local login is disabled for this gateway',
        });
        return;
      }
    }

    if (!requireValidPin(req, res, body)) {
      return;
    }

    const deviceId = `${body.deviceId || body.clientId || ''}`.trim();
    const deviceName = `${body.deviceName || body.clientName || 'mobile-client'}`.trim();
    if (deviceId) {
      const device = deviceRegistry.upsert({
        deviceId,
        deviceName,
        authMethod: 'local_pin',
        lastIp: req.ip,
        lastUserAgent: req.headers['user-agent'] || '',
      });
      const issued = issueDeviceSession(device, 'local_pin');
      setSessionCookie(res, issued.accessToken);
      res.json(issued);
      return;
    }

    const payload = {
      clientId: body.clientId || crypto.randomUUID(),
      clientName: body.clientName || 'mobile-client',
      authMethod: 'legacy_pin',
      issuedAt: Date.now(),
      expiresAt: Date.now() + accessTokenTtlMs,
    };
    const token = sign(payload);
    setSessionCookie(res, token);
    res.json({
      clientId: payload.clientId,
      clientName: payload.clientName,
      authMethod: payload.authMethod,
      expiresAt: payload.expiresAt,
      sessionToken: token,
      accessToken: token,
      refreshToken: null,
      deviceId: null,
      trustedIdentity: null,
    });
  }

  function browserLogin(req, res, body = {}) {
    const policy = getPolicy(req);
    if (!policy.browserLoginEnabled) {
      res.status(403).json({
        error: 'Browser login is disabled for this gateway',
      });
      return;
    }

    const trustedIdentity = `${(trustedHeader ? req.headers[trustedHeader] : '') || ''}`.trim();
    if (!trustedIdentity) {
      res.status(401).json({
        error: 'Trusted browser identity required',
      });
      return;
    }

    if (allowedEmails.size && !allowedEmails.has(trustedIdentity.toLowerCase())) {
      res.status(403).json({
        error: 'This identity is not allowed',
      });
      return;
    }

    if (!requireValidPin(req, res, body)) {
      return;
    }

    const payload = {
      clientId: `${body.clientId || crypto.randomUUID()}`.trim() || crypto.randomUUID(),
      clientName: `${body.clientName || trustedIdentity || 'Web browser'}`.trim(),
      authMethod: 'browser_sso_web',
      trustedIdentity,
      issuedAt: Date.now(),
      expiresAt: Date.now() + accessTokenTtlMs,
    };
    const token = sign(payload);
    setSessionCookie(res, token);
    res.json({
      clientId: payload.clientId,
      clientName: payload.clientName,
      authMethod: payload.authMethod,
      expiresAt: payload.expiresAt,
      sessionToken: token,
      accessToken: token,
      refreshToken: null,
      deviceId: null,
      trustedIdentity,
    });
  }

  function createBrowserGrant(req, params = {}) {
    const policy = getPolicy(req);
    if (!policy.browserLoginEnabled) {
      throw createStatusError(403, 'Browser login is disabled for this gateway');
    }

    const trustedIdentity = `${(trustedHeader ? req.headers[trustedHeader] : '') || ''}`.trim();
    if (!trustedIdentity) {
      throw createStatusError(401, 'Trusted browser identity required');
    }

    if (allowedEmails.size && !allowedEmails.has(trustedIdentity.toLowerCase())) {
      throw createStatusError(403, 'This identity is not allowed');
    }

    cleanupExpiredGrants();

    const deviceId = `${params.deviceId || ''}`.trim();
    const deviceName = `${params.deviceName || params.clientName || 'Android device'}`.trim();
    if (!deviceId) {
      throw createStatusError(400, 'deviceId is required');
    }

    const grantId = crypto.randomBytes(24).toString('base64url');
    browserGrants.set(grantId, {
      deviceId,
      deviceName,
      trustedIdentity,
      sessionId: `${params.session || ''}`.trim(),
      expiresAt: Date.now() + browserGrantTtlMs,
    });

    const redirectUrl = new URL(config.mobileDeepLinkBase || 'remoteconnect://open');
    const apiBaseUrl = `${params.gateway || params.apiBaseUrl || config.publicBaseUrl || ''}`.trim();
    const entryUrl = `${params.entry || params.entryUrl || ''}`.trim();
    const profileId = `${params.profile || params.profileId || ''}`.trim();
    if (apiBaseUrl) {
      redirectUrl.searchParams.set('gateway', apiBaseUrl);
    }
    if (entryUrl) {
      redirectUrl.searchParams.set('entry', entryUrl);
    }
    if (profileId) {
      redirectUrl.searchParams.set('profile', profileId);
    }
    redirectUrl.searchParams.set('grant', grantId);
    if (`${params.session || ''}`.trim()) {
      redirectUrl.searchParams.set('session', `${params.session}`.trim());
    }

    return {
      grantId,
      trustedIdentity,
      redirectUrl: redirectUrl.toString(),
    };
  }

  function exchangeGrant(req, res, body = {}) {
    cleanupExpiredGrants();

    const grantId = `${body.grant || ''}`.trim();
    const deviceId = `${body.deviceId || ''}`.trim();
    const deviceName = `${body.deviceName || ''}`.trim();
    const grant = browserGrants.get(grantId);
    if (!grant) {
      res.status(401).json({
        error: 'Grant is invalid or expired',
      });
      return;
    }

    if (!deviceId || deviceId !== grant.deviceId) {
      res.status(400).json({
        error: 'deviceId does not match the browser grant',
      });
      return;
    }

    if (!requireValidPin(req, res, body)) {
      return;
    }

    browserGrants.delete(grantId);

    const device = deviceRegistry.upsert({
      deviceId,
      deviceName: deviceName || grant.deviceName,
      authMethod: 'browser_sso',
      trustedIdentity: grant.trustedIdentity,
    });
    const issued = issueDeviceSession(device, 'browser_sso', grant.trustedIdentity);
    setSessionCookie(res, issued.accessToken);
    res.json({
      ...issued,
      redirectSessionId: grant.sessionId || null,
    });
  }

  function refresh(_req, res, body = {}) {
    const refreshToken = `${body.refreshToken || ''}`.trim();
    const device = findDeviceByRefreshToken(refreshToken);
    if (!device) {
      res.status(401).json({
        error: 'Refresh token is invalid or expired',
        code: 'refresh_token_invalid_or_expired',
      });
      return;
    }

    const issued = issueDeviceSession(device, device.authMethod || 'browser_sso', device.trustedIdentity || null);
    setSessionCookie(res, issued.accessToken);
    res.json(issued);
  }

  function listDevices(currentDeviceId = '') {
    return deviceRegistry.list().map((device) => ({
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      authMethod: device.authMethod,
      trustedIdentity: device.trustedIdentity || null,
      createdAt: device.createdAt,
      lastSeenAt: device.lastSeenAt,
      lastIp: device.lastIp || null,
      lastUserAgent: device.lastUserAgent || null,
      revokedAt: device.revokedAt,
      current: device.deviceId === currentDeviceId,
    }));
  }

  function revokeDevice(deviceId) {
    return deviceRegistry.revoke(deviceId);
  }

  function logout(res, authPayload = null) {
    if (authPayload?.deviceId) {
      deviceRegistry.revoke(authPayload.deviceId);
    }
    clearSessionCookie(res);
    res.json({
      ok: true,
    });
  }

  function setSessionCookie(res, token) {
    res.setHeader(
      'Set-Cookie',
      `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(accessTokenTtlMs / 1000)}${
        secureCookies ? '; Secure' : ''
      }`,
    );
  }

  function clearSessionCookie(res) {
    res.setHeader(
      'Set-Cookie',
      `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookies ? '; Secure' : ''}`,
    );
  }

  function issueDeviceSession(device, authMethod, trustedIdentity = null) {
    const accessPayload = {
      clientId: device.deviceId,
      clientName: device.deviceName,
      deviceId: device.deviceId,
      authMethod,
      trustedIdentity: trustedIdentity || device.trustedIdentity || null,
      issuedAt: Date.now(),
      expiresAt: Date.now() + accessTokenTtlMs,
    };
    const accessToken = sign(accessPayload);
    const refreshToken = crypto.randomBytes(32).toString('base64url');
    const refreshTokenHash = hashToken(refreshToken);
    const refreshExpiresAt = Date.now() + refreshTokenTtlMs;
    deviceRegistry.updateRefresh(device.deviceId, refreshTokenHash, refreshExpiresAt);
    return {
      clientId: device.deviceId,
      clientName: device.deviceName,
      deviceId: device.deviceId,
      authMethod,
      trustedIdentity: trustedIdentity || device.trustedIdentity || null,
      issuedAt: accessPayload.issuedAt,
      expiresAt: accessPayload.expiresAt,
      sessionToken: accessToken,
      accessToken,
      refreshToken,
    };
  }

  function findDeviceByRefreshToken(refreshToken) {
    const refreshTokenHash = hashToken(`${refreshToken || ''}`.trim());
    if (!refreshTokenHash) {
      return null;
    }

    return (
      deviceRegistry
        .list()
        .find(
          (device) =>
            device.refreshTokenHash === refreshTokenHash &&
            !device.revokedAt &&
            Number(device.refreshExpiresAt || 0) > Date.now(),
        ) || null
    );
  }

  function cleanupExpiredGrants() {
    const now = Date.now();
    for (const [grantId, grant] of browserGrants.entries()) {
      if (Number(grant.expiresAt || 0) <= now) {
        browserGrants.delete(grantId);
      }
    }
  }

  return {
    parseRequest,
    requireAuth,
    login: localLogin,
    localLogin,
    browserLogin,
    createBrowserGrant,
    exchangeGrant,
    refresh,
    logout,
    listDevices,
    revokeDevice,
    policy: getPolicy,
    headerName: HEADER_NAME,
  };
}

function hashToken(value) {
  if (!value) {
    return '';
  }

  return crypto.createHash('sha256').update(`${value}`).digest('hex');
}

function createStatusError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isTrustedLocalRequest(req) {
  const host = getRequestHost(req);
  if (host) {
    return isTrustedLocalHost(host);
  }

  const requestIp = normalizeIp(req?.ip || req?.socket?.remoteAddress || req?.connection?.remoteAddress || '');
  return isTrustedLocalHost(requestIp);
}

function getRequestHost(req) {
  const forwardedHost = firstHeaderValue(req?.headers?.['x-forwarded-host']);
  const hostHeader = firstHeaderValue(req?.headers?.host);
  const hostname = req?.hostname || forwardedHost || hostHeader || '';
  return normalizeHost(hostname);
}

function firstHeaderValue(value) {
  if (Array.isArray(value)) {
    return `${value[0] || ''}`.trim();
  }
  return `${value || ''}`.split(',')[0].trim();
}

function normalizeHost(value) {
  const normalized = `${value || ''}`.trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  if (normalized.startsWith('[')) {
    const endBracket = normalized.indexOf(']');
    return endBracket >= 0 ? normalized.slice(1, endBracket) : normalized;
  }

  const colonCount = (normalized.match(/:/g) || []).length;
  if (colonCount === 1 && normalized.includes(':')) {
    return normalized.split(':')[0];
  }

  return normalized;
}

function normalizeIp(value) {
  return `${value || ''}`.trim().toLowerCase().replace(/^::ffff:/, '');
}

function isTrustedLocalHost(host) {
  const normalized = normalizeIp(normalizeHost(host));
  if (!normalized) {
    return false;
  }

  if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1') {
    return true;
  }

  if (normalized.endsWith('.local') || normalized.endsWith('.lan') || normalized.endsWith('.home')) {
    return true;
  }

  if (normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true;
  }

  if (!normalized.includes('.') && normalized.includes(':')) {
    return false;
  }

  if (!normalized.includes('.')) {
    return true;
  }

  const segments = normalized.split('.');
  if (segments.length !== 4 || !segments.every((segment) => /^\d+$/.test(segment))) {
    return false;
  }

  const [first, second] = segments.map((segment) => Number(segment));
  return first === 10 || first === 127 || (first === 192 && second === 168) || (first === 172 && second >= 16 && second <= 31);
}
