/* global rm, t, LOCALE, MODELS, sizeStr, fileIcon, fileUrl, FONTS, FONT_COLORS, msgStyle, hasColor, closePopovers, $, esc, fmt, timeStr, avatarHtml, AVATARS, EMOTICONS, applyShortcuts, openGrid, initTitlebar, setTitle, applyI18n */

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
    const st = m.from === 'me' ? m.style : null;
    el.className = `msg ${m.from}`;
    el.innerHTML = `<div class="who">${esc(t('says', { name }))} <span class="t">(${timeStr(m.ts)})</span></div>`
      + (m.text ? `<div class="text${hasColor(st) ? ' mc' : ''}" style="${msgStyle(st)}">${fmt(m.text)}</div>` : '')
      + filesHtml(m.files);
  } else {
    const icon = { tool: '⚙️', error: '⚠️', system: '•' }[m.from] || '•';
    el.className = `line ${m.from}`;
    el.innerHTML = `<span class="bullet">${icon}</span><span>${esc(m.text)}</span>`;
  }
  // A deleted image falls back to a grey chip instead of a broken picture.
  el.querySelectorAll('img.thumb').forEach((img) => img.addEventListener('error', () => {
    const chip = document.createElement('span');
    chip.className = 'fchip missing';
    chip.textContent = '🖼️ ' + img.alt;
    img.replaceWith(chip);
  }));
  frag.appendChild(el);
  return frag;
}

function renderAll() {
  lastDay = '';
  const readOnly = ['default', 'manual', 'plan'].includes(chat.permissionMode);
  const welcome = esc(t(readOnly ? 'chat.welcomeRead' : 'chat.welcomeEdit', { cwd: '\u0000' })).replace('\u0000', `<b>${esc(chat.cwd)}</b>`);
  history.innerHTML = `<div class="welcome">${welcome}</div>`;
  for (const m of chat.messages) history.appendChild(renderMessage(m));
  scrollDown(true);
}

function renderChrome() {
  setTitle(t('chat.title', { name: chat.name }));
  $('#to-name').textContent = chat.name;
  $('#to-cwd').textContent = chat.cwd;
  renderModelPickers();
  $('#perm').value = chat.permissionMode === 'default' ? 'manual' : chat.permissionMode || 'acceptEdits';
  $('#dp-claude').innerHTML = avatarHtml(chat.avatar, 'xl', busy ? 'busy-ring' : '');
  $('#lbl-claude').textContent = chat.name;
  $('#dp-me').innerHTML = avatarHtml(profile.avatar, 'xl');
  $('#lbl-me').textContent = profile.name;
}

