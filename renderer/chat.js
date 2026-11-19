/* global rm, t, LOCALE, $, esc, fmt, timeStr, avatarHtml, AVATARS, EMOTICONS, applyShortcuts, openGrid, initTitlebar, setTitle, applyI18n */

const id = new URLSearchParams(location.search).get('id');
let chat = null;
let profile = null;
let busy = false;
let live = null; // akmakta olan Claude iletisi
let liveText = '';
let lastDay = '';

const history = $('#history');
const input = $('#input');

const nearBottom = () => history.scrollHeight - history.scrollTop - history.clientHeight < 80;
function scrollDown(force) {
  if (force || nearBottom()) history.scrollTop = history.scrollHeight;
}

function dayLabel(ts) {
  return new Date(ts).toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
}

function renderMessage(m) {
  const frag = document.createDocumentFragment();
  const day = dayLabel(m.ts);
  if (day !== lastDay) {
    lastDay = day;
    const d = document.createElement('div');
    d.className = 'day';
    d.textContent = `— ${day} —`;
    frag.appendChild(d);
  }
  const el = document.createElement('div');
  if (m.from === 'me' || m.from === 'claude') {
    const name = m.from === 'me' ? profile.name : chat.name;
    el.className = `msg ${m.from}`;
    el.innerHTML = `<div class="who">${esc(t('says', { name }))} <span class="t">(${timeStr(m.ts)})</span></div><div class="text">${fmt(m.text)}</div>`;
  } else {
    const icon = { tool: '⚙️', error: '⚠️', system: '•' }[m.from] || '•';
    el.className = `line ${m.from}`;
    el.innerHTML = `<span class="bullet">${icon}</span><span>${esc(m.text)}</span>`;
  }
  frag.appendChild(el);
  return frag;
}

function renderAll() {
  lastDay = '';
  const readOnly = chat.permissionMode === 'default' || chat.permissionMode === 'plan';
  const welcome = esc(t(readOnly ? 'chat.welcomeRead' : 'chat.welcomeEdit', { cwd: '\u0000' })).replace('\u0000', `<b>${esc(chat.cwd)}</b>`);
  history.innerHTML = `<div class="welcome">${welcome}</div>`;
  for (const m of chat.messages) history.appendChild(renderMessage(m));
  scrollDown(true);
}

function renderChrome() {
  setTitle(t('chat.title', { name: chat.name }));
  $('#to-name').textContent = chat.name;
  $('#to-cwd').textContent = chat.cwd;
  $('#model').value = chat.model || '';
  $('#perm').value = chat.permissionMode || 'acceptEdits';
  $('#dp-claude').innerHTML = avatarHtml(chat.avatar, 'xl', busy ? 'busy-ring' : '');
  $('#lbl-claude').textContent = chat.name;
  $('#dp-me').innerHTML = avatarHtml(profile.avatar, 'xl');
  $('#lbl-me').textContent = profile.name;
}

function renderStatus() {
  const s = $('#status');
  if (busy) {
    s.innerHTML = `<span class="typing pulse">${esc(t('chat.typing', { name: chat.name }))}</span>`;
  } else {
    const last = [...chat.messages].reverse().find((m) => m.from === 'claude');
    s.textContent = last
      ? t('chat.lastReceived', { date: new Date(last.ts).toLocaleString(LOCALE, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) })
      : t('chat.startHint');
  }
  $('#send').disabled = busy;
  $('#stop').disabled = !busy;
  $('#dp-claude .dp')?.classList.toggle('busy-ring', busy);
}

function setBusy(b) {
  busy = b;
  if (!b && live) {
    live.remove();
    live = null;
    liveText = '';
  }
  renderStatus();
}

async function send() {
  const raw = input.value.trim();
  if (!raw || busy) return;
  input.value = '';
  await rm.send(id, applyShortcuts(raw));
}

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
});
$('#send').onclick = send;
$('#stop').onclick = () => rm.stop(id);
$('#btn-nudge').onclick = () => rm.nudge(id);
$('#btn-folder').onclick = () => rm.reveal(id);
$('#btn-new').onclick = () => rm.newSession(id);
$('#model').onchange = (e) => rm.updateChat(id, { model: e.target.value });
$('#perm').onchange = (e) => rm.updateChat(id, { permissionMode: e.target.value });
$('#btn-emo').onclick = (e) => {
  e.stopPropagation();
  openGrid(e.currentTarget, EMOTICONS, t('emoticons'), (emo) => {
    const { selectionStart: a, selectionEnd: b, value } = input;
    input.value = value.slice(0, a) + emo + value.slice(b);
    input.focus();
    input.selectionStart = input.selectionEnd = a + emo.length;
  });
};
$('#dp-claude').onclick = (e) => {
  e.stopPropagation();
  openGrid(e.currentTarget, AVATARS.map((a) => a[0]), t('chatAvatar'), (a) => rm.updateChat(id, { avatar: a }), 4);
};

// ---------- Ana süreçten gelen olaylar ----------

rm.on('message', (m) => {
  chat.messages.push(m);
  if (m.from === 'claude' && live) {
    live.remove();
    live = null;
    liveText = '';
  }
  const stick = nearBottom() || m.from === 'me';
  history.appendChild(renderMessage(m));
  scrollDown(stick);
  if (m.from === 'claude' || m.from === 'me') renderStatus();
});

rm.on('delta', (text) => {
  const stick = nearBottom();
  if (!live) {
    live = document.createElement('div');
    live.className = 'msg claude live';
    live.innerHTML = `<div class="who">${esc(t('says', { name: chat.name }))}</div><div class="text"></div>`;
    history.appendChild(live);
  }
  liveText += text;
  live.querySelector('.text').innerHTML = fmt(liveText);
  scrollDown(stick);
});

rm.on('busy', setBusy);

rm.on('chat-updated', (c) => {
  chat = c;
  renderChrome();
  renderAll();
  renderStatus();
});

rm.on('profile', (p) => {
  profile = p;
  renderChrome();
  renderAll();
});

rm.on('shake', () => {
  document.body.classList.remove('shake');
  void document.body.offsetWidth;
  document.body.classList.add('shake');
});

(async () => {
  applyI18n();
  initTitlebar();
  const res = await rm.getChat(id);
  chat = res.chat;
  profile = res.profile;
  busy = res.busy;
  if (!chat) return window.close();
  renderChrome();
  renderAll();
  renderStatus();
  input.focus();
})();
