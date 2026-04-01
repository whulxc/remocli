import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { defaultSessionName, normalizeSessionKind, sessionKindLabel } from '../shared/session-kind.js';
import {
  deriveCompletionNotificationSessionIds,
  normalizeCompletionAlertSettings,
  normalizeSessionCompletionAlertOverrides,
  resolveCompletionAlertEnabled,
  resolveCompletionAlertDeliverySettings,
  deriveSessionNotificationEvents,
} from '../shared/session-alerts.js';
import {
  inferWorkspaceFlavor,
  isWorkspaceWithinRoot,
  joinWorkspacePath,
  normalizeWorkspaceInput,
  workspacePathsEqual,
} from '../shared/workspace-paths.js';
import { deriveSessionStatusDisplay } from '../shared/session-status-display.js';
import { buildMobileOpenUrl } from '../shared/mobile-links.js';
import {
  formatConversationDetailDisplayText,
  formatConversationSummaryDisplayText,
} from '../shared/summary-display.js';
import {
  previewFromConversation,
  previewFromSnapshot,
} from '../shared/session-preview.js';
import {
  attachmentIdentity,
  buildComposerSubmissionText,
  mergeComposerAttachments,
} from '../shared/composer-attachments.js';
import {
  buildSessionCacheScope,
  DEFAULT_SESSION_CACHE_MAX_BYTES,
  loadConversationItemDetailCache,
  loadSessionSummaryCache,
  removeSessionCacheEntries,
  renameSessionCacheEntries,
  saveConversationItemDetailCache,
  saveSessionSummaryCache,
} from './session-cache.js';

const VIEW_LOGIN = 'login';
const VIEW_APP = 'app';
const LOGIN_ACTION_NONE = 'none';
const LOGIN_ACTION_LOCAL = 'local';
const LOGIN_ACTION_BROWSER = 'browser';
const PROJECT_PATH_KEY = 'remote-connect-project-path';
const PROJECT_AGENT_KEY = 'remote-connect-project-agent';
const PROJECT_ROOT_KEY = 'remote-connect-project-root';
const CLIENT_ID_KEY = 'remote-connect-client-id';
const COMPLETION_ALERT_SETTINGS_KEY = 'remote-connect-completion-alert-settings';
const SESSION_COMPLETION_ALERT_OVERRIDES_KEY = 'remote-connect-session-completion-alert-overrides';
const COMPLETED_UNREAD_KEY = 'remote-connect-completed-unread';
const SEEN_SESSION_ACTIVITY_KEY = 'remote-connect-seen-session-activity';
const SEEN_SESSION_CONTENT_SIGNATURE_KEY = 'remote-connect-seen-session-content-signature';
const DEFAULT_DETAIL_SNAPSHOT_LINES = 1000;
const SNAPSHOT_LOAD_STEP_LINES = 1000;
const SNAPSHOT_TOP_THRESHOLD_PX = 24;
const DEFAULT_MOBILE_DEEP_LINK_BASE = 'remoteconnect://open';
const SESSION_CACHE_MAX_BYTES = DEFAULT_SESSION_CACHE_MAX_BYTES;

const state = {
  clientId: localStorage.getItem(CLIENT_ID_KEY) || createClientId(),
  currentProjectPath: localStorage.getItem(PROJECT_PATH_KEY) || '',
  pendingProjectPath: localStorage.getItem(PROJECT_PATH_KEY) || '',
  currentProjectAgentId: localStorage.getItem(PROJECT_AGENT_KEY) || '',
  currentProjectRoot: localStorage.getItem(PROJECT_ROOT_KEY) || '',
  identitySummary: '',
  projectSuggestions: [],
  projectSuggestionMeta: '',
  projectSuggestionError: '',
  projectSuggestionLoading: false,
  projectPickerVisible: false,
  projectSuggestionRequestId: 0,
  currentSession: null,
  sessions: [],
  availableSessions: [],
  agents: [],
  projectAgents: [],
  socket: null,
  hasControl: false,
  activeSheet: '',
  composeMode: 'existing',
  mobilePane: 'list',
  selectionMode: false,
  selectedSessionIds: new Set(),
  composeSubmitting: false,
  dragSessionId: '',
  dragPointerId: null,
  dragChanged: false,
  ignoreCardClickUntil: 0,
  editingContext: null,
  lastConversationKey: '',
  refreshTimer: 0,
  refreshPromise: null,
  queuedRefreshOptions: null,
  attachments: [],
  completionAlertSettings: loadCompletionAlertSettings(),
  sessionCompletionAlertOverrides: loadSessionCompletionAlertOverrides(),
  unreadCompletedSessionIds: new Set(loadCompletedUnreadSessionIds()),
  alertedSessionMarkers: {},
  seenSessionActivity: loadSeenSessionActivity(),
  seenSessionContentSignatures: loadSeenSessionContentSignatures(),
  authPolicy: null,
  loginAction: LOGIN_ACTION_NONE,
  detailSnapshotLines: DEFAULT_DETAIL_SNAPSHOT_LINES,
  detailSnapshotLineCount: 0,
  detailSnapshotHasEarlierHistory: false,
  detailSnapshotMode: 'raw_terminal',
  detailSnapshotLoadingOlder: false,
  pendingSnapshotViewport: null,
  currentConversationItems: [],
  conversationDetailById: {},
  expandedConversationItemIds: new Set(),
  loadingConversationItemIds: new Set(),
  conversationContentSignature: '',
  sessionAlertPopupQueue: [],
  activeSessionAlertPopup: null,
  sessionAlertPopupTimer: 0,
  clearingUnreadSessionIds: new Set(),
};

const elements = {
  loginView: document.querySelector('#login-view'),
  appView: document.querySelector('#app-view'),
  loginForm: document.querySelector('#login-form'),
  gatewaySummary: document.querySelector('#gateway-summary'),
  loginModeSummary: document.querySelector('#login-mode-summary'),
  pinField: document.querySelector('#pin-field'),
  pinInput: document.querySelector('#pin'),
  loginActionButton: document.querySelector('#login-action-button'),
  loginStatus: document.querySelector('#login-status'),
  mobileBackButton: document.querySelector('#mobile-back-button'),
  headerTitle: document.querySelector('#header-title'),
  userSummary: document.querySelector('#user-summary'),
  settingsToggle: document.querySelector('#settings-toggle'),
  sessionAlertPopups: document.querySelector('#session-alert-popups'),
  connectionBanner: document.querySelector('#connection-banner'),
  projectAgentDisplay: document.querySelector('#project-agent-display'),
  refreshButton: document.querySelector('#refresh-button'),
  projectAgentSelect: document.querySelector('#project-agent-select'),
  projectPathInput: document.querySelector('#project-path-input'),
  applyProjectPathButton: document.querySelector('#apply-project-path-button'),
  projectPathHint: document.querySelector('#project-path-hint'),
  projectPicker: document.querySelector('#project-picker'),
  newSessionToggle: document.querySelector('#new-session-toggle'),
  deleteModeToggle: document.querySelector('#delete-mode-toggle'),
  selectionToolbar: document.querySelector('#selection-toolbar'),
  selectionSummary: document.querySelector('#selection-summary'),
  deleteSelectedButton: document.querySelector('#delete-selected-button'),
  cancelSelectionButton: document.querySelector('#cancel-selection-button'),
  sessionList: document.querySelector('#session-list'),
  sessionTitle: document.querySelector('#session-title'),
  sessionMeta: document.querySelector('#session-meta'),
  sessionRuntimeMeta: document.querySelector('#session-runtime-meta'),
  statusPill: document.querySelector('#status-pill'),
  acquireButton: document.querySelector('#acquire-button'),
  releaseButton: document.querySelector('#release-button'),
  openLocalButton: document.querySelector('#open-local-button'),
  chatThread: document.querySelector('#chat-thread'),
  rawTerminalPanel: document.querySelector('#raw-terminal-panel'),
  terminalRoot: document.querySelector('#terminal'),
  sendForm: document.querySelector('#send-form'),
  sendInputWrap: document.querySelector('#send-input-wrap'),
  sendInput: document.querySelector('#send-input'),
  applyButton: document.querySelector('#apply-button'),
  ctrlCButton: document.querySelector('#ctrlc-button'),
  enterButton: document.querySelector('#enter-button'),
  editorPrompt: document.querySelector('#editor-prompt'),
  editorNote: document.querySelector('#editor-note'),
  composerAttachments: document.querySelector('#composer-attachments'),
  imageInput: document.querySelector('#image-input'),
  sheetBackdrop: document.querySelector('#sheet-backdrop'),
  composeSheet: document.querySelector('#compose-sheet'),
  closeComposeSheet: document.querySelector('#close-compose-sheet'),
  composeExistingTab: document.querySelector('#compose-existing-tab'),
  composeNewTab: document.querySelector('#compose-new-tab'),
  composeExistingPanel: document.querySelector('#compose-existing-panel'),
  existingSessionList: document.querySelector('#existing-session-list'),
  sessionForm: document.querySelector('#session-form'),
  startKind: document.querySelector('#start-kind'),
  startOpenDesktop: document.querySelector('#start-open-desktop'),
  startAdminRow: document.querySelector('#start-admin-row'),
  startAdmin: document.querySelector('#start-admin'),
  startName: document.querySelector('#start-name'),
  startSubmitButton: document.querySelector('#start-submit-button'),
  composeNote: document.querySelector('#compose-note'),
  settingsSheet: document.querySelector('#settings-sheet'),
  closeSettingsSheet: document.querySelector('#close-settings-sheet'),
  settingsNote: document.querySelector('#settings-note'),
  settingsCompleteNotify: document.querySelector('#settings-complete-notify'),
  settingsCompleteSound: document.querySelector('#settings-complete-sound'),
  settingsCompleteVibrate: document.querySelector('#settings-complete-vibrate'),
  sessionSettingsPanel: document.querySelector('#session-settings-panel'),
  sessionCompleteEnabled: document.querySelector('#session-complete-enabled'),
  sheetAcquireButton: document.querySelector('#sheet-acquire-button'),
  sheetReleaseButton: document.querySelector('#sheet-release-button'),
  sheetOpenLocalButton: document.querySelector('#sheet-open-local-button'),
  sheetRenameSessionButton: document.querySelector('#sheet-rename-session-button'),
  sheetHideSessionButton: document.querySelector('#sheet-hide-session-button'),
  sheetCloseSessionButton: document.querySelector('#sheet-close-session-button'),
  reloadPageButton: document.querySelector('#reload-page-button'),
  openBrowserButton: document.querySelector('#open-browser-button'),
  logoutButton: document.querySelector('#logout-button'),
};

const terminal = new Terminal({
  cursorBlink: true,
  fontFamily: '"JetBrains Mono", "SFMono-Regular", monospace',
  fontSize: 14,
  theme: {
    background: '#ffffff',
    foreground: '#1f2937',
    cursor: '#1f2937',
    selectionBackground: '#d9e8ff',
  },
  convertEol: true,
  disableStdin: true,
});
const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);
terminal.open(elements.terminalRoot);
fitAddon.fit();
terminal.onScroll(() => {
  maybeLoadOlderSnapshotFromTerminal();
});

if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

let fitTimer = 0;
let projectSuggestionTimer = 0;
updateViewportHeight();
scheduleTerminalFit();

window.addEventListener('resize', () => {
  updateViewportHeight();
  scheduleTerminalFit();
  syncMobilePane();
});
window.addEventListener('popstate', () => {
  handleHistoryNavigation();
});
window.visualViewport?.addEventListener('resize', () => {
  updateViewportHeight();
  scheduleTerminalFit(24);
});

elements.loginForm.addEventListener('submit', handleLoginSubmit);
elements.refreshButton.addEventListener('click', () => refreshOverview());
elements.projectAgentSelect.addEventListener('change', handleProjectAgentChange);
elements.applyProjectPathButton.addEventListener('click', applyProjectPath);
elements.projectPathInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    applyProjectPath();
    return;
  }
  if (event.key === 'Escape') {
    closeProjectPathPicker();
  }
});
elements.projectPathInput.addEventListener('input', handleProjectPathInput);
elements.projectPathInput.addEventListener('focus', maybeShowProjectPathPicker);
elements.projectPathInput.addEventListener('click', maybeShowProjectPathPicker);
document.addEventListener('pointerdown', handleGlobalPointerDown);
elements.newSessionToggle.addEventListener('click', () => {
  if (!ensureProjectPathSelected()) {
    return;
  }
  openSheet('compose');
});
elements.deleteModeToggle.addEventListener('click', () => {
  if (!state.sessions.length) {
    showProjectHint('当前没有可删除的会话。');
    return;
  }
  state.selectionMode = !state.selectionMode;
  state.selectedSessionIds.clear();
  renderSelectionToolbar();
  renderSessions();
});
elements.deleteSelectedButton.addEventListener('click', bulkDeleteSelectedSessions);
elements.cancelSelectionButton.addEventListener('click', () => {
  state.selectionMode = false;
  state.selectedSessionIds.clear();
  renderSelectionToolbar();
  renderSessions();
});
elements.mobileBackButton.addEventListener('click', () => {
  navigateBackToSessionList();
});
elements.settingsToggle.addEventListener('click', () => openSheet('settings'));
elements.closeComposeSheet.addEventListener('click', closeSheets);
elements.closeSettingsSheet.addEventListener('click', closeSheets);
elements.sheetBackdrop.addEventListener('click', closeSheets);
elements.composeExistingTab.addEventListener('click', () => setComposeMode('existing'));
elements.composeNewTab.addEventListener('click', () => setComposeMode('new'));
elements.startKind.addEventListener('change', updateComposeFormMode);
elements.sessionForm.addEventListener('submit', submitNewSession);
elements.openLocalButton.addEventListener('click', async () => {
  try {
    await openCurrentSessionOnDesktop();
  } catch (error) {
    const message = friendlyError(error);
    elements.editorNote.textContent = message;
    setSettingsNote(message);
  }
});
elements.sheetOpenLocalButton.addEventListener('click', async () => {
  try {
    await openCurrentSessionOnDesktop();
  } catch (error) {
    setSettingsNote(friendlyError(error));
  }
});
elements.sheetRenameSessionButton.addEventListener('click', async () => {
  try {
    await renameCurrentSession();
  } catch (error) {
    setSettingsNote(friendlyError(error));
  }
});
elements.sheetHideSessionButton.addEventListener('click', async () => {
  if (!state.currentSession) {
    return;
  }
  await hideSessions([state.currentSession.id]);
  closeSheets();
});
elements.sheetCloseSessionButton.addEventListener('click', async () => {
  if (!state.currentSession) {
    return;
  }
  await destroySessions([state.currentSession.id]);
  closeSheets();
});
elements.sendForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await submitComposer();
});
elements.sendInputWrap.addEventListener('click', () => {
  elements.sendInput.focus();
});
elements.sendInput.addEventListener('input', () => {
  resizeComposer();
});
elements.sendInput.addEventListener('keydown', async (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    await submitComposer();
  }
});
elements.applyButton.addEventListener('click', () => {
  elements.imageInput.click();
});
elements.imageInput.addEventListener('change', async () => {
  const files = [...(elements.imageInput.files || [])];
  for (const file of files) {
    await uploadImageAttachment(file);
  }
  elements.imageInput.value = '';
});
elements.sendInput.addEventListener('paste', async (event) => {
  const imageItems = [...(event.clipboardData?.items || [])].filter((item) => item.type.startsWith('image/'));
  if (!imageItems.length) {
    return;
  }
  event.preventDefault();
  for (const item of imageItems) {
    const file = item.getAsFile();
    if (file) {
      await uploadImageAttachment(file);
    }
  }
});
elements.composerAttachments.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const removeButton = target.closest('.composer-attachment__remove');
  if (!(removeButton instanceof HTMLButtonElement)) {
    return;
  }
  removeComposerAttachment(removeButton.dataset.attachmentId || '');
});
elements.chatThread.addEventListener('scroll', () => {
  maybeLoadOlderSnapshotFromConversation();
});
elements.ctrlCButton.addEventListener('click', async () => {
  await sendInput({ key: 'ctrl-c' });
});
elements.reloadPageButton.addEventListener('click', () => {
  if (window.AndroidBridge?.reloadPage) {
    window.AndroidBridge.reloadPage();
  } else {
    window.location.reload();
  }
});
elements.openBrowserButton.addEventListener('click', () => {
  if (window.AndroidBridge?.openExternalBrowser) {
    window.AndroidBridge.openExternalBrowser();
  } else if (shouldPreferAppOpen()) {
    openCurrentPageInApp();
  } else {
    window.open(window.location.href, '_blank', 'noopener');
  }
});
elements.settingsCompleteNotify.addEventListener('change', handleCompletionAlertSettingsChange);
elements.settingsCompleteSound.addEventListener('change', handleCompletionAlertSettingsChange);
elements.settingsCompleteVibrate.addEventListener('change', handleCompletionAlertSettingsChange);
elements.sessionCompleteEnabled.addEventListener('change', handleCurrentSessionCompletionAlertChange);
elements.logoutButton.addEventListener('click', logout);

