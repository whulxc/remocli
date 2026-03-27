import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from '../shared/config.js';

export class AuditLog {
  constructor(filePath = 'data/gateway/audit.log') {
    this.filePath = path.resolve(process.cwd(), filePath);
    ensureDir(path.dirname(this.filePath));
  }

  write(event) {
    const line = JSON.stringify({
      time: new Date().toISOString(),
      ...event,
    });
    fs.appendFileSync(this.filePath, `${line}\n`, 'utf8');
  }
}
