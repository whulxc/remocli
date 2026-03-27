import path from 'node:path';
import { buildMobileOpenUrl } from './mobile-links.js';

const GENERATED_DIR = 'config/generated';

export function generatedGatewayConfigPath() {
  return path.posix.join(GENERATED_DIR, 'gateway.generated.json');
}

export function generatedAgentConfigPath(agentId) {
  return path.posix.join(GENERATED_DIR, `agent.${sanitizeAgentId(agentId)}.generated.json`);
}

export function sanitizeAgentId(value) {
  return `${value}`.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
}

export function normalizeBaseUrl(value) {
  if (!value) {
    return '';
  }

  return `${value}`.trim().replace(/\/+$/, '');
}

export function collectDeploymentWarnings(deployment) {
  const warnings = [];
  const publicBaseUrl = normalizeBaseUrl(deployment?.gateway?.publicBaseUrl);
  const trustedProxyHeader = `${deployment?.gateway?.trustedProxyHeader || ''}`.trim().toLowerCase();
  const browserLoginEnabled = deployment?.gateway?.browserLoginEnabled ?? Boolean(publicBaseUrl);

  if (publicBaseUrl.includes('.trycloudflare.com')) {
    warnings.push(
      'gateway.publicBaseUrl points to a trycloudflare.com quick tunnel. This is preview-only and should not be treated as a formal public deployment.',
    );

    if (browserLoginEnabled) {
      warnings.push(
        'Browser login is enabled while using a quick tunnel. Cloudflare Access team domains do not replace a protected application hostname, so this mode is only suitable for temporary flow validation.',
      );
    }
  }

  if (browserLoginEnabled && publicBaseUrl && !trustedProxyHeader) {
    warnings.push(
      'Browser login is enabled but gateway.trustedProxyHeader is empty. The gateway will not be able to read a trusted identity header from your front proxy.',
    );
  }

  if (browserLoginEnabled && publicBaseUrl && trustedProxyHeader === 'tailscale-user-login') {
    warnings.push(
      'gateway.trustedProxyHeader is still set to tailscale-user-login. When you move to a formal Cloudflare Access application hostname, switch this to cf-access-authenticated-user-email.',
    );
  }

  return warnings;
}

export function buildGatewayConfig(deployment) {
  const publicBaseUrl = normalizeBaseUrl(deployment.gateway?.publicBaseUrl);
  const mobileDeepLinkBase = normalizeBaseUrl(deployment.gateway?.mobileDeepLinkBase);

  return {
    gatewayDistro: deployment.gateway?.distro || 'Ubuntu',
    listen: {
      host: deployment.gateway?.listenHost || '127.0.0.1',
      port: deployment.gateway?.listenPort || 8080,
    },
    auth: {
      pin: deployment.gateway?.pin || '123456',
      sessionSecret: deployment.gateway?.sessionSecret || 'replace-with-a-long-random-string',
      trustedProxyHeader: deployment.gateway?.trustedProxyHeader || 'tailscale-user-login',
      secureCookies: deployment.gateway?.secureCookies ?? true,
      localLoginEnabled: deployment.gateway?.localLoginEnabled ?? true,
      browserLoginEnabled: deployment.gateway?.browserLoginEnabled ?? Boolean(publicBaseUrl),
      allowedEmails: deployment.gateway?.allowedEmails || [],
      accessTokenTtlMs: deployment.gateway?.accessTokenTtlMs || 30 * 24 * 60 * 60 * 1000,
      refreshTokenTtlMs: deployment.gateway?.refreshTokenTtlMs || 30 * 24 * 60 * 60 * 1000,
      browserGrantTtlMs: deployment.gateway?.browserGrantTtlMs || 5 * 60 * 1000,
      deviceStorePath: deployment.gateway?.deviceStorePath || 'data/gateway/devices.json',
    },
    publicBaseUrl: publicBaseUrl || undefined,
    mobileDeepLinkBase: mobileDeepLinkBase || undefined,
    auditLogPath: deployment.gateway?.auditLogPath || 'data/gateway/audit.log',
    lockTtlMs: deployment.gateway?.lockTtlMs || 900000,
    pollIntervalMs: deployment.gateway?.pollIntervalMs || 3000,
    streamIntervalMs: deployment.gateway?.streamIntervalMs || 1500,
    notifications: {
      gotify: {
        baseUrl: normalizeBaseUrl(deployment.gotify?.baseUrl),
        token: deployment.gotify?.token || '',
      },
    },
    windows: {
      powerShellAdminWrapper: deployment.gateway?.windows?.powerShellAdminWrapper || '',
    },
    agents: (deployment.agents || []).map((agent) => ({
      id: agent.id,
      label: agent.label || agent.id,
      distro: agent.distro || deployment.gateway?.distro || 'Ubuntu',
      baseUrl: `http://127.0.0.1:${agent.port}`,
      token: agent.token,
    })),
  };
}

export function buildAgentConfig(_deployment, agent) {
  const safeId = sanitizeAgentId(agent.id);
  const dataDir = agent.dataDir || path.posix.join('data/agents', safeId);
  const workspacesRoot = agent.workspacesRoot || path.posix.join(dataDir, 'workspaces');

  return {
    listen: {
      host: agent.listenHost || '127.0.0.1',
      port: agent.port,
    },
    token: agent.token,
    sessionPrefix: agent.sessionPrefix || `${safeId}-`,
    defaultCommand: agent.defaultCommand || 'bash -il',
    dataDir,
    workspacesRoot,
    projectRoots: agent.projectRoots || [workspacesRoot],
    artifactsRoot: agent.artifactsRoot || path.posix.join(dataDir, 'artifacts'),
    snapshotLines: agent.snapshotLines || 220,
    detailSnapshotLines: agent.detailSnapshotLines || 3000,
    patterns: {
      attentionPatterns:
        agent.patterns?.attentionPatterns || ['approve', 'confirm', 'waiting for user', 'press enter', 'continue\\?'],
      completionPatterns: agent.patterns?.completionPatterns || ['task completed', 'done', 'finished'],
      errorPatterns: agent.patterns?.errorPatterns || ['error:', 'traceback', 'failed'],
    },
  };
}

export function buildNotificationClickUrl(config, sessionId) {
  if (!sessionId) {
    return null;
  }

  const publicBaseUrl = normalizeBaseUrl(config?.publicBaseUrl);
  const mobileDeepLinkBase = normalizeBaseUrl(config?.mobileDeepLinkBase);

  if (mobileDeepLinkBase && publicBaseUrl) {
    return buildMobileOpenUrl({
      mobileDeepLinkBase,
      gatewayUrl: publicBaseUrl,
      sessionId,
    });
  }

  if (!publicBaseUrl) {
    return null;
  }

  const url = new URL(publicBaseUrl);
  url.searchParams.set('session', sessionId);
  return url.toString();
}

export function buildGotifyExtras(clickUrl) {
  const extras = {
    'client::display': {
      contentType: 'text/plain',
    },
  };

  if (clickUrl) {
    extras['client::notification'] = {
      click: {
        url: clickUrl,
      },
    };
  }

  return extras;
}
