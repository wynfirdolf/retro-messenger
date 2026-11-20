/* global rm, t, I18N, LOCALE, $, $$, esc, LOGO_SVG, STATUS, buddySvg, AVATARS, avatarHtml, openGrid, Sounds, initTitlebar, applyShortcuts, applyI18n */

let state = null;
let selected = null;
let renaming = null;
const closedGroups = new Set();

const TIPS = t('list.tips');
let tipIndex = Math.floor(Math.random() * TIPS.length);

function showTip() {
  $('#tip').innerHTML = `<span style="font-size:22px">💡</span><span><b>${t('list.tipLabel')}</b> ${TIPS[tipIndex % TIPS.length]}</span>`;
  tipIndex++;
}

// ---------- Oturum açma ----------

let draftAvatar = '🦊';

function renderSignin() {
  document.body.querySelector('#signin').style.display = 'flex';
  $('#main').style.display = 'none';
  $('#si-logo').innerHTML = LOGO_SVG(40);
  draftAvatar = state.profile.avatar || '🦊';
  $('#si-avatar').innerHTML = avatarHtml(draftAvatar, 'xl');
  $('#si-name').value = state.profile.name || '';
  $('#si-status').value = state.profile.status || 'online';
  const note = $('#si-note');
  if (state.claudePath) {
    note.className = 'si-note';
    note.textContent = t('signin.claudeFound', { path: state.claudePath });
  } else {
    note.className = 'si-note bad';
    note.textContent = t('signin.claudeMissing');
  }
  setTimeout(() => $('#si-name').focus(), 50);
}

function pickAvatar(anchor, onPick) {
  openGrid(anchor, AVATARS.map((a) => a[0]), t('pickAvatar'), onPick, 4);
}

$('#si-avatar').onclick = $('#si-avatar-btn').onclick = (e) => {
  e.stopPropagation();
  pickAvatar(e.currentTarget, (a) => {
    draftAvatar = a;
    $('#si-avatar').innerHTML = avatarHtml(a, 'xl');
  });
};

async function signIn() {
  const name = $('#si-name').value.trim() || t('signin.defaultName');
  $('#si-go').disabled = true;
  $('#si-progress').style.display = 'flex';
  await new Promise((r) => setTimeout(r, 1300));
  await rm.updateProfile({ name, status: $('#si-status').value, avatar: draftAvatar, signedIn: true });
  Sounds.online();
  $('#si-go').disabled = false;
  $('#si-progress').style.display = 'none';
  state = await rm.getState();
  render();
}
$('#si-go').onclick = signIn;
$('#si-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') signIn(); });

// ---------- Ana liste ----------

function renderHeader() {
  const p = state.profile;
  $('#me-avatar').innerHTML = avatarHtml(p.avatar, 'l');
  $('#me-name').textContent = p.name;
  $('#me-status').value = p.status;
  if (document.activeElement !== $('#me-personal')) $('#me-personal').value = p.personal || '';
}

function renderUsage() {
  const rl = state.rateLimit;
  const box = $('#usage');
  if (!rl || typeof rl.unifiedWindows !== 'object' && typeof rl.utilization !== 'number') {
    box.style.display = 'none';
    return;
  }
  const win = rl.unifiedWindows?.five_hour || rl;
  const util = typeof win.utilization === 'number' ? win.utilization : null;
  if (util === null) { box.style.display = 'none'; return; }
  const pct = Math.round(util * 100);
  box.style.display = 'flex';
  $('#usage-fill').style.width = `${Math.min(100, pct)}%`;
  $('#usage-pct').textContent = `${pct}%`;
  const reset = win.resetsAt || rl.resetsAt;
  box.title = reset ? `${t('list.usageTitle')} · ${t('list.resets', { time: new Date(reset * 1000).toLocaleString(LOCALE) })}` : t('list.usageTitle');
}

function contactIcon(c) {
  if (c.waiting) return buddySvg('#e0412f', 'blink');
  if (c.busy) return buddySvg('#f0b000', 'pulse');
  if (c.unread) return buddySvg('#ff7a1a', 'blink');
  return buddySvg('#43b83a');
}

