// ChatGPT chats run OpenAI's Codex CLI (the copy bundled with the ChatGPT app, or one on PATH).
// It uses the ChatGPT sign-in already on this Mac (~/.codex); the app never asks for a login.
// Each message is one `codex exec --json` run; later messages resume the same thread.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const BUNDLED = [
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
  '/Applications/Codex.app/Contents/Resources/codex-cli/bin/codex',
];

function findCodex(env) {
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir, process.platform === 'win32' ? 'codex.cmd' : 'codex');
    if (dir && fs.existsSync(p)) return p;
  }
  return BUNDLED.find((p) => fs.existsSync(p)) || null;
}

const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

// Models the signed-in ChatGPT account can use, newest first, from Codex's own cache.
function listModels() {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(codexHome(), 'models_cache.json'), 'utf8'));
    return (data.models || [])
      .filter((m) => m.visibility === 'list' && m.slug)
      .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
      .map((m) => ({
        id: m.slug,
        label: m.display_name || m.slug,
        efforts: (m.supported_reasoning_levels || []).map((l) => l.effort).filter(Boolean),
      }));
  } catch {
    return [];
  }
}

// Read-only, write inside the project folder, or no sandbox at all.
const SANDBOXES = ['read-only', 'workspace-write', 'danger-full-access'];

const short = (s, n = 80) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

// "/bin/zsh -lc \"npm test\"" -> "npm test"
function plainCommand(cmd) {
  const m = String(cmd || '').match(/^\S*sh\s+-l?c\s+(["'])([\s\S]*)\1$/);
  return m ? m[2].replace(/\\"/g, '"') : String(cmd || '');
}

class CodexSession extends EventEmitter {
  constructor({ env, codexPath, cwd, sessionId, model, effort, permissionMode, t }) {
    super();
    this.env = env;
    this.codexPath = codexPath;
    this.cwd = cwd;
    this.threadId = sessionId || null;
    this.model = model || '';
    this.effort = effort || '';
    this.sandbox = SANDBOXES.includes(permissionMode) ? permissionMode : 'workspace-write';
    this.t = t;
    this.proc = null;
    this.busy = false;
  }

  emitEvent(ev) {
    this.emit('event', ev);
  }

  // content: a string, or Claude-style blocks; images become -i files, text becomes the prompt.
  send(content) {
    if (!this.codexPath) {
      this.emitEvent({ kind: 'error', text: this.t('err.noCodex') });
      return false;
    }
    if (!fs.existsSync(this.cwd)) {
      this.emitEvent({ kind: 'error', text: this.t('err.noFolder', { cwd: this.cwd }) });
      return false;
    }
    const { prompt, images } = this.flatten(content);
    const args = ['exec'];
    if (this.threadId) args.push('resume', this.threadId);
    args.push('--json', '--skip-git-repo-check', '-c', `sandbox_mode="${this.sandbox}"`, '-c', 'approval_policy="never"');
    if (this.model) args.push('-m', this.model);
    if (this.effort) args.push('-c', `model_reasoning_effort="${this.effort}"`);
    for (const img of images) args.push('-i', img);
    args.push('-'); // the prompt comes on stdin

    const proc = spawn(this.codexPath, args, { cwd: this.cwd, env: this.env.env, windowsHide: true });
    this.proc = proc;
    this.busy = true;
    this.finished = false;
    let stderr = '';
    readline.createInterface({ input: proc.stdout }).on('line', (line) => this.onLine(line));
    proc.stderr.on('data', (d) => { stderr = (stderr + d).slice(-3000); });
    proc.stdin.on('error', () => {});
    proc.stdin.end(prompt);
    proc.on('error', (err) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.busy = false;
      this.emitEvent({ kind: 'error', text: this.t('err.spawnCodex', { msg: err.message }) });
    });
    proc.on('exit', (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      if (this.busy && !this.finished) {
        this.busy = false;
        const tail = stderr.trim().split('\n').slice(-6).join('\n');
        this.emitEvent({ kind: 'error', text: this.t('err.crashedCodex', { code }) + (tail ? '\n' + tail : '') });
      }
    });
    return true;
  }

  flatten(content) {
    if (typeof content === 'string') return { prompt: content, images: [] };
    const images = [];
    const texts = [];
    for (const b of content) {
      if (b.type === 'text') texts.push(b.text);
      if (b.type === 'image' && b.path) images.push(b.path);
    }
    return { prompt: texts.join('\n\n'), images };
  }

  // Codex runs without interactive approvals; nothing to answer.
  respond() {}

  kill() {
    const p = this.proc;
    this.proc = null;
    this.busy = false;
    if (p) p.kill();
  }

  onLine(line) {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    switch (m.type) {
      case 'thread.started':
        if (m.thread_id && m.thread_id !== this.threadId) {
          this.threadId = m.thread_id;
          this.emitEvent({ kind: 'session', sessionId: m.thread_id });
        }
        return;
      case 'item.started':
        if (m.item?.type === 'command_execution') {
          this.emitEvent({ kind: 'tool', text: this.t('tool.Bash', { x: short(plainCommand(m.item.command)) }) });
        }
        return;
      case 'item.completed':
        this.onItem(m.item || {});
        return;
      case 'turn.completed':
        this.finished = true;
        this.busy = false;
        this.emitEvent({ kind: 'done', isError: false, errorText: null, denied: 0 });
        return;
      case 'turn.failed':
      case 'error': {
        if (this.finished) return;
        this.finished = true;
        this.busy = false;
        const msg = m.error?.message || m.message || this.t('err.generic');
        this.emitEvent({ kind: 'done', isError: true, errorText: msg, denied: 0 });
        return;
      }
      default:
    }
  }

  onItem(item) {
    switch (item.type) {
      case 'agent_message':
        if (item.text?.trim()) this.emitEvent({ kind: 'text', text: item.text });
        return;
      case 'file_change':
        for (const c of item.changes || []) {
          const key = c.kind === 'add' ? 'tool.Write' : 'tool.Edit';
          this.emitEvent({ kind: 'tool', text: this.t(key, { x: path.basename(c.path || '') }) });
        }
        return;
      case 'web_search':
        this.emitEvent({ kind: 'tool', text: this.t('tool.WebSearch', { x: short(item.query) }) });
        return;
      case 'mcp_tool_call':
        this.emitEvent({ kind: 'tool', text: this.t('tool.other', { x: `${item.server || ''}/${item.tool || ''}` }) });
        return;
      case 'todo_list':
        this.emitEvent({ kind: 'tool', text: this.t('tool.TodoWrite') });
        return;
      default:
        // reasoning, command output and model warnings are not shown
    }
  }
}

module.exports = { CodexSession, findCodex, listModels, SANDBOXES };
