import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAgentConfig,
  buildGatewayConfig,
  buildNotificationClickUrl,
  generatedAgentConfigPath,
  generatedGatewayConfigPath,
} from '../src/shared/deployment.js';
import { buildMobileOpenUrl } from '../src/shared/mobile-links.js';

const deployment = {
  workspace: {
    defaultWslRepoPath: '/home/test/remote_connect',
  },
  gateway: {
    distro: 'Ubuntu',
    publicBaseUrl: 'https://remocli.tailnet.ts.net/',
    mobileDeepLinkBase: 'remoteconnect://open',
    pin: '654321',
    sessionSecret: 'secret',
  },
  gotify: {
    baseUrl: 'https://gotify.tailnet.ts.net/',
    token: 'gotify-token',
  },
  agents: [
    {
      id: 'ubuntu-codex-a',
      label: 'Ubuntu Codex A',
      distro: 'Ubuntu',
      port: 9101,
      token: 'agent-token',
      workspacesRoot: '/home/test/code',
      projectRoots: ['/home/test/code'],
    },
  ],
};

test('deployment config builders normalize urls and generated paths', () => {
  const gateway = buildGatewayConfig(deployment);
  const agent = buildAgentConfig(deployment, deployment.agents[0]);

  assert.equal(gateway.publicBaseUrl, 'https://remocli.tailnet.ts.net');
  assert.equal(gateway.mobileDeepLinkBase, 'remoteconnect://open');
  assert.equal(gateway.gatewayDistro, 'Ubuntu');
  assert.equal(gateway.notifications.gotify.baseUrl, 'https://gotify.tailnet.ts.net');
  assert.equal(gateway.agents[0].baseUrl, 'http://127.0.0.1:9101');
  assert.equal(gateway.agents[0].distro, 'Ubuntu');
  assert.equal(gateway.auth.accessTokenTtlMs, 30 * 24 * 60 * 60 * 1000);
  assert.equal(gateway.auth.refreshTokenTtlMs, 30 * 24 * 60 * 60 * 1000);
  assert.equal(agent.listen.port, 9101);
  assert.equal(agent.dataDir, 'data/agents/ubuntu-codex-a');
  assert.equal(agent.workspacesRoot, '/home/test/code');
  assert.deepEqual(agent.projectRoots, ['/home/test/code']);
  assert.equal(agent.defaultCommand, 'bash -il');
  assert.equal(agent.snapshotLines, 220);
  assert.equal(agent.detailSnapshotLines, 3000);
  assert.equal(generatedGatewayConfigPath(), 'config/generated/gateway.generated.json');
  assert.equal(generatedAgentConfigPath('ubuntu-codex-a'), 'config/generated/agent.ubuntu-codex-a.generated.json');
});

test('notification click url prefers app deep link and falls back to web url', () => {
  const mobileUrl = buildNotificationClickUrl(deployment.gateway, 'ubuntu-codex-a:phone-debug');
  assert.equal(
    mobileUrl,
    'remoteconnect://open?gateway=https%3A%2F%2Fremocli.tailnet.ts.net&session=ubuntu-codex-a%3Aphone-debug',
  );

  const webUrl = buildNotificationClickUrl(
    {
      publicBaseUrl: 'https://remocli.tailnet.ts.net',
    },
    'ubuntu-codex-a:phone-debug',
  );
  assert.equal(webUrl, 'https://remocli.tailnet.ts.net/?session=ubuntu-codex-a%3Aphone-debug');
});

test('mobile open url keeps gateway, session, and grant parameters together', () => {
  assert.equal(
    buildMobileOpenUrl({
      mobileDeepLinkBase: 'remoteconnect://open',
      gatewayUrl: 'https://remocli.example.com/',
      entryUrl: 'https://team-example.cloudflareaccess.com/apps/remocli',
      sessionId: 'ubuntu-codex-a:remote-connect',
      grant: 'grant-123',
      profileId: 'public-team',
    }),
    'remoteconnect://open?gateway=https%3A%2F%2Fremocli.example.com&entry=https%3A%2F%2Fteam-example.cloudflareaccess.com%2Fapps%2Fremocli&session=ubuntu-codex-a%3Aremote-connect&grant=grant-123&profile=public-team',
  );
});
