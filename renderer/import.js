/* global rm, t, LOCALE, $, $$, esc, initTitlebar, applyI18n */

let sessions = [];
let selected = null;

const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
function ago(ms) {
  const s = (ms - Date.now()) / 1000;
  const steps = [[60, 'second'], [3600, 'minute'], [86400, 'hour'], [604800, 'day'], [2629800, 'week'], [31557600, 'month'], [Infinity, 'year']];
  const div = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2629800, year: 31557600 };
  for (const [limit, unit] of steps) if (Math.abs(s) < limit) return rtf.format(Math.round(s / div[unit]), unit);
  return '';
}

function render() {
  const q = $('#search').value.trim().toLocaleLowerCase(LOCALE);
  const shown = sessions.filter((s) => !q || [s.title, s.firstPrompt, s.lastPrompt, s.cwd].join(' ').toLocaleLowerCase(LOCALE).includes(q));
  if (!sessions.length) {
    $('#list').innerHTML = `<div class="empty">${esc(t('import.empty'))}</div>`;
  } else if (!shown.length) {
    $('#list').innerHTML = `<div class="empty">${esc(t('import.noMatch'))}</div>`;
  } else {
    $('#list').innerHTML = shown
      .map((s) => `<div class="row ${s.sessionId === selected ? 'sel' : ''}" data-id="${s.sessionId}">
        <span class="ico">💬</span>
        <div class="main">
          <div class="t">${esc(s.title || s.firstPrompt)}</div>
          ${s.title || s.lastPrompt !== s.firstPrompt ? `<div class="p">${esc(s.lastPrompt)}</div>` : ''}
          <div class="meta">📁 ${esc(s.cwdLabel)}${s.cwdExists ? '' : ` · <span class="missing">${esc(t('import.missing'))}</span>`}</div>
        </div>
        <span class="when">${esc(ago(s.mtime))}<br>${esc(t('import.messages', { n: s.userCount }))}</span>
      </div>`)
      .join('');
  }
  const sel = sessions.find((s) => s.sessionId === selected);
  $('#open').disabled = !sel || !sel.cwdExists;
}

async function openSelected() {
  if ($('#open').disabled) return;
  $('#open').disabled = true;
  await rm.importSession(selected);
}

$('#list').addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  selected = row.dataset.id;
  render();
});
$('#list').addEventListener('dblclick', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  selected = row.dataset.id;
  render();
  openSelected();
});
$('#search').addEventListener('input', render);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && selected) openSelected();
  if (e.key === 'Escape') rm.win('close');
});
$('#open').onclick = openSelected;
$('#cancel').onclick = () => rm.win('close');

(async () => {
  applyI18n();
  initTitlebar(t('import.title'));
  $('#search').focus();
  sessions = await rm.listSessions();
  render();
})();
