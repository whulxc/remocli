import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const deploymentPath = path.resolve(process.cwd(), process.argv[2] || 'config/deployment.local.json');
const nextUrl = `${process.argv[3] || ''}`.trim();

if (!nextUrl) {
  throw new Error('A public base URL is required');
}

const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
deployment.gateway = deployment.gateway || {};
deployment.gateway.publicBaseUrl = nextUrl.replace(/\/+$/, '');
fs.writeFileSync(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`, 'utf8');

console.log(`Updated ${path.relative(process.cwd(), deploymentPath)} with ${deployment.gateway.publicBaseUrl}`);
