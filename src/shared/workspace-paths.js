export const WORKSPACE_FLAVOR_POSIX = 'posix';
export const WORKSPACE_FLAVOR_WSL = 'wsl';
export const WORKSPACE_FLAVOR_WINDOWS = 'windows';

const WORKSPACE_FLAVORS = new Set([WORKSPACE_FLAVOR_POSIX, WORKSPACE_FLAVOR_WSL, WORKSPACE_FLAVOR_WINDOWS]);

export function normalizeWorkspaceFlavor(value) {
  const normalized = `${value || ''}`.trim().toLowerCase();
  return WORKSPACE_FLAVORS.has(normalized) ? normalized : '';
}

export function inferWorkspaceFlavor(rootPaths = [], options = {}) {
  const explicitFlavor = normalizeWorkspaceFlavor(options.flavor);
  if (explicitFlavor) {
    return explicitFlavor;
  }

  const fallbackFlavor = normalizeWorkspaceFlavor(options.fallbackFlavor) || WORKSPACE_FLAVOR_POSIX;
  const normalizedRoots = toWorkspacePathList(rootPaths).map((rootPath) => normalizeWorkspacePathLoose(rootPath)).filter(Boolean);

  if (normalizedRoots.some((rootPath) => /^[a-zA-Z]:\//.test(rootPath) || /^\/\/[^/]+\/[^/]+/.test(rootPath))) {
    return WORKSPACE_FLAVOR_WINDOWS;
  }
  if (normalizedRoots.some((rootPath) => /^\/mnt\/[a-z](?:\/|$)/i.test(rootPath))) {
    return WORKSPACE_FLAVOR_WSL;
  }

  return fallbackFlavor;
}

export function normalizeWorkspaceInput(workspacePath, options = {}) {
  const rawValue = `${workspacePath || ''}`.trim();
  if (!rawValue) {
    return '';
  }

  const flavor = inferWorkspaceFlavor(options.rootPaths, {
    flavor: options.flavor,
    fallbackFlavor: options.fallbackFlavor,
  });
  let normalized = rawValue.replace(/\\/g, '/');

  const wslMatch = normalized.match(/^\/\/(?:wsl(?:\.localhost)?|wsl\$)\/([^/]+)(\/.*)?$/i);
  if (wslMatch) {
    normalized =
      flavor === WORKSPACE_FLAVOR_WINDOWS ? `//wsl.localhost/${wslMatch[1]}${wslMatch[2] || ''}` : wslMatch[2] || '/';
  }

  const driveMatch = normalized.match(/^([a-zA-Z]):(?:\/(.*))?$/);
  if (driveMatch) {
    if (flavor === WORKSPACE_FLAVOR_WSL) {
      normalized = `/mnt/${driveMatch[1].toLowerCase()}${driveMatch[2] ? `/${driveMatch[2]}` : ''}`;
    } else if (flavor === WORKSPACE_FLAVOR_POSIX) {
      throw new Error('Workspace must use a path format that the selected agent can access');
    } else {
      normalized = `${driveMatch[1].toUpperCase()}:/${driveMatch[2] || ''}`;
    }
  }

  return normalizeWorkspacePathLoose(normalized);
}

export function normalizeWorkspacePathLoose(workspacePath) {
  const rawValue = `${workspacePath || ''}`.trim();
  if (!rawValue) {
    return '';
  }

  let normalized = rawValue.replace(/\\/g, '/');
  const wslMatch = normalized.match(/^\/\/(?:wsl(?:\.localhost)?|wsl\$)\/([^/]+)(\/.*)?$/i);
  if (wslMatch) {
    normalized = `//wsl.localhost/${wslMatch[1]}${wslMatch[2] || ''}`;
  }

  const driveMatch = normalized.match(/^([a-zA-Z]):(?:\/(.*))?$/);
  if (driveMatch) {
    normalized = `${driveMatch[1].toUpperCase()}:/${driveMatch[2] || ''}`;
  }

  normalized = collapseWorkspacePath(normalized);
  if (normalized.length > 1 && !/^[a-zA-Z]:\/$/.test(normalized) && !/^\/\/[^/]+\/[^/]+$/.test(normalized)) {
    normalized = normalized.replace(/\/+$/, '');
  }

  return normalized;
}

export function joinWorkspacePath(rootPath, childPath) {
  const normalizedChild = normalizeWorkspacePathLoose(childPath);
  if (!normalizedChild) {
    return normalizeWorkspacePathLoose(rootPath);
  }
  if (isAbsoluteWorkspacePath(normalizedChild)) {
    return normalizedChild;
  }

  const normalizedRoot = normalizeWorkspacePathLoose(rootPath);
  if (!normalizedRoot) {
    return normalizedChild;
  }

  const separator = normalizedRoot.endsWith('/') ? '' : '/';
  return normalizeWorkspacePathLoose(`${normalizedRoot}${separator}${normalizedChild}`);
}

export function isAbsoluteWorkspacePath(workspacePath) {
  const normalized = normalizeWorkspacePathLoose(workspacePath);
  return normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized) || /^\/\/[^/]+\/[^/]+/.test(normalized);
}

export function isWorkspaceWithinRoot(candidatePath, rootPath) {
  const normalizedCandidate = normalizeWorkspacePathLoose(candidatePath);
  const normalizedRoot = normalizeWorkspacePathLoose(rootPath);
  if (!normalizedCandidate || !normalizedRoot) {
    return false;
  }

  const candidateKey = workspaceComparisonKey(normalizedCandidate);
  const rootKey = workspaceComparisonKey(normalizedRoot);
  return candidateKey === rootKey || candidateKey.startsWith(`${rootKey}/`);
}

export function workspacePathsEqual(leftPath, rightPath) {
  const normalizedLeft = normalizeWorkspacePathLoose(leftPath);
  const normalizedRight = normalizeWorkspacePathLoose(rightPath);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return workspaceComparisonKey(normalizedLeft) === workspaceComparisonKey(normalizedRight);
}

function collapseWorkspacePath(workspacePath) {
  const rawValue = `${workspacePath || ''}`.trim().replace(/\\/g, '/');
  if (!rawValue) {
    return '';
  }

  let prefix = '';
  let remainder = rawValue;

  const uncMatch = rawValue.match(/^\/\/[^/]+\/[^/]+/);
  if (uncMatch) {
    prefix = uncMatch[0];
    remainder = rawValue.slice(prefix.length);
  } else {
    const driveMatch = rawValue.match(/^([a-zA-Z]:)\/?/);
    if (driveMatch) {
      prefix = `${driveMatch[1]}/`;
      remainder = rawValue.slice(prefix.length);
    } else if (rawValue.startsWith('/')) {
      prefix = '/';
      remainder = rawValue.slice(1);
    }
  }

  const output = [];
  for (const segment of remainder.split('/')) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (output.length && output[output.length - 1] !== '..') {
        output.pop();
        continue;
      }
      if (!prefix) {
        output.push(segment);
      }
      continue;
    }
    output.push(segment);
  }

  const body = output.join('/');
  if (!prefix) {
    return body;
  }
  if (!body) {
    return prefix;
  }
  return prefix.endsWith('/') ? `${prefix}${body}` : `${prefix}/${body}`;
}

function workspaceComparisonKey(workspacePath) {
  const normalized = normalizeWorkspacePathLoose(workspacePath);
  return /^[a-zA-Z]:\//.test(normalized) || /^\/\/[^/]+\/[^/]+/.test(normalized)
    ? normalized.toLowerCase()
    : normalized;
}

function toWorkspacePathList(rootPaths) {
  return Array.isArray(rootPaths) ? rootPaths : [rootPaths];
}