function renderStatus() {
  const s = $('#status');
  if (permissions.size) {
    s.innerHTML = `<span class="waiting blink">${esc(t('ask.waiting', { name: chat.name }))}</span>`;
  } else if (busy) {
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
  if ((!raw && !attachments.length) || busy) return;
  const files = attachments.map((f) => f.path);
  input.value = '';
  attachments = [];
  renderTray();
  await rm.send(id, raw ? applyShortcuts(raw) : '', profile.font || null, files);
}

// ---------- Dosya ekleri ----------

let attachments = []; // gönderilmeyi bekleyen dosyalar

function filesHtml(files) {
  if (!files?.length) return '';
  return `<div class="files">${files.map((f) => (f.kind === 'image'
    ? `<img class="thumb" src="${esc(fileUrl(f.path))}" alt="${esc(f.name)}" title="${esc(f.name)}" data-open="${esc(f.path)}">`
    : `<button class="fchip" data-open="${esc(f.path)}" title="${esc(f.path)}"><span class="fi">${fileIcon(f)}</span><span class="fn">${esc(f.name)}</span><span class="fs">${esc(sizeStr(f.kind === 'folder' ? null : f.size))}</span></button>`)).join('')}</div>`;
}

function renderTray() {
  const tray = $('#tray');
  tray.classList.toggle('has', attachments.length > 0);
  tray.innerHTML = attachments.map((f, i) => `<span class="fchip" title="${esc(f.path)}">
      ${f.kind === 'image' ? `<img src="${esc(fileUrl(f.path))}" alt="">` : `<span class="fi">${fileIcon(f)}</span>`}
      <span class="fn">${esc(f.name)}</span><span class="fs">${esc(sizeStr(f.kind === 'folder' ? null : f.size))}</span>
      <button class="rm" data-i="${i}" title="${esc(t('file.remove'))}">×</button></span>`).join('');
}

function addAttachments(list) {
  for (const f of list) {
    if (!f || attachments.some((a) => a.path === f.path)) continue;
    if (attachments.length >= 10) break;
    attachments.push(f);
  }
  renderTray();
  input.focus();
}

$('#tray').addEventListener('click', (e) => {
  const b = e.target.closest('.rm');
  if (!b) return;
  attachments.splice(Number(b.dataset.i), 1);
  renderTray();
});
$('#btn-file').onclick = async () => addAttachments(await rm.pickFiles());
history.addEventListener('click', (e) => {
  const el = e.target.closest('[data-open]');
  if (el) rm.openFile(el.dataset.open);
});

// Sürükle-bırak
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  $('#drop-text').textContent = t('file.drop', { name: chat.name });
  document.body.classList.add('dragging');
});
document.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); }
});
document.addEventListener('drop', async (e) => {
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const paths = [...(e.dataTransfer?.files || [])].map((f) => rm.pathForFile(f)).filter(Boolean);
  if (paths.length) addAttachments(await rm.describeFiles(paths));
});

// Yapıştırma: Finder'dan kopyalanan dosyalar ya da panodaki bir ekran görüntüsü
input.addEventListener('paste', async (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  const out = [];
  for (const f of files) {
    const p = rm.pathForFile(f);
    if (p) out.push(...(await rm.describeFiles([p])));
    else if (f.type.startsWith('image/')) out.push(await rm.savePasted(f.name || 'image.png', new Uint8Array(await f.arrayBuffer())));
  }
  addAttachments(out.filter(Boolean));
});

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
// ---------- İzin istekleri ----------

const permissions = new Map(); // istek id -> kart elemanı

function permDetail(req) {
  const i = req.input || {};
  const clip = (s, n = 1500) => (String(s).length > n ? String(s).slice(0, n) + '\n…' : String(s));
  switch (req.tool) {
    case 'Bash': return `<pre class="code">${esc(clip(i.command))}</pre>`;
    case 'Edit': {
      const diff = String(i.old_string || '').split('\n').map((l) => '- ' + l)
        .concat(String(i.new_string || '').split('\n').map((l) => '+ ' + l)).join('\n');
      return `<pre class="code">${esc(i.file_path || '')}\n\n${esc(clip(diff))}</pre>`;
    }
    case 'MultiEdit': return `<pre class="code">${esc(i.file_path || '')} (${(i.edits || []).length} edits)</pre>`;
    case 'Write': return `<pre class="code">${esc(i.file_path || '')}\n\n${esc(clip(i.content || '', 800))}</pre>`;
    case 'ExitPlanMode': return `<div class="plan">${fmt(i.plan || '')}</div>`;
    case 'WebFetch': return `<pre class="code">${esc(i.url || '')}</pre>`;
    default: return `<pre class="code">${esc(clip(JSON.stringify(i, null, 2), 800))}</pre>`;
  }
}

// What "always allow" would add, e.g. "Bash(npm test *)" or a folder, shown as the button's tooltip.
function ruleText(suggestions) {
  const out = [];
  for (const sug of suggestions) {
    for (const r of sug.rules || []) out.push(r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName);
    for (const d of sug.directories || []) out.push(d);
    if (sug.mode) out.push(sug.mode);
  }
  return out.join('\n');
}

