export function detectSessionState(snapshot, patterns = {}) {
  const text = snapshot || '';
  const { attentionPatterns, completionPatterns, errorPatterns } = compilePatterns(patterns);

  if (completionPatterns.some((pattern) => pattern.test(text))) {
    return 'completed';
  }

  if (errorPatterns.some((pattern) => pattern.test(text))) {
    return 'error';
  }

  if (attentionPatterns.some((pattern) => pattern.test(text))) {
    return 'needs_input';
  }

  return 'running';
}

export function detectSessionStateFromCapture(capture = {}, patterns = {}) {
  const mode = `${capture?.mode || ''}`.trim();
  const source = selectStateDetectionSource(capture);
  const { errorPatterns } = compilePatterns(patterns);

  if (mode === 'chat') {
    if (capture?.readyForInput === false) {
      return 'running';
    }

    if (hasActiveCodexWorkingIndicator(source)) {
      return 'running';
    }

    if (errorPatterns.some((pattern) => pattern.test(extractChatDiagnosticText(source)))) {
      return 'error';
    }

    if (capture?.readyForInput) {
      return 'completed';
    }

    return 'running';
  }

  return detectSessionState(source, patterns);
}

function hasActiveCodexWorkingIndicator(snapshot) {
  const normalized = `${snapshot || ''}`
    .split(/\r?\n/)
    .map((line) => `${line || ''}`.trim())
    .filter(Boolean)
    .join('\n');
  if (!normalized) {
    return false;
  }

  return normalized.includes('Working (') || /esc to interrupt/i.test(normalized);
}

function selectStateDetectionSource(capture = {}) {
  const visibleSnapshot = `${capture?.visibleSnapshot || ''}`;
  const snapshot = `${capture?.snapshot || ''}`;
  return visibleSnapshot.trim() ? visibleSnapshot : snapshot;
}

function extractChatDiagnosticText(snapshot) {
  return `${snapshot || ''}`
    .split(/\r?\n/)
    .map((line) => `${line || ''}`.trimStart())
    .filter((line) => {
      if (!line) {
        return false;
      }

      if (line.startsWith('└') || line.startsWith('├') || line.startsWith('│')) {
        return true;
      }

      if (line.startsWith('{') || line.startsWith('[')) {
        return true;
      }

      return /^(ERR|ERROR|Error:|Traceback|curl:|fetch failed|command failed|HTTP\/)/i.test(line);
    })
    .join('\n');
}

function compilePatterns(patterns = {}) {
  return {
    attentionPatterns: (patterns.attentionPatterns || []).map((value) => new RegExp(value, 'im')),
    completionPatterns: (patterns.completionPatterns || []).map((value) => new RegExp(value, 'im')),
    errorPatterns: (patterns.errorPatterns || []).map((value) => new RegExp(value, 'im')),
  };
}

export function summarizeTransition(previousState, nextState) {
  if (previousState === nextState) {
    return null;
  }

  if (nextState === 'needs_input') {
    return '会话正在等待你的输入';
  }

  if (nextState === 'completed') {
    return '会话已完成';
  }

  if (nextState === 'error') {
    return '会话发生错误';
  }

  return null;
}
