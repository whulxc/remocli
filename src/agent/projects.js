import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from '../shared/config.js';
import {
  WORKSPACE_FLAVOR_POSIX,
  WORKSPACE_FLAVOR_WINDOWS,
  WORKSPACE_FLAVOR_WSL,
  isWorkspaceWithinRoot,
  joinWorkspacePath,
  normalizeWorkspaceInput,
} from '../shared/workspace-paths.js';

export function configuredProjectRoots(config, fallbackRoot) {
  const configuredRoots =
    Array.isArray(config.projectRoots) && config.projectRoots.length > 0
      ? config.projectRoots
      : [config.workspacesRoot || fallbackRoot];

  return [...new Set(configuredRoots.filter(Boolean).map((rootPath) => path.resolve(rootPath)))];
}

export function listProjects(projectRoots) {
  const projects = [];

  for (const rootPath of projectRoots) {
    if (!fs.existsSync(rootPath)) {
      continue;
    }

    const entries = fs.readdirSync(rootPath, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }

      const projectPath = path.join(rootPath, entry.name);
      let stats;
      try {
        stats = fs.statSync(projectPath);
      } catch {
        continue;
      }

      if (!stats.isDirectory()) {
        continue;
      }

      projects.push({
        name: entry.name,
        path: projectPath,
        root: rootPath,
        rootLabel: rootLabel(rootPath),
        relativePath: path.relative(rootPath, projectPath) || entry.name,
      });
    }
  }

  return projects.sort((left, right) => {
    if (left.root === right.root) {
      return left.name.localeCompare(right.name);
    }
    return left.root.localeCompare(right.root);
  });
}

