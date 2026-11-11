const { execFile } = require('child_process');
class BluetoothMonitor {
  constructor({ onChange, onError }) { this.onChange = onChange; this.onError = onError; this.last = new Set(); this.timer = null; this.failed = false; }
  poll() {
    return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile','-NonInteractive','-Command',
      'Get-PnpDevice -Class Bluetooth -Status OK -ErrorAction Stop | Select-Object -ExpandProperty FriendlyName'],
      { windowsHide: true, timeout: 4000 }, (err, stdout) => err ? reject(err) : resolve(new Set(stdout.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)))));
  }
  start() {
    if (process.platform !== 'win32') return;
    this.timer = setInterval(async () => {
      if (this.failed) return;
      try {
        const now = await this.poll();
        for (const name of now) if (!this.last.has(name)) this.onChange({ name, connected: true });
        for (const name of this.last) if (!now.has(name)) this.onChange({ name, connected: false });
        this.last = now;
      } catch (e) { this.failed = true; this.stop(); this.onError(new Error(`Bluetooth polling unavailable: ${e.message}`)); }
    }, 8000);
  }
  stop() { clearInterval(this.timer); this.timer = null; }
}
module.exports = { BluetoothMonitor };
