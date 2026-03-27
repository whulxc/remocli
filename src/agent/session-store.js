import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, readJsonIfExists, writeJson } from '../shared/config.js';

export class SessionStore {
  constructor(baseDir) {
    this.baseDir = ensureDir(baseDir);
  }

  sessionFile(sessionName) {
    return path.join(this.baseDir, `${sessionName}.json`);
  }

  save(sessionName, payload) {
    writeJson(this.sessionFile(sessionName), payload);
  }

  read(sessionName) {
    return readJsonIfExists(this.sessionFile(sessionName), null);
  }

  remove(sessionName) {
    const filePath = this.sessionFile(sessionName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  list() {
    return fs
      .readdirSync(this.baseDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => readJsonIfExists(path.join(this.baseDir, entry.name), null))
      .filter(Boolean);
  }
}