function addPermission(req) {
  if (permissions.has(req.id)) return;
  const isPlan = req.tool === 'ExitPlanMode';
  const card = document.createElement('div');
  card.className = 'perm';
  card.innerHTML = `
    <div class="head">🔐 ${esc(t(isPlan ? 'ask.planTitle' : 'ask.title', { name: chat.name }))}</div>
    <div class="what">${esc(isPlan ? t('ask.plan') : req.summary)}</div>
    ${req.description && !isPlan ? `<div class="desc">${esc(req.description)}</div>` : ''}
    ${permDetail(req)}
    <div class="btns">
      <button class="xp-btn allow" data-d="allow">${esc(t(isPlan ? 'ask.approve' : 'ask.allow'))}</button>
      ${!isPlan && req.suggestions?.length ? `<button class="xp-btn" data-d="always" title="${esc(ruleText(req.suggestions))}">${esc(t('ask.always'))}</button>` : ''}
      <button class="xp-btn" data-d="deny">${esc(t('ask.deny'))}</button>
    </div>`;
  card.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-d]');
    if (!b) return;
    card.querySelectorAll('button').forEach((x) => (x.disabled = true));
    rm.answerPermission(id, req.id, b.dataset.d);
  });
  permissions.set(req.id, card);
  if (live) history.insertBefore(card, live.nextSibling); else history.appendChild(card);
  scrollDown(true);
  renderStatus();
  card.querySelector('.allow').focus();
}

function removePermission(requestId) {
  permissions.get(requestId)?.remove();
  permissions.delete(requestId);
  renderStatus();
}

rm.on('permission', addPermission);
rm.on('permission-done', removePermission);
rm.on('permission-clear', () => [...permissions.keys()].forEach(removePermission));

// ---------- Yazı tipi ve renk (MSN'deki "Yazı tipini değiştir") ----------

const myFont = () => ({ family: '', color: '', bold: false, italic: false, underline: false, strike: false, ...(profile.font || {}) });

function applyInputFont() {
  const s = profile.font;
  input.setAttribute('style', msgStyle(s));
  input.classList.toggle('mc', hasColor(s));
}

function saveFont(patch) {
  profile.font = { ...myFont(), ...patch };
  applyInputFont();
  renderFontPanel();
  rm.updateProfile({ font: profile.font });
}

function renderFontPanel() {
  const pop = $('.fontpop');
  if (!pop) return;
  const f = myFont();
  const groups = { classic: t('font.classic'), google: 'Google Fonts' };
  let list = '';
  let lastGroup = '';
  for (const [family, , group] of FONTS) {
    if (group !== lastGroup) {
      list += `<div class="grp">${esc(groups[group])}</div>`;
      lastGroup = group;
    }
    const label = family || t('font.default');
    const css = family ? `font-family:'${family}', var(--chat-font)` : '';
    list += `<button data-family="${esc(family)}" class="${f.family === family ? 'on' : ''}" style="${css}">${esc(label)}</button>`;
  }
  const tog = (k, label, css) => `<button class="xp-btn tog ${f[k] ? 'on' : ''}" data-tog="${k}" title="${esc(t(`font.${k}`))}" style="${css}">${label}</button>`;
  const swatches = [`<button class="sw auto ${f.color ? '' : 'on'}" data-color="" title="${esc(t('font.auto'))}"></button>`]
    .concat(FONT_COLORS.map((c) => `<button class="sw ${f.color === c ? 'on' : ''}" data-color="${c}" style="background:${c}"></button>`))
    .join('');
  pop.innerHTML = `
    <h4>${esc(t('chat.font'))}</h4>
    <div class="fonts">${list}</div>
    <div class="row">${tog('bold', 'B', 'font-weight:bold')}${tog('italic', 'I', 'font-style:italic')}${tog('underline', 'U', 'text-decoration:underline')}${tog('strike', 'S', 'text-decoration:line-through')}</div>
    <h4>${esc(t('font.color'))}</h4>
    <div class="row">${swatches}<input type="color" title="${esc(t('font.custom'))}" value="${f.color || '#1f5fbf'}"></div>
    <div class="preview"><span class="${hasColor(f) ? 'mc' : ''}" style="${msgStyle(f)}">${esc(t('font.preview'))}</span></div>`;
  const on = pop.querySelector('.fonts .on');
  if (on && !pop.dataset.scrolled) { on.scrollIntoView({ block: 'center' }); pop.dataset.scrolled = '1'; }
}

