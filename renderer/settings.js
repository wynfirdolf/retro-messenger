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

  $('#version').textContent = t('set.version', { v: state.appVersion || '' });
  const tool = (name, found, where) => `<span>${esc(name)}</span><span>${found
    ? `<span class="ok">✓ ${esc(t('set.found'))}</span><br><code>${esc(where)}</code>`
    : `<span class="no">✗ ${esc(t('set.notFound'))}</span>`}</span>`;
  $('#tools').innerHTML = tool('Claude Code', state.providers?.claude, state.claudePath)
    + tool('ChatGPT (Codex)', state.providers?.codex, state.codexPath);
}

// Fixed parts: titles, option lists, handlers
$('#status').innerHTML = ['online', 'busy', 'away', 'hidden'].map((k) => `<option value="${k}">${esc(t(`status.${k}`))}</option>`).join('');
$('#lang').innerHTML = [`<option value="auto">${esc(t('langAuto'))}</option>`]
  .concat(I18N.LANGS.map((l) => `<option value="${l}">${esc(I18N.STRINGS[l].langName)}</option>`)).join('');
$('#logo').innerHTML = LOGO_SVG(48);

$('#nav').onclick = (e) => { const b = e.target.closest('button[data-go]'); if (b) go(b.dataset.go); };
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