function contactHtml(c) {
  const cls = ['contact', c.unread ? 'unread' : '', selected === c.id ? 'sel' : ''].join(' ');
  if (renaming === c.id) {
    return `<div class="${cls}" data-id="${c.id}">${contactIcon(c)}<input type="text" class="rename" value="${esc(c.name)}" maxlength="60"></div>`;
  }
  const sub = c.waiting ? t('list.waiting') : c.busy ? t('list.typing') : c.last ? `- ${c.last}` : c.provider === 'claude-chat' || c.provider === 'codex-chat' ? '' : `- ${c.cwd}`;
  const badge = String(c.provider).startsWith('codex') ? `<span class="prov codex">${esc(t('prov.codex'))}</span>` : '';
  return `<div class="${cls}" data-id="${c.id}" title="${c.provider === 'claude-chat' || c.provider === 'codex-chat' ? '' : esc(c.cwd)}">${contactIcon(c)}<span class="cn">${esc(c.name)}</span>${badge}<span class="cm">${esc(sub)}</span></div>`;
}

function renderGroups() {
  const q = $('#search').value.trim().toLocaleLowerCase(LOCALE);
  const chats = state.chats
    .filter((c) => !q || c.name.toLocaleLowerCase(LOCALE).includes(q) || c.cwd.toLocaleLowerCase(LOCALE).includes(q))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const box = $('#groups');

  if (!state.chats.length) {
    box.innerHTML = `<div class="empty">${esc(t('list.empty'))}<br><br><button class="xp-btn" id="empty-new">${esc(t('list.newChat'))}</button><br><br><button class="xp-btn" id="empty-import">${esc(t('list.importChat'))}</button><br><br>${esc(t('list.emptyHint'))}</div>`;
    $('#empty-new').onclick = newChat;
    $('#empty-import').onclick = () => rm.openImport();
    return;
  }

  const groups = [
    { key: 'pinned', title: t('list.pinned'), items: chats.filter((c) => c.pinned) },
    { key: 'all', title: t('list.chats'), items: chats.filter((c) => !c.pinned) },
  ];
  box.innerHTML = groups
    .filter((g) => g.items.length || (g.key === 'all' && !q))
    .map((g) => {
      return `<div class="group ${closedGroups.has(g.key) ? 'closed' : ''}" data-group="${g.key}">
        <div class="group-head"><span class="tri"></span>${g.title} (${g.items.length})</div>
        ${g.items.map(contactHtml).join('')}
      </div>`;
    })
    .join('') || `<div class="empty">${esc(t('list.noMatch'))}</div>`;

  const input = $('.rename', box);
  if (input) {
    input.focus();
    input.select();
    const finish = async (save) => {
      const id = renaming;
      if (!id) return;
      renaming = null;
      if (save && input.value.trim()) await rm.updateChat(id, { name: input.value.trim() });
      else renderGroups();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }
}

function render() {
  if (!state.profile.signedIn) return renderSignin();
  $('#signin').style.display = 'none';
  $('#main').style.display = 'flex';
  renderHeader();
  renderUsage();
  renderGroups();
}

$('#groups').addEventListener('click', (e) => {
  const head = e.target.closest('.group-head');
  if (head) {
    const key = head.parentElement.dataset.group;
    closedGroups.has(key) ? closedGroups.delete(key) : closedGroups.add(key);
    return renderGroups();
  }
  const c = e.target.closest('.contact');
  if (c && !renaming) {
    selected = c.dataset.id;
    $$('.contact').forEach((el) => el.classList.toggle('sel', el.dataset.id === selected));
  }
});
$('#groups').addEventListener('dblclick', (e) => {
  const c = e.target.closest('.contact');
  if (c && !renaming) rm.openChat(c.dataset.id);
});
$('#groups').addEventListener('contextmenu', (e) => {
  const c = e.target.closest('.contact');
  if (!c) return;
  e.preventDefault();
  selected = c.dataset.id;
  $$('.contact').forEach((el) => el.classList.toggle('sel', el.dataset.id === selected));
  rm.contextMenu(c.dataset.id);
});
document.addEventListener('keydown', (e) => {
  if (renaming || document.activeElement?.tagName === 'INPUT') return;
  if (e.key === 'Enter' && selected) rm.openChat(selected);
});

// Main shows a Claude / ChatGPT menu when both are installed, then asks for the folder.
// "New chat" menu in the app's own XP style: icon, title and a short line per option.
const NEW_CHAT_OPTIONS = [
  { provider: 'claude-chat', icon: '✨', needs: 'claude', title: 'newmenu.chat', desc: 'newmenu.chatDesc' },
  { provider: 'codex-chat', icon: '💬', needs: 'codex', title: 'newmenu.gpt', desc: 'newmenu.gptDesc' },
  { provider: 'claude', icon: '🤖', needs: 'claude', title: 'newmenu.code', desc: 'newmenu.codeDesc' },
  { provider: 'codex', icon: '🧠', needs: 'codex', title: 'newmenu.codex', desc: 'newmenu.codexDesc' },
];

function closeNewMenu() {
  $('#newmenu')?.remove();
  document.removeEventListener('mousedown', newMenuAway, true);
  document.removeEventListener('keydown', newMenuKeys, true);
}
function newMenuAway(e) {
  if (!e.target.closest('#newmenu') && !e.target.closest('#add, #new-chat, #empty-new')) closeNewMenu();
}
function newMenuKeys(e) {
  const items = $$('#newmenu .nm-item:not(.off)');
  const i = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); closeNewMenu(); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = items.length;
    items[(i + (e.key === 'ArrowDown' ? 1 : n - 1) + (i < 0 ? 1 : 0)) % n]?.focus();
  }
}

