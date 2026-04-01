import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configuredProjectRoots,
  listProjects,
  normalizeRequestedWorkspace,
  resolveSessionWorkspace,
  suggestWorkspacePaths,
} from '../src/agent/projects.js';

test('configuredProjectRoots prefers explicit project roots', () => {
  const roots = configuredProjectRoots(
    {
      workspacesRoot: '/tmp/fallback',
      projectRoots: ['/srv/code', '/srv/code'],
    },
    '/tmp/fallback',
  );

  assert.deepEqual(roots, ['/srv/code']);
});

test('listProjects returns direct child directories from configured roots', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-connect-projects-'));
  const projectA = path.join(tempRoot, 'alpha');
  const projectB = path.join(tempRoot, 'beta');
  fs.mkdirSync(projectA, { recursive: true });
  fs.mkdirSync(projectB, { recursive: true });
  fs.writeFileSync(path.join(tempRoot, 'README.md'), '# ignored\n', 'utf8');

  const projects = listProjects([tempRoot]);
  assert.deepEqual(
    projects.map((project) => project.name),
    ['alpha', 'beta'],
  );
  assert.equal(projects[0].root, tempRoot);
});

test('resolveSessionWorkspace keeps ad-hoc sessions under the configured workspaces root', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-connect-workspaces-'));
  const workspace = resolveSessionWorkspace(
    {
      workspacesRoot: tempRoot,
      projectRoots: [tempRoot],
    },
    tempRoot,
    'demo-session',
    null,
  );

  assert.equal(workspace, path.join(tempRoot, 'demo-session'));
  assert.equal(fs.existsSync(workspace), true);
});

test('resolveSessionWorkspace accepts existing project directories inside allowed roots', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-connect-project-root-'));
  const project = path.join(tempRoot, 'demo-project');
  fs.mkdirSync(project, { recursive: true });

  const workspace = resolveSessionWorkspace(
    {
      workspacesRoot: tempRoot,
      projectRoots: [tempRoot],
    },
    tempRoot,
    'ignored-name',
    project,
  );

  assert.equal(workspace, project);
});

test('resolveSessionWorkspace nests explicit named sessions under the requested project directory', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-connect-nested-project-root-'));
  const project = path.join(tempRoot, 'demo-project');
  fs.mkdirSync(project, { recursive: true });

  const workspace = resolveSessionWorkspace(
    {
      workspacesRoot: tempRoot,
      projectRoots: [tempRoot],
    },
    tempRoot,
    'review-run',
    project,
    {
      createIfMissing: true,
      createNamedSubdirectory: true,
    },
  );

  assert.equal(workspace, path.join(project, 'review-run'));
  assert.equal(fs.existsSync(workspace), true);
  assert.equal(fs.statSync(workspace).isDirectory(), true);
});

test('resolveSessionWorkspace rejects paths outside configured roots', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-connect-safe-root-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-connect-outside-root-'));
  const project = path.join(outsideRoot, 'rogue-project');
  fs.mkdirSync(project, { recursive: true });

  assert.throws(
    () =>
      resolveSessionWorkspace(
        {
          workspacesRoot: tempRoot,
          projectRoots: [tempRoot],
        },
        tempRoot,
        'ignored-name',
        project,
      ),
    /Workspace must live under one of/,
  );
});

test('normalizeRequestedWorkspace accepts backslash WSL-style paths', () => {
  assert.equal(
    normalizeRequestedWorkspace('\\home\\demo\\workspace\\test-codex', {
      flavor: 'wsl',
    }),
    '/home/demo/workspace/test-codex',
  );
});

test('normalizeRequestedWorkspace converts WSL UNC paths into Linux workspace paths', () => {
  assert.equal(
    normalizeRequestedWorkspace('\\\\wsl.localhost\\Ubuntu\\home\\demo\\workspace\\demo', {
      flavor: 'wsl',
    }),
    '/home/demo/workspace/demo',
  );
});

test('normalizeRequestedWorkspace converts Windows drive-letter paths for WSL agents', () => {
  assert.equal(
    normalizeRequestedWorkspace('C:\\Users\\Demo\\code\\demo', {
      flavor: 'wsl',
    }),
    '/mnt/c/Users/Demo/code/demo',
  );
});

test('normalizeRequestedWorkspace rejects Windows drive-letter paths for POSIX agents', () => {
  assert.throws(
    () =>
      normalizeRequestedWorkspace('C:\\Users\\Lin\\code', {
        flavor: 'posix',
      }),
    /selected agent can access/,
  );
});

test('resolveSessionWorkspace creates missing directories under the selected root when requested', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-connect-create-root-'));
  const nestedProject = path.join(tempRoot, 'team', 'new-project');

  const workspace = resolveSessionWorkspace(
    {
      workspacesRoot: tempRoot,
      projectRoots: [tempRoot],
    },
    tempRoot,
    'ignored-name',
    'team/new-project',
    {
      createIfMissing: true,
      preferredRoot: tempRoot,
      flavor: 'posix',
    },
  );

  assert.equal(workspace, nestedProject);
  assert.equal(fs.existsSync(workspace), true);
  assert.equal(fs.statSync(workspace).isDirectory(), true);
});

test('suggestWorkspacePaths lists direct child directories for the active root', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-connect-suggest-root-'));
  fs.mkdirSync(path.join(tempRoot, 'alpha'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, 'beta'), { recursive: true });

  const payload = suggestWorkspacePaths(
    {
      workspacesRoot: tempRoot,
      projectRoots: [tempRoot],
    },
    tempRoot,
    '',
    {
      preferredRoot: tempRoot,
      flavor: 'posix',
    },
  );

  assert.equal(payload.directoryPath, tempRoot);
  assert.deepEqual(
    payload.suggestions.map((item) => item.name),
    ['alpha', 'beta'],
  );
});

test('suggestWorkspacePaths filters child directories by the typed fragment', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-connect-suggest-filter-'));
  fs.mkdirSync(path.join(tempRoot, 'team-alpha'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, 'team-beta'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, 'docs'), { recursive: true });

  const payload = suggestWorkspacePaths(
    {
      workspacesRoot: tempRoot,
      projectRoots: [tempRoot],
    },
    tempRoot,
    path.join(tempRoot, 'team'),
    {
      preferredRoot: tempRoot,
      flavor: 'posix',
    },
  );

  assert.equal(payload.directoryPath, tempRoot);
  assert.deepEqual(
    payload.suggestions.map((item) => item.name),
    ['team-alpha', 'team-beta'],
  );
});
