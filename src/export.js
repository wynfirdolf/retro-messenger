// Turns a chat into a Markdown or a self-contained HTML file.
const path = require('path');

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const slug = (s) => String(s || 'chat').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'chat';

function defaultFileName(chat, format) {
  const d = new Date();
  const two = (n) => String(n).padStart(2, '0');
  return `${slug(chat.name)}-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}.${format === 'html' ? 'html' : 'md'}`;
}

// Small, safe markdown for the HTML export (same subset the app shows).
function mdToHtml(text) {
  const parts = String(text).split(/```[\w+-]*\n?([\s\S]*?)```/g);
  return parts
    .map((p, i) => {
      if (i % 2 === 1) return `<pre><code>${escHtml(p.replace(/\n$/, ''))}</code></pre>`;
      if (i > 0) p = p.replace(/^\n/, '');
      if (i < parts.length - 1) p = p.replace(/\n$/, '');
      const kept = [];
      const keep = (html) => `\u0001${kept.push(html) - 1}\u0001`;
      let h = escHtml(p)
        .replace(/`([^`\n]+)`/g, (m, c) => keep(`<code>${c}</code>`))
        .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, label, url) => keep(`<a href="${url}">${label}</a>`))
        .replace(/(^|[\s(>*])(https?:\/\/[^\s<]+?)(?=[.,;:!?)\]*]*(?:\s|$|<))/g, (m, pre, url) => `${pre}${keep(`<a href="${url}">${url}</a>`)}`);
      h = h
        .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
        .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
        .replace(/^#{1,6} (.+)$/gm, '<b>$1</b>')
        .replace(/\n/g, '<br>');
      return h.replace(/\u0001(\d+)\u0001/g, (m, n) => kept[n]);
    })
    .join('');
}

function context(chat, profile, t) {
  const locale = t('locale');
  const dt = (ts) => new Date(ts).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const time = (ts) => new Date(ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const day = (ts) => new Date(ts).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const msgs = (chat.messages || []).filter((m) => m && typeof m.text === 'string');
  const provider = String(chat.provider || 'claude');
  const who = provider.startsWith('codex') ? 'ChatGPT' : 'Claude';
  const chatOnly = provider === 'claude-chat' || provider === 'codex-chat';
  const meta = [
    [t('export.with'), `${who}${chat.model ? ' · ' + chat.model : ''}`],
    ...(chatOnly ? [] : [[t('export.folder'), chat.cwd]]),
    [t('export.messages'), String(msgs.filter((m) => m.from === 'me' || m.from === 'claude').length)],
    ...(msgs.length ? [[t('export.period'), `${dt(msgs[0].ts)} – ${dt(msgs[msgs.length - 1].ts)}`]] : []),
    [t('export.exported'), dt(Date.now())],
  ];
  const nameOf = (m) => (m.from === 'me' ? profile.name || t('signin.defaultName') : chat.name);
  const fileLine = (m) => (m.files?.length ? m.files.map((f) => f.name).join(', ') : '');
  return { msgs, meta, nameOf, time, day, fileLine };
}

function toMarkdown(chat, profile, t) {
  const { msgs, meta, nameOf, time, day, fileLine } = context(chat, profile, t);
  const out = [`# ${chat.name}`, '', ...meta.map(([k, v]) => `- **${k}** ${v}`), ''];
  let lastDay = '';
  for (const m of msgs) {
    const d = day(m.ts);
    if (d !== lastDay) { out.push(`---`, '', `## ${d}`, ''); lastDay = d; }
    if (m.from === 'me' || m.from === 'claude') {
      out.push(`**${nameOf(m)}** · ${time(m.ts)}`, '');
      if (m.text.trim()) out.push(m.text.trim(), '');
      const f = fileLine(m);
      if (f) out.push(`📎 ${f}`, '');
    } else if (m.from === 'error') {
      out.push(`> ⚠️ ${m.text.trim().replace(/\n/g, '\n> ')}`, '');
    } else {
      out.push(`_${m.from === 'tool' ? '⚙️ ' : '• '}${m.text.trim()}_`, '');
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function toHtml(chat, profile, t) {
  const { msgs, meta, nameOf, time, day, fileLine } = context(chat, profile, t);
  let lastDay = '';
  const body = msgs.map((m) => {
    let h = '';
    const d = day(m.ts);
    if (d !== lastDay) { lastDay = d; h += `<div class="day">— ${escHtml(d)} —</div>`; }
    if (m.from === 'me' || m.from === 'claude') {
      const color = m.from === 'me' && /^#[0-9a-f]{6}$/i.test(m.style?.color || '') ? ` style="color:${m.style.color}"` : '';
      h += `<div class="msg ${m.from}"><div class="who">${escHtml(t('says', { name: nameOf(m) }))} <span class="t">(${escHtml(time(m.ts))})</span></div>`
        + (m.text.trim() ? `<div class="text"${color}>${mdToHtml(m.text.trim())}</div>` : '')
        + (fileLine(m) ? `<div class="files">📎 ${escHtml(fileLine(m))}</div>` : '') + '</div>';
    } else {
      h += `<div class="line ${m.from}">${m.from === 'tool' ? '⚙️' : m.from === 'error' ? '⚠️' : '•'} ${escHtml(m.text.trim())}</div>`;
    }
    return h;
  }).join('\n');
  return `<!doctype html>
<html lang="${escHtml(t('locale').slice(0, 2))}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(chat.name)}</title>
<style>
  :root { color-scheme: light dark; --bg:#eef3fb; --card:#fff; --ink:#111; --muted:#6d6d6d; --claude:#102a6b; --line:#c9d8ee; --code:#f4f6fa; --link:#0645ad; --head:#1d3f84; }
  @media (prefers-color-scheme: dark) { :root { --bg:#161d2a; --card:#1c2331; --ink:#e4e9f2; --muted:#8d9ab0; --claude:#a8c5ff; --line:#2e3a50; --code:#141a24; --link:#8fd6ff; --head:#9dbdff; } }
  body { margin:0; padding:24px 12px; background:var(--bg); color:var(--ink); font:15px/1.5 "Segoe UI", Tahoma, Verdana, system-ui, sans-serif; }
  .page { max-width:760px; margin:0 auto; background:var(--card); border:1px solid var(--line); border-radius:8px; overflow:hidden; box-shadow:0 4px 18px #0002; }
  header { padding:16px 20px; color:#fff; background:linear-gradient(180deg,#4a96ff,#0a5fe0 60%,#0846b8); }
  header h1 { margin:0; font-size:20px; text-shadow:1px 1px 0 #0a246a; }
  .meta { padding:10px 20px; color:var(--muted); font-size:13px; border-bottom:1px solid var(--line); }
  .meta b { color:var(--ink); font-weight:600; }
  main { padding:14px 20px 22px; }
  .day { text-align:center; color:var(--muted); font-size:12px; margin:14px 0; }
  .msg { margin:0 0 14px; }
  .who { color:var(--muted); font-size:13px; }
  .who .t { font-size:12px; opacity:.8; }
  .text { padding-left:14px; overflow-wrap:anywhere; }
  .claude .text { color:var(--claude); }
  .files { padding-left:14px; color:var(--muted); font-size:13px; }
  .line { margin:2px 0 10px; color:var(--muted); font-size:13px; }
  .line.error { color:#c0392b; white-space:pre-wrap; }
  code { font:13px Menlo,Consolas,monospace; background:var(--code); border:1px solid var(--line); border-radius:3px; padding:0 4px; }
  pre { margin:6px 0; padding:8px 10px; background:var(--code); border:1px solid var(--line); border-left:3px solid #6a9be6; overflow-x:auto; }
  pre code { border:0; padding:0; background:none; color:var(--ink); }
  a { color:var(--link); }
  footer { padding:10px 20px; text-align:center; color:var(--muted); font-size:12px; border-top:1px solid var(--line); }
</style>
</head>
<body>
<div class="page">
<header><h1>${escHtml(chat.name)}</h1></header>
<div class="meta">${meta.map(([k, v]) => `<div><b>${escHtml(k)}</b> ${escHtml(v)}</div>`).join('')}</div>
<main>
${body}
</main>
<footer>${escHtml(t('export.footer'))}</footer>
</div>
</body>
</html>
`;
}

module.exports = { toMarkdown, toHtml, defaultFileName };