initialize().catch((error) => {
  console.error(error);
  setView(VIEW_LOGIN);
  updateLoginGatewaySummary();
  renderLoginAction({ summary: '', actionText: '', showPin: false, action: LOGIN_ACTION_NONE });
  showLoginStatus(friendlyError(error), true);
});

async function initialize() {
  updateOpenDestinationButton();
  updateLoginGatewaySummary();
  applyProjectPathFromQuery();
  if (new URLSearchParams(location.search).get('debugPin')) {
    await attemptQueryAutoLogin();
    return;
  }
  try {
    await bootstrap();
  } catch {
    await presentLoginView();
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  if (state.loginAction === LOGIN_ACTION_NONE) {
    showLoginStatus('当前站点暂未提供可用的登录入口。', true);
    return;
  }

  elements.loginActionButton.disabled = true;
  try {
    showLoginStatus('');
    const response = state.loginAction === LOGIN_ACTION_BROWSER ? await submitBrowserLogin() : await submitLocalLogin();
    persistLogin(response);
    elements.pinInput.value = '';
    await bootstrap();
  } catch (error) {
    showLoginStatus(friendlyError(error), true);
  } finally {
    elements.loginActionButton.disabled = state.loginAction === LOGIN_ACTION_NONE;
  }
}

async function attemptQueryAutoLogin() {
  const params = new URLSearchParams(location.search);
  const response = await api('/api/login', {
    method: 'POST',
    body: JSON.stringify({
      pin: params.get('debugPin'),
      clientId: params.get('debugClientId') || state.clientId,
      clientName: params.get('debugClientName') || 'android-phone',
    }),
  });

  persistLogin(response);
  params.delete('debugPin');
  params.delete('debugClientId');
  params.delete('debugClientName');
  if (window.history?.replaceState) {
    const query = params.toString();
    const nextUrl = `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
    window.history.replaceState({}, '', nextUrl);
  }
  await bootstrap();
}

async function presentLoginView(status = '', isError = false) {
  setView(VIEW_LOGIN);
  updateLoginGatewaySummary();
  renderLoginAction({ summary: '', actionText: '', showPin: false, action: LOGIN_ACTION_NONE });
  showLoginStatus(status, isError);
  await refreshLoginPolicy({ preserveStatus: Boolean(status) });
}

async function bootstrap() {
  const me = await api('/api/me');
  applyIdentitySummary(me);
  syncProjectPathInput(state.currentProjectPath);
  renderCompletionAlertSettings();
  setView(VIEW_APP);
  closeSheets();
  startRefreshLoop();
  await refreshOverview();
}

async function refreshLoginPolicy(options = {}) {
  const preserveStatus = Boolean(options.preserveStatus);
  updateLoginGatewaySummary();

  try {
    const policy = await api('/api/auth/policy');
    state.authPolicy = policy;
    updateLoginGatewaySummary(policy);
    updateOpenDestinationButton();
    renderLoginPolicy(policy);
    if (!preserveStatus) {
      showLoginStatus(
        state.loginAction === LOGIN_ACTION_NONE ? '当前站点暂未提供可用的登录入口。' : '确认当前站点后继续登录。',
      );
    }
  } catch (error) {
    state.authPolicy = null;
    updateOpenDestinationButton();
    renderLoginPolicy(null);
    if (!preserveStatus) {
      showLoginStatus(friendlyError(error), true);
    }
  }
}

function renderLoginPolicy(policy) {
  const modeLabel = policy?.publicMode ? '公网模式' : '受信本地模式';
  const summaryLines = [];

  if (!policy) {
    renderLoginAction({ summary: '', actionText: '', showPin: false, action: LOGIN_ACTION_NONE });
    return;
  }

  summaryLines.push(modeLabel);
  if (policy.currentTrustedIdentity) {
    summaryLines.push(`已识别：${policy.currentTrustedIdentity}`);
  }

  if (policy.browserLoginEnabled) {
    summaryLines.push('当前站点要求浏览器前置身份 + PIN');
    if (!policy.currentTrustedIdentity) {
      summaryLines.push('请先通过前置认证入口访问当前地址，再输入 PIN。');
      renderLoginAction({
        summary: summaryLines.join('\n'),
        actionText: '',
        showPin: false,
        action: LOGIN_ACTION_NONE,
      });
      return;
    }

    renderLoginAction({
      summary: summaryLines.join('\n'),
      actionText: 'PIN 登录',
      showPin: true,
      action: LOGIN_ACTION_BROWSER,
    });
    return;
  }

  if (policy.trustedLocalLoginEnabled) {
    summaryLines.push('当前站点要求 PIN 登录');
    renderLoginAction({
      summary: summaryLines.join('\n'),
      actionText: 'PIN 登录',
      showPin: true,
      action: LOGIN_ACTION_LOCAL,
    });
    return;
  }

  summaryLines.push('当前站点暂未提供可用的登录入口');
  renderLoginAction({
    summary: summaryLines.join('\n'),
    actionText: '',
    showPin: false,
    action: LOGIN_ACTION_NONE,
  });
}

function renderLoginAction({ summary, actionText, showPin, action }) {
  state.loginAction = action;
  elements.loginModeSummary.textContent = summary || '';
  elements.loginModeSummary.hidden = !summary;
  elements.pinField.hidden = !showPin;
  elements.pinInput.required = showPin;
  if (!showPin) {
    elements.pinInput.value = '';
  }
  elements.loginActionButton.hidden = !actionText;
  elements.loginActionButton.disabled = !actionText;
  elements.loginActionButton.textContent = actionText || '';
}

function updateLoginGatewaySummary(policy = state.authPolicy) {
  const gateway = policy?.publicBaseUrl || window.location.origin;
  elements.gatewaySummary.textContent = gateway;
}

function isAndroidBrowser() {
  return /android/i.test(window.navigator.userAgent || '');
}

function currentSessionIdForAppOpen() {
  const currentSessionId = `${state.currentSession?.id || ''}`.trim();
  if (currentSessionId) {
    return currentSessionId;
  }
  return `${new URLSearchParams(window.location.search).get('session') || ''}`.trim();
}

function buildCurrentMobileOpenUrl() {
  return buildMobileOpenUrl({
    mobileDeepLinkBase: state.authPolicy?.mobileDeepLinkBase || DEFAULT_MOBILE_DEEP_LINK_BASE,
    gatewayUrl: state.authPolicy?.publicBaseUrl || window.location.origin,
    sessionId: currentSessionIdForAppOpen(),
  });
}

function shouldPreferAppOpen() {
  return !window.AndroidBridge?.openExternalBrowser && isAndroidBrowser() && Boolean(buildCurrentMobileOpenUrl());
}

function updateOpenDestinationButton() {
  elements.openBrowserButton.textContent = shouldPreferAppOpen() ? '在 APP 打开' : '在浏览器打开';
}

function openCurrentPageInApp() {
  const targetUrl = buildCurrentMobileOpenUrl();
  if (!targetUrl) {
    window.open(window.location.href, '_blank', 'noopener');
    return;
  }
  window.location.assign(targetUrl);
}

async function submitLocalLogin() {
  return api('/api/login', {
    method: 'POST',
    body: JSON.stringify({
      pin: elements.pinInput.value,
      clientId: state.clientId,
      clientName: nextClientName('local'),
    }),
  });
}

async function submitBrowserLogin() {
  return api('/api/auth/browser/login', {
    method: 'POST',
    body: JSON.stringify({
      pin: elements.pinInput.value,
      clientId: state.clientId,
      clientName: nextClientName('browser'),
    }),
  });
}

function persistLogin(response) {
  localStorage.setItem(CLIENT_ID_KEY, response.clientId);
  state.clientId = response.clientId;
}

function nextClientName(mode) {
  return mode === 'browser' ? 'Web browser' : 'web-client';
}

function startRefreshLoop() {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
  }
  state.refreshTimer = window.setInterval(() => {
    refreshOverview({ preserveSelection: true, reloadProjects: false }).catch(() => {});
  }, 4000);
}

function mergeRefreshOverviewOptions(current, next) {
  if (!current) {
    return { ...next };
  }

  return {
    preserveSelection: Boolean(current.preserveSelection) && Boolean(next.preserveSelection),
    reloadProjects: current.reloadProjects !== false || next.reloadProjects !== false,
  };
}

async function refreshOverview(options = {}) {
  if (state.refreshPromise) {
    state.queuedRefreshOptions = mergeRefreshOverviewOptions(state.queuedRefreshOptions, options);
    return state.refreshPromise;
  }

  state.refreshPromise = (async () => {
    let nextOptions = options;
    while (nextOptions) {
      const currentOptions = nextOptions;
      state.queuedRefreshOptions = null;
      await performRefreshOverview(currentOptions);
      nextOptions = state.queuedRefreshOptions;
    }
  })().finally(() => {
    state.refreshPromise = null;
    state.queuedRefreshOptions = null;
  });

  return state.refreshPromise;
}

async function performRefreshOverview(options = {}) {
  const preserveSelection = Boolean(options.preserveSelection);
  const reloadProjects = options.reloadProjects !== false || state.projectAgents.length === 0;
  const projectPromise = reloadProjects ? api('/api/projects') : Promise.resolve({ agents: state.projectAgents });
  const [agentsPayload, projectPayload] = await Promise.all([api('/api/wsl'), projectPromise]);
  state.agents = agentsPayload.agents || [];
  state.projectAgents = mergeProjectAgents(state.agents, projectPayload.agents || []);
  reconcileProjectSelection();
  renderProjectControls();
  hydrateStartForm();

  if (!state.currentProjectPath) {
    state.sessions = [];
    state.availableSessions = [];
    state.currentSession = null;
    state.hasControl = false;
    closeSocket();
    syncSessionQuery('');
    renderSelectionToolbar();
    renderSessions();
    renderExistingSessions();
    renderCurrentSessionEmpty();
    showProjectHint(projectSelectionHint());
    return;
  }

  const query = new URLSearchParams({
    workspacePath: state.currentProjectPath,
  });
  if (state.currentProjectAgentId) {
    query.set('agentId', state.currentProjectAgentId);
  }
  const workspaceQuery = query.toString();
  const [visiblePayload, allPayload] = await Promise.all([
    api(`/api/sessions?${workspaceQuery}`),
    api(`/api/sessions?${workspaceQuery}&includeHidden=true`),
  ]);

  const previousAvailableSessions = state.availableSessions;
  const previousUnreadSessionIds = new Set(state.unreadCompletedSessionIds);
  state.sessions = (visiblePayload.sessions || []).map(preserveServerUnreadCompletionState);
  state.availableSessions = (allPayload.sessions || []).map(preserveServerUnreadCompletionState);
  pruneSeenSessionActivity();
  refreshUnreadCompletedSessionIds();
  applyCompletionIndicators({
    previousUnreadSessionIds,
    previousSessions: previousAvailableSessions,
  });
  markVisibleCompletionIndicators();

  if (!preserveSelection) {
    state.selectedSessionIds.clear();
  } else {
    state.selectedSessionIds = new Set([...state.selectedSessionIds].filter((sessionId) => state.sessions.some((session) => session.id === sessionId)));
  }

  const preferredSessionId = new URLSearchParams(location.search).get('session');
  if (preferredSessionId && state.sessions.some((session) => session.id === preferredSessionId)) {
    const preferred = state.sessions.find((session) => session.id === preferredSessionId);
    if (preferred && preferred.id !== state.currentSession?.id) {
      await openSession(preferred);
    }
  } else if (state.currentSession) {
    const next = state.availableSessions.find((session) => session.id === state.currentSession.id);
    if (next) {
      state.currentSession = next;
      markSessionSeenState(next);
    } else {
      state.currentSession = null;
      state.hasControl = false;
      closeSocket();
      syncSessionQuery('');
      renderCurrentSessionEmpty();
    }
  }

  renderSelectionToolbar();
  renderSessions();
  renderExistingSessions();
  renderSessionHeader();
  showProjectHint('');
}

function mergeProjectAgents(runtimeAgents, catalogAgents) {
  const catalogById = new Map((catalogAgents || []).map((agent) => [agent.id, agent]));
  const mergedAgents = (runtimeAgents || []).map((agent) => {
    const catalog = catalogById.get(agent.id) || {};
    return {
      id: agent.id,
      label: agent.label || agent.id,
      distro: catalog.distro || agent.distro || '',
      workspaceFlavor: catalog.workspaceFlavor || inferWorkspaceFlavor(catalog.rootPaths || []),
      rootPaths: catalog.rootPaths || [],
      projects: catalog.projects || [],
      lastError: catalog.lastError || null,
      systemName: inferAgentSystemName({
        label: agent.label || agent.id,
        distro: catalog.distro || agent.distro || '',
        workspaceFlavor: catalog.workspaceFlavor || inferWorkspaceFlavor(catalog.rootPaths || []),
        rootPaths: catalog.rootPaths || [],
      }),
    };
  });

  const counts = new Map();
  for (const agent of mergedAgents) {
    counts.set(agent.systemName, (counts.get(agent.systemName) || 0) + 1);
  }

  const seen = new Map();
  return mergedAgents.map((agent) => {
    const nextIndex = (seen.get(agent.systemName) || 0) + 1;
    seen.set(agent.systemName, nextIndex);
    return {
      ...agent,
      displayName: counts.get(agent.systemName) > 1 ? `${agent.systemName} ${nextIndex}` : agent.systemName,
    };
  });
}

function inferAgentSystemName(agent) {
  const distro = `${agent?.distro || ''}`.trim();
  if (distro) {
    return distro;
  }

  const label = `${agent?.label || ''}`.trim();
  const normalizedLabel = label
    .replace(/\bcodex\b.*$/i, '')
    .replace(/\bagent\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalizedLabel) {
    return normalizedLabel;
  }

  if (`${agent?.workspaceFlavor || ''}` === 'windows') {
    return 'Windows';
  }
  if (`${agent?.workspaceFlavor || ''}` === 'wsl') {
    return 'WSL';
  }
  return 'Linux';
}

function reconcileProjectSelection() {
  if (!state.projectAgents.length) {
    state.currentProjectAgentId = '';
    state.currentProjectRoot = '';
    state.currentProjectPath = '';
    state.pendingProjectPath = '';
    persistProjectSelection();
    return;
  }

  const inferredAgentId =
    state.currentProjectPath
      ? state.projectAgents.find((agent) => agent.rootPaths.some((rootPath) => isWorkspaceWithinRoot(state.currentProjectPath, rootPath)))?.id || ''
      : '';
  if (!findProjectAgent(state.currentProjectAgentId)) {
    state.currentProjectAgentId = inferredAgentId || state.projectAgents[0]?.id || '';
  }

  const agent = currentProjectAgent();
  if (!agent) {
    state.currentProjectRoot = '';
    state.currentProjectPath = '';
    persistProjectSelection();
    return;
  }

  state.currentProjectRoot = pickProjectRoot(agent, state.currentProjectRoot, state.currentProjectPath);
  if (state.currentProjectPath && !agent.rootPaths.some((rootPath) => isWorkspaceWithinRoot(state.currentProjectPath, rootPath))) {
    state.currentProjectPath = '';
    state.pendingProjectPath = '';
    state.currentSession = null;
    state.hasControl = false;
    closeSocket();
    syncSessionQuery('');
    syncProjectPathInput('');
  }
  persistProjectSelection();
}

function findProjectAgent(agentId) {
  return state.projectAgents.find((agent) => agent.id === agentId) || null;
}

function currentProjectAgent() {
  return findProjectAgent(state.currentProjectAgentId);
}

function pickProjectRoot(agent, preferredRoot = '', projectPath = '') {
  const roots = agent?.rootPaths || [];
  if (!roots.length) {
    return '';
  }
  if (projectPath) {
    const matchingRoot = roots.find((rootPath) => isWorkspaceWithinRoot(projectPath, rootPath));
    if (matchingRoot) {
      return matchingRoot;
    }
  }
  const exactRoot = roots.find((rootPath) => workspacePathsEqual(rootPath, preferredRoot));
  if (exactRoot) {
    return exactRoot;
  }
  return roots[0];
}

function renderProjectControls() {
  renderProjectAgentControl();
  renderProjectPathInput();
  renderProjectPicker();
}

function renderProjectAgentControl() {
  elements.projectAgentSelect.innerHTML = '';
  elements.projectAgentDisplay.hidden = true;
  elements.projectAgentSelect.hidden = true;
  if (!state.projectAgents.length) {
    elements.projectAgentSelect.disabled = true;
    elements.projectAgentDisplay.textContent = '没有可用运行系统';
    elements.projectAgentDisplay.hidden = false;
    return;
  }

  if (state.projectAgents.length === 1) {
    const [agent] = state.projectAgents;
    elements.projectAgentSelect.disabled = true;
    elements.projectAgentDisplay.textContent = agent.displayName || agent.label;
    elements.projectAgentDisplay.hidden = false;
    return;
  }

  elements.projectAgentSelect.disabled = false;
  elements.projectAgentSelect.hidden = false;
  for (const agent of state.projectAgents) {
    const option = document.createElement('option');
    option.value = agent.id;
    option.textContent = agent.displayName || agent.label;
    option.selected = agent.id === state.currentProjectAgentId;
    elements.projectAgentSelect.appendChild(option);
  }
}

function renderProjectPathInput() {
  const agent = currentProjectAgent();
  const preferredRoot = pickProjectRoot(agent, state.currentProjectRoot, state.currentProjectPath);
  elements.projectPathInput.disabled = !agent;
  elements.applyProjectPathButton.disabled = !agent;
  elements.projectPathInput.placeholder = preferredRoot
    ? `${preferredRoot.replace(/\/+$/, '')}/你的项目`
    : state.projectAgents.length > 1 ? '先选择运行系统' : '先输入工程目录';
}

function renderProjectPicker() {
  const shouldShow = state.projectPickerVisible && Boolean(currentProjectAgent());
  elements.projectPicker.hidden = !shouldShow;
  elements.projectPicker.innerHTML = '';
  if (!shouldShow) {
    return;
  }

  const agent = currentProjectAgent();
  if (!agent) {
    elements.projectPicker.innerHTML = '<div class="empty-state">先选择一个运行系统。</div>';
    return;
  }
  if (agent.lastError) {
    elements.projectPicker.innerHTML = `<div class="empty-state">项目列表读取失败：${escapeHtml(agent.lastError)}</div>`;
    return;
  }

  if (state.projectSuggestionLoading) {
    elements.projectPicker.innerHTML = '<div class="empty-state">正在读取可进入的子目录…</div>';
    return;
  }

  if (state.projectSuggestionError) {
    elements.projectPicker.innerHTML = `<div class="empty-state">${escapeHtml(state.projectSuggestionError)}</div>`;
    return;
  }

  if (!state.projectSuggestions.length) {
    elements.projectPicker.innerHTML = '<div class="empty-state">当前没有匹配的子目录；可以直接输入一个新目录并进入。</div>';
    return;
  }

  const summary = document.createElement('div');
  summary.className = 'project-picker__meta';
  summary.textContent = state.projectSuggestionMeta || `可进入的子目录 · ${state.projectSuggestions.length} 个`;
  elements.projectPicker.appendChild(summary);

  const list = document.createElement('div');
  list.className = 'project-picker__list';
  for (const project of state.projectSuggestions) {
    const button = document.createElement('button');
    button.className = 'chip project-chip';
    button.type = 'button';
    button.dataset.active = `${workspacePathsEqual(project.path, state.currentProjectPath)}`;
    button.innerHTML = `
      <strong>${escapeHtml(project.name)}</strong>
      <span>${escapeHtml(project.path)}</span>
    `;
    button.addEventListener('click', () => {
      applyProjectPathValue(project.path, {
        agentId: agent.id,
        rootPath: project.rootPath || project.root || pickProjectRoot(agent),
      }).catch((error) => {
        showProjectHint(friendlyError(error));
      });
    });
    list.appendChild(button);
  }
  elements.projectPicker.appendChild(list);
}

function hydrateStartForm() {
  updateComposeFormMode();
}

function updateComposeFormMode() {
  const isPowerShell = normalizeSessionKind(elements.startKind.value) === 'powershell';
  elements.startAdminRow.hidden = !isPowerShell;
  elements.composeNote.textContent = isPowerShell
    ? 'PowerShell 会在 tmux 里启动。管理员模式需要 gsudo.exe 或配置好的包装器。'
    : 'WSL 会话默认打开 bash -il，并沿用上方当前工程目录；目录不存在时会自动创建。';
}

function renderSessions() {
  elements.sessionList.innerHTML = '';
  if (!state.currentProjectPath) {
    elements.sessionList.innerHTML = '<div class="empty-state">先选择工程目录，再显示该目录下的会话。</div>';
    return;
  }
  if (!state.sessions.length) {
    elements.sessionList.innerHTML = '<div class="empty-state">这个工程目录下还没有显示中的会话。</div>';
    return;
  }

  for (const session of state.sessions) {
    const card = document.createElement('article');
    card.className = 'session-card session-card--managed';
    card.dataset.sessionId = session.id;
    card.dataset.active = `${state.currentSession?.id === session.id}`;
    card.dataset.dragging = `${state.dragSessionId === session.id}`;
    card.draggable = !state.selectionMode;

    const checked = state.selectedSessionIds.has(session.id);
    const hiddenBadge = session.hidden ? '<span class="session-flag">已隐藏</span>' : '';
    const selection = state.selectionMode
      ? `<label class="session-check"><input type="checkbox" ${checked ? 'checked' : ''} /></label>`
      : '';
    const renameAction = state.selectionMode
      ? ''
      : '<button class="session-rename-button" type="button" aria-label="重命名会话">重命名</button>';
    const statusDisplay = sessionStatusDisplay(session);
    const footClass = statusDisplay ? 'session-card__foot' : 'session-card__foot session-card__foot--solo';
    const statusMarkup = statusDisplay
      ? `<span class="status-dot status-dot--${escapeHtml(statusDisplay.tone)}">${escapeHtml(statusDisplay.label)}</span>`
      : '';

    card.innerHTML = `
      <div class="session-card__top">
        <div class="session-card__lead">
          <button class="drag-handle" type="button" aria-label="拖动排序">⋮⋮</button>
          ${selection}
          <div>
            <div class="session-title-row">
              <div class="session-title">${escapeHtml(session.name)}</div>
            </div>
          </div>
        </div>
        <div class="session-card__actions">
          ${hiddenBadge}
          ${renameAction}
          <button class="session-close-button" type="button" aria-label="从列表隐藏">×</button>
        </div>
      </div>
      <div class="session-card__meta">${escapeHtml(session.previewText || '点开后即可进入这个会话。')}</div>
      <div class="${footClass}">
        ${statusMarkup}
        <span class="session-time">${new Date(session.activityAt || session.createdAt || Date.now()).toLocaleString()}</span>
      </div>
    `;

    card.addEventListener('click', async (event) => {
      const target = event.target;
      if (Date.now() < state.ignoreCardClickUntil) {
        return;
      }
      if (target instanceof HTMLElement && target.closest('.drag-handle')) {
        return;
      }
      if (target instanceof HTMLButtonElement && target.classList.contains('session-close-button')) {
        event.stopPropagation();
        await hideSessions([session.id]);
        return;
      }
      if (target instanceof HTMLButtonElement && target.classList.contains('session-rename-button')) {
        event.stopPropagation();
        await renameSession(session);
        return;
      }
      if (target instanceof HTMLInputElement && target.type === 'checkbox') {
        toggleSelection(session.id, target.checked);
        return;
      }
      if (state.selectionMode) {
        toggleSelection(session.id, !state.selectedSessionIds.has(session.id));
        return;
      }
      await openSession(session, true, {
        historyMode: isMobileLayout() && !state.currentSession ? 'push' : 'replace',
      });
    });

    card.addEventListener('dragstart', (event) => {
      state.dragSessionId = session.id;
      event.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragover', (event) => {
      if (!state.selectionMode) {
        event.preventDefault();
      }
    });
    card.addEventListener('drop', async (event) => {
      event.preventDefault();
      if (state.selectionMode || !state.dragSessionId || state.dragSessionId === session.id) {
        return;
      }
      await reorderSession(state.dragSessionId, session.id);
      state.dragSessionId = '';
    });
    card.addEventListener('dragend', () => {
      state.dragSessionId = '';
    });

    const dragHandle = card.querySelector('.drag-handle');
    dragHandle?.addEventListener('pointerdown', (event) => {
      if (state.selectionMode || event.button > 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      startPointerReorder(session.id, event);
    });

    elements.sessionList.appendChild(card);
  }
}

function renderExistingSessions() {
  elements.existingSessionList.innerHTML = '';
  if (!state.currentProjectPath) {
    elements.existingSessionList.innerHTML = '<div class="empty-state">先选择工程目录，才能接入已有 tmux。</div>';
    return;
  }

  if (!state.availableSessions.length) {
    elements.existingSessionList.innerHTML = '<div class="empty-state">当前工程目录下没有可接入的 tmux 会话。</div>';
    return;
  }

  for (const session of state.availableSessions) {
    const card = document.createElement('button');
    card.className = 'session-card session-card--sheet';
    card.type = 'button';
    card.innerHTML = `
      <div class="session-card__top">
        <div>
          <div class="session-title">${escapeHtml(session.name)}</div>
        </div>
        ${session.hidden ? '<span class="session-flag">已隐藏</span>' : ''}
      </div>
      <div class="session-card__meta">${escapeHtml(session.previewText || '接入这个 tmux 会话。')}</div>
    `;
    card.addEventListener('click', async () => {
      if (session.hidden) {
        await api('/api/session-preferences/unhide', {
          method: 'POST',
          body: JSON.stringify({ sessionIds: [session.id] }),
        });
      }
      closeSheets();
      await refreshOverview();
      const next = state.availableSessions.find((item) => item.id === session.id) || session;
      await openSession(next);
    });
    elements.existingSessionList.appendChild(card);
  }
}

function renderSelectionToolbar() {
  elements.selectionToolbar.hidden = !state.selectionMode;
  elements.selectionSummary.textContent = `已选 ${state.selectedSessionIds.size} 项`;
  elements.deleteSelectedButton.disabled = state.selectedSessionIds.size === 0;
}

function toggleSelection(sessionId, checked) {
  if (checked) {
    state.selectedSessionIds.add(sessionId);
  } else {
    state.selectedSessionIds.delete(sessionId);
  }
  renderSelectionToolbar();
  renderSessions();
}

async function reorderSession(sourceId, targetId) {
  if (!applyLocalReorder(sourceId, targetId)) {
    return;
  }
  await persistSessionOrder();
}

function applyLocalReorder(sourceId, targetId) {
  const sourceIndex = state.sessions.findIndex((session) => session.id === sourceId);
  const targetIndex = state.sessions.findIndex((session) => session.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return false;
  }
  const nextSessions = [...state.sessions];
  const [moved] = nextSessions.splice(sourceIndex, 1);
  const insertIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  nextSessions.splice(insertIndex, 0, moved);
  state.sessions = nextSessions;
  renderSessions();
  return true;
}

async function persistSessionOrder() {
  await api('/api/session-preferences/order', {
    method: 'POST',
    body: JSON.stringify({ sessionIds: state.sessions.map((session) => session.id) }),
  });
  await refreshOverview({ preserveSelection: true });
}

function startPointerReorder(sessionId, event) {
  state.dragSessionId = sessionId;
  state.dragPointerId = event.pointerId;
  state.dragChanged = false;
  state.ignoreCardClickUntil = Date.now() + 300;
  document.body.dataset.reordering = 'true';
  renderSessions();
  window.addEventListener('pointermove', handlePointerReorderMove);
  window.addEventListener('pointerup', handlePointerReorderEnd);
  window.addEventListener('pointercancel', handlePointerReorderCancel);
}

function handlePointerReorderMove(event) {
  if (!state.dragSessionId || state.dragPointerId !== event.pointerId) {
    return;
  }
  const cards = [...elements.sessionList.querySelectorAll('.session-card[data-session-id]')];
  if (!cards.length) {
    return;
  }

  const targetCard = pickReorderTarget(cards, event.clientY);
  const targetId = targetCard?.dataset.sessionId || '';
  if (!targetId || targetId === state.dragSessionId) {
    return;
  }
  if (applyLocalReorder(state.dragSessionId, targetId)) {
    state.dragChanged = true;
  }
}

function handlePointerReorderEnd(event) {
  if (state.dragPointerId !== event.pointerId) {
    return;
  }
  finishPointerReorder(true);
}

function handlePointerReorderCancel(event) {
  if (state.dragPointerId !== event.pointerId) {
    return;
  }
  finishPointerReorder(false);
}

function finishPointerReorder(commitOrder) {
  const shouldPersist = commitOrder && state.dragChanged;
  state.dragSessionId = '';
  state.dragPointerId = null;
  state.dragChanged = false;
  state.ignoreCardClickUntil = Date.now() + 300;
  document.body.dataset.reordering = 'false';
  window.removeEventListener('pointermove', handlePointerReorderMove);
  window.removeEventListener('pointerup', handlePointerReorderEnd);
  window.removeEventListener('pointercancel', handlePointerReorderCancel);
  renderSessions();
  if (shouldPersist) {
    persistSessionOrder().catch((error) => {
      showProjectHint(friendlyError(error));
    });
  }
}

function pickReorderTarget(cards, clientY) {
  let nearestCard = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    const distance = Math.abs(clientY - midpoint);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestCard = card;
    }
  }
  return nearestCard;
}

async function openSession(session, reconnect = true, options = {}) {
  const previousSessionId = state.currentSession?.id || '';
  if (previousSessionId !== session.id) {
    resetDetailSnapshotState();
    state.pendingSnapshotViewport = {
      reason: 'open_session',
    };
  }
  state.currentSession = session;
  markSessionSeenState(session);
  markSessionCompletionSeen(session.id, { rerender: false });
  state.hasControl = session.lock?.owner === state.clientId;
  if (previousSessionId !== session.id) {
    elements.sendInput.value = '';
    state.attachments = [];
    state.lastConversationKey = '';
    resetConversationDetailState();
    renderComposerAttachments();
    resizeComposer();
  }
  syncSessionQuery(session.id, options.historyMode || 'replace');
  renderSessions();
  renderSessionHeader();
  if (previousSessionId !== session.id) {
    await hydrateCurrentSessionFromCache(session);
  }
  if (isMobileLayout()) {
    setMobilePane('detail');
    scheduleScrollCurrentSessionToLatest();
  }
  if (reconnect) {
    connectSocket(session.id);
  }
  try {
    await acquireCurrentSession();
  } catch (error) {
    elements.editorNote.textContent = friendlyError(error);
  }
  if (isMobileLayout()) {
    scheduleScrollCurrentSessionToLatest();
  }
}

function connectSocket(sessionId) {
  closeSocket();
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const query = new URLSearchParams();
  query.set('lines', `${state.detailSnapshotLines}`);
  query.set('view', 'summary');
  const suffix = query.toString();
  const socket = new WebSocket(`${protocol}//${location.host}/ws/sessions/${encodeURIComponent(sessionId)}?${suffix}`);
  state.socket = socket;
  elements.connectionBanner.textContent = '连接中';

  socket.addEventListener('open', () => {
    if (state.socket !== socket) {
      return;
    }
    elements.connectionBanner.textContent = '在线';
  });

  socket.addEventListener('message', (event) => {
    if (state.socket !== socket) {
      return;
    }
    const message = JSON.parse(event.data);
    if (message.type === 'snapshot') {
      renderSnapshot(message.payload);
      return;
    }
    if (message.type === 'error') {
      state.detailSnapshotLoadingOlder = false;
      elements.connectionBanner.textContent = friendlyError(message.payload?.message || '连接异常');
    }
  });

  socket.addEventListener('close', () => {
    if (state.socket !== socket) {
      return;
    }
    state.socket = null;
    state.detailSnapshotLoadingOlder = false;
    elements.connectionBanner.textContent = '已断开';
  });
}

function closeSocket() {
  if (state.socket) {
    state.socket.close();
    state.socket = null;
  }
}

function renderSnapshot(payload) {
  if (!state.currentSession) {
    return;
  }
  const previousSession = {
    ...state.currentSession,
  };
  const pendingSnapshotViewport = state.pendingSnapshotViewport;
  state.pendingSnapshotViewport = null;
  const previousViewport = captureCurrentSnapshotViewport();
  const mode = payload.conversation?.mode || 'raw_terminal';
  const nextPreviewText =
    mode === 'raw_terminal'
      ? previewFromSnapshot(payload.snapshot || '')
      : previewFromConversation(payload.conversation || {}) || state.currentSession.previewText || '';
  state.currentSession = {
    ...state.currentSession,
    state: payload.state,
    lock: payload.lock,
    runtimeStatus: payload.conversation?.statusLine || '',
    activityAt: Number(payload.activityAt || state.currentSession.activityAt || 0),
    readyForInput: payload.readyForInput,
    hasBackgroundTask: payload.hasBackgroundTask,
    hasPendingUserInput: payload.hasPendingUserInput,
    promptAtStart: payload.promptAtStart,
    contentSignature: payload.contentSignature || state.currentSession.contentSignature,
    previewText: nextPreviewText,
  };
  syncCurrentSessionState(state.currentSession);
  state.hasControl = payload.lock?.owner === state.clientId;
  state.editingContext = payload.editingContext || null;
  state.detailSnapshotLineCount = Number(payload.snapshotLineCount || countSnapshotLines(payload.snapshot || ''));
  state.detailSnapshotLines = Number(payload.requestedSnapshotLines || state.detailSnapshotLines || DEFAULT_DETAIL_SNAPSHOT_LINES);
  state.detailSnapshotHasEarlierHistory = Boolean(payload.hasEarlierHistory);
  state.conversationContentSignature = `${payload.contentSignature || state.currentSession.contentSignature || ''}`;
  renderSessions();
  renderExistingSessions();
  renderSessionHeader();
  applyCurrentSessionSnapshotIndicators(previousSession, state.currentSession);

  state.detailSnapshotMode = mode;
  elements.rawTerminalPanel.hidden = mode !== 'raw_terminal';
  elements.chatThread.hidden = mode === 'raw_terminal';
  if (mode === 'raw_terminal') {
    state.lastConversationKey = '';
    terminal.reset();
    terminal.write(payload.snapshot || '', () => {
      restoreTerminalViewport(previousViewport, pendingSnapshotViewport);
    });
    elements.editorPrompt.textContent = '原始终端';
    elements.editorNote.textContent = '当前程序不适合聊天式展示，已切回原始终端。';
    scheduleTerminalFit(24);
  } else {
    setConversationItems(payload.conversation?.items || []);
    renderConversation({
      previousViewport,
      pendingSnapshotViewport,
    });
    elements.editorPrompt.textContent = payload.editingContext?.promptText || '命令输入';
    elements.editorNote.textContent = '';
    persistCurrentConversationSummary(payload).catch(() => {});
  }
  state.detailSnapshotLoadingOlder = false;
}

function syncCurrentSessionState(session) {
  if (!session?.id) {
    return;
  }
  const merge = (item) => (
    item.id === session.id
      ? {
        ...item,
        state: session.state,
        lock: session.lock,
        runtimeStatus: session.runtimeStatus,
        activityAt: session.activityAt,
        readyForInput: session.readyForInput,
        hasBackgroundTask: session.hasBackgroundTask,
        hasPendingUserInput: session.hasPendingUserInput,
        promptAtStart: session.promptAtStart,
        contentSignature: session.contentSignature,
        previewText: session.previewText,
      }
      : item
  );
  state.sessions = state.sessions.map(merge);
  state.availableSessions = state.availableSessions.map(merge);
}

function applyCurrentSessionSnapshotIndicators(previousSession, nextSession) {
  const sessionId = `${nextSession?.id || ''}`.trim();
  if (!sessionId || isCurrentSessionDetailVisible()) {
    return;
  }
}

function renderConversation(options = {}) {
  const items = state.currentConversationItems;
  const previousViewport = options.previousViewport || null;
  const forceLatest =
    options.pendingSnapshotViewport?.reason === 'open_session';
  const anchor = options.anchor || null;
  const shouldShowRunningPlaceholder = shouldRenderRunningPlaceholder();
  const nextKey = JSON.stringify({
    items,
    expanded: [...state.expandedConversationItemIds].sort(),
    loading: [...state.loadingConversationItemIds].sort(),
    shouldShowRunningPlaceholder,
  });

  const distanceFromBottom = elements.chatThread.scrollHeight - elements.chatThread.scrollTop - elements.chatThread.clientHeight;
  const shouldStickToBottom = distanceFromBottom < 24;
  elements.chatThread.innerHTML = '';
  state.lastConversationKey = nextKey;
  if (!items.length && !shouldShowRunningPlaceholder) {
    elements.chatThread.innerHTML = '<div class="empty-chat">这个会话还没有可展示的总结记录。</div>';
  }

  for (const item of items || []) {
    const bubble = document.createElement('article');
    bubble.className = `chat-bubble chat-bubble--${item.role}`;
    if (item.expandable) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'chat-summary-toggle';
      toggle.dataset.itemId = item.id;
      toggle.textContent = formatConversationSummaryDisplayText(item.summary) || '点击加载详情';
      toggle.addEventListener('click', () => {
        toggleConversationItemDetail(item.id).catch((error) => {
          elements.editorNote.textContent = friendlyError(error);
        });
      });
      bubble.appendChild(toggle);

      const expanded = state.expandedConversationItemIds.has(item.id);
      if (expanded) {
        const detail = state.conversationDetailById[item.id];
        if (detail?.text) {
          const detailText = document.createElement('div');
          detailText.className = 'chat-detail-text';
          detailText.textContent = formatConversationDetailDisplayText(detail.text);
          bubble.appendChild(detailText);
        } else {
          const loading = document.createElement('div');
          loading.className = 'chat-loading-detail';
          loading.textContent = state.loadingConversationItemIds.has(item.id) ? '正在加载详情…' : '详情暂时不可用。';
          bubble.appendChild(loading);
        }
      }
    } else {
      const text = document.createElement('pre');
      text.textContent = item.text || item.summary || '';
      bubble.appendChild(text);
    }
    elements.chatThread.appendChild(bubble);
  }

  if (shouldShowRunningPlaceholder) {
    const bubble = document.createElement('article');
    bubble.className = 'chat-bubble chat-bubble--assistant';
    const placeholder = document.createElement('div');
    placeholder.className = 'chat-runtime-placeholder';
    placeholder.textContent = '运行中，等待新的总结…';
    bubble.appendChild(placeholder);
    elements.chatThread.appendChild(bubble);
  }

  if (anchor && restoreConversationAnchor(anchor)) {
    return;
  }

  if (forceLatest || shouldStickToBottom) {
    elements.chatThread.scrollTop = elements.chatThread.scrollHeight;
    if (forceLatest) {
      scheduleScrollCurrentSessionToLatest();
    }
    return;
  }

  const nextScrollTop = elements.chatThread.scrollHeight - elements.chatThread.clientHeight - distanceFromBottom;
  elements.chatThread.scrollTop = Math.max(0, nextScrollTop);
}

function renderSessionHeader() {
  if (!state.currentSession) {
    renderCurrentSessionEmpty();
    return;
  }

  const statusDisplay = sessionStatusDisplay(state.currentSession, {
    includeCurrentSession: true,
  });
  elements.sessionTitle.textContent = state.currentSession.name;
  elements.sessionMeta.textContent = `${state.currentSession.agentLabel} · ${sessionKindLabel(state.currentSession.kind, {
    admin: Boolean(state.currentSession.admin),
  })}${state.currentSession.workspace ? ` · ${state.currentSession.workspace}` : ''}`;
  elements.sessionRuntimeMeta.textContent = `${state.currentSession.runtimeStatus || ''}`;
  elements.sessionRuntimeMeta.hidden = !`${state.currentSession.runtimeStatus || ''}`.trim();
  elements.statusPill.hidden = !statusDisplay;
  elements.statusPill.textContent = statusDisplay?.label || '';
  elements.statusPill.className = `badge badge--${statusDisplay?.tone || 'idle'}`;
  elements.acquireButton.hidden = true;
  elements.releaseButton.hidden = true;
  elements.acquireButton.disabled = true;
  elements.releaseButton.disabled = true;
  elements.openLocalButton.disabled = false;
  elements.openLocalButton.textContent = '在电脑打开';
  elements.sheetAcquireButton.hidden = true;
  elements.sheetReleaseButton.hidden = true;
  elements.sheetAcquireButton.disabled = true;
  elements.sheetReleaseButton.disabled = true;
  elements.sheetOpenLocalButton.disabled = false;
  elements.sheetOpenLocalButton.textContent = '在电脑打开';
  elements.sheetRenameSessionButton.disabled = false;
  elements.sheetHideSessionButton.disabled = false;
  elements.sheetCloseSessionButton.disabled = false;
  elements.sendInput.disabled = false;
  elements.applyButton.disabled = false;
  elements.ctrlCButton.disabled = false;
  elements.enterButton.disabled = false;
  elements.sessionSettingsPanel.hidden = false;
  renderCompletionAlertSettings();
  renderTopBar();
}

function renderCurrentSessionEmpty() {
  state.mobilePane = 'list';
  document.body.dataset.mobilePane = isMobileLayout() ? 'list' : 'desktop';
  elements.sessionTitle.textContent = '请选择一个会话';
  elements.sessionMeta.textContent = '先在左侧选择工程目录，再打开一个会话。';
  elements.sessionRuntimeMeta.textContent = '';
  elements.sessionRuntimeMeta.hidden = true;
  elements.statusPill.hidden = true;
  elements.statusPill.textContent = '';
  elements.statusPill.className = 'badge badge--idle';
  elements.acquireButton.hidden = true;
  elements.releaseButton.hidden = true;
  elements.acquireButton.disabled = true;
  elements.releaseButton.disabled = true;
  elements.openLocalButton.disabled = true;
  elements.openLocalButton.textContent = '在电脑打开';
  elements.sheetAcquireButton.hidden = true;
  elements.sheetReleaseButton.hidden = true;
  elements.sheetAcquireButton.disabled = true;
  elements.sheetReleaseButton.disabled = true;
  elements.sheetOpenLocalButton.disabled = true;
  elements.sheetOpenLocalButton.textContent = '在电脑打开';
  elements.sheetRenameSessionButton.disabled = true;
  elements.sheetHideSessionButton.disabled = true;
  elements.sheetCloseSessionButton.disabled = true;
  elements.sendInput.disabled = true;
  elements.sendInput.value = '';
  elements.applyButton.disabled = true;
  elements.ctrlCButton.disabled = true;
  elements.enterButton.disabled = true;
  elements.sessionSettingsPanel.hidden = true;
  elements.chatThread.hidden = false;
  elements.rawTerminalPanel.hidden = true;
  elements.chatThread.innerHTML = '<div class="empty-chat">打开一个会话后，这里会显示总结，并在点击时按需加载详情。</div>';
  state.editingContext = null;
  state.lastConversationKey = '';
  resetDetailSnapshotState();
  resetConversationDetailState();
  resizeComposer();
  renderCompletionAlertSettings();
  renderTopBar();
}

function resetDetailSnapshotState() {
  state.detailSnapshotLines = DEFAULT_DETAIL_SNAPSHOT_LINES;
  state.detailSnapshotLineCount = 0;
  state.detailSnapshotHasEarlierHistory = false;
  state.detailSnapshotMode = 'raw_terminal';
  state.detailSnapshotLoadingOlder = false;
  state.pendingSnapshotViewport = null;
}

function resetConversationDetailState() {
  state.currentConversationItems = [];
  state.conversationDetailById = {};
  state.expandedConversationItemIds.clear();
  state.loadingConversationItemIds.clear();
  state.conversationContentSignature = '';
}

function setConversationItems(items) {
  state.currentConversationItems = normalizeConversationItems(items);
  const visibleIds = new Set(state.currentConversationItems.map((item) => `${item?.id || ''}`).filter(Boolean));
  for (const itemId of [...state.expandedConversationItemIds]) {
    if (!visibleIds.has(itemId)) {
      state.expandedConversationItemIds.delete(itemId);
    }
  }
  for (const itemId of [...state.loadingConversationItemIds]) {
    if (!visibleIds.has(itemId)) {
      state.loadingConversationItemIds.delete(itemId);
    }
  }
}

function normalizeConversationItems(items) {
  return (items || []).map((item) => ({
    id: `${item?.id || ''}`,
    role: `${item?.role || 'assistant'}`,
    text: `${item?.text || ''}`,
    summary: `${item?.summary || ''}`,
    collapsed: Boolean(item?.collapsed),
    expandable: Boolean(item?.expandable),
  }));
}

function shouldRenderRunningPlaceholder() {
  if (state.detailSnapshotMode === 'raw_terminal' || !state.currentSession) {
    return false;
  }
  if (state.currentSession.readyForInput) {
    return false;
  }
  return Boolean(state.currentSession.hasBackgroundTask || `${state.currentSession.state || ''}` === 'running');
}

function currentSessionCacheScope() {
  return buildSessionCacheScope(location.origin, state.clientId);
}

async function hydrateCurrentSessionFromCache(session) {
  const cached = await loadSessionSummaryCache(currentSessionCacheScope(), session.id);
  if (!cached || state.currentSession?.id !== session.id) {
    return;
  }
  state.detailSnapshotMode = 'chat';
  state.conversationContentSignature = `${cached.contentSignature || ''}`;
  setConversationItems(cached.items || []);
  renderConversation({
    pendingSnapshotViewport: state.pendingSnapshotViewport,
  });
}

async function persistCurrentConversationSummary(payload) {
  if (!state.currentSession || state.detailSnapshotMode === 'raw_terminal') {
    return;
  }
  await saveSessionSummaryCache(
    currentSessionCacheScope(),
    state.currentSession.id,
    {
      contentSignature: `${payload.contentSignature || state.conversationContentSignature || ''}`,
      items: state.currentConversationItems,
      runtimeStatus: `${payload.conversation?.statusLine || ''}`,
      state: `${payload.state || ''}`,
      readyForInput: Boolean(payload.readyForInput),
      hasBackgroundTask: Boolean(payload.hasBackgroundTask),
      updatedAt: Date.now(),
    },
    {
      maxBytes: SESSION_CACHE_MAX_BYTES,
    },
  );
}

async function toggleConversationItemDetail(itemId) {
  const normalizedItemId = `${itemId || ''}`.trim();
  if (!normalizedItemId || !state.currentSession) {
    return;
  }
  const anchor = captureConversationAnchor(normalizedItemId);
  if (state.expandedConversationItemIds.has(normalizedItemId)) {
    state.expandedConversationItemIds.delete(normalizedItemId);
    renderConversation({ anchor });
    return;
  }

  state.expandedConversationItemIds.add(normalizedItemId);
  const cached = await loadConversationItemDetailCache(currentSessionCacheScope(), state.currentSession.id, normalizedItemId);
  if (cached) {
    state.conversationDetailById[normalizedItemId] = cached;
    renderConversation({ anchor });
    return;
  }

  state.loadingConversationItemIds.add(normalizedItemId);
  renderConversation({ anchor });
  try {
    const response = await api(`/api/sessions/${encodeURIComponent(state.currentSession.id)}/conversation/items/${encodeURIComponent(normalizedItemId)}`, {
      method: 'GET',
    });
    state.conversationDetailById[normalizedItemId] = response.item;
    await saveConversationItemDetailCache(
      currentSessionCacheScope(),
      state.currentSession.id,
      normalizedItemId,
      response.item,
      {
        maxBytes: SESSION_CACHE_MAX_BYTES,
      },
    );
  } finally {
    state.loadingConversationItemIds.delete(normalizedItemId);
    renderConversation({ anchor });
  }
}

function captureConversationAnchor(itemId) {
  const toggle = findConversationToggle(itemId);
  if (!toggle) {
    return null;
  }
  const containerRect = elements.chatThread.getBoundingClientRect();
  const toggleRect = toggle.getBoundingClientRect();
  return {
    itemId,
    offsetTop: toggleRect.top - containerRect.top,
  };
}

function restoreConversationAnchor(anchor) {
  if (!anchor?.itemId) {
    return false;
  }
  const toggle = findConversationToggle(anchor.itemId);
  if (!toggle) {
    return false;
  }
  const containerRect = elements.chatThread.getBoundingClientRect();
  const toggleRect = toggle.getBoundingClientRect();
  const nextOffsetTop = toggleRect.top - containerRect.top;
  elements.chatThread.scrollTop += nextOffsetTop - Number(anchor.offsetTop || 0);
  return true;
}

function findConversationToggle(itemId) {
  return [...elements.chatThread.querySelectorAll('.chat-summary-toggle')]
    .find((element) => element.dataset.itemId === `${itemId || ''}`) || null;
}

function countSnapshotLines(snapshot) {
  if (!`${snapshot || ''}`.trim()) {
    return 0;
  }
  return `${snapshot}`.split(/\r?\n/).length;
}

function captureCurrentSnapshotViewport() {
  if (state.detailSnapshotMode === 'raw_terminal' && !elements.rawTerminalPanel.hidden) {
    const buffer = terminal.buffer.active;
    const distanceFromBottom = buffer.baseY - buffer.viewportY;
    return {
      mode: 'raw_terminal',
      viewportY: buffer.viewportY,
      baseY: buffer.baseY,
      length: buffer.length,
      distanceFromBottom,
      nearBottom: distanceFromBottom < 3,
    };
  }
  const scrollHeight = elements.chatThread.scrollHeight;
  const distanceFromBottom = scrollHeight - elements.chatThread.scrollTop - elements.chatThread.clientHeight;
  return {
    mode: 'conversation',
    scrollTop: elements.chatThread.scrollTop,
    scrollHeight,
    distanceFromBottom,
    nearBottom: distanceFromBottom < SNAPSHOT_TOP_THRESHOLD_PX,
  };
}

function restoreTerminalViewport(previousViewport, pendingSnapshotViewport) {
  if (pendingSnapshotViewport?.reason === 'expand_older' && previousViewport?.mode === 'raw_terminal') {
    const addedBufferLines = Math.max(0, terminal.buffer.active.length - previousViewport.length);
    terminal.scrollToLine(Math.max(0, previousViewport.viewportY + addedBufferLines));
    return;
  }
  if (pendingSnapshotViewport?.reason === 'open_session') {
    terminal.scrollToBottom();
    scheduleScrollCurrentSessionToLatest();
    return;
  }
  if (previousViewport?.mode !== 'raw_terminal' || previousViewport.nearBottom) {
    terminal.scrollToBottom();
    return;
  }
  terminal.scrollToLine(Math.max(0, terminal.buffer.active.baseY - previousViewport.distanceFromBottom));
}

function maybeLoadOlderSnapshotFromConversation() {
  if (!state.currentSession || state.detailSnapshotMode === 'raw_terminal') {
    return;
  }
  if (state.detailSnapshotLoadingOlder || !state.detailSnapshotHasEarlierHistory) {
    return;
  }
  if (elements.chatThread.scrollTop > SNAPSHOT_TOP_THRESHOLD_PX) {
    return;
  }
  requestOlderSnapshotWindow().catch((error) => {
    state.detailSnapshotLoadingOlder = false;
    elements.editorNote.textContent = friendlyError(error);
  });
}

function maybeLoadOlderSnapshotFromTerminal() {
  if (!state.currentSession || state.detailSnapshotMode !== 'raw_terminal') {
    return;
  }
  if (state.detailSnapshotLoadingOlder || !state.detailSnapshotHasEarlierHistory) {
    return;
  }
  if (terminal.buffer.active.viewportY > 0) {
    return;
  }
  requestOlderSnapshotWindow().catch((error) => {
    state.detailSnapshotLoadingOlder = false;
    elements.editorNote.textContent = friendlyError(error);
  });
}

async function requestOlderSnapshotWindow() {
  if (!state.currentSession || state.detailSnapshotLoadingOlder || !state.detailSnapshotHasEarlierHistory) {
    return;
  }
  state.detailSnapshotLoadingOlder = true;
  state.pendingSnapshotViewport = {
    reason: 'expand_older',
  };
  state.detailSnapshotLines += SNAPSHOT_LOAD_STEP_LINES;
  connectSocket(state.currentSession.id);
}

async function acquireCurrentSession() {
  if (!state.currentSession) {
    return;
  }
  const response = await api(`/api/sessions/${encodeURIComponent(state.currentSession.id)}/attach`, {
    method: 'POST',
    body: JSON.stringify({
      lines: state.detailSnapshotLines,
      view: 'summary',
    }),
  });
  state.hasControl = true;
  state.currentSession.lock = response.lock;
  renderSnapshot(response.snapshot);
}

async function releaseCurrentSession() {
  if (!state.currentSession) {
    return;
  }
  await api(`/api/sessions/${encodeURIComponent(state.currentSession.id)}/release`, {
    method: 'POST',
  });
  state.hasControl = false;
  renderSessionHeader();
}

async function openCurrentSessionOnDesktop() {
  if (!state.currentSession) {
    return;
  }
  const response = await api(`/api/sessions/${encodeURIComponent(state.currentSession.id)}/open-local`, {
    method: 'POST',
  });
  if (response.desktopLaunch?.skipped) {
    state.currentSession.attached = true;
    renderSessionHeader();
    setSettingsNote(response.desktopLaunch.message || '这个会话已经在电脑上打开了。');
    elements.editorNote.textContent = response.desktopLaunch.message || '这个会话已经在电脑上打开了。';
    return;
  }
  if (response.desktopLaunch?.ok === false) {
    const message = `电脑窗口打开失败：${response.desktopLaunch.error}`;
    setSettingsNote(message);
    elements.editorNote.textContent = message;
    return;
  }
  state.currentSession.attached = true;
  renderSessionHeader();
  setSettingsNote('已经在电脑上附着同一个 tmux 会话。');
  elements.editorNote.textContent = '电脑端已重新附着到这个 tmux 会话。';
}

async function renameCurrentSession() {
  if (!state.currentSession) {
    return;
  }
  await renameSession(state.currentSession);
  closeSheets();
}

async function renameSession(session) {
  if (!session) {
    return;
  }

  const nextName = window.prompt('新的会话名称', session.name);
  if (nextName == null) {
    return;
  }

  const trimmedName = `${nextName}`.trim();
  if (!trimmedName || trimmedName === session.name) {
    return;
  }

  const response = await api(`/api/sessions/${encodeURIComponent(session.id)}/rename`, {
    method: 'POST',
    body: JSON.stringify({ name: trimmedName }),
  });

  setSettingsNote(`会话已重命名为 ${response.session.name}。`);
  renameCompletedUnreadSessionId(session.id, response.session.id);
  renameSessionCompletionAlertOverride(session.id, response.session.id);
  renameSeenSessionState(session.id, response.session.id);
  await renameSessionCacheEntries(currentSessionCacheScope(), session.id, response.session.id, {
    maxBytes: SESSION_CACHE_MAX_BYTES,
  });
  await refreshOverview({ preserveSelection: true });
  const nextSession = state.availableSessions.find((item) => item.id === response.session.id) || response.session;
  if (state.currentSession?.id === session.id || state.currentSession?.id === response.session.id) {
    await openSession(nextSession);
  }
}

async function submitComposer() {
  if (!state.currentSession) {
    return;
  }
  const text = `${elements.sendInput.value || ''}`;
  const message = buildComposerSubmissionText(text, state.attachments);
  if (!message) {
    return;
  }
  elements.enterButton.disabled = true;
  try {
    await sendInput({ text: message });
    await sendInput({ key: 'enter' });
    elements.sendInput.value = '';
    state.attachments = [];
    renderComposerAttachments();
    resizeComposer();
  } finally {
    elements.enterButton.disabled = false;
  }
}

async function sendInput(body) {
  if (!state.currentSession) {
    return;
  }
  await api(`/api/sessions/${encodeURIComponent(state.currentSession.id)}/input`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function submitNewSession(event) {
  event.preventDefault();
  if (!state.currentProjectPath) {
    elements.composeNote.textContent = '先在列表页选择工程目录。';
    return;
  }

  elements.composeNote.textContent = '正在启动会话...';
  state.composeSubmitting = true;
  elements.startSubmitButton.disabled = true;
  try {
    const kind = normalizeSessionKind(elements.startKind.value);
    const workspace = state.currentProjectPath;
    const inferredName = defaultSessionName(kind, workspace);
    const defaultAgentId = state.currentProjectAgentId || '';
    if (!defaultAgentId) {
      throw new Error('没有可用的运行系统');
    }
    const response = await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        wslId: defaultAgentId,
        kind,
        workspace,
        workspaceRoot: state.currentProjectRoot,
        createIfMissing: true,
        name: `${elements.startName.value || ''}`.trim() || inferredName,
        admin: kind === 'powershell' ? elements.startAdmin.checked : false,
        openDesktop: elements.startOpenDesktop.checked,
      }),
    });

    elements.startName.value = '';
    elements.startAdmin.checked = false;
    elements.composeNote.textContent = response.desktopLaunch?.ok === false
      ? `会话已启动，但电脑窗口打开失败：${response.desktopLaunch.error}`
      : '会话已启动。';
    closeSheets();
    await refreshOverview();
    const next = state.availableSessions.find((session) => session.id === response.session.id) || response.session;
    await openSession(next);
  } catch (error) {
    elements.composeNote.textContent = friendlyError(error);
  } finally {
    state.composeSubmitting = false;
    elements.startSubmitButton.disabled = false;
  }
}

