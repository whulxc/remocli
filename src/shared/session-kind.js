export const SESSION_KIND_WSL = 'wsl';
export const SESSION_KIND_POWERSHELL = 'powershell';

const SESSION_KINDS = new Set([SESSION_KIND_WSL, SESSION_KIND_POWERSHELL]);

export function normalizeSessionKind(value) {
  const normalized = `${value || ''}`.trim().toLowerCase();
  if (SESSION_KINDS.has(normalized)) {
    return normalized;
  }

  return SESSION_KIND_WSL;
}

export function inferSessionKind(metadata = {}) {
  const source = metadata && typeof metadata === 'object' ? metadata : {};
  const requested = `${source.kind || ''}`.trim().toLowerCase();
  if (SESSION_KINDS.has(requested)) {
    return requested;
  }

  const command = `${source.command || source.currentCommand || ''}`.toLowerCase();
  if (command.includes('powershell') || command.includes('pwsh')) {
    return SESSION_KIND_POWERSHELL;
  }

  const inspectionText = [source.previewText, source.visibleSnapshot, source.snapshot]
    .filter((value) => `${value || ''}`.trim())
    .join('\n');
  if (
    /(^|\n)\s*PS[\s\S]{0,240}>/.test(inspectionText) ||
    inspectionText.includes('Microsoft.PowerShell.Core\\FileSystem::')
  ) {
    return SESSION_KIND_POWERSHELL;
  }

  return SESSION_KIND_WSL;
}

export function buildSessionCommand(options = {}) {
  const command = `${options.command || ''}`.trim();
  if (command) {
    return command;
  }

  const sessionKind = normalizeSessionKind(options.sessionKind);
  if (sessionKind === SESSION_KIND_POWERSHELL) {
    const baseCommand = 'powershell.exe -NoLogo';
    if (options.admin) {
      const adminWrapper = `${options.powerShellAdminWrapper || ''}`.trim();
      if (!adminWrapper) {
        throw new Error('Administrator PowerShell requires gateway.windows.powerShellAdminWrapper');
      }
      return `${adminWrapper} ${baseCommand}`;
    }
    return baseCommand;
  }

  return 'bash -il';
}

export function sessionKindLabel(value, options = {}) {
  const sessionKind = normalizeSessionKind(value);
  if (sessionKind === SESSION_KIND_POWERSHELL) {
    return options.admin ? 'PowerShell 管理员' : 'PowerShell';
  }

  return 'WSL 终端';
}

export function defaultSessionName(sessionKind, workspace = '') {
  const trimmedWorkspace = `${workspace || ''}`.trim().replace(/[\\/]+$/, '');
  if (trimmedWorkspace) {
    return trimmedWorkspace.split(/[\\/]/).filter(Boolean).pop() || '';
  }

  if (normalizeSessionKind(sessionKind) === SESSION_KIND_POWERSHELL) {
    return `powershell-${Date.now()}`;
  }

  return `wsl-${Date.now()}`;
}