function openFontPanel(anchor) {
  if ($('.fontpop')) return closePopovers();
  closePopovers();
  const pop = document.createElement('div');
  pop.className = 'popover fontpop';
  document.body.appendChild(pop);
  renderFontPanel();
  const r = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  pop.style.top = `${Math.max(6, r.top - pr.height - 4)}px`;
  pop.style.left = `${Math.max(6, Math.min(r.left, innerWidth - pr.width - 6))}px`;
  pop.addEventListener('click', (e) => {
    e.stopPropagation();
    const b = e.target.closest('button');
    if (!b) return;
    if ('family' in b.dataset) saveFont({ family: b.dataset.family });
    else if (b.dataset.tog) saveFont({ [b.dataset.tog]: !myFont()[b.dataset.tog] });
    else if ('color' in b.dataset) saveFont({ color: b.dataset.color });
  });
  pop.addEventListener('change', (e) => {
    if (e.target.type === 'color') saveFont({ color: e.target.value });
  });
  const away = (e) => {
    if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) {
      pop.remove();
      document.removeEventListener('mousedown', away);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', away));
}

$('#btn-font').onclick = (e) => {
  e.stopPropagation();
  openFontPanel(e.currentTarget);
};

// ---------- Model, sürüm ve efor ----------

function renderModelPickers() {
  const { family, version } = MODELS.parse(chat.model);
  $('#family').innerHTML =
    `<option value="">${esc(t('chat.modelDefault'))}</option>` +
    MODELS.FAMILIES.map((f) => `<option value="${f.key}">${f.name}</option>`).join('');
  $('#family').value = family;

  const fam = MODELS.FAMILIES.find((f) => f.key === family);
  $('#version').style.display = fam ? '' : 'none';
  $('#version').innerHTML = fam
    ? `<option value="">${esc(t('chat.latest'))}</option>` +
      fam.versions.map((v) => `<option value="${v.id}">${fam.name} ${v.label}</option>`).join('')
    : '';
  $('#version').value = version;

  const allowed = MODELS.efforts(chat.model);
  const effortSel = $('#effort');
  effortSel.disabled = allowed.length === 0;
  effortSel.title = allowed.length ? '' : t('chat.effortNone');
  effortSel.innerHTML =
    `<option value="">${esc(t('effort.default'))}</option>` +
    allowed.map((e) => `<option value="${e}">${esc(t(`effort.${e}`))}</option>`).join('');
  effortSel.value = allowed.includes(chat.effort) ? chat.effort : '';
}

$('#family').onchange = (e) => rm.updateChat(id, { model: e.target.value });
$('#version').onchange = (e) => rm.updateChat(id, { model: e.target.value || $('#family').value });
$('#effort').onchange = (e) => rm.updateChat(id, { effort: e.target.value });
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
  const cards = [...permissions.values()];
  renderAll();
  cards.forEach((card) => history.appendChild(card));
  renderStatus();
});

rm.on('profile', (p) => {
  profile = p;
  renderChrome();
  const cards = [...permissions.values()];
  renderAll();
  cards.forEach((card) => history.appendChild(card));
  applyInputFont();
  renderFontPanel();
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
  applyInputFont();
  input.focus();
  (res.pending || []).forEach(addPermission);
})();
