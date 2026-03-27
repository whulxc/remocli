import fs from 'node:fs';
import path from 'node:path';

export function loadJsonConfig(envKey, fallbackPath) {
  const configPath = path.resolve(process.cwd(), process.env[envKey] || fallbackPath);
  const raw = fs.readFileSync(configPath, 'utf8');
  return {
    configPath,
    config: JSON.parse(raw),
  };
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function readJsonIfExists(filePath, fallbackValue) {
  if (!fs.existsSync(filePath)) {
    return fallbackValue;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function safeSessionId(agentId, sessionName) {
  return `${encodeURIComponent(agentId)}:${encodeURIComponent(sessionName)}`;
}

export function parseCompositeSessionId(compositeId) {
  const [encodedAgentId, encodedSessionName] = compositeId.split(':');
  if (!encodedAgentId || !encodedSessionName) {
    throw new Error(`Invalid session id: ${compositeId}`);
  }

  return {
    agentId: decodeURIComponent(encodedAgentId),
    sessionName: decodeURIComponent(encodedSessionName),
  };
}
