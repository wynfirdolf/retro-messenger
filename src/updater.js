// Update checks against this project's GitHub releases.
// Windows: electron-updater downloads the installer in the background and installs it when the app quits (or on demand).
// macOS: the app is not signed with an Apple Developer ID, and macOS refuses to swap an unsigned app in place,
// so there we only look up the newest release and point the user to its download page.
const { app, net } = require('electron');
const { EventEmitter } = require('events');

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
      if (latest && isNewer(latest, app.getVersion())) this.set({ status: 'available', version: latest, url: rel.html_url || RELEASES_URL, checkedAt: Date.now() });
      else this.set({ status: 'uptodate', checkedAt: Date.now() });
    } catch (err) {
      this.fail(err);
    }
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

  // Windows: quit, run the installer, start again.
  installNow() {
    if (this.native && this.state.status === 'ready') {
      this.installing = true;
      this.native.quitAndInstall(false, true);
    }
  }
}

module.exports = new Updater();
module.exports.isNewer = isNewer;
module.exports.RELEASES_URL = RELEASES_URL;
