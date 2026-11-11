const loudness = require('loudness');

class VolumeMonitor {
  constructor({ onChange, onError }) {
    this.onChange = onChange; this.onError = onError;
    this.timer = null; this.last = null; this.stopped = true; this.busy = false;
  }
  async poll() {
    if (this.stopped || this.busy) return;
    this.busy = true;
    try {
      const [rawValue, muted] = await Promise.all([loudness.getVolume(), loudness.getMuted()]);
      const value = Math.max(0, Math.min(100, Math.round(Number(rawValue))));
      const state = `${value}:${!!muted}`;
      if (this.last !== null && state !== this.last) this.onChange({ value, muted: !!muted });
      this.last = state;
    } catch (error) {
      // Keep polling: transient audio endpoint errors should not permanently disable the HUD.
      if (!this.reportedError) { this.reportedError = true; this.onError(error); }
    } finally {
      this.busy = false;
      if (!this.stopped) this.timer = setTimeout(() => this.poll(), 180);
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