async function hideSessions(sessionIds) {
  await api('/api/session-preferences/hide', {
    method: 'POST',
    body: JSON.stringify({ sessionIds }),
  });
  for (const sessionId of sessionIds) {
    delete state.seenSessionActivity[sessionId];
    delete state.seenSessionContentSignatures[sessionId];
  }
  persistSeenSessionActivity();
  persistSeenSessionContentSignatures();
  if (state.currentSession && sessionIds.includes(state.currentSession.id)) {
    state.currentSession = null;
    state.hasControl = false;
    closeSocket();
    renderCurrentSessionEmpty();
  }
  await refreshOverview({ preserveSelection: true });
}

async function bulkDeleteSelectedSessions() {
  const sessionIds = [...state.selectedSessionIds];
  if (!sessionIds.length) {
    return;
  }
  await destroySessions(sessionIds);
  state.selectionMode = false;
  state.selectedSessionIds.clear();
  renderSelectionToolbar();
  renderSessions();
}

async function destroySessions(sessionIds) {
  if (!sessionIds.length) {
    return;
  }
  if (sessionIds.length === 1) {
    await api(`/api/sessions/${encodeURIComponent(sessionIds[0])}`, { method: 'DELETE' });
  } else {
    await api('/api/sessions/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ sessionIds }),
    });
  }
  if (state.currentSession && sessionIds.includes(state.currentSession.id)) {
    state.currentSession = null;
    state.hasControl = false;
    closeSocket();
    renderCurrentSessionEmpty();
  }
  for (const sessionId of sessionIds) {
    state.unreadCompletedSessionIds.delete(sessionId);
    delete state.seenSessionActivity[sessionId];
    delete state.seenSessionContentSignatures[sessionId];
  }
  removeSessionCompletionAlertOverrides(sessionIds);
  persistCompletedUnreadSessionIds();
  persistSeenSessionActivity();
  persistSeenSessionContentSignatures();
  await removeSessionCacheEntries(currentSessionCacheScope(), sessionIds);
  await refreshOverview();
}

