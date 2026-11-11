const { execFile } = require('child_process');
class BrightnessMonitor {
  constructor({ onChange, onError }) {
    this.onChange = onChange; this.onError = onError;
    this.last = null; this.timer = null; this.stopped = true; this.busy = false; this.failed = false;
  }
  query() {
    return new Promise((resolve, reject) => execFile('powershell.exe', [
      '-NoProfile','-NonInteractive','-Command',
      '$ErrorActionPreference="Stop"; (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness | Select-Object -First 1 -ExpandProperty CurrentBrightness)'
    ], { windowsHide: true, timeout: 3500, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else {
        const value = Number.parseInt(String(stdout).trim(), 10);
        Number.isFinite(value) ? resolve(Math.max(0, Math.min(100, value))) : reject(new Error('Brightness value unavailable'));
      }
    }));
  }
  async poll() {
    if (this.stopped || this.busy || this.failed) return;
    this.busy = true;
    try {
      const value = await this.query();
      if (this.last !== null && value !== this.last) this.onChange({ value });
      this.last = value;
    } catch (error) {
      // WMI brightness is unsupported on many external monitors. Disable quietly after one report.
      this.failed = true;
      this.onError(new Error(`Brightness monitoring unavailable on this display: ${error.message}`));
    } finally {
      this.busy = false;
      if (!this.stopped && !this.failed) this.timer = setTimeout(() => this.poll(), 650);
    }
  }
  start() {
    if (process.platform !== 'win32' || !this.stopped) return;
    this.stopped = false;
    this.poll();
  }
  stop() { this.stopped = true; clearTimeout(this.timer); this.timer = null; }
}
module.exports = { BrightnessMonitor };
