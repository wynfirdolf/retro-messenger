// Reads Claude Code's saved conversations (~/.claude/projects/<project>/<session-id>.jsonl)
// so a conversation started in the terminal can be continued in the app.
const fs = require('fs');
const os = require('os');
const path = require('path');

const HEAD_BYTES = 256 * 1024;
const TAIL_BYTES = 64 * 1024;
const MAX_SESSIONS = 300;

function projectsDir() {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, 'projects');
}

function readSlice(file, start, length) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, start);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function parseLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* a line cut in half at the slice edge */ }
  }
  return out;
}

// The text the user typed, or null for tool results, slash-command wrappers and other plumbing.
function userText(entry) {
  if (entry.type !== 'user' || entry.isMeta || entry.isSidechain) return null;
  const content = entry.message?.content;
  let text = null;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    const parts = content.filter((b) => b.type === 'text').map((b) => b.text);
    if (parts.length && !content.some((b) => b.type === 'tool_result')) text = parts.join('\n');
  }
  if (!text) return null;
  text = text.trim();
  if (!text || text.startsWith('<') || text.startsWith('Caveat:')) return null;
  return text;
}

function summarize(file, stat) {
  const head = parseLines(readSlice(file, 0, Math.min(stat.size, HEAD_BYTES)));
  const tail = stat.size > HEAD_BYTES
    ? parseLines(readSlice(file, Math.max(0, stat.size - TAIL_BYTES), TAIL_BYTES))
    : [];
  let cwd = null;
  let firstPrompt = null;
  let lastPrompt = null;
  let aiTitle = null;
  let customTitle = null;
  let userCount = 0;
  for (const e of [...head, ...tail]) {
    if (!cwd && e.cwd) cwd = e.cwd;
    const text = userText(e);
    if (text) {
      userCount++;
      if (!firstPrompt) firstPrompt = text;
      lastPrompt = text;
    }
    if (e.type === 'last-prompt' && e.lastPrompt) lastPrompt = e.lastPrompt;
    if (e.type === 'ai-title' && e.aiTitle) aiTitle = e.aiTitle;
    if (e.type === 'custom-title' && e.customTitle) customTitle = e.customTitle;
  }
  if (!cwd || !firstPrompt) return null;
  return {
    sessionId: path.basename(file, '.jsonl'),
    file,
    cwd,
    title: customTitle || aiTitle || null,
    firstPrompt: firstPrompt.replace(/\s+/g, ' ').slice(0, 160),
    lastPrompt: (lastPrompt || firstPrompt).replace(/\s+/g, ' ').slice(0, 160),
    userCount,
    mtime: stat.mtimeMs,
  };
}

// Newest first. `exclude` holds session IDs the app already has.
function listSessions(exclude = new Set()) {
  const root = projectsDir();
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return []; }

  const files = [];
  for (const d of dirs) {
    const dir = path.join(root, d.name);
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      if (exclude.has(name.slice(0, -6))) continue;
      const file = path.join(dir, name);
      try {
        const stat = fs.statSync(file);
        if (stat.isFile() && stat.size > 0) files.push({ file, stat });
      } catch { /* deleted while scanning */ }
    }
  }
  files.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  const out = [];
  for (const { file, stat } of files) {
    if (out.length >= MAX_SESSIONS) break;
    try {
      const s = summarize(file, stat);
      if (s) out.push(s);
    } catch { /* unreadable file */ }
  }
  return out;
}

// Turns a transcript into the app's message list: what the user typed, Claude's replies, tool lines.
function loadTranscript(file, describeTool) {
  const messages = [];
  const seen = new Set();
  for (const e of parseLines(fs.readFileSync(file, 'utf8'))) {
    const ts = Date.parse(e.timestamp) || Date.now();
    const text = userText(e);
    if (text) {
      messages.push({ from: 'me', text, ts });
      continue;
    }
    if (e.type !== 'assistant' || e.isSidechain) continue;
    const id = e.message?.id || e.uuid;
    (e.message?.content || []).forEach((b, i) => {
      const key = `${id}:${i}:${b.type}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (b.type === 'text' && b.text?.trim()) messages.push({ from: 'claude', text: b.text, ts });
      else if (b.type === 'tool_use') messages.push({ from: 'tool', text: describeTool(b), ts });
    });
  }
  return messages;
}

module.exports = { listSessions, loadTranscript };