async function uploadImageAttachment(file) {
  if (!state.currentSession) {
    return;
  }
  const payload = await api(`/api/sessions/${encodeURIComponent(state.currentSession.id)}/pasted-images`, {
    method: 'POST',
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type || 'image/png',
      dataBase64: await fileToBase64(file),
    }),
  });

  if (!payload.artifact) {
    return;
  }

  state.attachments = mergeComposerAttachments(state.attachments, [payload.artifact]);
  renderComposerAttachments();
}

function renderComposerAttachments() {
  elements.composerAttachments.innerHTML = '';
  elements.composerAttachments.hidden = state.attachments.length === 0;
  for (const item of state.attachments) {
    const attachmentId = attachmentIdentity(item);
    const chip = document.createElement('div');
    chip.className = 'composer-attachment';
    chip.innerHTML = `
      <button class="composer-attachment__remove" type="button" aria-label="移除图片" data-attachment-id="${escapeHtml(attachmentId)}">×</button>
      <img src="${item.url}" alt="${escapeHtml(item.name)}" loading="lazy" />
      <span>${escapeHtml(item.name)}</span>
    `;
    elements.composerAttachments.appendChild(chip);
  }
}

function removeComposerAttachment(attachmentId) {
  const normalizedAttachmentId = `${attachmentId || ''}`.trim();
  if (!normalizedAttachmentId) {
    return;
  }
  state.attachments = state.attachments.filter((item) => attachmentIdentity(item) !== normalizedAttachmentId);
  renderComposerAttachments();
}

