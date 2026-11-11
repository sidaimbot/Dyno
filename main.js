const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const si = require('systeminformation');

const store = new Store({
  defaults: {
    settings: {
      media: true, lyrics: true, volume: true, brightness: true,
      battery: true, timer: true, notifications: true, bluetooth: true,
      startWithWindows: false, position: 'top-center', offsetY: 8, dnd: false,
      animationSpeed: 1, launchHidden: false
    }
  }
});
const settings = () => store.get('settings');
let islandWindow, settingsWindow, tray, media, volume, brightness, battery, notifications;
let mediaStopTimer = null, mediaStopped = false;
let quitting = false;
let allowQuit = false;
let exitStarted = false;
let updater = null;
let idleGazeEnabled = true;
let gazeTimer = null;
const demo = process.env.ISLAND_DEMO === '1';
// Host window is larger than the island so the expanded card and its soft rim glow are not clipped.
const WIN_W = 720, WIN_H = 420;

function log(area, error) { console.warn(`[${area}]`, error?.message || error); }

function createIsland() {
  const display = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: WIN_W, height: WIN_H,
    x: Math.round(display.bounds.x + (display.bounds.width - WIN_W) / 2),
    y: display.bounds.y,
    frame: false, transparent: true, backgroundColor: '#00000000',
    alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false,
    hasShadow: false, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  islandWindow = win;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'src/renderer/index.html'));
  win.once('ready-to-show', () => {
    positionIsland();
    if (!settings().launchHidden) win.showInactive();
  });
  win.on('closed', () => { islandWindow = null; });
  return win;
}

function positionIsland() {
  if (!islandWindow || islandWindow.isDestroyed()) return;
  const display = screen.getPrimaryDisplay();
  const bounds = display.bounds;
  const s = settings();
  const x = Math.round(bounds.x + (bounds.width - WIN_W) / 2);
  const y = Math.max(bounds.y, bounds.y + Number(s.offsetY || 0));
  islandWindow.setBounds({ x, y, width: WIN_W, height: WIN_H });
  islandWindow.setAlwaysOnTop(true, 'screen-saver');
}
function registerDisplayListeners() {
  screen.on('display-metrics-changed', positionIsland);
  screen.on('display-added', positionIsland);
  screen.on('display-removed', positionIsland);
}

