// Consumes values pushed by SysMonitor. WMI brightness cannot be read without a
// PowerShell/CIM round-trip on Windows, so it is read by the shared reader process
// rather than by a poller of its own.
class BrightnessMonitor {
  constructor({ onChange, onError }) {
    this.onChange = onChange; this.onError = onError;
    this.last = null;
  }
  push(value) {
    const level = Number(value);
    if (!Number.isFinite(level)) return;
    const clamped = Math.max(0, Math.min(100, Math.round(level)));
    if (this.last !== null && clamped !== this.last) this.onChange({ value: clamped });
    this.last = clamped;
  }
  stop() { this.last = null; }
}
module.exports = { BrightnessMonitor };