function insertTextAtCursor(text) {
  const start = elements.sendInput.selectionStart || 0;
  const end = elements.sendInput.selectionEnd || 0;
  const prefix = elements.sendInput.value.slice(0, start);
  const suffix = elements.sendInput.value.slice(end);
  const spacerBefore = prefix && !/\s$/.test(prefix) ? ' ' : '';
  const spacerAfter = suffix && !/^\s/.test(suffix) ? ' ' : '';
  elements.sendInput.value = `${prefix}${spacerBefore}${text}${spacerAfter}${suffix}`;
  const nextCursor = (prefix + spacerBefore + text).length;
  elements.sendInput.focus();
  elements.sendInput.setSelectionRange(nextCursor, nextCursor);
  resizeComposer();
}

async function applyProjectPath() {
  try {
    const nextPath = `${elements.projectPathInput.value || ''}`.trim();
    if (!nextPath) {
      closeProjectPathPicker();
      clearCurrentProjectWorkspace();
      await refreshOverview({ reloadProjects: false });
      return;
    }
    await applyProjectPathValue(nextPath);
  } catch (error) {
    showProjectHint(friendlyError(error));
  }
}

async function applyProjectPathValue(nextPath, options = {}) {
  const agent = findProjectAgent(options.agentId || state.currentProjectAgentId);
  if (!agent) {
    throw new Error('没有可用的运行系统');
  }

  const preferredRoot = options.rootPath || state.currentProjectRoot || pickProjectRoot(agent);
  const { path: resolvedPath, rootPath } = normalizeProjectPathInput(nextPath, {
    agent,
    preferredRoot,
  });

  state.currentProjectAgentId = agent.id;
  state.currentProjectRoot = rootPath;
  state.pendingProjectPath = resolvedPath;
  state.currentProjectPath = resolvedPath;
  closeProjectPathPicker();
  syncProjectPathInput(resolvedPath);
  persistProjectSelection();
  renderProjectControls();
  await refreshOverview({ reloadProjects: false });
}

