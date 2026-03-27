import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const deploymentPath = path.resolve(process.cwd(), process.argv[2] || 'config/deployment.local.json');
const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
const service = deployment.gotify?.service;

if (!service) {
  throw new Error('deployment.gotify.service is required');
}

if (deployment.gotify?.token) {
  console.log('Gotify token already present; skipping provisioning.');
  process.exit(0);
}

const host = service.listenHost || '127.0.0.1';
const port = service.listenPort || 18080;
const baseUrl = trimBaseUrl(deployment.gotify?.baseUrl) || `http://${host}:${port}`;
const adminUser = service.adminUser || 'admin';
const adminPass = service.adminPass;
const applicationName = service.applicationName || 'RemoCLI';

if (!adminPass) {
  throw new Error('deployment.gotify.service.adminPass is required');
}

await waitForService(`${baseUrl}/health`, 20, 500);

const response = await fetch(`${baseUrl}/application`, {
  method: 'POST',
  headers: {
    authorization: `Basic ${Buffer.from(`${adminUser}:${adminPass}`).toString('base64')}`,
  },
  body: createFormBody({
    name: applicationName,
    description: 'RemoCLI notifications',
  }),
});

if (!response.ok) {
  const body = await response.text();
  throw new Error(`Failed to create Gotify application: ${response.status} ${body}`);
}

const payload = await response.json();
deployment.gotify.baseUrl = baseUrl;
deployment.gotify.token = payload.token;
fs.writeFileSync(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`, 'utf8');

console.log(`Provisioned Gotify application '${applicationName}'.`);
console.log(`Updated ${path.relative(process.cwd(), deploymentPath)} with token ${payload.token}.`);

async function waitForService(url, attempts, delayMs) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until attempts are exhausted.
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`Gotify did not become ready at ${url}`);
}

function createFormBody(values) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    form.set(key, value);
  }
  return form;
}

function trimBaseUrl(value) {
  if (!value) {
    return '';
  }

  return `${value}`.trim().replace(/\/+$/, '');
}
