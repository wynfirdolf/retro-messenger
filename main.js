const { app, BrowserWindow, ipcMain, dialog, Menu, shell, screen, nativeTheme } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const store = require('./src/store');
const { ClaudeSession, resolveEnvironment, describeTool } = require('./src/claude-session');
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
let rateLimit = null;
const chatWins = new Map(); // sohbet id -> pencere
const sessions = new Map(); // sohbet id -> ClaudeSession
const busy = new Set();
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
    if (m.from === 'claude' || m.from === 'me') return m.text.replace(/[`*#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  return '';
}

function snapshot() {
  return {
    profile: store.profile(),
    claudePath: env.claudePath && env.claudePath.replace(os.homedir(), '~'),
    rateLimit,
    chats: store.chats().map((c) => ({
      id: c.id,
      name: c.name,
      cwd: c.cwd,
      avatar: c.avatar,
      pinned: c.pinned,
      updatedAt: c.updatedAt,
      busy: busy.has(c.id),
      unread: unread.has(c.id),
      last: lastSnippet(c),
    })),
  };
}

function pushState() {
  if (alive(listWin)) listWin.webContents.send('state', snapshot());
}

function sendToChat(id, channel, payload) {
  const w = chatWins.get(id);
  if (alive(w)) w.webContents.send(channel, payload);
}

function updateBadge() {
  if (isMac && app.dock) app.dock.setBadge(unread.size ? String(unread.size) : '');
  else app.setBadgeCount(unread.size);
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

function openImportWindow(parent) {
  if (alive(importWin)) return importWin.focus();
  importWin = makeWindow({ width: 620, height: 560, minWidth: 460, minHeight: 360, parent: alive(parent) ? parent : undefined });
  importWin.loadFile(page('import.html'));
  importWin.on('closed', () => { importWin = null; });
}

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

function getSession(chat) {
  let s = sessions.get(chat.id);
  if (s) return s;
  s = new ClaudeSession({
    env,
    cwd: chat.cwd,
    sessionId: chat.sessionId,
    model: chat.model,
    effort: MODELS.efforts(chat.model).includes(chat.effort) ? chat.effort : '',
    permissionMode: chat.permissionMode,
    t,
  });
  s.on('event', (ev) => handleEvent(chat.id, ev));
  sessions.set(chat.id, s);
  return s;
}

function resetSession(id) {
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
    case 'error':
      busy.delete(id);
      addAndShow(id, { from: 'error', text: ev.text });
      sendToChat(id, 'busy', false);
      break;
    case 'done':
      busy.delete(id);
      if (ev.isError) addAndShow(id, { from: 'error', text: ev.errorText });
      if (ev.denied) {
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

function sendToClaude(id, text) {
  const chat = store.getChat(id);
  if (!chat || busy.has(id)) return false;
  busy.add(id);
  sendToChat(id, 'busy', true);
  if (!getSession(chat).send(text)) {
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

ipcMain.handle('chat:create', (_e, { cwd, name, avatar }) => {
  const chat = store.createChat({ cwd, name: name || path.basename(cwd), avatar });
  pushState();
  openChat(chat.id);
  return chat.id;
});

ipcMain.handle('chat:get', (_e, id) => ({
  chat: store.getChat(id),
  busy: busy.has(id),
  profile: store.profile(),
}));

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

ipcMain.handle('history:list', () => {
  const known = new Set(store.chats().map((c) => c.sessionId).filter(Boolean));
  return history.listSessions(known).map((s) => ({
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

ipcMain.handle('chat:send', (_e, id, text) => {
  if (busy.has(id)) return false;
  addAndShow(id, { from: 'me', text });
  return sendToClaude(id, text);
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

app.whenReady().then(() => {
  store.load(app.getPath('userData'));
  applyTheme();
  env = resolveEnvironment();
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