function handleProjectAgentChange() {
  state.currentProjectAgentId = `${elements.projectAgentSelect.value || ''}`.trim();
  const agent = currentProjectAgent();
  state.currentProjectRoot = pickProjectRoot(agent);
  resetProjectPickerState();
  clearCurrentProjectWorkspace();
  renderProjectControls();
  refreshOverview({ reloadProjects: false }).catch((error) => {
    showProjectHint(friendlyError(error));
  });
}

function normalizeProjectPathInput(projectPath, options = {}) {
  const agent = options.agent || currentProjectAgent();
  const rawValue = `${projectPath || ''}`.trim();
  if (!agent) {
    throw new Error('没有可用的运行系统');
  }
  if (!rawValue) {
    throw new Error('请输入工程目录');
  }

  const rootPaths = agent.rootPaths || [];
  const preferredRoot = `${options.preferredRoot || ''}`.trim() || pickProjectRoot(agent);
  if (!preferredRoot) {
    throw new Error('当前运行系统还没有可用根目录');
  }

  const normalizedInput = normalizeWorkspaceInput(rawValue, {
    rootPaths,
    flavor: agent.workspaceFlavor,
    fallbackFlavor: agent.workspaceFlavor,
  });
  const candidatePath = joinWorkspacePath(preferredRoot, normalizedInput);
  const matchedRoot = rootPaths.find((rootPath) => isWorkspaceWithinRoot(candidatePath, rootPath));
  if (rootPaths.length && !matchedRoot) {
    throw new Error(`工程目录必须位于这些根目录下面：${rootPaths.join('、')}`);
  }

  return {
    path: candidatePath,
    rootPath: matchedRoot || preferredRoot,
  };
}

function clearCurrentProjectWorkspace() {
  state.pendingProjectPath = '';
  state.currentProjectPath = '';
  state.sessions = [];
  state.availableSessions = [];
  state.currentSession = null;
  state.hasControl = false;
  state.selectedSessionIds.clear();
  closeSocket();
  resetProjectPickerState();
  syncSessionQuery('');
  syncProjectPathInput('');
  persistProjectSelection();
}

function syncProjectPathInput(projectPath = state.currentProjectPath) {
  elements.projectPathInput.value = `${projectPath || ''}`.trim();
}

function handleProjectPathInput() {
  state.pendingProjectPath = `${elements.projectPathInput.value || ''}`.trim();
  if (projectSuggestionTimer) {
    clearTimeout(projectSuggestionTimer);
  }
  projectSuggestionTimer = window.setTimeout(() => {
    projectSuggestionTimer = 0;
    requestProjectSuggestions({ open: true }).catch((error) => {
      showProjectHint(friendlyError(error));
    });
  }, 120);
}

function maybeShowProjectPathPicker() {
  if (!currentProjectAgent()) {
    return;
  }
  requestProjectSuggestions({ open: true }).catch((error) => {
    showProjectHint(friendlyError(error));
  });
}

function handleGlobalPointerDown(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  if (
    target.closest('#project-path-input')
    || target.closest('#apply-project-path-button')
    || target.closest('#project-picker')
  ) {
    return;
  }
  closeProjectPathPicker();
}

function resetProjectPickerState() {
  state.projectSuggestionRequestId += 1;
  state.projectSuggestions = [];
  state.projectSuggestionMeta = '';
  state.projectSuggestionError = '';
  state.projectSuggestionLoading = false;
  state.projectPickerVisible = false;
  if (projectSuggestionTimer) {
    clearTimeout(projectSuggestionTimer);
    projectSuggestionTimer = 0;
  }
}

function closeProjectPathPicker() {
  state.projectPickerVisible = false;
  renderProjectPicker();
}

async function requestProjectSuggestions(options = {}) {
  const agent = currentProjectAgent();
  if (!agent) {
    resetProjectPickerState();
    renderProjectControls();
    return;
  }

  const input = `${options.input ?? elements.projectPathInput.value ?? ''}`.trim();
  const preferredRoot = pickProjectRoot(agent, state.currentProjectRoot, state.currentProjectPath);
  const query = new URLSearchParams({
    agentId: agent.id,
  });
  if (input) {
    query.set('input', input);
  }
  if (preferredRoot) {
    query.set('preferredRoot', preferredRoot);
  }

  state.projectPickerVisible = options.open !== false;
  state.projectSuggestionLoading = true;
  state.projectSuggestionError = '';
  renderProjectPicker();

  const requestId = state.projectSuggestionRequestId + 1;
  state.projectSuggestionRequestId = requestId;
  try {
    const payload = await api(`/api/projects/suggest?${query.toString()}`);
    if (requestId !== state.projectSuggestionRequestId) {
      return;
    }

    state.projectSuggestions = payload.suggestions || [];
    state.projectSuggestionMeta = payload.directoryPath
      ? `${payload.directoryPath} · ${state.projectSuggestions.length} 个子目录`
      : `可进入的子目录 · ${state.projectSuggestions.length} 个`;
    state.projectSuggestionError = '';
  } catch (error) {
    if (requestId !== state.projectSuggestionRequestId) {
      return;
    }
    state.projectSuggestions = [];
    state.projectSuggestionMeta = '';
    state.projectSuggestionError = friendlyError(error);
  } finally {
    if (requestId !== state.projectSuggestionRequestId) {
      return;
    }
    state.projectSuggestionLoading = false;
    renderProjectPicker();
  }
}

function ensureProjectPathSelected() {
  if (state.currentProjectPath) {
    return true;
  }
  showProjectHint(projectSelectionHint());
  return false;
}

function applyProjectPathFromQuery() {
  const params = new URLSearchParams(location.search);
  const projectAgentId = `${params.get('agentId') || ''}`.trim();
  const projectRoot = `${params.get('workspaceRoot') || ''}`.trim();
  const projectPath = `${params.get('projectPath') || ''}`.trim();
  if (projectAgentId) {
    state.currentProjectAgentId = projectAgentId;
  }
  if (projectRoot) {
    state.currentProjectRoot = projectRoot;
  }
  if (!projectPath) {
    persistProjectSelection();
    return;
  }
  state.pendingProjectPath = projectPath;
  state.currentProjectPath = projectPath;
  persistProjectSelection();
}

function showProjectHint(message) {
  elements.projectPathHint.textContent = message;
  elements.projectPathHint.hidden = !message;
}

function persistProjectSelection() {
  localStorage.setItem(PROJECT_PATH_KEY, state.currentProjectPath || '');
  localStorage.setItem(PROJECT_AGENT_KEY, state.currentProjectAgentId || '');
  localStorage.setItem(PROJECT_ROOT_KEY, state.currentProjectRoot || '');
}

function projectSelectionHint() {
  if (!state.projectAgents.length) {
    return '当前没有可用运行系统。';
  }
  const defaultRoot = pickProjectRoot(currentProjectAgent(), state.currentProjectRoot, state.currentProjectPath);
  if (!defaultRoot) {
    return state.projectAgents.length > 1 ? '先选择运行系统，再输入工程目录。' : '先输入工程目录。';
  }
  return `先在工程目录里输入完整路径，或点输入框选择 ${defaultRoot} 下的子目录；不存在时会自动创建。`;
}

function setComposeMode(mode) {
  state.composeMode = mode;
  elements.composeExistingTab.dataset.active = `${mode === 'existing'}`;
  elements.composeNewTab.dataset.active = `${mode === 'new'}`;
  elements.composeExistingPanel.hidden = mode !== 'existing';
  elements.sessionForm.hidden = mode !== 'new';
}

function openSheet(name) {
  state.activeSheet = name;
  elements.sheetBackdrop.hidden = false;
  elements.composeSheet.hidden = name !== 'compose';
  elements.settingsSheet.hidden = name !== 'settings';
  if (name === 'compose') {
    setComposeMode(state.currentProjectPath ? state.composeMode : 'new');
  }
}

function closeSheets() {
  state.activeSheet = '';
  elements.sheetBackdrop.hidden = true;
  elements.composeSheet.hidden = true;
  elements.settingsSheet.hidden = true;
}

function setView(nextView) {
  elements.loginView.hidden = nextView !== VIEW_LOGIN;
  elements.appView.hidden = nextView !== VIEW_APP;
  document.body.dataset.view = nextView;
  if (nextView === VIEW_LOGIN) {
    closeSheets();
    setMobilePane('list');
  }
  updateViewRoute(nextView);
  window.scrollTo(0, 0);
}

function showLoginStatus(message, isError = false) {
  elements.loginStatus.hidden = !message;
  elements.loginStatus.textContent = message || '';
  elements.loginStatus.style.color = isError ? '#d64545' : '';
}

function renderTopBar() {
  const isMobileDetail = isMobileLayout() && state.mobilePane === 'detail' && state.currentSession;
  elements.headerTitle.textContent = isMobileDetail ? state.currentSession.name : '会话列表';
  elements.mobileBackButton.hidden = !isMobileLayout() || !state.currentSession || state.mobilePane !== 'detail';
}

function isCurrentSessionDetailVisible() {
  if (!state.currentSession) {
    return false;
  }
  return !isMobileLayout() || state.mobilePane === 'detail';
}

