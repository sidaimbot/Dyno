const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const loudness = require('loudness');

// On Windows `loudness` shells out to a helper exe, and getVolume()/getMuted() each
// launch a separate process. Reading both values from a single run halves that churn,
// and the slower interval keeps the monitor off the CPU: the previous 180 ms
// two-process poll created roughly eleven short-lived processes every second for the
// whole session, which is what made the rest of the machine feel sluggish. At 1200 ms
// the helper still starts less than once a second, and the HUD (1600 ms on screen)
// only shows up to about one interval later than before.
const POLL_MS = 1200;
const HELPER = 'adjust_get_current_system_volume_vista_plus.exe';

// resolve('loudness') hands back index.js, so the helper shipped beside the impl modules
// is found without depending on the package's export map.
function locateHelper() {
  try {
    const entry = require.resolve('loudness');
    const candidate = path.join(path.dirname(entry), 'impl', 'windows', HELPER);
    return fs.existsSync(candidate) ? candidate : null;
  } catch (_) { return null; }
}
const HELPER_PATH = locateHelper();

function readOnce() {
  if (!HELPER_PATH) {
    // Fallback: the public API still works, it just costs two processes per reading.
    return Promise.all([loudness.getVolume(), loudness.getMuted()])
      .then(([value, muted]) => ({ value, muted }));
  }
  return new Promise((resolve, reject) => {
    // The helper prints "<volume> <muted>" from one run.
    execFile(HELPER_PATH, [], { windowsHide: true, timeout: 2000 }, (error, stdout) => {
      if (error) { reject(error); return; }
      const [volume, muted] = String(stdout).trim().split(/\s+/);
      const level = Number.parseInt(volume, 10);
      if (!Number.isFinite(level)) { reject(new Error('Volume value unavailable')); return; }
      resolve({ value: level, muted: Boolean(Number.parseInt(muted, 10)) });
    });
  });
}

class VolumeMonitor {
  constructor({ onChange, onError }) {
    this.onChange = onChange; this.onError = onError;
    this.timer = null; this.last = null; this.stopped = true; this.busy = false;
  }
  async poll() {
    if (this.stopped || this.busy) return;
    this.busy = true;
    try {
      const { value: rawValue, muted } = await readOnce();
      const value = Math.max(0, Math.min(100, Math.round(Number(rawValue))));
      const state = `${value}:${!!muted}`;
      if (this.last !== null && state !== this.last) this.onChange({ value, muted: !!muted });
      this.last = state;
    } catch (error) {
      // Keep polling: transient audio endpoint errors should not permanently disable the HUD.
      if (!this.reportedError) { this.reportedError = true; this.onError(error); }
    } finally {
      this.busy = false;
      if (!this.stopped) this.timer = setTimeout(() => this.poll(), POLL_MS);
    }
  }
  start() {
    if (process.platform !== 'win32' || !this.stopped) return;
    this.stopped = false;
    this.poll();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
module.exports = { VolumeMonitor };
