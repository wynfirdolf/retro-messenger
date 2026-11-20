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
    // GUI apps on Windows get the user's PATH; the native installer puts claude.exe in ~/.local/bin, npm puts claude.cmd in %APPDATA%\npm.
    const dirs = String(env.Path || env.PATH || '').split(path.delimiter).filter(Boolean);
    dirs.push(path.join(os.homedir(), '.local', 'bin'), path.join(process.env.APPDATA || '', 'npm'));
    for (const name of ['claude.exe', 'claude.cmd']) {
      for (const dir of dirs) {
        const p = path.join(dir, name);
        if (fs.existsSync(p)) return { env, claudePath: p };
      }
    }
    return { env, claudePath: null };
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

// Windows can only start .cmd/.bat files through cmd.exe. Arguments are quoted for cmd here;
// none of ours contain characters cmd would still expand (% ! ^ & | < >), only spaces at most.
function spawnCli(file, args, opts) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
    const q = (a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
    const line = [file, ...args].map(q).join(' ');
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...opts, windowsHide: true, windowsVerbatimArguments: true });
  }
  return spawn(file, args, { ...opts, windowsHide: true });
}

// On Windows a process started through cmd.exe keeps running when only cmd.exe is killed.
function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === 'win32' && proc.pid) {
    try {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => proc.kill());
      return;
    } catch { /* fall through */ }
  }
  proc.kill();
}

const short = (s, n = 80) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const base = (p) => (p ? path.basename(String(p)) : '');

const TOOL_KEYS = {
  Bash: ['tool.Bash', (i) => short(i.command)],
  Read: ['tool.Read', (i) => base(i.file_path)],
  Edit: ['tool.Edit', (i) => base(i.file_path)],
  MultiEdit: ['tool.Edit', (i) => base(i.file_path)],
  Write: ['tool.Write', (i) => base(i.file_path)],
  NotebookEdit: ['tool.NotebookEdit', (i) => base(i.notebook_path)],
  Glob: ['tool.Glob', (i) => short(i.pattern)],
  Grep: ['tool.Grep', (i) => short(i.pattern)],
  WebFetch: ['tool.WebFetch', (i) => short(i.url)],
  WebSearch: ['tool.WebSearch', (i) => short(i.query)],
  Task: ['tool.Task', (i) => short(i.description || i.prompt, 60)],
  Agent: ['tool.Task', (i) => short(i.description || i.prompt, 60)],
  TodoWrite: ['tool.TodoWrite', () => ''],
};

// The short thing a tool acts on (a command, a file name, a URL), for one-line notes.
function toolTarget({ name, input = {} }) {
  const entry = TOOL_KEYS[name];
  return (entry && entry[1](input || {})) || name;
}

function describeTool({ name, input = {} }, t) {
  const entry = TOOL_KEYS[name];
  if (!entry) return t('tool.other', { x: name });
  return t(entry[0], { x: entry[1](input || {}) });
}

const CHAT_SYSTEM_PROMPT = [
  'You are Claude, made by Anthropic, chatting with the user in Retro Messenger, a nostalgic instant-messenger app.',
  'This is an ordinary conversation, not a coding project: there is no project folder to work in.',
  'Reply in the language the user writes in. Be warm and natural; keep replies as short as the question allows, but give full answers when asked for detail.',
  'Markdown (bold, lists, code blocks) is rendered.',
  'You can search the web and open web pages when current or specific information would help, and read files the user attaches.',
].join(' ');

class ClaudeSession extends EventEmitter {
  constructor({ env, cwd, sessionId, model, effort, permissionMode, chatMode, t }) {
    super();
    this.chatMode = !!chatMode;
    this.t = t;
    this.env = env;
    this.cwd = cwd;
    this.sessionId = sessionId || null;
    this.model = model || '';
    this.effort = effort || '';
    // 'default' was the old name of 'manual' (ask before every change).
    this.permissionMode = permissionMode === 'default' ? 'manual' : permissionMode || 'acceptEdits';
    this.proc = null;
    this.busy = false;
    this.stderr = '';
    this.seenBlocks = new Set();
    this.costSoFar = 0;
  }

  emitEvent(ev) {
    this.emit('event', ev);
  }

  // total_cost_usd and modelUsage are cumulative for this process; `usage` is this turn only.
  emitUsage(m) {
    const u = m.usage || {};
    const turn = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    if (!turn) return;
    const models = Object.values(m.modelUsage || {});
    const cost = typeof m.total_cost_usd === 'number' ? m.total_cost_usd : 0;
    const costDelta = Math.max(0, cost - this.costSoFar);
    this.costSoFar = cost;
    this.emitEvent({
      kind: 'usage',
      turnTokens: turn,
      costDelta,
      usage: {
        context: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
        contextWindow: models.length ? models[models.length - 1].contextWindow || 0 : 0,
        model: Object.keys(m.modelUsage || {}).pop() || '',
        at: Date.now(),
      },
    });
  }