function send(channel, payload) {
  if (islandWindow && !islandWindow.isDestroyed())
    islandWindow.webContents.send(channel, payload);
}
function showActivity(type, data, options = {}) {
  // Bluetooth device discovery popups are intentionally disabled.
  if (type === 'bluetooth') return;
  send('activity:show', { type, data, options });
}
function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus(); return;
  }
  settingsWindow = new BrowserWindow({
    width: 440, height: 600, title: 'Dyno Settings',
    resizable: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  settingsWindow.loadFile(path.join(__dirname, 'src/renderer/settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}
function makeTray() {
  const candidates = [
    path.join(__dirname, 'assets/icons/tray.png'),
    path.join(__dirname, 'assets/icons/icon.png'),
    path.join(__dirname, 'build/icon.png')
  ];
  let icon = nativeImage.createEmpty();
  for (const iconPath of candidates) {
    if (!fs.existsSync(iconPath)) continue;
    const next = nativeImage.createFromPath(iconPath);
    if (!next.isEmpty()) { icon = next; break; }
  }
  tray = new Tray(icon);
  tray.setToolTip('Dyno');
  refreshTray();
  tray.on('click', () => {
    if (!islandWindow) return;
    islandWindow.isVisible() ? islandWindow.hide() : (positionIsland(), islandWindow.showInactive());
  });
}
function installReadyUpdate() {
  if (!updater?.getState().ready) return;
  allowQuit = true;
  quitting = true;
  exitStarted = true;
  updater.install();
}
function refreshTray() {
  if (!tray) return;
  const ready = !!updater?.getState().ready;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: islandWindow?.isVisible() ? 'Hide' : 'Show', click: () => {
      if (!islandWindow) return;
      islandWindow.isVisible() ? islandWindow.hide() : (positionIsland(), islandWindow.showInactive());
    }},
    { label: 'Start with Windows', type: 'checkbox', checked: !!settings().startWithWindows,
      click: item => setSetting('startWithWindows', item.checked) },
    { type: 'separator' },
    { label: 'Start timer…', click: () => showActivity('timer:prompt', {}, { duration: 15000 }) },
    { label: 'Settings', click: createSettingsWindow },
    { type: 'separator' },
    ready
      ? { label: 'Restart to install update', click: installReadyUpdate }
      : { label: 'Check for updates', click: () => updater?.check({ manual: true }) },
    { label: 'Quit', click: () => requestQuit() }
  ]));
}
function setSetting(key, value) {
  store.set(`settings.${key}`, value);
  if (key === 'startWithWindows') {
    app.setLoginItemSettings({ openAtLogin: !!value, path: app.getPath('exe'),
      args: value ? ['--hidden'] : [] });
  }
  send('settings:updated', settings());
  positionIsland();
  if (['media','lyrics','volume','brightness','battery','notifications'].includes(key)) {
    // Rebuild monitors after feature toggles so settings take effect immediately.
    for (const mod of [media, volume, brightness, battery, notifications]) {
      try { mod?.stop?.(); } catch (e) { log('settings-restart', e); }
    }
    startModules().catch(e => log('settings-restart', e));
  }
}
function setupIpc() {
  ipcMain.on('island:idle-watch', (_e, enabled) => { idleGazeEnabled = !!enabled; });
  ipcMain.on('island:interactive', (_e, enabled) => {
    if (islandWindow && !islandWindow.isDestroyed())
      islandWindow.setIgnoreMouseEvents(!enabled, { forward: true });
  });
  ipcMain.on('island:activity', (_e, type, data, options) => showActivity(type, data, options));
  ipcMain.handle('settings:get', () => settings());
  ipcMain.handle('settings:set', (_e, key, value) => { setSetting(key, value); return settings(); });
  ipcMain.handle('timer:start', (_e, seconds) =>
    showActivity('timer', { seconds }, { priority: 50, duration: (Number(seconds) || 0) * 1000 + 600 }));
  ipcMain.handle('media:control', async (_e, action, value) => media?.control(action, value));
  ipcMain.handle('lyrics:get', async (_e, track) => media?.getLyrics(track));
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.on('settings:open', createSettingsWindow);
  // The expanded card has its own volume slider, battery readout and clipboard action.
  ipcMain.handle('volume:get', async () => {
    const loudness = require('loudness');
    const [value, muted] = await Promise.all([loudness.getVolume(), loudness.getMuted()]);
    return { value: Math.max(0, Math.min(100, Math.round(Number(value)))), muted: !!muted };
  });
  ipcMain.handle('volume:set', async (_e, value) => {
    const loudness = require('loudness');
    const level = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    await loudness.setVolume(level);
    if (level > 0) await loudness.setMuted(false);
    return { value: level, muted: level === 0 };
  });
  ipcMain.handle('volume:mute', async (_e, muted) => {
    const loudness = require('loudness');
    await loudness.setMuted(!!muted);
    return !!muted;
  });
  ipcMain.handle('battery:get', async () => {
    try {
      const b = await si.battery();
      if (!b.hasBattery) return null;
      // A charge cap reports isCharging=false while the cable is connected; acConnected is the cable.
      return { percent: Math.round(b.percent), charging: !!(b.acConnected || b.isCharging), minutes: Number(b.timeRemaining) || 0 };
    } catch (error) { log('battery-read', error); return null; }
  });
  ipcMain.handle('network:get', async () => {
    try { return await require('./src/main/network').readNetwork(); }
    catch (error) { log('network', error); return null; }
  });
  // The Connectivity pane hands off to the Windows pages for actual joining/paring.
  ipcMain.handle('network:open', (_e, target) => {
    const pages = { wifi: 'ms-settings:network-wifi', bluetooth: 'ms-settings:bluetooth' };
    return shell.openExternal(pages[target] || 'ms-settings:network').then(() => true).catch(() => false);
  });
  ipcMain.handle('clipboard:write', (_e, text) => {
    require('electron').clipboard.writeText(String(text ?? '').slice(0, 4000));
    return true;
  });
  ipcMain.on('app:quit', () => requestQuit());
  ipcMain.handle('update:check', async () => {
    if (!updater) return { status: 'idle', message: '' };
    await updater.check({ manual: true });
    return updater.getState();
  });
  ipcMain.handle('update:state', () => updater?.getState() || { status: 'idle', message: '' });
  ipcMain.on('update:install', () => installReadyUpdate());
  ipcMain.on('island:exit-done', () => {
    allowQuit = true;
    quitting = true;
    app.quit();
  });
}
function requestQuit() {
  if (allowQuit) { app.quit(); return; }
  if (exitStarted) return;
  exitStarted = true;
  quitting = true;
  if (!islandWindow || islandWindow.isDestroyed()) {
    allowQuit = true;
    app.quit();
    return;
  }
  // Play the wrap-up animation in the renderer, then quit when it signals done.
  if (!islandWindow.isVisible()) islandWindow.showInactive();
  send('island:exit');
  clearTimeout(requestQuit.fallback);
  requestQuit.fallback = setTimeout(() => {
    allowQuit = true;
    app.quit();
  }, 900);
}

