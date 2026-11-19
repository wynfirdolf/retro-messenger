// Tüm pencerelerin paylaştığı yardımcılar: başlık çubuğu, sesler, görünen resimler, ifadeler, metin biçimlendirme.
/* global rm */

const t = I18N.makeT(rm.lang);
const LOCALE = t('locale');

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const LOGO_SVG = (size = 16) => `
<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
  <defs><linearGradient id="lg${size}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#9fd4ff"/><stop offset="1" stop-color="#1a63d6"/></linearGradient></defs>
  <path d="M10 8h40a7 7 0 0 1 7 7v24a7 7 0 0 1-7 7H29L16 57V46h-6a7 7 0 0 1-7-7V15a7 7 0 0 1 7-7z"
        fill="url(#lg${size})" stroke="#0b3f8f" stroke-width="2.5"/>
  <circle cx="19" cy="27" r="4" fill="#fff"/><circle cx="30" cy="27" r="4" fill="#fff"/><circle cx="41" cy="27" r="4" fill="#fff"/>
  <circle cx="53" cy="12" r="8" fill="#4fcf3f" stroke="#1d7a17" stroke-width="2.5"/>
</svg>`;

const STATUS = {
  online: { color: '#43b83a' },
  busy: { color: '#e0412f' },
  away: { color: '#f0b000' },
  hidden: { color: '#a3a3a3' },
};

const buddySvg = (color, cls = '') => `
<svg class="buddy ${cls}" viewBox="0 0 16 16" aria-hidden="true">
  <circle cx="8" cy="4.6" r="3.3" fill="${color}" stroke="#0005" stroke-width="0.8"/>
  <path d="M2.2 15.3c0-3.9 2.5-6.1 5.8-6.1s5.8 2.2 5.8 6.1z" fill="${color}" stroke="#0005" stroke-width="0.8"/>
  <ellipse cx="6.8" cy="3.4" rx="1.3" ry="0.8" fill="#fff8"/>
</svg>`;

// Görünen resimler: renkli bir zemin üzerinde büyük bir emoji.
const AVATARS = [
  ['🦊', '#ffcf8a', '#ff8a3d'], ['🤖', '#c9e4ff', '#5d9cec'], ['🐱', '#ffe0ec', '#f38bb4'], ['🐼', '#e8f5e0', '#7bc96f'],
  ['🌻', '#fff6b0', '#f4c20d'], ['🎸', '#ffd9d0', '#e5533d'], ['⚽', '#dff3ff', '#3aa0d8'], ['🦋', '#e9e0ff', '#8d6be0'],
  ['🐢', '#d8f5e6', '#2fa36b'], ['🍕', '#ffe6c7', '#e58a2e'], ['🎮', '#e3e3ff', '#5b5bd6'], ['🌴', '#d5f7f0', '#18a38a'],
  ['🐧', '#e2edf7', '#4b6a8a'], ['🚀', '#e6e9ff', '#3f51b5'], ['🎧', '#f1e2ff', '#9b4fd1'], ['☕', '#f3e6d8', '#8d5a35'],
];

function avatarHtml(emoji, size = '', extra = '') {
  const a = AVATARS.find((x) => x[0] === emoji) || [emoji || '🙂', '#e9f1fb', '#9db8e0'];
  return `<span class="dp ${size} ${extra}"><span style="background:radial-gradient(circle at 35% 30%, ${a[1]}, ${a[2]})">${esc(a[0])}</span></span>`;
}

// Klasik metin ifadeleri gönderilirken emojiye çevrilir.
const SHORTCUTS = [
  [':)', '🙂'], [':-)', '🙂'], [':D', '😄'], [':-D', '😄'], [';)', '😉'], [';-)', '😉'], [':(', '🙁'], [':-(', '🙁'],
  [':P', '😛'], [':p', '😛'], [':O', '😮'], [':o', '😮'], [':S', '😖'], [':|', '😐'], [":'(", '😢'], ['(H)', '😎'],
  ['(A)', '😇'], [':@', '😠'], ['(Y)', '👍'], ['(N)', '👎'], ['<3', '❤️'], ['(L)', '❤️'], ['(U)', '💔'], ['(K)', '💋'],
  ['(F)', '🌹'], ['(*)', '⭐'], ['(I)', '💡'], ['(C)', '☕'], ['(B)', '🍺'], ['(^)', '🎂'], ['(G)', '🎁'], ['(8)', '🎵'],
];
const EMOTICONS = [
  '🙂', '😄', '😉', '😛', '😮', '😎', '😇', '🙁', '😢', '😠', '😖', '😐', '😳', '🤓', '🤔', '😴',
  '🥳', '🤯', '🙄', '😏', '👍', '👎', '👏', '🙏', '💪', '👋', '❤️', '💔', '⭐', '🌹', '💡', '☕',
  '🍺', '🎂', '🎁', '🎵', '📞', '✉️', '💻', '🐛', '🔥', '✅', '❌', '⚠️', '🚀', '🎉', '🌙', '☀️',
];

