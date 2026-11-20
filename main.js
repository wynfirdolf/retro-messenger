const { app, BrowserWindow, ipcMain, dialog, Menu, shell, screen, nativeTheme, nativeImage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const store = require('./src/store');
const { ClaudeSession, resolveEnvironment, describeTool } = require('./src/claude-session');
const { CodexSession, findCodex, listModels: codexModels } = require('./src/codex-session');
const history = require('./src/history');
const I18N = require('./renderer/i18n');
const MODELS = require('./renderer/models');

const isMac = process.platform === 'darwin';
const PRELOAD = path.join(__dirname, 'preload.js');
const page = (name) => path.join(__dirname, 'renderer', name);

let env = { env: process.env, claudePath: null };
let listWin = null;
let toastWin = null;
let importWin = null;
let settingsWin = null;
let rateLimit = null;
const chatWins = new Map(); // sohbet id -> pencere
const sessions = new Map(); // sohbet id -> ClaudeSession
const busy = new Set();
const pending = new Map(); // sohbet id -> Map(istek id -> izin isteği)
const userDenied = new Set(); // bu turda kullanıcının bir isteği reddettiği sohbetler
const unread = new Set();

const alive = (w) => w && !w.isDestroyed();
const currentLang = () => I18N.resolveLang(store.profile().lang, app.getLocale());
const t = (key, vars) => I18N.makeT(currentLang())(key, vars);

// 'system' follows macOS / Windows; 'light' and 'dark' force a theme. The CSS reacts through prefers-color-scheme.
function applyTheme() {
  const pref = store.profile().theme;
  nativeTheme.themeSource = ['light', 'dark'].includes(pref) ? pref : 'system';
}
const windowBg = () => (nativeTheme.shouldUseDarkColors ? '#1c2331' : '#ffffff');

function makeWindow(opts) {
  const win = new BrowserWindow({
    frame: false,
    show: false,
    backgroundColor: windowBg(),
    ...opts,
    webPreferences: { preload: PRELOAD, autoplayPolicy: 'no-user-gesture-required' },
  });
  win.once('ready-to-show', () => win.show());
  return win;
}

// ---------- Durum ----------

function lastSnippet(chat) {
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const m = chat.messages[i];
    if (m.from !== 'claude' && m.from !== 'me') continue;
    const text = m.text.replace(/[`*#]/g, '').replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, 80);
    if (m.files?.length) return '📎 ' + m.files.map((f) => f.name).join(', ').slice(0, 78);
  }
  return '';
}

// ---------- Dosya ekleri ----------

const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const MAX_INLINE_IMAGE = 5 * 1024 * 1024; // bigger images go to Claude as a path instead
const MAX_FILES = 10;
const attachmentsDir = () => path.join(app.getPath('userData'), 'attachments');

function describeFile(p) {
  try {
    const st = fs.statSync(p);
    const mime = IMAGE_TYPES[path.extname(p).toLowerCase()] || null;
    return { path: p, name: path.basename(p), size: st.size, kind: st.isDirectory() ? 'folder' : mime ? 'image' : 'file', mime };
  } catch {
    return null;
  }
}

// Images small enough are sent inline so Claude sees them right away; everything is also listed by path.
// Claude gets images as base64 blocks; Codex gets them as -i file paths.
function buildContent(text, files, provider = 'claude') {
  if (!files.length) return text;
  const blocks = [];
  const inline = new Set();
  for (const f of files) {
    if (f.kind === 'image' && f.size <= MAX_INLINE_IMAGE) {
      blocks.push(String(provider).startsWith('codex')
        ? { type: 'image', path: f.path }
        : { type: 'image', source: { type: 'base64', media_type: f.mime, data: fs.readFileSync(f.path).toString('base64') } });
      inline.add(f.path);
    }
  }
  const note = (f) => (f.kind === 'folder' ? ' (folder)' : inline.has(f.path) ? ' (image, already included above; no need to open it)' : '');
  const list = files.map((f) => `- ${f.path}${note(f)}`).join('\n');
  blocks.push({ type: 'text', text: `${text}${text ? '\n\n' : ''}[Attached ${files.length === 1 ? 'file' : 'files'}]\n${list}` });
  return blocks;
}

function snapshot() {
  return {
    profile: store.profile(),
    claudePath: env.claudePath && env.claudePath.replace(os.homedir(), '~'),
    codexPath: env.codexPath && env.codexPath.replace(os.homedir(), '~'),
    appVersion: require('./package.json').version,
    providers: { claude: !!env.claudePath, codex: !!env.codexPath },
    rateLimit,
    chats: store.chats().map((c) => ({
      id: c.id,
      name: c.name,
      cwd: c.cwd,
      avatar: c.avatar,
      provider: c.provider || 'claude',
      pinned: c.pinned,
      updatedAt: c.updatedAt,
      busy: busy.has(c.id),
      waiting: !!pending.get(c.id)?.size,
      unread: unread.has(c.id),
      last: lastSnippet(c),
    })),
  };
}

function pushState() {
  if (alive(listWin)) listWin.webContents.send('state', snapshot());
  if (alive(settingsWin)) settingsWin.webContents.send('state', snapshot());
}

function sendToChat(id, channel, payload) {
  const w = chatWins.get(id);
  if (alive(w)) w.webContents.send(channel, payload);
}

// A 16x16 red dot for the Windows taskbar, drawn pixel by pixel (BGRA) so no image file is needed.
let unreadDot = null;
function redDot() {
  if (unreadDot) return unreadDot;
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2);
      const i = (y * size + x) * 4;
      const inner = d <= 6.2;
      const alpha = Math.max(0, Math.min(1, 7.5 - d));
      buf[i] = inner ? 0x2b : 0xff; // B
      buf[i + 1] = inner ? 0x2b : 0xff; // G
      buf[i + 2] = inner ? 0xd9 : 0xff; // R
      buf[i + 3] = Math.round(alpha * 255);
    }
  }
  unreadDot = nativeImage.createFromBitmap(buf, { width: size, height: size });
  return unreadDot;
}

function updateBadge() {
  if (isMac && app.dock) app.dock.setBadge(unread.size ? String(unread.size) : '');
  else if (process.platform === 'win32') {
    if (alive(listWin)) listWin.setOverlayIcon(unread.size ? redDot() : null, unread.size ? t('badge.unread', { n: unread.size }) : '');
  } else app.setBadgeCount(unread.size);
}

function markRead(id) {
  if (unread.delete(id)) {
    updateBadge();
    pushState();
  }
  const w = chatWins.get(id);
  if (alive(w)) w.flashFrame(false);
}

function playSound(name, id) {
  if (store.profile().status === 'busy' && name !== 'nudge') return;
  const target = alive(chatWins.get(id)) ? chatWins.get(id) : listWin;
  if (alive(target)) target.webContents.send('play-sound', name);
}

// ---------- Pencereler ----------

function createListWindow() {
  listWin = makeWindow({ width: 330, height: 680, minWidth: 290, minHeight: 460, title: 'Retro Messenger' });
  listWin.loadFile(page('list.html'));
  listWin.on('closed', () => { listWin = null; });
}

function openChat(id) {
  const chat = store.getChat(id);
  if (!chat) return;
  let win = chatWins.get(id);
  if (alive(win)) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return;
  }
  const offset = (chatWins.size % 6) * 26;
  const { workArea } = screen.getPrimaryDisplay();
  win = makeWindow({
    width: 660,
    height: 620,
    minWidth: 480,
    minHeight: 440,
    x: workArea.x + 380 + offset,
    y: workArea.y + 60 + offset,
    title: chat.name,
  });
  win.loadFile(page('chat.html'), { query: { id } });
  win.on('focus', () => markRead(id));
  win.on('closed', () => chatWins.delete(id));
  chatWins.set(id, win);
  markRead(id);
}

function openSettingsWindow() {
  if (alive(settingsWin)) return settingsWin.focus();
  settingsWin = makeWindow({ width: 620, height: 520, minWidth: 520, minHeight: 420, title: t('set.title') });
  settingsWin.loadFile(page('settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

function openImportWindow(parent) {
  if (alive(importWin)) return importWin.focus();
  importWin = makeWindow({ width: 620, height: 560, minWidth: 460, minHeight: 360, parent: alive(parent) ? parent : undefined });
  importWin.loadFile(page('import.html'));
  importWin.on('closed', () => { importWin = null; });
}

const claudeChatsDir = () => path.join(app.getPath('userData'), 'claude-chats');

const homeLabel = (p) => (p.startsWith(os.homedir()) ? '~' + p.slice(os.homedir().length) : p);

function showToast(chat, text) {
  if (alive(toastWin)) toastWin.close();
  const { workArea } = screen.getPrimaryDisplay();
  const w = 270;
  const h = 128;
  toastWin = new BrowserWindow({
    width: w,
    height: h,
    x: workArea.x + workArea.width - w - 14,
    y: workArea.y + workArea.height - h - 14,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: windowBg(),
    webPreferences: { preload: PRELOAD },
  });
  toastWin.loadFile(page('toast.html'), {
    query: { id: chat.id, name: chat.name, avatar: chat.avatar, text: text.replace(/\s+/g, ' ').slice(0, 140) },
  });
  const tw = toastWin;
  tw.once('ready-to-show', () => tw.showInactive());
  setTimeout(() => { if (alive(tw)) tw.close(); }, 6500);
}

function shake(win) {
  if (!alive(win) || win.isMaximized() || win.isFullScreen()) return;
  const [x, y] = win.getPosition();
  const steps = [[-10, 0], [10, -5], [-8, 5], [8, 0], [-6, -3], [6, 3], [-3, 0], [3, 0]];
  let i = 0;
  const timer = setInterval(() => {
    if (!alive(win)) return clearInterval(timer);
    if (i >= steps.length * 2) {
      clearInterval(timer);
      win.setPosition(x, y);
      return;
    }
    const [dx, dy] = steps[i % steps.length];
    win.setPosition(x + dx, y + dy);
    i++;
  }, 28);
}

// ---------- Claude oturumları ----------

function codexEfforts(model) {
  const list = codexModels();
  const m = list.find((x) => x.id === model) || list[0];
  return m ? m.efforts : [];
}

function getSession(chat) {
  let s = sessions.get(chat.id);
  if (s) return s;
  const chatOnly = chat.provider === 'claude-chat' || chat.provider === 'codex-chat';
  if (chatOnly) fs.mkdirSync(chat.cwd, { recursive: true });
  const common = { env, cwd: chat.cwd, sessionId: chat.sessionId, model: chat.model, permissionMode: chat.permissionMode, chatMode: chatOnly, t };
  s = String(chat.provider).startsWith('codex')
    ? new CodexSession({ ...common, codexPath: env.codexPath, effort: codexEfforts(chat.model).includes(chat.effort) ? chat.effort : '' })
    : new ClaudeSession({ ...common, effort: MODELS.efforts(chat.model).includes(chat.effort) ? chat.effort : '' });
  s.on('event', (ev) => handleEvent(chat.id, ev));
  sessions.set(chat.id, s);
  return s;
}

function clearPending(id) {
  if (pending.get(id)?.size) sendToChat(id, 'permission-clear');
  pending.delete(id);
}

function resetSession(id) {
  clearPending(id);
  const s = sessions.get(id);
  if (s) {
    s.removeAllListeners();
    s.kill();
    sessions.delete(id);
  }
  busy.delete(id);
}

function addAndShow(id, msg) {
  const m = store.addMessage(id, msg);
  if (m) sendToChat(id, 'message', m);
}

function handleEvent(id, ev) {
  const chat = store.getChat(id);
  if (!chat) return;
  switch (ev.kind) {
    case 'delta':
      sendToChat(id, 'delta', ev.text);
      return;
    case 'session':
      store.updateChat(id, { sessionId: ev.sessionId });
      return;
    case 'rate':
      rateLimit = ev.info;
      pushState();
      return;
    case 'text':
      addAndShow(id, { from: 'claude', text: ev.text });
      break;
    case 'tool':
      addAndShow(id, { from: 'tool', text: ev.text });
      break;
    case 'permission': {
      if (!pending.has(id)) pending.set(id, new Map());
      pending.get(id).set(ev.request.id, ev.request);
      sendToChat(id, 'permission', ev.request);
      askForAttention(chat, ev.request);
      break;
    }
    case 'permission-cancel':
      pending.get(id)?.delete(ev.requestId);
      sendToChat(id, 'permission-done', ev.requestId);
      break;
    case 'error':
      busy.delete(id);
      addAndShow(id, { from: 'error', text: ev.text });
      sendToChat(id, 'busy', false);
      break;
    case 'done':
      busy.delete(id);
      if (ev.isError) addAndShow(id, { from: 'error', text: ev.errorText });
      clearPending(id);
      if (ev.denied && !userDenied.has(id)) {
        addAndShow(id, {
          from: 'system',
          text: t('sys.denied', { n: ev.denied }),
        });
      }
      sendToChat(id, 'busy', false);
      onReplyFinished(chat);
      break;
  }
  pushState();
}

function onReplyFinished(chat) {
  const win = chatWins.get(chat.id);
  if (alive(win) && win.isFocused()) return;
  unread.add(chat.id);
  updateBadge();
  if (alive(win)) win.flashFrame(true);
  if (store.profile().status === 'busy') return;
  playSound('message', chat.id);
  showToast(chat, lastSnippet(chat) || t('sys.replyReady'));
  if (isMac && app.dock) app.dock.bounce('informational');
}

// A permission request is urgent: always notify unless the chat window is in front.
function askForAttention(chat, req) {
  const win = chatWins.get(chat.id);
  if (alive(win) && win.isFocused()) return;
  if (alive(win)) win.flashFrame(true);
  if (isMac && app.dock) app.dock.bounce('critical');
  if (store.profile().status === 'busy') return;
  playSound('nudge', chat.id);
  showToast(chat, `🔐 ${t('ask.toast', { what: req.summary })}`);
}

function sendToClaude(id, content) {
  const chat = store.getChat(id);
  if (!chat || busy.has(id)) return false;
  busy.add(id);
  userDenied.delete(id);
  sendToChat(id, 'busy', true);
  if (!getSession(chat).send(content)) {
    busy.delete(id);
    sendToChat(id, 'busy', false);
  }
  pushState();
  return true;
}

// ---------- IPC ----------

ipcMain.handle('state', () => snapshot());

ipcMain.on('lang', (e) => {
  e.returnValue = currentLang();
});

ipcMain.handle('profile:update', (_e, patch) => {
  const langBefore = currentLang();
  store.updateProfile(patch);
  if ('theme' in patch) applyTheme();
  if (currentLang() !== langBefore) {
    for (const w of BrowserWindow.getAllWindows()) if (alive(w)) w.webContents.reload();
    return;
  }
  pushState();
  for (const w of chatWins.values()) if (alive(w)) w.webContents.send('profile', store.profile());
});

ipcMain.handle('folder:pick', async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: t('dlg.pickFolder'),
    buttonLabel: t('dlg.choose'),
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('chat:create', (_e, { cwd, name, avatar, provider }) => {
  const p = provider === 'codex' ? 'codex' : 'claude';
  const chat = store.createChat({ cwd, name: name || path.basename(cwd), avatar, provider: p });
  pushState();
  openChat(chat.id);
  return chat.id;
});

// "New chat": pick who to talk to (when more than one is installed), then a folder.
// provider: 'claude-chat' (no folder), 'claude' or 'codex' (asks for a folder). The renderer shows the menu.
ipcMain.handle('chat:new', async (e, provider) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const pickFolderAndCreate = async (provider) => {
    const r = await dialog.showOpenDialog(win, { title: t('dlg.pickFolder'), buttonLabel: t('dlg.choose'), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled) return;
    const cwd = r.filePaths[0];
    const chat = store.createChat({ cwd, name: path.basename(cwd), provider });
    pushState();
    openChat(chat.id);
  };
  // A plain Claude chat needs no folder: it gets a private, empty one inside the app's data folder.
  const createClaudeChat = (kind = 'claude-chat') => {
    const id = crypto.randomUUID();
    const name = t(kind === 'codex-chat' ? 'list.gptChatName' : 'list.claudeChatName');
    const chat = store.createChat({ cwd: path.join(claudeChatsDir(), id), name, provider: kind });
    pushState();
    openChat(chat.id);
  };
  if (provider === 'claude-chat' && env.claudePath) return createClaudeChat();
  if (provider === 'codex-chat' && env.codexPath) return createClaudeChat('codex-chat');
  if (provider === 'claude' && env.claudePath) return pickFolderAndCreate('claude');
  if (provider === 'codex' && env.codexPath) return pickFolderAndCreate('codex');
});

ipcMain.handle('codex:models', () => codexModels());

ipcMain.handle('chat:get', (_e, id) => ({
  codexModels: String(store.getChat(id)?.provider).startsWith('codex') ? codexModels() : [],
  chat: store.getChat(id),
  busy: busy.has(id),
  profile: store.profile(),
  pending: [...(pending.get(id)?.values() || [])],
}));

ipcMain.handle('perm:answer', (_e, id, requestId, decision) => {
  const req = pending.get(id)?.get(requestId);
  const s = sessions.get(id);
  if (!req || !s) return;
  pending.get(id).delete(requestId);
  s.respond(requestId, decision, req);
  if (decision === 'deny') userDenied.add(id);
  sendToChat(id, 'permission-done', requestId);
  const key = decision === 'deny' ? 'ask.denied' : decision === 'always' ? 'ask.alwaysAllowed' : 'ask.allowed';
  addAndShow(id, { from: 'system', text: t(key, { what: req.target || req.summary }) });
  pushState();
});

ipcMain.handle('chat:update', (_e, id, patch) => {
  const allowed = {};
  for (const k of ['name', 'avatar', 'pinned', 'model', 'effort', 'permissionMode']) if (k in patch) allowed[k] = patch[k];
  const restart = ['model', 'effort', 'permissionMode'].some((k) => k in allowed) && sessions.has(id);
  store.updateChat(id, allowed);
  if (restart) {
    const wasBusy = busy.has(id);
    resetSession(id);
    if (wasBusy) {
      addAndShow(id, { from: 'system', text: t('sys.settingStopped') });
      sendToChat(id, 'busy', false);
    }
  }
  sendToChat(id, 'chat-updated', store.getChat(id));
  pushState();
});

ipcMain.handle('chat:delete', async (e, id) => {
  const chat = store.getChat(id);
  if (!chat) return;
  const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(e.sender), {
    type: 'question',
    buttons: [t('dlg.delete'), t('dlg.cancel')],
    defaultId: 1,
    cancelId: 1,
    message: t('dlg.deleteMsg', { name: chat.name }),
    detail: t('dlg.deleteDetail'),
  });
  if (response !== 0) return;
  resetSession(id);
  const w = chatWins.get(id);
  if (alive(w)) w.close();
  unread.delete(id);
  updateBadge();
  store.deleteChat(id);
  pushState();
});

ipcMain.handle('chat:open', (_e, id) => openChat(id));

// ---------- Terminalde başlatılmış konuşmaları içe aktarma ----------

ipcMain.handle('history:open', (e) => openImportWindow(BrowserWindow.fromWebContents(e.sender)));
ipcMain.handle('settings:open', () => openSettingsWindow());

ipcMain.handle('history:list', () => {
  const known = new Set(store.chats().map((c) => c.sessionId).filter(Boolean));
  return history.listSessions(known).filter((s) => !s.cwd.startsWith(claudeChatsDir())).map((s) => ({
    ...s,
    file: undefined,
    cwdLabel: homeLabel(s.cwd),
    cwdExists: fs.existsSync(s.cwd),
  }));
});

ipcMain.handle('history:import', (_e, sessionId) => {
  const existing = store.chats().find((c) => c.sessionId === sessionId);
  if (existing) {
    openChat(existing.id);
  } else {
    const s = history.listSessions().find((x) => x.sessionId === sessionId);
    if (!s) return false;
    const tr = (b) => describeTool(b, t);
    const messages = history.loadTranscript(s.file, tr).slice(-499);
    messages.push({ from: 'system', text: t('sys.imported'), ts: Date.now() });
    const chat = store.createChat({ cwd: s.cwd, name: s.title || path.basename(s.cwd) });
    store.updateChat(chat.id, { sessionId, messages, updatedAt: Date.now() });
    pushState();
    openChat(chat.id);
  }
  if (alive(importWin)) importWin.close();
  return true;
});

// Only known keys with simple values are kept from the sender's font style.
function cleanStyle(s) {
  if (!s || typeof s !== 'object') return undefined;
  const out = {};
  if (typeof s.family === 'string' && s.family.length < 40) out.family = s.family;
  if (typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color)) out.color = s.color;
  for (const k of ['bold', 'italic', 'underline', 'strike']) if (s[k] === true) out[k] = true;
  return Object.keys(out).length ? out : undefined;
}

ipcMain.handle('chat:send', (_e, id, text, style, filePaths) => {
  if (busy.has(id)) return false;
  const files = (Array.isArray(filePaths) ? filePaths : [])
    .filter((p) => typeof p === 'string' && path.isAbsolute(p))
    .slice(0, MAX_FILES)
    .map(describeFile)
    .filter(Boolean);
  if (!text && !files.length) return false;
  addAndShow(id, { from: 'me', text, style: cleanStyle(style), files: files.length ? files.map(({ mime, ...f }) => f) : undefined });
  return sendToClaude(id, buildContent(text, files, store.getChat(id)?.provider));
});

ipcMain.handle('file:pick', async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: t('file.pick'),
    buttonLabel: t('file.send'),
    properties: ['openFile', 'multiSelections'],
  });
  return r.canceled ? [] : r.filePaths.map(describeFile).filter(Boolean);
});

ipcMain.handle('file:describe', (_e, paths) => (Array.isArray(paths) ? paths : []).map(describeFile).filter(Boolean));

// A pasted image (e.g. a screenshot) has no file yet: save it so it can be sent and shown later.
ipcMain.handle('file:save-pasted', (_e, name, bytes) => {
  if (!(bytes instanceof Uint8Array) || bytes.length > 25 * 1024 * 1024) return null;
  const ext = path.extname(String(name || '')).toLowerCase();
  const safeExt = IMAGE_TYPES[ext] ? ext : '.png';
  fs.mkdirSync(attachmentsDir(), { recursive: true });
  const d = new Date();
  const two = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}.${two(d.getMinutes())}.${two(d.getSeconds())}`;
  const p = path.join(attachmentsDir(), `Screenshot ${stamp} ${crypto.randomUUID().slice(0, 4)}${safeExt}`);
  fs.writeFileSync(p, bytes);
  return describeFile(p);
});

ipcMain.handle('url:open', (_e, u) => {
  if (typeof u === 'string' && /^https?:\/\//.test(u)) shell.openExternal(u);
});

ipcMain.handle('file:open', (_e, p) => {
  if (typeof p === 'string' && path.isAbsolute(p) && fs.existsSync(p)) shell.openPath(p);
});

ipcMain.handle('chat:stop', (_e, id) => {
  if (!busy.has(id)) return;
  resetSession(id);
  addAndShow(id, { from: 'system', text: t('sys.stopped') });
  sendToChat(id, 'busy', false);
  pushState();
});

ipcMain.handle('chat:nudge', (e, id) => {
  shake(BrowserWindow.fromWebContents(e.sender));
  sendToChat(id, 'shake');
  playSound('nudge', id);
  addAndShow(id, { from: 'system', text: t('sys.nudged') });
  sendToClaude(id, t('nudgePrompt'));
});

ipcMain.handle('chat:reveal', (_e, id) => {
  const chat = store.getChat(id);
  if (chat) shell.openPath(chat.cwd);
});

ipcMain.handle('chat:new-session', (_e, id) => {
  resetSession(id);
  store.updateChat(id, { sessionId: null });
  addAndShow(id, { from: 'system', text: t('sys.newSession') });
  sendToChat(id, 'busy', false);
  pushState();
});

ipcMain.on('chat:context-menu', (e, id) => {
  const chat = store.getChat(id);
  if (!chat) return;
  const sender = e.sender;
  Menu.buildFromTemplate([
    { label: t('menu.open'), click: () => openChat(id) },
    { label: t('menu.rename'), click: () => sender.send('rename', id) },
    { label: chat.pinned ? t('menu.unpin') : t('menu.pin'), click: () => { store.updateChat(id, { pinned: !chat.pinned }); pushState(); } },
    { label: t('menu.reveal'), click: () => shell.openPath(chat.cwd) },
    { type: 'separator' },
    { label: t('menu.delete'), click: () => sender.send('delete', id) },
  ]).popup({ window: BrowserWindow.fromWebContents(sender) });
});

ipcMain.on('win', (e, action) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!alive(w)) return;
  if (action === 'min') w.minimize();
  else if (action === 'max') (w.isMaximized() ? w.unmaximize() : w.maximize());
  else if (action === 'close') w.close();
});

ipcMain.on('toast:click', (_e, id) => {
  openChat(id);
  if (alive(toastWin)) toastWin.close();
});

// ---------- Uygulama ----------

app.setName('Retro Messenger');
// Windows groups taskbar buttons and notifications by this id; it matches build.appId.
if (process.platform === 'win32') app.setAppUserModelId('com.wynfirdolf.retromessenger');

app.whenReady().then(() => {
  store.load(app.getPath('userData'));
  applyTheme();
  env = resolveEnvironment();
  env.codexPath = findCodex(env.env);
  createListWindow();
  app.on('activate', () => {
    if (!alive(listWin)) createListWindow();
    else listWin.show();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('before-quit', () => {
  for (const s of sessions.values()) s.kill();
  store.flush();
});
