import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuth } from '../src/gateway/auth.js';

test('browser login issues a trusted browser session token after PIN verification', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-connect-auth-'));
  try {
    const auth = createAuth({
      publicBaseUrl: 'https://ai.example.com',
      auth: {
        pin: '2468',
        sessionSecret: 'test-secret',
        trustedProxyHeader: 'cf-access-authenticated-user-email',
        browserLoginEnabled: true,
        localLoginEnabled: false,
        deviceStorePath: path.join(tempDir, 'devices.json'),
      },
    });

    const req = createMockRequest({
      host: 'ai.example.com',
      headers: {
        'cf-access-authenticated-user-email': 'user@example.com',
      },
      ip: '127.0.0.1',
    });
    const res = createMockResponse();

    auth.browserLogin(req, res, {
      pin: '2468',
      clientId: 'web-client',
      clientName: 'Chrome on Mac',
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.clientId, 'web-client');
    assert.equal(res.body.clientName, 'Chrome on Mac');
    assert.equal(res.body.authMethod, 'browser_sso_web');
    assert.equal(res.body.trustedIdentity, 'user@example.com');
    assert.match(res.headers['Set-Cookie'], /remote_connect_session=/);
    assert.match(res.headers['Set-Cookie'], /Max-Age=2592000/);

    const parsed = auth.parseRequest({
      headers: {
        'x-remote-connect-session': res.body.sessionToken,
      },
      url: '/',
    });
    assert.equal(parsed.clientId, 'web-client');
    assert.equal(parsed.clientName, 'Chrome on Mac');
    assert.equal(parsed.authMethod, 'browser_sso_web');
    assert.equal(parsed.trustedIdentity, 'user@example.com');

    const parsedCookie = auth.parseRequest(createMockRequest({
      host: 'ai.example.com',
      headers: {
        cookie: res.headers['Set-Cookie'],
      },
      url: '/',
    }));
    assert.equal(parsedCookie.clientId, 'web-client');
    assert.equal(parsedCookie.trustedIdentity, 'user@example.com');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('session tokens in query strings are no longer accepted for authentication', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-connect-auth-'));
  try {
    const auth = createAuth({
      publicBaseUrl: 'https://ai.example.com',
      auth: {
        pin: '2468',
        sessionSecret: 'test-secret',
        trustedProxyHeader: 'cf-access-authenticated-user-email',
        browserLoginEnabled: true,
        localLoginEnabled: false,
        deviceStorePath: path.join(tempDir, 'devices.json'),
      },
    });

    const req = createMockRequest({
      host: 'ai.example.com',
      headers: {
        'cf-access-authenticated-user-email': 'user@example.com',
      },
      ip: '127.0.0.1',
    });
    const res = createMockResponse();

    auth.browserLogin(req, res, {
      pin: '2468',
      clientId: 'web-client',
      clientName: 'Chrome on Mac',
    });

    const parsed = auth.parseRequest(createMockRequest({
      host: 'ai.example.com',
      url: `/?sessionToken=${encodeURIComponent(res.body.sessionToken)}`,
    }));

    assert.equal(parsed, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('browser login rejects requests without a trusted browser identity header', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-connect-auth-'));
  try {
    const auth = createAuth({
      publicBaseUrl: 'https://ai.example.com',
      auth: {
        pin: '2468',
        sessionSecret: 'test-secret',
        trustedProxyHeader: 'cf-access-authenticated-user-email',
        browserLoginEnabled: true,
        localLoginEnabled: false,
        deviceStorePath: path.join(tempDir, 'devices.json'),
      },
    });

    const res = createMockResponse();
    auth.browserLogin(createMockRequest({
      host: 'ai.example.com',
      headers: {},
      ip: '127.0.0.1',
    }), res, {
      clientId: 'web-client',
      clientName: 'Chrome on Mac',
    });

    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, {
      error: 'Trusted browser identity required',
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('browser login rejects an invalid PIN even with a trusted browser identity header', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-connect-auth-'));
  try {
    const auth = createAuth({
      publicBaseUrl: 'https://ai.example.com',
      auth: {
        pin: '2468',
        sessionSecret: 'test-secret',
        trustedProxyHeader: 'cf-access-authenticated-user-email',
        browserLoginEnabled: true,
        localLoginEnabled: false,
        deviceStorePath: path.join(tempDir, 'devices.json'),
      },
    });

    const res = createMockResponse();
    auth.browserLogin(createMockRequest({
      host: 'ai.example.com',
      headers: {
        'cf-access-authenticated-user-email': 'user@example.com',
      },
      ip: '127.0.0.1',
    }), res, {
      pin: '0000',
      clientId: 'web-client',
      clientName: 'Chrome on Mac',
    });

    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, {
      error: 'Invalid PIN',
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('trusted local policy stays in PIN-only mode even when a public hostname is configured', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-connect-auth-'));
  try {
    const auth = createAuth({
      publicBaseUrl: 'https://ai.example.com',
      auth: {
        pin: '2468',
        sessionSecret: 'test-secret',
        trustedProxyHeader: 'cf-access-authenticated-user-email',
        browserLoginEnabled: true,
        localLoginEnabled: false,
        deviceStorePath: path.join(tempDir, 'devices.json'),
      },
    });

    const localPolicy = auth.policy(createMockRequest({
      host: '127.0.0.1:8080',
      ip: '127.0.0.1',
    }));
    assert.equal(localPolicy.publicMode, false);
    assert.equal(localPolicy.browserLoginEnabled, false);
    assert.equal(localPolicy.trustedLocalLoginEnabled, true);

    const publicPolicy = auth.policy(createMockRequest({
      host: 'ai.example.com',
      ip: '127.0.0.1',
    }));
    assert.equal(publicPolicy.publicMode, true);
    assert.equal(publicPolicy.browserLoginEnabled, true);
    assert.equal(publicPolicy.trustedLocalLoginEnabled, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('trusted local requests can still use direct PIN login on localhost with a public deployment configured', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-connect-auth-'));
  try {
    const auth = createAuth({
      publicBaseUrl: 'https://ai.example.com',
      auth: {
        pin: '2468',
        sessionSecret: 'test-secret',
        trustedProxyHeader: 'cf-access-authenticated-user-email',
        browserLoginEnabled: true,
        localLoginEnabled: false,
        deviceStorePath: path.join(tempDir, 'devices.json'),
      },
    });

    const res = createMockResponse();
    auth.localLogin(createMockRequest({
      host: '127.0.0.1:8080',
      ip: '127.0.0.1',
    }), res, {
      pin: '2468',
      deviceId: 'android-device',
      deviceName: 'Demo Android Device',
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.deviceId, 'android-device');
    assert.equal(res.body.authMethod, 'local_pin');
    assert.ok(res.body.refreshToken);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('quick tunnel preview can stay in direct PIN mode on a public hostname', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-connect-auth-'));
  try {
    const auth = createAuth({
      publicBaseUrl: 'https://preview.trycloudflare.com',
      auth: {
        pin: '2468',
        sessionSecret: 'test-secret',
        trustedProxyHeader: 'tailscale-user-login',
        browserLoginEnabled: false,
        localLoginEnabled: true,
        deviceStorePath: path.join(tempDir, 'devices.json'),
      },
    });

    const publicPolicy = auth.policy(createMockRequest({
      host: 'preview.trycloudflare.com',
      ip: '127.0.0.1',
    }));
    assert.equal(publicPolicy.publicMode, true);
    assert.equal(publicPolicy.browserLoginEnabled, false);
    assert.equal(publicPolicy.trustedLocalLoginEnabled, true);

    const res = createMockResponse();
    auth.localLogin(createMockRequest({
      host: 'preview.trycloudflare.com',
      ip: '127.0.0.1',
    }), res, {
      pin: '2468',
      deviceId: 'android-device',
      deviceName: 'Demo Android Device',
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.deviceId, 'android-device');
    assert.equal(res.body.authMethod, 'local_pin');
    assert.ok(res.body.refreshToken);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('browser grant exchange requires PIN verification', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-connect-auth-'));
  try {
    const auth = createAuth({
      publicBaseUrl: 'https://ai.example.com',
      mobileDeepLinkBase: 'remoteconnect://open',
      auth: {
        pin: '2468',
        sessionSecret: 'test-secret',
        trustedProxyHeader: 'cf-access-authenticated-user-email',
        browserLoginEnabled: true,
        localLoginEnabled: false,
        deviceStorePath: path.join(tempDir, 'devices.json'),
      },
    });

    const grant = auth.createBrowserGrant(createMockRequest({
      host: 'ai.example.com',
      headers: {
        'cf-access-authenticated-user-email': 'user@example.com',
      },
      ip: '127.0.0.1',
    }), {
      deviceId: 'android-device',
      deviceName: 'Demo Android Device',
    });

    const res = createMockResponse();
    auth.exchangeGrant({ ip: '127.0.0.1' }, res, {
      grant: grant.grantId,
      deviceId: 'android-device',
      deviceName: 'Demo Android Device',
      pin: '2468',
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.deviceId, 'android-device');
    assert.equal(res.body.authMethod, 'browser_sso');
    assert.equal(res.body.trustedIdentity, 'user@example.com');
    assert.ok(res.body.refreshToken);
    assert.match(res.headers['Set-Cookie'], /Max-Age=2592000/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('browser grants preserve the selected entry, api gateway, and profile in the app redirect', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-connect-auth-'));
  try {
    const auth = createAuth({
      publicBaseUrl: 'https://ai.example.com',
      mobileDeepLinkBase: 'remoteconnect://open',
      auth: {
        pin: '2468',
        sessionSecret: 'test-secret',
        trustedProxyHeader: 'cf-access-authenticated-user-email',
        browserLoginEnabled: true,
        localLoginEnabled: false,
        deviceStorePath: path.join(tempDir, 'devices.json'),
      },
    });

    const grant = auth.createBrowserGrant(createMockRequest({
      host: 'ai.example.com',
      headers: {
        'cf-access-authenticated-user-email': 'user@example.com',
      },
      ip: '127.0.0.1',
    }), {
      deviceId: 'android-device',
      deviceName: 'Demo Android Device',
      profile: 'public-team',
      entry: 'https://myteam.cloudflareaccess.com/apps/remote-connect',
      gateway: 'https://ai.example.com',
    });

    assert.match(grant.redirectUrl, /gateway=https%3A%2F%2Fai\.example\.com/);
    assert.match(grant.redirectUrl, /entry=https%3A%2F%2Fmyteam\.cloudflareaccess\.com%2Fapps%2Fremote-connect/);
    assert.match(grant.redirectUrl, /profile=public-team/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('refresh keeps remembered device sessions alive without requiring browser or PIN again', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-connect-auth-'));
  try {
    const auth = createAuth({
      publicBaseUrl: 'https://ai.example.com',
      mobileDeepLinkBase: 'remoteconnect://open',
      auth: {
        pin: '2468',
        sessionSecret: 'test-secret',
        trustedProxyHeader: 'cf-access-authenticated-user-email',
        browserLoginEnabled: true,
        localLoginEnabled: false,
        deviceStorePath: path.join(tempDir, 'devices.json'),
      },
    });

    const grant = auth.createBrowserGrant(createMockRequest({
      host: 'ai.example.com',
      headers: {
        'cf-access-authenticated-user-email': 'user@example.com',
      },
      ip: '127.0.0.1',
    }), {
      deviceId: 'android-device',
      deviceName: 'Demo Android Device',
    });

    const exchangeRes = createMockResponse();
    auth.exchangeGrant({ ip: '127.0.0.1' }, exchangeRes, {
      grant: grant.grantId,
      deviceId: 'android-device',
      deviceName: 'Demo Android Device',
      pin: '2468',
    });

    const refreshRes = createMockResponse();
    auth.refresh({}, refreshRes, {
      refreshToken: exchangeRes.body.refreshToken,
    });

    assert.equal(refreshRes.statusCode, 200);
    assert.equal(refreshRes.body.deviceId, 'android-device');
    assert.equal(refreshRes.body.authMethod, 'browser_sso');
    assert.equal(refreshRes.body.trustedIdentity, 'user@example.com');
    assert.ok(refreshRes.body.refreshToken);
    assert.notEqual(refreshRes.body.refreshToken, exchangeRes.body.refreshToken);
    assert.match(refreshRes.headers['Set-Cookie'], /Max-Age=2592000/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('logout revokes the remembered device so refresh requires full login again', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-connect-auth-'));
  try {
    const auth = createAuth({
      publicBaseUrl: 'https://ai.example.com',
      mobileDeepLinkBase: 'remoteconnect://open',
      auth: {
        pin: '2468',
        sessionSecret: 'test-secret',
        trustedProxyHeader: 'cf-access-authenticated-user-email',
        browserLoginEnabled: true,
        localLoginEnabled: false,
        deviceStorePath: path.join(tempDir, 'devices.json'),
      },
    });

    const grant = auth.createBrowserGrant(createMockRequest({
      host: 'ai.example.com',
      headers: {
        'cf-access-authenticated-user-email': 'user@example.com',
      },
      ip: '127.0.0.1',
    }), {
      deviceId: 'android-device',
      deviceName: 'Demo Android Device',
    });

    const exchangeRes = createMockResponse();
    auth.exchangeGrant({ ip: '127.0.0.1' }, exchangeRes, {
      grant: grant.grantId,
      deviceId: 'android-device',
      deviceName: 'Demo Android Device',
      pin: '2468',
    });

    const logoutRes = createMockResponse();
    auth.logout(logoutRes, {
      deviceId: 'android-device',
    });

    assert.equal(logoutRes.statusCode, 200);
    assert.deepEqual(logoutRes.body, {
      ok: true,
    });

    const refreshRes = createMockResponse();
    auth.refresh({}, refreshRes, {
      refreshToken: exchangeRes.body.refreshToken,
    });

    assert.equal(refreshRes.statusCode, 401);
    assert.deepEqual(refreshRes.body, {
      error: 'Refresh token is invalid or expired',
      code: 'refresh_token_invalid_or_expired',
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createMockRequest({ host = '127.0.0.1:8080', ip = '127.0.0.1', headers = {}, hostname = null, url = '/' } = {}) {
  return {
    headers: {
      host,
      ...headers,
    },
    hostname,
    ip,
    url,
  };
}
