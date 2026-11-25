// Consumes readings pushed by SysMonitor. This module used to poll on its own via
// systeminformation, whose `battery()` starts three PowerShell processes per reading
// (Win32_Battery, BatteryStaticData, BatteryFullChargedCapacity) and did so every 30 s,
// on each cable event and on every card expand.
class BatteryMonitor {
  constructor({ onChange, onError }) {
    this.onChange = onChange; this.onError = onError;
    this.prev = null; this.low = new Set(); this.snapshot = null;
  }
  push(reading) {
    if (!reading) return;
    this.snapshot = reading;
    const plugged = !!reading.charging;
    const data = { percent: reading.percent, charging: plugged, timeRemaining: reading.timeRemaining };
    // Surface both directions of the charge transition so plugging in and pulling the cable are visible.
    if (this.prev && !this.prev.charging && plugged) this.onChange('charging', data);
    else if (this.prev && this.prev.charging && !plugged) this.onChange('battery', data);
    for (const threshold of [20, 10]) {
      if (data.percent <= threshold && !plugged && !this.low.has(threshold)) {
        this.low.add(threshold); this.onChange('battery-low', { ...data, threshold });
      }
      if (data.percent > threshold + 2) this.low.delete(threshold);
    }
    this.prev = { percent: data.percent, charging: plugged };
  }
  get current() { return this.snapshot; }
  stop() { this.prev = null; this.low.clear(); }
}
module.exports = { BatteryMonitor };
