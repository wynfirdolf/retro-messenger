// Update checks against this project's GitHub releases.
// Windows: electron-updater downloads the installer in the background and installs it when the app quits (or on demand).
// macOS: the app isn't signed with an Apple Developer ID, so Gatekeeper won't let it swap itself in place while running.
// Instead this downloads the new .dmg in the background, and on "Install and relaunch" a small detached shell script
// waits for this process to exit, mounts the dmg, copies the new .app over the old one (stripping the quarantine
// flag it carries from the download, same as the README's manual install step), and reopens the app.
const { app, net, shell } = require('electron');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = 'wynfirdolf/retro-messenger';
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
const CHECK_EVERY = 6 * 60 * 60 * 1000;

// "0.15.0" -> [0, 15, 0]; anything after a "-" (pre-release) is ignored.
const parts = (v) => String(v).replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
function isNewer(a, b) {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

// No release published yet, or a release without update files: that just means "nothing newer", not a failure.
const isNotFound = (err) => /\b404\b|cannot find latest|no published versions/i.test(String((err && err.message) || err));

class Updater extends EventEmitter {
  constructor() {
    super();
    // status: idle | checking | uptodate | available | downloading | ready | error | dev
    this.state = { status: 'idle', version: null, percent: 0, error: null, canInstall: false, url: RELEASES_URL, checkedAt: 0 };
    this.timer = null;
    this.native = null; // electron-updater's autoUpdater, Windows only
    this.dmgPath = null; // macOS: the downloaded .dmg, once ready
    this.installing = false;
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('change', this.state);
  }

  start(getEnabled) {
    this.getEnabled = getEnabled;
    if (!app.isPackaged) {
      this.set({ status: 'dev' });
      return;
    }
    if (process.platform === 'win32') this.setupNative();
    setTimeout(() => this.autoCheck(), 8000);
    this.timer = setInterval(() => this.autoCheck(), CHECK_EVERY);
  }

  autoCheck() {
    if (this.getEnabled && this.getEnabled()) this.check();
  }

  setupNative() {
    const { autoUpdater } = require('electron-updater');
    this.native = autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking', error: null }));
    autoUpdater.on('update-available', (i) => this.set({ status: 'downloading', version: i.version, percent: 0 }));
    autoUpdater.on('update-not-available', () => this.set({ status: 'uptodate', checkedAt: Date.now() }));
    autoUpdater.on('download-progress', (p) => this.set({ status: 'downloading', percent: Math.round(p.percent || 0) }));
    autoUpdater.on('update-downloaded', (i) => this.set({ status: 'ready', version: i.version, percent: 100, canInstall: true, checkedAt: Date.now() }));
    autoUpdater.on('error', (err) => this.fail(err));
  }

  async check() {
    if (this.state.status === 'dev' || ['checking', 'downloading', 'ready'].includes(this.state.status)) return;
    if (this.native) {
      try { await this.native.checkForUpdates(); } catch (err) { this.fail(err); }
      return;
    }
    this.set({ status: 'checking', error: null });
    try {
      const rel = await this.latestRelease();
      const latest = String(rel.tag_name || '').replace(/^v/, '');
      if (!latest || !isNewer(latest, app.getVersion())) {
        this.set({ status: 'uptodate', checkedAt: Date.now() });
        return;
      }
      if (process.platform === 'darwin') await this.downloadForMac(rel, latest);
      else this.set({ status: 'available', version: latest, url: rel.html_url || RELEASES_URL, checkedAt: Date.now() });
    } catch (err) {
      this.fail(err);
    }
  }

  // The .dmg this architecture's build publishes, e.g. Retro-Messenger-0.17.0-arm64.dmg.
  findMacAsset(rel) {
    const assets = rel.assets || [];
    const arch = process.arch;
    return assets.find((a) => a.name.endsWith('.dmg') && a.name.includes(`-${arch}`)) || assets.find((a) => a.name.endsWith('.dmg'));
  }

  async downloadForMac(rel, version) {
    const asset = this.findMacAsset(rel);
    if (!asset) {
      // No macOS build in this release: fall back to pointing at the page, same as before.
      this.set({ status: 'available', version, url: rel.html_url || RELEASES_URL, checkedAt: Date.now() });
      return;
    }
    this.set({ status: 'downloading', version, percent: 0, error: null });
    const dest = path.join(app.getPath('temp'), `retro-messenger-update-${version}.dmg`);
    try {
      await this.downloadTo(asset.browser_download_url, dest, asset.size);
      this.dmgPath = dest;
      this.set({ status: 'ready', version, percent: 100, canInstall: true, checkedAt: Date.now() });
    } catch (err) {
      try { fs.unlinkSync(dest); } catch { /* nothing to clean up */ }
      this.fail(err);
    }
  }

  downloadTo(url, dest, sizeHint) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      const req = net.request({ url, redirect: 'follow' });
      req.on('response', (res) => {
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        const total = parseInt(res.headers['content-length'] || sizeHint || 0, 10);
        let received = 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          file.write(chunk);
          if (total) this.set({ status: 'downloading', percent: Math.min(99, Math.round((received / total) * 100)) });
        });
        res.on('end', () => file.end(resolve));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end();
    });
  }

  fail(err) {
    if (isNotFound(err)) this.set({ status: 'uptodate', error: null, checkedAt: Date.now() });
    else this.set({ status: 'error', error: String((err && err.message) || err).split('\n')[0].slice(0, 200) });
  }

  latestRelease() {
    return new Promise((resolve, reject) => {
      const req = net.request({ url: `https://api.github.com/repos/${REPO}/releases/latest`, headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'retro-messenger' } });
      let body = '';
      req.on('response', (res) => {
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`GitHub: HTTP ${res.statusCode}`));
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  installNow() {
    if (this.state.status !== 'ready') return;
    if (this.native) {
      this.installing = true;
      this.native.quitAndInstall(false, true);
      return;
    }
    if (process.platform === 'darwin' && this.dmgPath) this.installMac();
  }

  // Writes a small script that outlives this process, waits for it to quit, then swaps the app bundle in place
  // and reopens it — the same steps `npm run install:mac` does by hand (ditto + strip quarantine), run unattended.
  installMac() {
    const execPath = process.execPath; // .../Retro Messenger.app/Contents/MacOS/Retro Messenger
    const appBundle = execPath.replace(/\/Contents\/MacOS\/[^/]+$/, '');
    if (!appBundle.endsWith('.app')) return; // not running from a normal .app bundle (e.g. a dev build); nothing to swap
    const installDir = path.dirname(appBundle);
    const appName = path.basename(appBundle);

    const script = `#!/bin/sh
set -e
PID="$1"; DMG="$2"; APPDIR="$3"; APPNAME="$4"
while kill -0 "$PID" 2>/dev/null; do sleep 0.3; done
MOUNT=$(mktemp -d)
hdiutil attach "$DMG" -mountpoint "$MOUNT" -nobrowse -quiet
SRC=$(find "$MOUNT" -maxdepth 1 -name "*.app" | head -1)
if [ -n "$SRC" ]; then
  rm -rf "$APPDIR/$APPNAME"
  ditto "$SRC" "$APPDIR/$APPNAME"
  xattr -dr com.apple.quarantine "$APPDIR/$APPNAME" 2>/dev/null || true
fi
hdiutil detach "$MOUNT" -quiet || true
rm -f "$DMG"
open "$APPDIR/$APPNAME"
rm -f "$0"
`;
    const scriptPath = path.join(app.getPath('temp'), 'retro-messenger-install-update.sh');
    try {
      fs.writeFileSync(scriptPath, script, { mode: 0o755 });
      const child = spawn('/bin/sh', [scriptPath, String(process.pid), this.dmgPath, installDir, appName], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      this.installing = true;
      app.quit();
    } catch (err) {
      this.set({ status: 'error', error: String((err && err.message) || err).slice(0, 200) });
    }
  }
}

module.exports = new Updater();
module.exports.isNewer = isNewer;
module.exports.RELEASES_URL = RELEASES_URL;
