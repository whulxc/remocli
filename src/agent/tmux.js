import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function tmux(args, options = {}) {
  const { stdout, stderr } = await execFileAsync('tmux', args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...(options.env || {}),
    },
    maxBuffer: 10 * 1024 * 1024,
  });

  return {
    stdout: stdout.trimEnd(),
    stderr: stderr.trimEnd(),
  };
}

export async function listSessions(prefix, options = {}) {
  const { includeAll = false } = options;

  try {
    const { stdout } = await tmux([
      'list-sessions',
      '-F',
      '#{session_name}\t#{session_created}\t#{session_activity}\t#{session_attached}',
    ]);

    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sessionName, createdAt, activityAt, attached] = line.split('\t');
        return {
          sessionName,
          createdAt: Number(createdAt) * 1000,
          activityAt: Number(activityAt) * 1000,
          attached: Number(attached || 0) > 0,
        };
      })
      .filter((session) => includeAll || session.sessionName.startsWith(prefix));
  } catch (error) {
    if (isTmuxServerMissing(error)) {
      return [];
    }

    throw error;
  }
}

export async function createSession(name, command, workspace, env) {
  const envPrefix = Object.entries(env)
    .map(([key, value]) => `${key}=${shellEscape(value)}`)
    .join(' ');
  const shellCommand = `${envPrefix} exec ${command}`;
  await tmux(['new-session', '-d', '-s', name, '-c', workspace, 'sh', '-lc', shellCommand]);
}

export async function captureSession(name, lineCount = 300) {
  const { stdout } = await tmux(['capture-pane', '-p', '-e', '-J', '-S', `-${lineCount}`, '-t', `${name}:0.0`]);
  return stdout;
}

export async function captureSessionWindow(name, lineCount = 300) {
  const normalizedLineCount = Math.max(1, Number.parseInt(`${lineCount}`, 10) || 300);
  const snapshot = await captureSession(name, normalizedLineCount + 1);
  const lines = `${snapshot || ''}` ? `${snapshot}`.split(/\r?\n/) : [];
  if (lines.length <= normalizedLineCount) {
    return {
      snapshot,
      lineCount: lines.length,
      hasEarlierHistory: false,
    };
  }
  const windowedLines = lines.slice(lines.length - normalizedLineCount);
  return {
    snapshot: windowedLines.join('\n'),
    lineCount: windowedLines.length,
    hasEarlierHistory: true,
  };
}

export async function captureFullSession(name) {
  const { stdout } = await tmux(['capture-pane', '-p', '-e', '-J', '-S', '-', '-t', `${name}:0.0`]);
  return stdout;
}

export async function captureVisiblePane(name) {
  const { stdout } = await tmux(['capture-pane', '-p', '-e', '-t', `${name}:0.0`]);
  return stdout;
}

export async function paneInfo(name) {
  const { stdout } = await tmux([
    'display-message',
    '-p',
    '-t',
    `${name}:0.0`,
    '#{cursor_x}\t#{cursor_y}\t#{pane_width}\t#{pane_height}\t#{pane_in_mode}\t#{pane_current_command}\t#{pane_current_path}',
  ]);
  const [cursorX, cursorY, width, height, inMode, currentCommand, currentPath] = stdout.split('\t');
  return {
    cursorX: Number(cursorX || 0),
    cursorY: Number(cursorY || 0),
    width: Number(width || 0),
    height: Number(height || 0),
    inMode: inMode === '1',
    currentCommand: currentCommand || '',
    currentPath: currentPath || '',
  };
}

export async function sendText(name, text) {
  await tmux(['send-keys', '-t', `${name}:0.0`, '-l', '--', text]);
}

export async function sendKey(name, key) {
  await tmux(['send-keys', '-t', `${name}:0.0`, key]);
}

export async function sessionExists(name) {
  try {
    await tmux(['has-session', '-t', name]);
    return true;
  } catch (error) {
    const stderr = `${error.stderr || ''}`;
    if (stderr.includes("can't find session") || isTmuxServerMissing(error)) {
      return false;
    }

    throw error;
  }
}

export async function killSession(name) {
  await tmux(['kill-session', '-t', name]);
}

export async function renameSession(currentName, nextName) {
  await tmux(['rename-session', '-t', currentName, nextName]);
}

export async function renameWindow(sessionName, windowName) {
  await tmux(['rename-window', '-t', `${sessionName}:0`, `${windowName}`]);
}

function shellEscape(value) {
  return `'${`${value}`.replace(/'/g, `'\\''`)}'`;
}

function isTmuxServerMissing(error) {
  const stderr = `${error?.stderr || ''}`;
  return (
    stderr.includes('no server running') ||
    stderr.includes('server exited unexpectedly') ||
    stderr.includes('error connecting to /tmp/tmux-')
  );
}
