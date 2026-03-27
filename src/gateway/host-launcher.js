import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class HostLauncher {
  constructor(config) {
    this.config = config;
  }

  async commandAvailable(commandName) {
    const escapedName = `${commandName}`.replace(/'/g, "''");

    try {
      await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `if (Get-Command '${escapedName}' -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }`,
        ],
        {
          maxBuffer: 1024 * 1024,
        },
      );
      return true;
    } catch {
      return false;
    }
  }

  async openTmuxSessionWindow({ agentDistro, sessionName, windowTitle, asAdmin = false }) {
    const gatewayDistro = `${this.config.gatewayDistro || 'Ubuntu'}`.trim();
    const scriptPath = linuxPathToUnc(path.resolve(process.cwd(), 'scripts/windows/open-tmux-session.ps1'), gatewayDistro);
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-Distro',
      `${agentDistro}`,
      '-SessionName',
      `${sessionName}`,
    ];

    if (`${windowTitle || ''}`.trim()) {
      args.push('-WindowTitle', `${windowTitle}`);
    }

    if (asAdmin) {
      args.push('-AsAdmin');
    }

    const { stdout, stderr } = await execFileAsync('powershell.exe', args, {
      maxBuffer: 1024 * 1024,
    });

    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    };
  }
}

function linuxPathToUnc(linuxPath, distro) {
  const segments = `${linuxPath}`.replace(/^\/+/, '').split('/').filter(Boolean);
  return `\\\\wsl.localhost\\${distro}\\${segments.join('\\')}`;
}