function applyShortcuts(text) {
  let out = text;
  for (const [k, v] of SHORTCUTS) out = out.split(k).join(v);
  return out;
}

// Basit ve güvenli markdown: önce kaçış, sonra kod blokları, satır içi kod, kalın ve italik.
function fmt(text) {
  const parts = String(text).split(/```[\w+-]*\n?([\s\S]*?)```/g);
  return parts
    .map((p, i) => {
      if (i % 2 === 1) return `<pre class="code">${esc(p.replace(/\n$/, ''))}</pre>`;
      if (i > 0) p = p.replace(/^\n/, '');
      if (i < parts.length - 1) p = p.replace(/\n$/, '');
      return esc(p)
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
        .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
        .replace(/^#{1,6} (.+)$/gm, '<b>$1</b>')
        .replace(/\n/g, '<br>');
    })
    .join('');
}

const timeStr = (ts) => new Date(ts).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });

// Sesler WebAudio ile üretilir; harici ses dosyası yoktur.
const Sounds = (() => {
  let ctx = null;
  const ac = () => (ctx ||= new AudioContext());
  function tone(freq, at, dur, type = 'sine', gain = 0.16) {
    const a = ac();
    const t = a.currentTime + at;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  return {
    message() { tone(784, 0, 0.16, 'triangle'); tone(1175, 0.1, 0.34, 'triangle'); },
    nudge() { for (let i = 0; i < 10; i++) tone(i % 2 ? 130 : 175, i * 0.045, 0.055, 'square', 0.07); },
    online() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.085, 0.3, 'sine', 0.12)); },
    send() { tone(1400, 0, 0.05, 'sine', 0.05); },
    play(name) { try { this[name]?.(); } catch {} },
  };
})();

function initTitlebar(title) {
  const tb = $('.titlebar');
  if (!tb) return;
  $('.tb-icon', tb).innerHTML = LOGO_SVG(16);
  if (title) setTitle(title);
  $$('[data-win]', tb).forEach((b) => {
    b.title = t(`win.${b.dataset.win}`);
    b.onclick = () => rm.win(b.dataset.win);
  });
  tb.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) rm.win('max'); });
}

function setTitle(title) {
  document.title = title;
  const el = $('.titlebar .tb-title');
  if (el) el.textContent = title;
}

function closePopovers() { $$('.popover').forEach((p) => p.remove()); }

// Bir düğmenin altında emoji ızgarası açar.
function openGrid(anchor, items, title, onPick, cols = 8) {
  closePopovers();
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.innerHTML = `<h4>${esc(title)}</h4><div class="grid" style="grid-template-columns:repeat(${cols},30px)"></div>`;
  const grid = $('.grid', pop);
  for (const it of items) {
    const b = document.createElement('button');
    b.textContent = it;
    b.onclick = (e) => { e.stopPropagation(); closePopovers(); onPick(it); };
    grid.appendChild(b);
  }
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let top = r.bottom + 4;
  if (top + pr.height > innerHeight - 6) top = Math.max(6, r.top - pr.height - 4);
  pop.style.top = `${top}px`;
  pop.style.left = `${Math.max(6, Math.min(r.left, innerWidth - pr.width - 6))}px`;
  setTimeout(() => document.addEventListener('click', closePopovers, { once: true }));
}

// data-i18n="anahtar" → metin, data-i18n-title → title, data-i18n-ph → placeholder
function applyI18n(root = document) {
  document.documentElement.lang = rm.lang;
  $$('[data-i18n]', root).forEach((el) => (el.textContent = t(el.dataset.i18n)));
  $$('[data-i18n-title]', root).forEach((el) => (el.title = t(el.dataset.i18nTitle)));
  $$('[data-i18n-ph]', root).forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
}

rm.on('play-sound', (name) => Sounds.play(name));
