/* global rm, t, I18N, $, $$, esc, LOGO_SVG, AVATARS, avatarHtml, openGrid, initTitlebar, applyI18n, applyShortcuts */

let state = null;

function go(pageName) {
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.go === pageName));
  $$('section[data-page]').forEach((s) => s.classList.toggle('on', s.dataset.page === pageName));
  try { localStorage.setItem('settings.page', pageName); } catch {}
}

function radios(box, name, options, value, onPick) {
  box.innerHTML = options.map(([v, title, desc]) => `<label><input type="radio" name="${name}" value="${v}" ${v === value ? 'checked' : ''}>
    <span>${esc(title)}${desc ? `<small>${esc(desc)}</small>` : ''}</span></label>`).join('');
  box.onchange = (e) => onPick(e.target.value);
}

function render() {
  const p = state.profile;
  $('#me-dp').innerHTML = avatarHtml(p.avatar, 'l');
  if (document.activeElement !== $('#name')) $('#name').value = p.name || '';
  if (document.activeElement !== $('#personal')) $('#personal').value = p.personal || '';
  $('#status').value = p.status || 'online';

  radios($('#theme'), 'theme', [
    ['system', t('theme.system'), t('set.themeSystem')],
    ['light', t('theme.light')],
    ['dark', t('theme.dark')],
  ], p.theme || 'system', (v) => rm.updateProfile({ theme: v }));
  $('#lang').value = p.lang || 'auto';

  const mac = rm.platform === 'darwin';
  radios($('#links'), 'links', [
    ['click', t('set.linkClick'), t('set.linkClickDesc')],
    ['mod', t(mac ? 'set.linkModMac' : 'set.linkModWin'), t('set.linkModDesc')],
  ], p.linkClick || 'click', (v) => rm.updateProfile({ linkClick: v }));

  $('#snd-on').checked = p.sounds !== false;
  $('#snd-app').checked = p.appSounds !== false;
  $('#snd-app').disabled = p.sounds === false;
  $('#snd-app-row').style.opacity = p.sounds === false ? '0.5' : '';
  renderUpdate();
  renderSounds();
  $('#version').textContent = t('set.version', { v: state.appVersion || '' });
  const tool = (name, found, where) => `<span>${esc(name)}</span><span>${found
    ? `<span class="ok">✓ ${esc(t('set.found'))}</span><br><code>${esc(where)}</code>`
    : `<span class="no">✗ ${esc(t('set.notFound'))}</span>`}</span>`;
  $('#tools').innerHTML = tool('Claude Code', state.providers?.claude, state.claudePath)
    + tool('ChatGPT (Codex)', state.providers?.codex, state.codexPath);
}

async function renderSounds() {
  let info;
  try { info = await rm.listSounds(); } catch { return; }
  $('#snd-list').innerHTML = info.sounds.map((s) => `<div class="snd"><span class="nm">${esc(t('snd.name.' + s.name))}
    <small>${esc(s.name)}.mp3 / .wav · ${esc(t('snd.max', { s: s.max }))} · <span class="${s.file ? 'custom' : ''}">${esc(s.file ? t('snd.custom', { f: s.file }) : t('snd.default'))}</span></small></span>
    <button class="xp-btn" data-play="${s.name}">▶</button></div>`).join('');
  $('#snd-dir').textContent = t('snd.dir', { d: info.dir || '' });
}

function renderUpdate() {
  // Auto-update exists on Windows only.
  $('#upd-box').style.display = state.updatesEnabled === false ? 'none' : '';
  const u = state.update || { status: 'idle' };
  const win = rm.platform === 'win32';
  $('#autoupdate').checked = state.profile.autoUpdate !== false;
  const text = {
    dev: t('upd.dev'),
    idle: '',
    checking: t('upd.checking'),
    uptodate: t('upd.uptodate'),
    available: t('upd.available', { v: u.version }),
    downloading: t('upd.downloading', { v: u.version, p: u.percent || 0 }),
    ready: t('upd.ready', { v: u.version }),
    error: t('upd.error', { e: u.error || '' }),
  }[u.status] || '';
  $('#upd-status').textContent = text;
  const btn = $('#upd-btn');
  btn.disabled = ['checking', 'downloading', 'dev'].includes(u.status);
  if (u.status === 'ready' && win) { btn.textContent = t('upd.install'); btn.onclick = () => rm.installUpdate(); }
  else if (u.status === 'available') { btn.textContent = t('upd.download'); btn.onclick = () => rm.openUrl(u.url); }
  else { btn.textContent = t('upd.check'); btn.onclick = () => rm.checkUpdate(); }
}

$('#snd-list').onclick = (e) => { const b = e.target.closest('button[data-play]'); if (b) rm.playSound(b.dataset.play); };
$('#snd-open').onclick = () => rm.openSoundsFolder();
$('#snd-on').onchange = (e) => rm.updateProfile({ sounds: e.target.checked });
$('#snd-app').onchange = (e) => rm.updateProfile({ appSounds: e.target.checked });
window.addEventListener('focus', renderSounds);

// Fixed parts: titles, option lists, handlers
$('#status').innerHTML = ['online', 'busy', 'away', 'hidden'].map((k) => `<option value="${k}">${esc(t(`status.${k}`))}</option>`).join('');
$('#lang').innerHTML = [`<option value="auto">${esc(t('langAuto'))}</option>`]
  .concat(I18N.LANGS.map((l) => `<option value="${l}">${esc(I18N.STRINGS[l].langName)}</option>`)).join('');
$('#logo').innerHTML = LOGO_SVG(48);

$('#nav').onclick = (e) => { const b = e.target.closest('button[data-go]'); if (b) go(b.dataset.go); };
$('#autoupdate').onchange = (e) => rm.updateProfile({ autoUpdate: e.target.checked });
$('#status').onchange = (e) => rm.updateProfile({ status: e.target.value });
$('#lang').onchange = (e) => rm.updateProfile({ lang: e.target.value });
for (const [id, key, fix] of [['name', 'name', (v) => v || t('signin.defaultName')], ['personal', 'personal', applyShortcuts]]) {
  $(`#${id}`).addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  $(`#${id}`).addEventListener('blur', (e) => rm.updateProfile({ [key]: fix(e.target.value.trim()) }));
}
$('#me-dp').onclick = (e) => {
  e.stopPropagation();
  openGrid(e.currentTarget, AVATARS.map((a) => a[0]), t('pickAvatar'), (a) => rm.updateProfile({ avatar: a }), 4);
};
$('#signout').onclick = () => { rm.updateProfile({ signedIn: false }); rm.win('close'); };
$('#github').onclick = () => rm.openUrl('https://github.com/wynfirdolf/retro-messenger');
$('#close').onclick = () => rm.win('close');
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('.popover')) rm.win('close'); });

rm.on('state', (s) => { state = s; render(); });

(async () => {
  applyI18n();
  initTitlebar(t('set.title'));
  state = await rm.getState();
  render();
  let start = 'personal';
  try { start = localStorage.getItem('settings.page') || start; } catch {}
  go($(`section[data-page="${start}"]`) ? start : 'personal');
})();
