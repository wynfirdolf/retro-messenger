// Custom message fonts: a `fonts` folder (in the app's data folder) where the user can drop their own
// .ttf / .otf / .woff / .woff2 files. Each one shows up as a pickable font in a conversation's "A Font"
// panel, next to the bundled ones. Unlike the bundled Google Fonts, there's no font-metrics calibration
// here, so every custom font renders at the same size as the message text.
const fs = require('fs');
const path = require('path');

const EXTS = { '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const MAX_BYTES = 20 * 1024 * 1024;

let dir = null;

function ensure(app) {
  if (!dir) dir = path.join(app.getPath('userData'), 'fonts');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* a read-only folder is reported when something tries to write */ }
  return dir;
}

const dirPath = () => dir;
const isFontFile = (name) => !!EXTS[path.extname(name).toLowerCase()];

// A readable label from a file name: "comic-sans_MS-Bold.ttf" -> "Comic Sans MS Bold".
function labelFor(fileName) {
  const base = fileName.replace(/\.[^.]+$/, '');
  const words = base.replace(/[-_]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().split(/\s+/).filter(Boolean);
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || base;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'font';
const familyFor = (fileName) => `rm-custom-${slug(fileName)}`;

function entryFor(name) {
  let size = 0;
  try { size = fs.statSync(path.join(dir, name)).size; } catch { /* listed anyway; read() will fail later if it's gone */ }
  return { id: name, label: labelFor(name), family: familyFor(name), size };
}

function list() {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter(isFontFile).map(entryFor);
}

// Copies a file the user picked into the fonts folder; returns the new entry, or null if it can't be used.
function importFile(srcPath) {
  if (!isFontFile(srcPath)) return null;
  let size = 0;
  try { size = fs.statSync(srcPath).size; } catch { return null; }
  if (!size || size > MAX_BYTES) return null;
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* already there, most likely */ }
  const ext = path.extname(srcPath);
  const base = path.basename(srcPath, ext);
  let name = path.basename(srcPath);
  let dest = path.join(dir, name);
  for (let n = 2; fs.existsSync(dest); n++) {
    name = `${base}-${n}${ext}`;
    dest = path.join(dir, name);
  }
  fs.copyFileSync(srcPath, dest);
  return entryFor(name);
}

// Deletes one custom font by its id (the file name list() returned); path.basename keeps it inside the folder.
function remove(id) {
  const name = path.basename(String(id || ''));
  if (!isFontFile(name)) return false;
  try { fs.unlinkSync(path.join(dir, name)); return true; } catch { return false; }
}

function read(id) {
  const name = path.basename(String(id || ''));
  if (!isFontFile(name)) return null;
  const p = path.join(dir, name);
  try {
    const st = fs.statSync(p);
    if (!st.isFile() || st.size === 0 || st.size > MAX_BYTES) return null;
    return { bytes: fs.readFileSync(p), mime: EXTS[path.extname(name).toLowerCase()], family: familyFor(name) };
  } catch {
    return null;
  }
}

module.exports = { EXTS, MAX_BYTES, ensure, dirPath, list, importFile, remove, read };
