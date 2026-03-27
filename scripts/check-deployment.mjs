import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { buildAgentConfig, buildGatewayConfig, collectDeploymentWarnings } from '../src/shared/deployment.js';

const inputPath = path.resolve(process.cwd(), process.argv[2] || 'config/deployment.local.json');
const deployment = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const warnings = collectDeploymentWarnings(deployment);

const gatewayConfig = buildGatewayConfig(deployment);
const gatewayBaseUrl = `http://${gatewayConfig.listen.host}:${gatewayConfig.listen.port}`;
const results = [];

results.push(await checkJson(`${gatewayBaseUrl}/health`, 'gateway'));

for (const agent of deployment.agents || []) {
  const agentConfig = buildAgentConfig(deployment, agent);
  const agentBaseUrl = `http://${agentConfig.listen.host}:${agentConfig.listen.port}`;
  results.push(await checkJson(`${agentBaseUrl}/health`, `agent:${agent.id}`, {
    'x-agent-token': agent.token,
  }));
}

for (const result of results) {
  const prefix = result.ok ? '[ok]' : '[fail]';
  console.log(`${prefix} ${result.name} ${result.url}`);
  if (result.ok) {
    console.log(`       ${JSON.stringify(result.body)}`);
  } else {
    console.log(`       ${result.error}`);
  }
}

if (results.some((result) => !result.ok)) {
  process.exitCode = 1;
}

for (const warning of warnings) {
  console.warn(`[warn] ${warning}`);
}

async function checkJson(url, name, headers = {}) {
  try {
    const response = await fetch(url, { headers });
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        name,
        url,
        error: `${response.status} ${text}`,
      };
    }

    return {
      ok: true,
      name,
      url,
      body: JSON.parse(text),
    };
  } catch (error) {
    return {
      ok: false,
      name,
      url,
      error: error.message,
    };
  }
}