export function suggestWorkspacePaths(config, fallbackRoot, requestedWorkspace, options = {}) {
  const defaultWorkspaceRoot = path.resolve(config.workspacesRoot || fallbackRoot);
  const projectRoots = configuredProjectRoots(config, defaultWorkspaceRoot);
  const allowedRoots = [defaultWorkspaceRoot, ...projectRoots];
  const workspaceFlavor = detectWorkspaceFlavor(config, allowedRoots, options.flavor);
  const preferredRoot = `${options.preferredRoot || ''}`.trim();
  const baseRoot = preferredRoot
    ? normalizeRequestedWorkspace(preferredRoot, {
        allowedRoots,
        flavor: workspaceFlavor,
      })
    : path.resolve(projectRoots[0] || defaultWorkspaceRoot);
  const rawInput = `${requestedWorkspace || ''}`.trim();

  let directoryPath = path.resolve(baseRoot);
  let rootPath = selectAllowedRoot(directoryPath, allowedRoots) || directoryPath;
  let fragment = '';

  if (rawInput) {
    const normalizedInput = normalizeRequestedWorkspace(rawInput, {
      allowedRoots,
      preferredRoot: baseRoot,
      flavor: workspaceFlavor,
    });
    const candidatePath = path.resolve(joinWorkspacePath(baseRoot, normalizedInput));
    const endsWithSeparator = /[\\/]+$/.test(rawInput);
    const candidateIsDirectory = isDirectory(candidatePath);

    if (endsWithSeparator || candidateIsDirectory) {
      directoryPath = candidatePath;
    } else {
      directoryPath = path.dirname(candidatePath);
      fragment = path.basename(candidatePath);
    }

    rootPath = selectAllowedRoot(directoryPath, allowedRoots) || selectAllowedRoot(candidatePath, allowedRoots) || '';
  }

  if (!rootPath || !isWorkspaceWithinRoot(directoryPath, rootPath) || !isDirectory(directoryPath)) {
    return {
      workspaceFlavor,
      rootPath: rootPath || path.resolve(baseRoot),
      directoryPath,
      suggestions: [],
    };
  }

  const suggestions = fs.readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => ({
      entry,
      absolutePath: path.join(directoryPath, entry.name),
    }))
    .filter(({ absolutePath }) => isDirectory(absolutePath))
    .filter(({ entry }) => !fragment || entry.name.toLowerCase().startsWith(fragment.toLowerCase()))
    .map(({ entry, absolutePath }) => ({
      name: entry.name,
      path: absolutePath,
      rootPath,
      relativePath: path.relative(rootPath, absolutePath) || entry.name,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    workspaceFlavor,
    rootPath,
    directoryPath,
    suggestions,
  };
}

export function resolveSessionWorkspace(config, fallbackRoot, sessionName, requestedWorkspace, options = {}) {
  const defaultWorkspaceRoot = path.resolve(config.workspacesRoot || fallbackRoot);
  const projectRoots = configuredProjectRoots(config, defaultWorkspaceRoot);
  const preferredRoot = `${options.preferredRoot || ''}`.trim();
  const createIfMissing = Boolean(options.createIfMissing);
  const workspaceFlavor = detectWorkspaceFlavor(config, [defaultWorkspaceRoot, ...projectRoots], options.flavor);

  if (!requestedWorkspace) {
    return ensureDir(path.resolve(defaultWorkspaceRoot, sessionName));
  }

  const normalizedWorkspace = normalizeRequestedWorkspace(requestedWorkspace, {
    allowedRoots: [defaultWorkspaceRoot, ...projectRoots],
    preferredRoot,
    flavor: workspaceFlavor,
  });
  const normalizedPreferredRoot = preferredRoot
    ? normalizeRequestedWorkspace(preferredRoot, {
        allowedRoots: [defaultWorkspaceRoot, ...projectRoots],
        flavor: workspaceFlavor,
      })
    : '';
  const baseRoot = normalizedPreferredRoot
    ? path.resolve(normalizedPreferredRoot)
    : path.resolve(projectRoots[0] || defaultWorkspaceRoot);
  const candidatePath = path.resolve(joinWorkspacePath(baseRoot, normalizedWorkspace));
  const allowedRoots = [defaultWorkspaceRoot, ...projectRoots];

  if (!allowedRoots.some((rootPath) => isWorkspaceWithinRoot(candidatePath, rootPath))) {
    throw new Error(`Workspace must live under one of: ${allowedRoots.join(', ')}`);
  }

  if (!fs.existsSync(candidatePath)) {
    if (createIfMissing) {
      return ensureDir(candidatePath);
    }
    throw new Error(`Workspace does not exist: ${candidatePath}`);
  }

  if (!fs.statSync(candidatePath).isDirectory()) {
    throw new Error(`Workspace is not a directory: ${candidatePath}`);
  }

  return candidatePath;
}

export function normalizeRequestedWorkspace(requestedWorkspace, options = {}) {
  const rawValue = `${requestedWorkspace || ''}`.trim();
  if (!rawValue) {
    return '';
  }

  const preferredRoot = `${options.preferredRoot || ''}`.trim();
  const allowedRoots = Array.isArray(options.allowedRoots) ? options.allowedRoots : [];
  return normalizeWorkspaceInput(rawValue, {
    rootPaths: [preferredRoot, ...allowedRoots],
    flavor: options.flavor,
    fallbackFlavor: detectHostWorkspaceFlavor(),
  });
}

function detectWorkspaceFlavor(config, rootPaths, explicitFlavor) {
  const configuredFlavor = `${config.workspaceFlavor || ''}`.trim();
  return normalizeRequestedWorkspaceFlavor(explicitFlavor || configuredFlavor || detectHostWorkspaceFlavor(), rootPaths);
}

function normalizeRequestedWorkspaceFlavor(flavor, rootPaths) {
  const normalizedFlavor = `${flavor || ''}`.trim().toLowerCase();
  if (normalizedFlavor === WORKSPACE_FLAVOR_WSL || normalizedFlavor === WORKSPACE_FLAVOR_WINDOWS || normalizedFlavor === WORKSPACE_FLAVOR_POSIX) {
    return normalizedFlavor;
  }
  if (rootPaths.some((rootPath) => /^\/mnt\/[a-z](?:\/|$)/i.test(rootPath))) {
    return WORKSPACE_FLAVOR_WSL;
  }
  if (rootPaths.some((rootPath) => /^[a-zA-Z]:[\\/]/.test(rootPath))) {
    return WORKSPACE_FLAVOR_WINDOWS;
  }
  return WORKSPACE_FLAVOR_POSIX;
}

function detectHostWorkspaceFlavor() {
  if (process.platform === 'win32') {
    return WORKSPACE_FLAVOR_WINDOWS;
  }

  if (process.platform === 'linux') {
    try {
      if (fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop')) {
        return WORKSPACE_FLAVOR_WSL;
      }
      const version = fs.readFileSync('/proc/version', 'utf8');
      if (/microsoft/i.test(version)) {
        return WORKSPACE_FLAVOR_WSL;
      }
    } catch {
      // Ignore and fall back to POSIX.
    }
  }

  return WORKSPACE_FLAVOR_POSIX;
}

function rootLabel(rootPath) {
  const normalized = rootPath.replace(/\/+$/, '');
  return path.basename(normalized) || normalized || '/';
}

function isDirectory(directoryPath) {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function selectAllowedRoot(candidatePath, allowedRoots) {
  return [...allowedRoots]
    .sort((left, right) => right.length - left.length)
    .find((rootPath) => isWorkspaceWithinRoot(candidatePath, rootPath)) || '';
}
