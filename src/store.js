// Kalıcı veri: profil ve sohbetler, kullanıcı veri klasöründe tek bir JSON dosyasında tutulur.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_MESSAGES = 500;
const DEFAULT_PROFILE = { name: '', personal: '', status: 'online', avatar: '🦊', signedIn: false, lang: 'auto', theme: 'system' };

let file = null;
let data = { profile: { ...DEFAULT_PROFILE }, chats: [] };
let timer = null;

function load(dir) {
  file = path.join(dir, 'data.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    data = {
      profile: { ...DEFAULT_PROFILE, ...(raw.profile || {}) },
      chats: Array.isArray(raw.chats) ? raw.chats : [],
    };
  } catch {
    data = { profile: { ...DEFAULT_PROFILE }, chats: [] };
  }
}

function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 300);
}

function flush() {
  clearTimeout(timer);
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(data));
  fs.renameSync(file + '.tmp', file);
}

const profile = () => data.profile;
function updateProfile(patch) {
  Object.assign(data.profile, patch);
  save();
}

const chats = () => data.chats;
const getChat = (id) => data.chats.find((c) => c.id === id) || null;

function createChat({ name, cwd, avatar, provider = 'claude' }) {
  const codex = provider === 'codex' || provider === 'codex-chat';
  const chatOnly = provider === 'claude-chat' || provider === 'codex-chat';
  const chat = {
    id: crypto.randomUUID(),
    provider,
    name,
    cwd,
    avatar: avatar || (provider === 'codex-chat' ? '💬' : codex ? '🧠' : chatOnly ? '✨' : '🤖'),
    sessionId: null,
    model: '',
    effort: '',
    permissionMode: codex ? 'workspace-write' : 'acceptEdits',
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
  data.chats.push(chat);
  save();
  return chat;
}

function updateChat(id, patch) {
  const chat = getChat(id);
  if (!chat) return null;
  Object.assign(chat, patch);
  save();
  return chat;
}

function deleteChat(id) {
  data.chats = data.chats.filter((c) => c.id !== id);
  save();
}

function addMessage(id, msg) {
  const chat = getChat(id);
  if (!chat) return null;
  const m = { ...msg, ts: Date.now() };
  chat.messages.push(m);
  if (chat.messages.length > MAX_MESSAGES) chat.messages.splice(0, chat.messages.length - MAX_MESSAGES);
  chat.updatedAt = m.ts;
  save();
  return m;
}

module.exports = { load, flush, profile, updateProfile, chats, getChat, createChat, updateChat, deleteChat, addMessage };
