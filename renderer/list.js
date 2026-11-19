/* global rm, $, $$, esc, LOGO_SVG, STATUS, buddySvg, AVATARS, avatarHtml, openGrid, Sounds, initTitlebar, applyShortcuts */

let state = null;
let selected = null;
let renaming = null;
const closedGroups = new Set();

const TIPS = [
  '<b>İpucu:</b> Bir sohbete çift tıklayarak açın. Sağ tıklayınca yeniden adlandırabilir veya sabitleyebilirsiniz.',
  '<b>İpucu:</b> Claude yanıt verirken simgesi sarı yanıp söner; yanıt gelince turuncu olur.',
  '<b>İpucu:</b> Sohbet penceresindeki titreşim düğmesi pencereyi sallar ve Claude\'un dikkatini çeker.',
  '<b>İpucu:</b> :) (Y) &lt;3 gibi klasik ifadeler gönderirken emojiye dönüşür.',
  '<b>İpucu:</b> Durumunuzu "Meşgul" yaparsanız sesler ve bildirimler susar.',
  '<b>İpucu:</b> Her sohbet bir proje klasöründe çalışan gerçek bir Claude Code oturumudur.',
];
let tipIndex = Math.floor(Math.random() * TIPS.length);

function showTip() {
  $('#tip').innerHTML = `<span style="font-size:22px">💡</span><span>${TIPS[tipIndex % TIPS.length]}</span>`;
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
    note.textContent = `Claude Code bulundu: ${state.claudePath}`;
  } else {
    note.className = 'si-note bad';
    note.textContent = 'Claude Code bulunamadı. Önce Claude Code\'u kurun; uygulama sizin kurulu `claude` komutunuzu kullanır.';
  }
  setTimeout(() => $('#si-name').focus(), 50);
}

function pickAvatar(anchor, onPick) {
  openGrid(anchor, AVATARS.map((a) => a[0]), 'Görünen resminizi seçin', onPick, 4);
}

$('#si-avatar').onclick = $('#si-avatar-btn').onclick = (e) => {
  e.stopPropagation();
  pickAvatar(e.currentTarget, (a) => {
    draftAvatar = a;
    $('#si-avatar').innerHTML = avatarHtml(a, 'xl');
  });
};

async function signIn() {
  const name = $('#si-name').value.trim() || 'Ben';
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
  setTitleStatus();
}

function setTitleStatus() {
  const st = STATUS[state.profile.status] || STATUS.online;
  $('#me-status').style.color = st.color === '#a3a3a3' ? '#666' : '#333';
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
  $('#usage-label').textContent = '5 saatlik kullanım';
  $('#usage-fill').style.width = `${Math.min(100, pct)}%`;
  $('#usage-pct').textContent = `%${pct}`;
  const reset = win.resetsAt || rl.resetsAt;
  box.title = reset ? `Sıfırlanma: ${new Date(reset * 1000).toLocaleString('tr-TR')}` : '';
}

function contactIcon(c) {
  if (c.busy) return buddySvg('#f0b000', 'pulse');
  if (c.unread) return buddySvg('#ff7a1a', 'blink');
  return buddySvg('#43b83a');
}

function contactHtml(c) {
  const cls = ['contact', c.unread ? 'unread' : '', selected === c.id ? 'sel' : ''].join(' ');
  if (renaming === c.id) {
    return `<div class="${cls}" data-id="${c.id}">${contactIcon(c)}<input type="text" class="rename" value="${esc(c.name)}" maxlength="60"></div>`;
  }
  const sub = c.busy ? '(Yazıyor…)' : c.last ? `- ${c.last}` : `- ${c.cwd}`;
  return `<div class="${cls}" data-id="${c.id}" title="${esc(c.cwd)}">${contactIcon(c)}<span class="cn">${esc(c.name)}</span><span class="cm">${esc(sub)}</span></div>`;
}

function renderGroups() {
  const q = $('#search').value.trim().toLocaleLowerCase('tr');
  const chats = state.chats
    .filter((c) => !q || c.name.toLocaleLowerCase('tr').includes(q) || c.cwd.toLocaleLowerCase('tr').includes(q))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const box = $('#groups');

  if (!state.chats.length) {
    box.innerHTML = `<div class="empty">Henüz hiç sohbetiniz yok.<br><br><button class="xp-btn" id="empty-new">Yeni sohbet başlat</button><br><br>Her sohbet, seçtiğiniz bir proje klasöründe çalışan bir Claude Code oturumudur.</div>`;
    $('#empty-new').onclick = newChat;
    return;
  }

  const groups = [
    { key: 'pinned', title: 'Sabitlenenler', items: chats.filter((c) => c.pinned) },
    { key: 'all', title: 'Sohbetler', items: chats.filter((c) => !c.pinned) },
  ];
  box.innerHTML = groups
    .filter((g) => g.items.length || (g.key === 'all' && !q))
    .map((g) => {
      return `<div class="group ${closedGroups.has(g.key) ? 'closed' : ''}" data-group="${g.key}">
        <div class="group-head"><span class="tri"></span>${g.title} (${g.items.length})</div>
        ${g.items.map(contactHtml).join('')}
      </div>`;
    })
    .join('') || '<div class="empty">Eşleşen sohbet yok.</div>';

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

async function newChat() {
  const cwd = await rm.pickFolder();
  if (cwd) await rm.createChat({ cwd });
}
$('#add').onclick = newChat;
$('#new-chat').onclick = newChat;
$('#search').addEventListener('input', renderGroups);

$('#me-avatar').onclick = (e) => {
  e.stopPropagation();
  pickAvatar(e.currentTarget, (a) => rm.updateProfile({ avatar: a }));
};
$('#me-status').onchange = (e) => rm.updateProfile({ status: e.target.value });
$('#me-personal').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('#me-personal').addEventListener('blur', (e) => rm.updateProfile({ personal: applyShortcuts(e.target.value.trim()) }));
$('#me-name').ondblclick = () => rm.updateProfile({ signedIn: false });
$('#me-name').title = 'Oturumu kapatmak için çift tıklayın';

rm.on('state', (s) => {
  state = s;
  if (!renaming) render();
  else { renderHeader(); renderUsage(); }
});
rm.on('rename', (id) => { renaming = id; renderGroups(); });
rm.on('delete', (id) => rm.deleteChat(id));

(async () => {
  initTitlebar('Retro Messenger');
  state = await rm.getState();
  render();
  showTip();
  setInterval(showTip, 20000);
})();
