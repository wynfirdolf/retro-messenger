// Her sohbet, kullanıcının kendi kurulu `claude` CLI'ını stream-json modunda çalıştıran bir süreçtir.
// Ham olaylar burada sadeleştirilip { kind: ... } biçiminde dışarı verilir.
const { spawn, execFileSync } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

// GUI uygulamaları kullanıcının kabuk PATH'ini almaz; claude'u ve araçlarının ihtiyaç duyduğu PATH'i buluruz.
function resolveEnvironment() {
  const env = { ...process.env };
  let claudePath = null;

  if (process.platform === 'win32') {
    return { env, claudePath: 'claude' };
  }

  const shell = process.env.SHELL || '/bin/zsh';
  try {
    const out = execFileSync(shell, ['-ilc', 'printf "__RM__%s__RM__" "$PATH"; command -v claude'], {
      encoding: 'utf8',
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const parts = out.split('__RM__');
    if (parts.length >= 3) {
      env.PATH = parts[1];
      const found = parts[2].trim().split('\n').pop();
      if (found && fs.existsSync(found)) claudePath = found;
    }
  } catch {
    // Kabuk okunamazsa bilinen konumlara bakılır.
  }

  const home = os.homedir();
  const candidates = [
    path.join(home, '.local/bin/claude'),
    path.join(home, '.claude/local/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ];
  for (const c of candidates) {
    if (!claudePath && fs.existsSync(c)) claudePath = c;
  }
  return { env, claudePath };
}

const short = (s, n = 80) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const base = (p) => (p ? path.basename(String(p)) : '');

function describeTool({ name, input = {} }) {
  switch (name) {
    case 'Bash': return `Komut çalıştırıyor: ${short(input.command)}`;
    case 'Read': return `Dosya okuyor: ${base(input.file_path)}`;
    case 'Edit':
    case 'MultiEdit': return `Dosya düzenliyor: ${base(input.file_path)}`;
    case 'Write': return `Dosya yazıyor: ${base(input.file_path)}`;
    case 'NotebookEdit': return `Not defteri düzenliyor: ${base(input.notebook_path)}`;
    case 'Glob': return `Dosya arıyor: ${short(input.pattern)}`;
    case 'Grep': return `Kodda arıyor: ${short(input.pattern)}`;
    case 'WebFetch': return `Web sayfası okuyor: ${short(input.url)}`;
    case 'WebSearch': return `Web'de arıyor: ${short(input.query)}`;
    case 'Task':
    case 'Agent': return `Yardımcı ajan başlattı: ${short(input.description || input.prompt, 60)}`;
    case 'TodoWrite': return 'Yapılacaklar listesini güncelledi';
    default: return `${name} aracını kullanıyor`;
  }
}

class ClaudeSession extends EventEmitter {
  constructor({ env, cwd, sessionId, model, permissionMode }) {
    super();
    this.env = env;
    this.cwd = cwd;
    this.sessionId = sessionId || null;
    this.model = model || '';
    this.permissionMode = permissionMode || 'acceptEdits';
    this.proc = null;
    this.busy = false;
    this.stderr = '';
    this.seenBlocks = new Set();
  }

  emitEvent(ev) {
    this.emit('event', ev);
  }

  start() {
    if (!this.env.claudePath) {
      this.emitEvent({ kind: 'error', text: 'Claude Code bulunamadı. Önce Claude Code\'u kurup terminalde bir kez `claude` çalıştırın.' });
      return false;
    }
    if (!fs.existsSync(this.cwd)) {
      this.emitEvent({ kind: 'error', text: `Sohbetin klasörü bulunamadı: ${this.cwd}` });
      return false;
    }

    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode', this.permissionMode,
    ];
    if (this.model) args.push('--model', this.model);
    if (this.sessionId) args.push('--resume', this.sessionId);

    const proc = spawn(this.env.claudePath, args, {
      cwd: this.cwd,
      env: this.env.env,
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    this.proc = proc;
    this.stderr = '';

    readline.createInterface({ input: proc.stdout }).on('line', (line) => this.onLine(line));
    proc.stderr.on('data', (d) => {
      this.stderr = (this.stderr + d).slice(-4000);
    });
    proc.stdin.on('error', () => {});
    proc.on('error', (err) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.busy = false;
      this.emitEvent({ kind: 'error', text: `Claude Code başlatılamadı: ${err.message}` });
    });
    proc.on('exit', (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      if (this.busy) {
        this.busy = false;
        const tail = this.stderr.trim().slice(-800);
        this.emitEvent({ kind: 'error', text: `Claude Code beklenmedik şekilde kapandı (kod ${code}).${tail ? '\n' + tail : ''}` });
      }
    });
    return true;
  }

  send(text) {
    if (!this.proc && !this.start()) return false;
    this.busy = true;
    this.proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n');
    return true;
  }

  kill() {
    const p = this.proc;
    this.proc = null;
    this.busy = false;
    if (p) {
      try { p.stdin.end(); } catch {}
      p.kill();
    }
  }

  onLine(line) {
    let m;
    try { m = JSON.parse(line); } catch { return; }

    if (m.session_id && m.session_id !== this.sessionId) {
      this.sessionId = m.session_id;
      this.emitEvent({ kind: 'session', sessionId: m.session_id });
    }

    switch (m.type) {
      case 'stream_event': {
        if (m.parent_tool_use_id) return;
        const e = m.event;
        if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
          this.emitEvent({ kind: 'delta', text: e.delta.text });
        }
        return;
      }
      case 'assistant': {
        if (m.parent_tool_use_id) return;
        const id = m.message?.id || '';
        (m.message?.content || []).forEach((b, i) => {
          const key = `${id}:${i}`;
          if (this.seenBlocks.has(key)) return;
          if (b.type === 'text' && b.text.trim()) {
            this.seenBlocks.add(key);
            this.emitEvent({ kind: 'text', text: b.text });
          } else if (b.type === 'tool_use') {
            this.seenBlocks.add(key);
            this.emitEvent({ kind: 'tool', text: describeTool(b) });
          }
        });
        return;
      }
      case 'rate_limit_event':
        this.emitEvent({ kind: 'rate', info: m.rate_limit_info });
        return;
      case 'result':
        this.finish(m);
        return;
      default:
        if ('total_cost_usd' in m && 'stop_reason' in m) this.finish(m);
    }
  }

  finish(m) {
    this.busy = false;
    this.seenBlocks.clear();
    const errors = Array.isArray(m.errors) ? m.errors.join('\n') : '';
    this.emitEvent({
      kind: 'done',
      isError: !!m.is_error,
      errorText: m.is_error ? (errors || (typeof m.result === 'string' ? m.result : '') || 'Bir hata oluştu.') : null,
      denied: Array.isArray(m.permission_denials) ? m.permission_denials.length : 0,
    });
  }
}

module.exports = { ClaudeSession, resolveEnvironment };