function currentForegroundSessionId() {
  return isCurrentSessionDetailVisible() ? `${state.currentSession?.id || ''}`.trim() : '';
}

function setMobilePane(nextPane) {
  state.mobilePane = nextPane;
  document.body.dataset.mobilePane = isMobileLayout() ? nextPane : 'desktop';
  renderTopBar();
  scheduleTerminalFit(24);
}

function syncMobilePane() {
  if (!isMobileLayout()) {
    document.body.dataset.mobilePane = 'desktop';
    renderTopBar();
    return;
  }
  const nextPane = state.currentSession && state.mobilePane === 'detail' ? 'detail' : 'list';
  setMobilePane(nextPane);
}

function isMobileLayout() {
  return window.innerWidth < 1080;
}

function updateViewportHeight() {
  const nextHeight = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty('--viewport-height', `${Math.round(nextHeight)}px`);
}

function scheduleTerminalFit(delay = 0) {
  if (fitTimer) {
    clearTimeout(fitTimer);
  }
  fitTimer = window.setTimeout(() => {
    fitTimer = 0;
    requestAnimationFrame(() => fitAddon.fit());
  }, delay);
}

function scheduleScrollCurrentSessionToLatest() {
  requestAnimationFrame(() => {
    if (state.detailSnapshotMode === 'raw_terminal' && !elements.rawTerminalPanel.hidden) {
      terminal.scrollToBottom();
      requestAnimationFrame(() => {
        terminal.scrollToBottom();
      });
      return;
    }

    if (!elements.chatThread.hidden) {
      elements.chatThread.scrollTop = elements.chatThread.scrollHeight;
      requestAnimationFrame(() => {
        elements.chatThread.scrollTop = elements.chatThread.scrollHeight;
      });
    }
  });
}

function setSettingsNote(message = '') {
  const text = `${message || ''}`.trim();
  elements.settingsNote.textContent = text;
  elements.settingsNote.hidden = !text;
}

function buildSessionAlertMarker(kind, session) {
  return [
    kind,
    `${session?.id || ''}`.trim(),
    Number(session?.activityAt || 0),
    `${session?.contentSignature || ''}`.trim(),
    `${session?.state || ''}`.trim(),
  ].join(':');
}

function shouldDispatchSessionAlert(kind, session) {
  const sessionId = `${session?.id || ''}`.trim();
  if (!sessionId) {
    return false;
  }
  const markerKey = `${kind}:${sessionId}`;
  const nextMarker = buildSessionAlertMarker(kind, session);
  if (state.alertedSessionMarkers[markerKey] === nextMarker) {
    return false;
  }
  state.alertedSessionMarkers[markerKey] = nextMarker;
  return true;
}

function pruneSessionAlertMarkers() {
  const unreadSessionIds = state.unreadCompletedSessionIds;
  const errorSessionIds = new Set(
    state.availableSessions
      .filter((session) => `${session?.state || ''}` === 'error')
      .map((session) => `${session?.id || ''}`.trim())
      .filter(Boolean),
  );
  for (const markerKey of Object.keys(state.alertedSessionMarkers)) {
    const [kind, sessionId] = markerKey.split(':');
    if (kind === 'needs_input' && !unreadSessionIds.has(sessionId)) {
      delete state.alertedSessionMarkers[markerKey];
      continue;
    }
    if (kind === 'error' && !errorSessionIds.has(sessionId)) {
      delete state.alertedSessionMarkers[markerKey];
    }
  }
}

function clearSessionAlertMarkers(sessionId) {
  const normalizedSessionId = `${sessionId || ''}`.trim();
  if (!normalizedSessionId) {
    return;
  }
  delete state.alertedSessionMarkers[`needs_input:${normalizedSessionId}`];
  delete state.alertedSessionMarkers[`error:${normalizedSessionId}`];
}

function syncCompletionSeenToServer(sessionId) {
  const normalizedSessionId = `${sessionId || ''}`.trim();
  if (!normalizedSessionId || state.clearingUnreadSessionIds.has(normalizedSessionId)) {
    return;
  }
  state.clearingUnreadSessionIds.add(normalizedSessionId);
  api('/api/session-preferences/clear-completed-unread', {
    method: 'POST',
    body: JSON.stringify({
      sessionIds: [normalizedSessionId],
    }),
  }).catch(() => {}).finally(() => {
    state.clearingUnreadSessionIds.delete(normalizedSessionId);
  });
}

function dismissActiveSessionAlertPopup(options = {}) {
  const popup = state.activeSessionAlertPopup;
  if (state.sessionAlertPopupTimer) {
    clearTimeout(state.sessionAlertPopupTimer);
    state.sessionAlertPopupTimer = 0;
  }
  state.activeSessionAlertPopup = null;
  if (options.markSeen !== false && popup?.sessionId) {
    markSessionCompletionSeen(popup.sessionId, { rerender: true, syncServer: true });
  }
  renderSessionAlertPopup();
  showNextSessionAlertPopup();
}

function renderSessionAlertPopup() {
  const popup = state.activeSessionAlertPopup;
  elements.sessionAlertPopups.hidden = !popup;
  elements.sessionAlertPopups.innerHTML = popup
    ? `
      <button class="session-alert-popup" type="button" data-kind="${escapeHtml(popup.kind)}">
        <div class="session-alert-popup__eyebrow">${escapeHtml(popup.kind === 'error' ? '会话异常' : '会话代办')}</div>
        <div class="session-alert-popup__title">${escapeHtml(popup.title)}</div>
        <div class="session-alert-popup__body">${escapeHtml(popup.body)}</div>
      </button>
    `
    : '';
  if (!popup) {
    return;
  }
  const button = elements.sessionAlertPopups.querySelector('.session-alert-popup');
  button?.addEventListener('click', () => {
    const targetSession = state.availableSessions.find((session) => session.id === popup.sessionId);
    dismissActiveSessionAlertPopup({ markSeen: true });
    if (!targetSession) {
      return;
    }
    openSession(targetSession).catch((error) => {
      showProjectHint(friendlyError(error));
    });
  }, { once: true });
}

function showNextSessionAlertPopup() {
  if (state.activeSessionAlertPopup || !state.sessionAlertPopupQueue.length) {
    return;
  }
  state.activeSessionAlertPopup = state.sessionAlertPopupQueue.shift() || null;
  renderSessionAlertPopup();
  if (!state.activeSessionAlertPopup) {
    return;
  }
  state.sessionAlertPopupTimer = window.setTimeout(() => {
    state.sessionAlertPopupTimer = 0;
    if (!state.activeSessionAlertPopup) {
      return;
    }
    dismissActiveSessionAlertPopup({ markSeen: true });
  }, 5000);
}

function enqueueSessionAlertPopup(kind, session) {
  if (document.body.dataset.view !== VIEW_APP) {
    return;
  }
  const sessionId = `${session?.id || ''}`.trim();
  if (!sessionId) {
    return;
  }
  const title = `${session?.name || sessionId}`.trim();
  const body = normalizeSessionAlertBody(session?.previewText || '')
    || (kind === 'error' ? '电脑端返回了错误状态。' : '会话已经完成当前步骤，等待你的下一步输入。');
  const marker = buildSessionAlertMarker(kind, session);
  if (state.activeSessionAlertPopup?.marker === marker || state.sessionAlertPopupQueue.some((item) => item.marker === marker)) {
    return;
  }
  state.sessionAlertPopupQueue.push({
    marker,
    sessionId,
    kind,
    title,
    body,
  });
  showNextSessionAlertPopup();
}

function notifyViaPlatform(kind, title, body, options = {}) {
  const settings = normalizeCompletionAlertSettings(options);
  if (!settings.enabled || (!settings.notify && !settings.sound && !settings.vibrate)) {
    return;
  }

  if (window.AndroidBridge?.notifyStateWithOptions) {
    window.AndroidBridge.notifyStateWithOptions(kind, title, body, settings.notify, settings.sound, settings.vibrate);
    return;
  }

  if (window.AndroidBridge?.notifyState && settings.notify) {
    window.AndroidBridge.notifyState(kind, title, body);
  } else if (settings.notify && 'Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body });
  }

  if (settings.vibrate && typeof navigator.vibrate === 'function') {
    navigator.vibrate([0, 120, 60, 120]);
  }

  if (settings.sound) {
    playCompletionTone();
  }
}

function applyCompletionIndicators({ previousUnreadSessionIds = new Set(), previousSessions = [] } = {}) {
  const viewedSessionId = currentForegroundSessionId();
  const notificationEvents = deriveSessionNotificationEvents({
    previousSessions,
    nextSessions: state.availableSessions,
    previousUnreadSessionIds: [...previousUnreadSessionIds],
    nextUnreadSessionIds: [...state.unreadCompletedSessionIds],
    viewedSessionId,
  });
  console.debug('[completion-alert] apply list refresh', {
    viewedSessionId,
    previousUnreadSessionIds: [...previousUnreadSessionIds],
    nextUnreadSessionIds: [...state.unreadCompletedSessionIds],
    events: notificationEvents,
    actionableSessions: state.availableSessions
      .filter((session) => session.serverUnreadCompleted || session.id === state.currentSession?.id)
      .map((session) => ({
        id: session.id,
        name: session.name,
        unreadCompleted: Boolean(session.serverUnreadCompleted),
        readyForInput: Boolean(session.readyForInput),
        hasPendingUserInput: Boolean(session.hasPendingUserInput),
        activityAt: Number(session.activityAt || 0),
        contentSignature: `${session.contentSignature || ''}`,
      })),
  });

  for (const event of notificationEvents) {
    const session = state.availableSessions.find((item) => item.id === event.sessionId);
    if (!session) {
      continue;
    }
    if (!shouldDispatchSessionAlert(event.kind, session)) {
      continue;
    }
    const alert = buildSessionAlertNotification(event.kind, session);
    const deliverySettings = resolveCompletionAlertDeliverySettings({
      sessionId: event.sessionId,
      viewedSessionId,
      completionAlertSettings: state.completionAlertSettings,
      sessionCompletionAlertOverrides: state.sessionCompletionAlertOverrides,
    });
    notifyViaPlatform(
      alert.kind,
      alert.title,
      alert.body,
      deliverySettings,
    );
    enqueueSessionAlertPopup(event.kind, session);
  }
}

function buildSessionAlertNotification(kind, session) {
  const preview = normalizeSessionAlertBody(session?.previewText || '');
  if (kind === 'error') {
    return {
      kind: 'error',
      title: `会话异常：${session.name}`,
      body: preview || '电脑端返回了错误状态。',
    };
  }

  return {
    kind: 'needs_input',
    title: `会话代办：${session.name}`,
    body: preview || '会话已经完成当前步骤，等待你的下一步输入。',
  };
}

function normalizeSessionAlertBody(value) {
  return `${value || ''}`
    .replace(/^[\s•]+/u, '')
    .trim();
}

function decorateSessionsWithUnread(list) {
  for (const session of list) {
    session.unreadCompleted = state.unreadCompletedSessionIds.has(session.id);
  }
}

function refreshUnreadCompletedSessionIds() {
  const nextUnreadSessionIds = new Set(
    state.availableSessions
      .filter((session) => session.serverUnreadCompleted && isCompletionAlertEnabledForSession(session.id))
      .map((session) => session.id),
  );
  state.unreadCompletedSessionIds = nextUnreadSessionIds;
  pruneSessionAlertMarkers();
  persistCompletedUnreadSessionIds();
  decorateSessionsWithUnread(state.sessions);
  decorateSessionsWithUnread(state.availableSessions);
}

function markVisibleCompletionIndicators() {
  if (!isCurrentSessionDetailVisible()) {
    return;
  }
  markSessionCompletionSeen(state.currentSession.id, { rerender: false });
  decorateSessionsWithUnread(state.sessions);
  decorateSessionsWithUnread(state.availableSessions);
}

function markSessionCompletionSeen(sessionId, options = {}) {
  if (!sessionId) {
    return;
  }
  const hasVisibleUnread = state.unreadCompletedSessionIds.has(sessionId);
  const hasServerUnread = state.availableSessions.some((session) => session.id === sessionId && session.serverUnreadCompleted);
  if (!hasVisibleUnread && !hasServerUnread) {
    return;
  }
  state.unreadCompletedSessionIds.delete(sessionId);
  setSessionServerUnreadCompleted(sessionId, false);
  clearSessionAlertMarkers(sessionId);
  if (options.syncServer !== false) {
    syncCompletionSeenToServer(sessionId);
  }
  persistCompletedUnreadSessionIds();
  decorateSessionsWithUnread(state.sessions);
  decorateSessionsWithUnread(state.availableSessions);
  if (options.rerender !== false) {
    renderSessions();
  }
}

function renameCompletedUnreadSessionId(previousId, nextId) {
  if (!previousId || !nextId || previousId === nextId || !state.unreadCompletedSessionIds.has(previousId)) {
    return;
  }
  state.unreadCompletedSessionIds.delete(previousId);
  state.unreadCompletedSessionIds.add(nextId);
  persistCompletedUnreadSessionIds();
}

function handleCompletionAlertSettingsChange() {
  state.completionAlertSettings = normalizeCompletionAlertSettings({
    enabled: true,
    notify: elements.settingsCompleteNotify.checked,
    sound: elements.settingsCompleteSound.checked,
    vibrate: elements.settingsCompleteVibrate.checked,
  });
  localStorage.setItem(COMPLETION_ALERT_SETTINGS_KEY, JSON.stringify(state.completionAlertSettings));
  refreshUnreadCompletedSessionIds();
  renderCompletionAlertSettings();
  renderSessions();
  if (state.completionAlertSettings.notify && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

function renderCompletionAlertSettings() {
  const settings = normalizeCompletionAlertSettings(state.completionAlertSettings);
  elements.settingsCompleteNotify.checked = settings.notify;
  elements.settingsCompleteSound.checked = settings.sound;
  elements.settingsCompleteVibrate.checked = settings.vibrate;
  elements.sessionCompleteEnabled.checked = state.currentSession
    ? isCompletionAlertEnabledForSession(state.currentSession.id)
    : settings.enabled;
}

function loadCompletionAlertSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(COMPLETION_ALERT_SETTINGS_KEY) || '{}');
    return normalizeCompletionAlertSettings({
      enabled: true,
      notify: raw?.notify,
      sound: raw?.sound,
      vibrate: raw?.vibrate,
    });
  } catch {
    return normalizeCompletionAlertSettings({
      enabled: true,
      notify: true,
    });
  }
}

function handleCurrentSessionCompletionAlertChange() {
  if (!state.currentSession) {
    return;
  }
  state.sessionCompletionAlertOverrides[state.currentSession.id] = elements.sessionCompleteEnabled.checked;
  persistSessionCompletionAlertOverrides();
  refreshUnreadCompletedSessionIds();
  renderCompletionAlertSettings();
  renderSessions();
}

