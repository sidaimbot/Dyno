const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('islandAPI', {
  on: (channel, callback) => {
    const allowed = ['activity:show', 'settings:updated', 'cursor:position', 'island:exit', 'update:status'];
    if (!allowed.includes(channel)) return () => {};
    const listener = (_event, data) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  exitDone: () => ipcRenderer.send('island:exit-done'),
  setInteractive: enabled => ipcRenderer.send('island:interactive', !!enabled),
  setIdleWatch: enabled => ipcRenderer.send('island:idle-watch', !!enabled),
  activity: (type, data, options) => ipcRenderer.send('island:activity', type, data, options),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  startTimer: seconds => ipcRenderer.invoke('timer:start', seconds),
  mediaControl: (action, value) => ipcRenderer.invoke('media:control', action, value),
  getLyrics: track => ipcRenderer.invoke('lyrics:get', track),
  openSettings: () => ipcRenderer.send('settings:open'),
  version: () => ipcRenderer.invoke('app:version'),
  getVolume: () => ipcRenderer.invoke('volume:get'),
  setVolume: value => ipcRenderer.invoke('volume:set', value),
  setMuted: muted => ipcRenderer.invoke('volume:mute', muted),
  getBattery: () => ipcRenderer.invoke('battery:get'),
  getNetwork: () => ipcRenderer.invoke('network:get'),
  openNetworkSettings: target => ipcRenderer.invoke('network:open', target),
  copyText: text => ipcRenderer.invoke('clipboard:write', text),
  quit: () => ipcRenderer.send('app:quit'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.send('update:install')
});
