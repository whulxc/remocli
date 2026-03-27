import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { ensureDir, writeJson } from '../src/shared/config.js';
import {
  buildAgentConfig,
  buildGatewayConfig,
  collectDeploymentWarnings,
  generatedAgentConfigPath,
  generatedGatewayConfigPath,
} from '../src/shared/deployment.js';

const inputPath = path.resolve(process.cwd(), process.argv[2] || 'config/deployment.local.json');

if (!fs.existsSync(inputPath)) {
  console.error(`Deployment config not found: ${inputPath}`);
  process.exit(1);
}

const deployment = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
validateDeployment(deployment);
const warnings = collectDeploymentWarnings(deployment);

const generatedDir = path.resolve(process.cwd(), path.dirname(generatedGatewayConfigPath()));
ensureDir(generatedDir);

const gatewayConfigPath = path.resolve(process.cwd(), generatedGatewayConfigPath());
writeJson(gatewayConfigPath, buildGatewayConfig(deployment));
console.log(`Wrote ${path.relative(process.cwd(), gatewayConfigPath)}`);

for (const agent of deployment.agents) {
  const outputPath = path.resolve(process.cwd(), generatedAgentConfigPath(agent.id));
  writeJson(outputPath, buildAgentConfig(deployment, agent));
  console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
}

for (const warning of warnings) {
  console.warn(`[warn] ${warning}`);
}

function validateDeployment(deployment) {
  if (!deployment?.gateway?.distro) {
    throw new Error('deployment.gateway.distro is required');
  }

  if (!deployment?.workspace?.defaultWslRepoPath && !deployment?.gateway?.wslRepoPath) {
    throw new Error('deployment.workspace.defaultWslRepoPath or deployment.gateway.wslRepoPath is required');
  }

  if (!Array.isArray(deployment.agents) || deployment.agents.length === 0) {
    throw new Error('deployment.agents must contain at least one agent');
  }

  const ids = new Set();
  const ports = new Set();
  for (const agent of deployment.agents) {
    if (!agent.id || !agent.distro || !agent.port || !agent.token) {
      throw new Error(`agent entries require id, distro, port, and token: ${JSON.stringify(agent)}`);
    }

    if (ids.has(agent.id)) {
      throw new Error(`duplicate agent id: ${agent.id}`);
    }
    ids.add(agent.id);

    if (ports.has(agent.port)) {
      throw new Error(`duplicate agent port: ${agent.port}`);
    }
    ports.add(agent.port);
  }
}