function loadSessionCompletionAlertOverrides() {
  try {
    return normalizeSessionCompletionAlertOverrides(JSON.parse(localStorage.getItem(SESSION_COMPLETION_ALERT_OVERRIDES_KEY) || '{}'));
  } catch {
    return normalizeSessionCompletionAlertOverrides();
  }
}

function persistSessionCompletionAlertOverrides() {
  localStorage.setItem(SESSION_COMPLETION_ALERT_OVERRIDES_KEY, JSON.stringify(state.sessionCompletionAlertOverrides));
}

function renameSessionCompletionAlertOverride(previousId, nextId) {
  if (!previousId || !nextId || previousId === nextId || !Object.prototype.hasOwnProperty.call(state.sessionCompletionAlertOverrides, previousId)) {
    return;
  }
  state.sessionCompletionAlertOverrides[nextId] = state.sessionCompletionAlertOverrides[previousId];
  delete state.sessionCompletionAlertOverrides[previousId];
  persistSessionCompletionAlertOverrides();
}

function removeSessionCompletionAlertOverrides(sessionIds) {
  let changed = false;
  for (const sessionId of sessionIds) {
    if (!Object.prototype.hasOwnProperty.call(state.sessionCompletionAlertOverrides, sessionId)) {
      continue;
    }
    delete state.sessionCompletionAlertOverrides[sessionId];
    changed = true;
  }
  if (changed) {
    persistSessionCompletionAlertOverrides();
  }
}

function isCompletionAlertEnabledForSession(sessionId) {
  return resolveCompletionAlertEnabled({
    sessionId,
    completionAlertSettings: state.completionAlertSettings,
    sessionCompletionAlertOverrides: state.sessionCompletionAlertOverrides,
  });
}

function preserveServerUnreadCompletionState(session) {
  return {
    ...session,
    serverUnreadCompleted: Boolean(session?.serverUnreadCompleted ?? session?.unreadCompleted),
  };
}

function setSessionServerUnreadCompleted(sessionId, nextValue) {
  for (const session of state.sessions) {
    if (session.id === sessionId) {
      session.serverUnreadCompleted = nextValue;
    }
  }
  for (const session of state.availableSessions) {
    if (session.id === sessionId) {
      session.serverUnreadCompleted = nextValue;
    }
  }
  if (state.currentSession?.id === sessionId) {
    state.currentSession.serverUnreadCompleted = nextValue;
  }
}

function loadCompletedUnreadSessionIds() {
  try {
    const values = JSON.parse(localStorage.getItem(COMPLETED_UNREAD_KEY) || '[]');
    return Array.isArray(values) ? values : [];
  } catch {
    return [];
  }
}

function persistCompletedUnreadSessionIds() {
  localStorage.setItem(COMPLETED_UNREAD_KEY, JSON.stringify([...state.unreadCompletedSessionIds]));
}

function playCompletionTone() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    return;
  }
  const audioContext = new AudioContextCtor();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = 880;
  gainNode.gain.value = 0.0001;
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  const now = audioContext.currentTime;
  gainNode.gain.exponentialRampToValueAtTime(0.05, now + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
  oscillator.start(now);
  oscillator.stop(now + 0.3);
  oscillator.addEventListener('ended', () => {
    audioContext.close().catch(() => {});
  });
}

async function logout() {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {
    // Ignore.
  }
  state.identitySummary = '';
  state.seenSessionActivity = {};
  state.seenSessionContentSignatures = {};
  state.alertedSessionMarkers = {};
  state.sessionAlertPopupQueue = [];
  dismissActiveSessionAlertPopup();
  state.currentSession = null;
  closeSocket();
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = 0;
  }
  localStorage.removeItem(SEEN_SESSION_ACTIVITY_KEY);
  localStorage.removeItem(SEEN_SESSION_CONTENT_SIGNATURE_KEY);
  elements.userSummary.textContent = '';
  elements.userSummary.hidden = true;
  closeSheets();
  if (window.AndroidBridge?.handleLogout) {
    window.AndroidBridge.handleLogout();
    return;
  }
  await presentLoginView();
}

function syncSessionQuery(sessionId, mode = 'replace') {
  const historyMethod = mode === 'push' ? 'pushState' : 'replaceState';
  if (!window.history?.[historyMethod]) {
    return;
  }
  const url = new URL(window.location.href);
  if (sessionId) {
    url.searchParams.set('session', sessionId);
  } else {
    url.searchParams.delete('session');
  }
  url.hash = elements.appView.hidden ? '#login' : '#sessions';
  window.history[historyMethod]({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function updateViewRoute(nextView) {
  if (!window.history?.replaceState) {
    return;
  }
  const url = new URL(window.location.href);
  url.hash = nextView === VIEW_APP ? '#sessions' : '#login';
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

async function api(pathname, options = {}) {
  const response = await fetch(pathname, {
    credentials: 'same-origin',
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (response.status === 401 && !isAuthlessPath(pathname)) {
    closeSocket();
    closeSheets();
    setView(VIEW_LOGIN);
    showLoginStatus('登录已经过期，请重新登录。', true);
    refreshLoginPolicy({ preserveStatus: true }).catch(() => {});
    throw new Error('需要重新登录');
  }
  if (!response.ok) {
    throw new Error((await response.text()) || response.statusText);
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return response.text();
  }
  return response.json();
}

function sessionStatusDisplay(session, options = {}) {
  const sessionId = `${session?.id || ''}`.trim();
  return deriveSessionStatusDisplay(session, {
    currentSessionId: state.currentSession?.id || '',
    seenActivityAt: Number(state.seenSessionActivity[sessionId] || 0),
    seenContentSignature: `${state.seenSessionContentSignatures[sessionId] || ''}`.trim(),
    includeCurrentSession: Boolean(options.includeCurrentSession),
  });
}

function applyIdentitySummary(me) {
  const clientName = `${me?.clientName || ''}`.trim();
  const trustedIdentity = `${me?.trustedIdentity || ''}`.trim();
  state.identitySummary = trustedIdentity
    ? `${clientName}${clientName ? ` · ${trustedIdentity}` : trustedIdentity}`
    : clientName || '未知';
  elements.userSummary.textContent = trustedIdentity;
  elements.userSummary.hidden = !trustedIdentity;
}

function normalizeSeenSessionActivity(raw) {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  return Object.fromEntries(
    Object.entries(raw)
      .map(([sessionId, activityAt]) => [`${sessionId || ''}`.trim(), Number(activityAt || 0)])
      .filter(([sessionId, activityAt]) => sessionId && Number.isFinite(activityAt) && activityAt > 0),
  );
}

function normalizeSeenSessionContentSignatures(raw) {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  return Object.fromEntries(
    Object.entries(raw)
      .map(([sessionId, contentSignature]) => [`${sessionId || ''}`.trim(), `${contentSignature || ''}`.trim()])
      .filter(([sessionId, contentSignature]) => sessionId && contentSignature),
  );
}

function loadSeenSessionActivity() {
  try {
    return normalizeSeenSessionActivity(JSON.parse(localStorage.getItem(SEEN_SESSION_ACTIVITY_KEY) || '{}'));
  } catch {
    return {};
  }
}

function loadSeenSessionContentSignatures() {
  try {
    return normalizeSeenSessionContentSignatures(
      JSON.parse(localStorage.getItem(SEEN_SESSION_CONTENT_SIGNATURE_KEY) || '{}'),
    );
  } catch {
    return {};
  }
}

function persistSeenSessionActivity() {
  localStorage.setItem(SEEN_SESSION_ACTIVITY_KEY, JSON.stringify(state.seenSessionActivity));
}

function persistSeenSessionContentSignatures() {
  localStorage.setItem(SEEN_SESSION_CONTENT_SIGNATURE_KEY, JSON.stringify(state.seenSessionContentSignatures));
}

function pruneSeenSessionActivity() {
  const knownSessionIds = new Set(state.availableSessions.map((session) => `${session.id || ''}`.trim()).filter(Boolean));
  let activityChanged = false;
  for (const sessionId of Object.keys(state.seenSessionActivity)) {
    if (knownSessionIds.has(sessionId)) {
      continue;
    }
    delete state.seenSessionActivity[sessionId];
    activityChanged = true;
  }
  let signatureChanged = false;
  for (const sessionId of Object.keys(state.seenSessionContentSignatures)) {
    if (knownSessionIds.has(sessionId)) {
      continue;
    }
    delete state.seenSessionContentSignatures[sessionId];
    signatureChanged = true;
  }
  if (activityChanged) {
    persistSeenSessionActivity();
  }
  if (signatureChanged) {
    persistSeenSessionContentSignatures();
  }
}

function markSessionSeenActivity(sessionId, activityAt) {
  const normalizedSessionId = `${sessionId || ''}`.trim();
  const nextActivityAt = Number(activityAt || 0);
  if (!normalizedSessionId || !Number.isFinite(nextActivityAt) || nextActivityAt <= 0) {
    return;
  }
  if (Number(state.seenSessionActivity[normalizedSessionId] || 0) >= nextActivityAt) {
    return;
  }
  state.seenSessionActivity[normalizedSessionId] = nextActivityAt;
  persistSeenSessionActivity();
}

function markSessionSeenContentSignature(sessionId, contentSignature) {
  const normalizedSessionId = `${sessionId || ''}`.trim();
  const nextContentSignature = `${contentSignature || ''}`.trim();
  if (!normalizedSessionId || !nextContentSignature) {
    return;
  }
  if (`${state.seenSessionContentSignatures[normalizedSessionId] || ''}` === nextContentSignature) {
    return;
  }
  state.seenSessionContentSignatures[normalizedSessionId] = nextContentSignature;
  persistSeenSessionContentSignatures();
}

function markSessionSeenState(session) {
  if (!session) {
    return;
  }
  markSessionSeenActivity(session.id, session.activityAt);
  markSessionSeenContentSignature(session.id, session.contentSignature);
}

function renameSeenSessionState(previousId, nextId) {
  if (!previousId || !nextId || previousId === nextId) {
    return;
  }
  let activityChanged = false;
  if (Object.prototype.hasOwnProperty.call(state.seenSessionActivity, previousId)) {
    state.seenSessionActivity[nextId] = state.seenSessionActivity[previousId];
    delete state.seenSessionActivity[previousId];
    activityChanged = true;
  }
  if (activityChanged) {
    persistSeenSessionActivity();
  }
  let signatureChanged = false;
  if (Object.prototype.hasOwnProperty.call(state.seenSessionContentSignatures, previousId)) {
    state.seenSessionContentSignatures[nextId] = state.seenSessionContentSignatures[previousId];
    delete state.seenSessionContentSignatures[previousId];
    signatureChanged = true;
  }
  if (signatureChanged) {
    persistSeenSessionContentSignatures();
  }
}

function navigateBackToSessionList() {
  if (!state.currentSession) {
    closeSheets();
    setMobilePane('list');
    return;
  }
  leaveCurrentSessionView();
}

function leaveCurrentSessionView(options = {}) {
  if (!state.currentSession) {
    closeSheets();
    if (options.syncHistory !== false) {
      syncSessionQuery('');
    }
    setMobilePane('list');
    return;
  }
  closeSheets();
  closeProjectPathPicker();
  closeSocket();
  state.currentSession = null;
  state.hasControl = false;
  state.editingContext = null;
  state.attachments = [];
  elements.imageInput.value = '';
  elements.sendInput.blur();
  renderComposerAttachments();
  if (options.syncHistory !== false) {
    syncSessionQuery('');
  }
  renderSessions();
  renderCurrentSessionEmpty();
  setMobilePane('list');
}

function handleSystemBack() {
  if (state.activeSheet) {
    closeSheets();
    return true;
  }
  if (state.projectPickerVisible) {
    closeProjectPathPicker();
    return true;
  }
  if (isMobileLayout() && state.currentSession) {
    navigateBackToSessionList();
    return true;
  }
  return false;
}

window.RemoteConnectAppHandleSystemBack = handleSystemBack;

function handleHistoryNavigation() {
  if (document.body.dataset.view !== VIEW_APP) {
    return;
  }
  const sessionId = new URLSearchParams(window.location.search).get('session');
  if (!sessionId) {
    leaveCurrentSessionView({ syncHistory: false });
    return;
  }
  const session = state.availableSessions.find((item) => item.id === sessionId)
    || state.sessions.find((item) => item.id === sessionId);
  if (!session) {
    leaveCurrentSessionView({ syncHistory: false });
    return;
  }
  if (state.currentSession?.id === session.id) {
    if (isMobileLayout()) {
      setMobilePane('detail');
    }
    return;
  }
  openSession(session, true, { historyMode: 'replace' }).catch((error) => {
    showProjectHint(friendlyError(error));
  });
}

function friendlyError(error) {
  const message = `${error?.message || error}`;
  if (message.startsWith('{') && message.endsWith('}')) {
    try {
      const payload = JSON.parse(message);
      return payload.error || message;
    } catch {
      return message;
    }
  }
  if (message.includes('Invalid PIN')) {
    return 'PIN 不正确。';
  }
  if (message.includes('Too many login attempts')) {
    return '尝试次数过多，请稍后再试。';
  }
  if (message.includes('Trusted browser identity required')) {
    return '当前浏览器还没有可信身份，请先通过 Access 打开这个站点。';
  }
  if (message.includes('This identity is not allowed')) {
    return '当前浏览器身份不在允许名单内。';
  }
  if (message.includes('Browser login is disabled for this gateway')) {
    return '当前站点未启用网页登录。';
  }
  if (message.includes('Local login is disabled for this gateway')) {
    return '当前站点未启用 PIN 登录。';
  }
  if (message.includes('selected agent can access')) {
    return '当前运行系统不能直接使用这种路径格式，请改用对应系统的路径写法。';
  }
  if (message.includes('Workspace must live under one of')) {
    return '工程目录必须位于当前运行系统允许的根目录下面。';
  }
  if (message.includes('Authentication required') || message.includes('需要重新登录')) {
    return '登录已经过期，请重新登录。';
  }
  return message;
}

function isAuthlessPath(pathname) {
  return pathname === '/api/login' || pathname === '/api/auth/browser/login' || pathname === '/api/auth/policy';
}

function escapeHtml(value) {
  return `${value}`
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function resizeComposer() {
  elements.sendInput.style.height = 'auto';
  const nextHeight = Math.min(Math.max(elements.sendInput.scrollHeight, 54), Math.round(window.innerHeight * 0.28));
  elements.sendInput.style.height = `${nextHeight}px`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const result = `${reader.result || ''}`;
      resolve(result.includes(',') ? result.split(',').pop() || '' : result);
    };
    reader.readAsDataURL(file);
  });
}

function createClientId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  const randomBytes = globalThis.crypto?.getRandomValues
    ? globalThis.crypto.getRandomValues(new Uint8Array(16))
    : Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  randomBytes[6] = (randomBytes[6] & 0x0f) | 0x40;
  randomBytes[8] = (randomBytes[8] & 0x3f) | 0x80;
  const hex = [...randomBytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
