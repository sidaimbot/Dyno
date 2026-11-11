const { app } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');

const CHECK_GAP_MS = 4 * 60 * 60 * 1000;

function readFeedFile() {
  const candidates = [
    path.join(__dirname, '../../update-feed.json'),
    path.join(process.resourcesPath || '', 'update-feed.json')
  ];
  for (const file of candidates) {
    try {
      if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) { /* ignore a broken local feed file */ }
  }
  return {};
}

function createUpdater({ store, send, showActivity, log, onState }) {
  const state = {
    status: 'idle',
    version: '',
    percent: 0,
    message: '',
    ready: false,
    checking: false,
    manual: false
  };
  let configured = false;
  let scheduled = false;

  function publish() {
    try { onState?.({ ...state }); } catch (error) { log('update', error); }
    send('update:status', {
      status: state.status,
      version: state.version,
      percent: state.percent,
      message: state.message,
      ready: state.ready
    });
  }

  function setStatus(status, extra = {}) {
    Object.assign(state, extra, { status });
    publish();
  }

  function packagedWindowsInstall() {
    return app.isPackaged && process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_FILE;
  }

  function configure() {
    if (configured) return true;
    const feed = readFeedFile();
    const owner = String(process.env.UPDATE_GITHUB_OWNER || feed.owner || '').trim();
    const repo = String(process.env.UPDATE_GITHUB_REPO || feed.repo || '').trim();

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;
    // sha512 metadata checks stay on. Authenticode verification stays at the
    // electron-updater default (on). Do not point the feed at a custom HTTP URL.
    autoUpdater.logger = {
      info: message => log('update', message),
      warn: message => log('update', message),
      error: message => log('update', message),
      debug: () => {}
    };

    if (owner && repo) {
      const options = {
        provider: 'github',
        owner,
        repo,
        private: feed.private === true
      };
      if (options.private) {
        const token = process.env.GH_TOKEN || '';
        if (!token) {
          log('update', 'Private GitHub releases need GH_TOKEN in the environment. Update check skipped.');
          return false;
        }
        options.token = token;
      }
      autoUpdater.setFeedURL(options);
    }

    autoUpdater.on('checking-for-update', () => {
      state.checking = true;
      if (state.manual) setStatus('checking', { message: 'Checking for updates...' });
    });
    autoUpdater.on('update-available', info => {
      state.checking = false;
      state.manual = false;
      setStatus('available', {
        version: info?.version || '',
        percent: 0,
        message: 'A new update is available.'
      });
      showActivity('notification', {
        title: 'A new update is available.',
        message: info?.version ? `Version ${info.version} is downloading.` : 'Downloading in the background.',
        app: 'Dyno'
      }, { duration: 4200, priority: 40 });
    });
    autoUpdater.on('download-progress', progress => {
      const percent = Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0)));
      if (state.status === 'downloading' && percent === state.percent) return;
      setStatus('downloading', { percent, message: `Downloading update... ${percent}%` });
    });
    autoUpdater.on('update-downloaded', info => {
      state.checking = false;
      state.ready = true;
      state.manual = false;
      setStatus('downloaded', {
        version: info?.version || state.version,
        percent: 100,
        message: 'Update downloaded. Restart to install.'
      });
      showActivity('notification', {
        title: 'Update downloaded. Restart to install.',
        message: info?.version ? `Version ${info.version} is ready.` : 'It will also install the next time you quit.',
        app: 'Dyno'
      }, { duration: 7000, priority: 70 });
    });
    autoUpdater.on('update-not-available', () => {
      state.checking = false;
      state.manual = false;
      // Nothing to install: stay quiet instead of reporting that you are up to date.
      setStatus('latest', { message: '' });
    });
    autoUpdater.on('error', error => {
      state.checking = false;
      const manual = state.manual;
      state.manual = false;
      log('update', error?.message || error);
      // Background checks fail silently (offline, or no release published yet).
      // A check the user asked for gets one short note instead of a stuck banner.
      if (!manual) { setStatus('error', { message: '' }); return; }
      setStatus('error', { message: 'Update check failed. Try again later.' });
      showActivity('notification', {
        title: 'Update check failed.',
        message: 'You can keep using this version.',
        app: 'Dyno'
      }, { duration: 3200, priority: 40 });
    });

    configured = true;
    return true;
  }

  async function check({ manual = false } = {}) {
    if (!packagedWindowsInstall()) {
      if (manual) {
        setStatus('latest', { message: 'Updates run in the installed app.' });
      }
      return { ...state };
    }
    if (state.ready) {
      setStatus('downloaded', { message: 'Update downloaded. Restart to install.' });
      return { ...state };
    }
    if (state.checking) return { ...state };
    const last = Number(store.get('updates.lastCheck') || 0);
    if (!manual && last && Date.now() - last < CHECK_GAP_MS) return { ...state };
    if (!configure()) return { ...state };
    state.manual = !!manual;
    try {
      store.set('updates.lastCheck', Date.now());
      await autoUpdater.checkForUpdates();
    } catch (error) {
      state.checking = false;
      state.manual = false;
      log('update', error?.message || error);
      if (manual) setStatus('error', { message: 'Update check failed. Try again later.' });
    }
    return { ...state };
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    // Let the island finish appearing before the network check.
    setTimeout(() => {
      check({ manual: false }).catch(error => log('update', error));
    }, 12000);
  }

  function install() {
    if (!state.ready) return false;
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return true;
  }

  return { check, schedule, install, getState: () => ({ ...state }) };
}

module.exports = { createUpdater };