function newChat(e) {
  if ($('#newmenu')) return closeNewMenu();
  const have = state.providers || { claude: !!state.claudePath, codex: false };
  const menu = document.createElement('div');
  menu.id = 'newmenu';
  menu.innerHTML = `<div class="nm-head">${esc(t('newmenu.title'))}</div>` + NEW_CHAT_OPTIONS.map((o) => {
    const ok = have[o.needs];
    return `<button class="nm-item${ok ? '' : ' off'}" data-p="${o.provider}" ${ok ? '' : 'disabled'}>
      <span class="nm-ico">${o.icon}</span>
      <span class="nm-txt"><b>${esc(t(o.title))}</b><small>${esc(ok ? t(o.desc) : t('newmenu.missing'))}</small></span>
    </button>`;
  }).join('');
  document.body.appendChild(menu);
  const anchor = (e && e.currentTarget) || $('#new-chat');
  const r = anchor.getBoundingClientRect();
  const h = menu.offsetHeight;
  const w = menu.offsetWidth;
  const below = r.bottom + 4 + h < innerHeight;
  menu.style.top = `${below ? r.bottom + 4 : Math.max(6, r.top - h - 4)}px`;
  menu.style.left = `${Math.max(6, Math.min(r.left, innerWidth - w - 6))}px`;
  menu.classList.add(below ? 'down' : 'up');
  menu.addEventListener('click', (ev) => {
    const b = ev.target.closest('.nm-item:not(.off)');
    if (!b) return;
    closeNewMenu();
    rm.newChat(b.dataset.p);
  });
  document.addEventListener('mousedown', newMenuAway, true);
  document.addEventListener('keydown', newMenuKeys, true);
  menu.querySelector('.nm-item:not(.off)')?.focus();
}
$('#add').onclick = newChat;
$('#new-chat').onclick = newChat;
$('#import-chat').onclick = () => rm.openImport();
$('#search').addEventListener('input', renderGroups);

$('#me-avatar').onclick = (e) => {
  e.stopPropagation();
  pickAvatar(e.currentTarget, (a) => rm.updateProfile({ avatar: a }));
};
$('#me-status').onchange = (e) => rm.updateProfile({ status: e.target.value });
$('#me-personal').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('#me-personal').addEventListener('blur', (e) => rm.updateProfile({ personal: applyShortcuts(e.target.value.trim()) }));
$('#me-name').ondblclick = () => rm.updateProfile({ signedIn: false });

rm.on('state', (s) => {
  state = s;
  if (!renaming) render();
  else { renderHeader(); renderUsage(); }
});
rm.on('rename', (id) => { renaming = id; renderGroups(); });
rm.on('delete', (id) => rm.deleteChat(id));

// Durum seçeneklerinin parantezli hali (eski usul) ve dil seçimi
$('#me-status').innerHTML = ['online', 'busy', 'away', 'hidden']
  .map((k) => `<option value="${k}">(${esc(t(`status.${k}`))})</option>`)
  .join('');
const langOptions = [`<option value="auto">${esc(t('langAuto'))}</option>`]
  .concat(I18N.LANGS.map((l) => `<option value="${l}">${esc(I18N.STRINGS[l].langName)}</option>`))
  .join('');
$$('.lang-select').forEach((sel) => {
  sel.innerHTML = langOptions;
  sel.onchange = () => rm.updateProfile({ lang: sel.value });
});
$('#theme').innerHTML = ['system', 'light', 'dark']
  .map((k) => `<option value="${k}">${esc(t(`theme.${k}`))}</option>`)
  .join('');
$('#theme').onchange = (e) => rm.updateProfile({ theme: e.target.value });

(async () => {
  applyI18n();
  initTitlebar('Retro Messenger');
  state = await rm.getState();
  $$('.lang-select').forEach((sel) => (sel.value = state.profile.lang || 'auto'));
  $('#theme').value = state.profile.theme || 'system';
  render();
  showTip();
  setInterval(showTip, 20000);
})();