  start() {
    if (!this.env.claudePath) {
      this.emitEvent({ kind: 'error', text: this.t('err.noClaude') });
      return false;
    }
    if (!fs.existsSync(this.cwd)) {
      this.emitEvent({ kind: 'error', text: this.t('err.noFolder', { cwd: this.cwd }) });
      return false;
    }

    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      // Permission prompts come to us as control_request messages on stdout; we answer on stdin.
      '--permission-prompt-tool', 'stdio',
    ];
    if (this.chatMode) {
      // A plain Claude conversation: no coding project, only web search, web pages and reading files the user sends.
      args.push(
        '--permission-mode', 'default',
        '--tools', 'WebSearch,WebFetch,Read',
        '--allowedTools', 'WebSearch,WebFetch',
        '--strict-mcp-config',
        '--system-prompt', CHAT_SYSTEM_PROMPT,
      );
    } else {
      args.push(
        '--permission-mode', this.permissionMode,
        // Multiple-choice questions would need their own UI; Claude asks in plain text instead.
        '--disallowedTools', 'AskUserQuestion',
      );
    }
    if (this.model) args.push('--model', this.model);
    if (this.effort) args.push('--effort', this.effort);
    if (this.sessionId) args.push('--resume', this.sessionId);

    const proc = spawnCli(this.env.claudePath, args, { cwd: this.cwd, env: this.env.env });
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
      this.emitEvent({ kind: 'error', text: this.t('err.spawn', { msg: err.message }) });
    });
    proc.on('exit', (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      if (this.busy) {
        this.busy = false;
        const tail = this.stderr.trim().slice(-800);
        this.emitEvent({ kind: 'error', text: this.t('err.crashed', { code }) + (tail ? '\n' + tail : '') });
      }
    });
    return true;
  }

  // content: a string, or an array of content blocks (images + text).
  send(content) {
    if (!this.proc && !this.start()) return false;
    this.busy = true;
    this.proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
    return true;
  }

  // decision: 'allow' | 'always' | 'deny'. 'always' adds Claude's suggested rules for this session only.
  respond(requestId, decision, request) {
    if (!this.proc) return;
    let response;
    if (decision === 'deny') {
      response = { behavior: 'deny', message: 'The user declined this action in the app.' };
    } else {
      response = { behavior: 'allow', updatedInput: request.input };
      if (decision === 'always' && Array.isArray(request.suggestions) && request.suggestions.length) {
        response.updatedPermissions = request.suggestions.map((s) => ({ ...s, destination: 'session' }));
      }
    }
    this.write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
  }

  write(obj) {
    try { this.proc.stdin.write(JSON.stringify(obj) + '\n'); } catch { /* process already gone */ }
  }

  kill() {
    const p = this.proc;
    this.proc = null;
    this.busy = false;
    if (p) {
      try { p.stdin.end(); } catch {}
      killTree(p);
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
      case 'control_request': {
        const r = m.request || {};
        if (r.subtype === 'can_use_tool') {
          this.emitEvent({
            kind: 'permission',
            request: {
              id: m.request_id,
              tool: r.tool_name,
              input: r.input || {},
              description: r.description || '',
              suggestions: r.permission_suggestions || [],
              summary: describeTool({ name: r.tool_name, input: r.input || {} }, this.t),
              target: toolTarget({ name: r.tool_name, input: r.input || {} }),
            },
          });
        } else {
          this.write({ type: 'control_response', response: { subtype: 'error', request_id: m.request_id, error: `Unsupported request: ${r.subtype}` } });
        }
        return;
      }
      case 'control_cancel_request':
        this.emitEvent({ kind: 'permission-cancel', requestId: m.request_id });
        return;
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
            this.emitEvent({ kind: 'tool', text: describeTool(b, this.t) });
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
    this.emitUsage(m);
    const errors = Array.isArray(m.errors) ? m.errors.join('\n') : '';
    this.emitEvent({
      kind: 'done',
      isError: !!m.is_error,
      errorText: m.is_error ? (errors || (typeof m.result === 'string' ? m.result : '') || this.t('err.generic')) : null,
      denied: Array.isArray(m.permission_denials) ? m.permission_denials.length : 0,
    });
  }
}

module.exports = { ClaudeSession, resolveEnvironment, describeTool, spawnCli, killTree };