async function startModules() {
  const s = settings();
  const { MediaBridge } = require('./src/main/media');
  const { VolumeMonitor } = require('./src/main/volume');
  const { BrightnessMonitor } = require('./src/main/brightness');
  const { BatteryMonitor } = require('./src/main/battery');
  const { NotificationServer } = require('./src/main/notifications');

  clearTimeout(mediaStopTimer); mediaStopTimer = null; mediaStopped = false;
  const mediaEnded = () => {
    clearTimeout(mediaStopTimer); mediaStopTimer = null;
    send('activity:show', { type: 'media-ended', data: {}, options: {} });
  };
  media = new MediaBridge({ onUpdate: data => {
    if (!s.media) return;
    if (data.ended) { mediaStopped = false; mediaEnded(); return; }
    if (!data.title) return;
    if (!data.playing) {
      // A paused player keeps advertising the same track, so the island would sit
      // on a frozen card for as long as the app stays open. Pass the paused state
      // through for a moment, then treat the stop as the end of the session and
      // drop back to the idle eyes; playing again starts a fresh media activity.
      if (mediaStopped) return;
      showActivity('media', data, { priority: 20 });
      if (!mediaStopTimer) {
        mediaStopTimer = setTimeout(() => {
          mediaStopTimer = null; mediaStopped = true; mediaEnded();
        }, 2000);
      }
      return;
    }
    clearTimeout(mediaStopTimer); mediaStopTimer = null; mediaStopped = false;
    showActivity('media', data, { priority: 20 });
  }, onError: e => log('media', e), demo });
  if (s.media) media.start();

  if (s.volume) {
    volume = new VolumeMonitor({ onChange: data => showActivity('volume', data, { duration: 1600, priority: 100 }), onError: e => log('volume', e) });
    volume.start();
  }
  if (s.brightness) {
    brightness = new BrightnessMonitor({ onChange: data => showActivity('brightness', data, { duration: 1600, priority: 95 }), onError: e => log('brightness', e) });
    brightness.start();
  }
  if (s.battery) {
    battery = new BatteryMonitor({ onChange: (type, data) => showActivity(type, data, { duration: type === 'battery-low' ? 5000 : 3600, priority: type === 'battery-low' ? 90 : 30 }), onError: e => log('battery', e) });
    battery.start();
  }
  if (s.notifications) {
    notifications = new NotificationServer({ onNotify: data => showActivity('notification', data, { duration: 3500, priority: 80 }), onError: e => log('notifications', e) });
    notifications.start();
  }
}

async function runDemo() {
  const sequence = [
    ['media', { title: 'Midnight City', artist: 'M83', album: 'Hurry Up, We’re Dreaming', playing: true, position: 42, duration: 243, source: 'Demo Player', art: null }],
    ['volume', { value: 68, muted: false }],
    ['lyrics', { current: 'Waiting in the car', next: 'Waiting for the ride in the dark' }],
    ['charging', { percent: 82, charging: true }],
    ['timer', { seconds: 94, demo: true }]
  ];
  let i = 0;
  const tick = () => {
    if (!demo || quitting) return;
    const [type, data] = sequence[i++ % sequence.length];
    showActivity(type, data, { duration: type === 'media' ? 6500 : 2800, priority: type === 'volume' ? 100 : 20 });
    setTimeout(tick, 4300);
  };
  setTimeout(tick, 1200);
}

app.whenReady().then(async () => {
  registerDisplayListeners();
  // Windows tells us about cable changes instantly; WMI's 30 s poll is too slow and
  // isCharging alone misses unplugs once a charge cap has stopped charging.
  const pollBatterySoon = () => [1200, 4000].forEach(ms => setTimeout(
    () => battery?.poll?.().catch(e => log('battery', e)), ms));
  powerMonitor.on('on-ac', pollBatterySoon);
  powerMonitor.on('on-battery', pollBatterySoon);
  gazeTimer = setInterval(() => {
    if (!idleGazeEnabled || !islandWindow || islandWindow.isDestroyed() || !islandWindow.isVisible()) return;
    const cursor = screen.getCursorScreenPoint();
    const bounds = islandWindow.getBounds();
    send('cursor:position', { x: cursor.x - bounds.x, y: cursor.y - bounds.y });
  }, 90);
  if (process.platform !== 'win32') console.warn('Windows features are best-effort on this platform.');
  createIsland(); makeTray(); setupIpc();
  updater = require('./src/main/updater').createUpdater({
    store, send, showActivity, log,
    onState: next => { if (next.status !== refreshTray.last) { refreshTray.last = next.status; refreshTray(); } }
  });
  await startModules();
  if (demo) runDemo();
  updater.schedule();
  app.on('activate', () => { if (!islandWindow) createIsland(); });
});
app.on('before-quit', e => {
  quitting = true;
  clearInterval(gazeTimer);
  for (const mod of [media, volume, brightness, battery, notifications]) {
    try { mod?.stop?.(); } catch (err) { log('cleanup', err); }
  }
  if (allowQuit) return;
  // First quit attempt: hold off and let the island animate out.
  if (islandWindow && !islandWindow.isDestroyed()) {
    e.preventDefault();
    requestQuit();
  } else {
    allowQuit = true;
  }
});
app.on('window-all-closed', e => { /* tray app stays alive */ });
app.on('second-instance', () => {
  if (islandWindow) { islandWindow.showInactive(); positionIsland(); }
});
if (!app.requestSingleInstanceLock()) app.quit();
