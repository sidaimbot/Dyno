const si = require('systeminformation');
class BatteryMonitor {
  constructor({ onChange, onError }) {
    this.onChange = onChange; this.onError = onError;
    this.timer = null; this.prev = null; this.low = new Set();
  }
  async poll() {
    const b = await si.battery();
    if (!b.hasBattery) return;
    // A charge cap (common on laptops) reports isCharging=false while the cable is
    // still connected, so the cable itself is what counts as "plugged in".
    const plugged = !!(b.acConnected || b.isCharging);
    const data = { percent: Math.round(b.percent), charging: plugged, timeRemaining: b.timeRemaining };
    // Surface both directions of the charge transition so plugging in and pulling the cable are visible.
    if (this.prev && !this.prev.charging && plugged) this.onChange('charging', data);
    else if (this.prev && this.prev.charging && !plugged) this.onChange('battery', data);
    for (const threshold of [20, 10]) {
      if (data.percent <= threshold && !plugged && !this.low.has(threshold)) {
        this.low.add(threshold); this.onChange('battery-low', { ...data, threshold });
      }
      if (data.percent > threshold + 2) this.low.delete(threshold);
    }
    this.prev = data;
  }
  start() { this.poll().catch(this.onError); this.timer = setInterval(() => this.poll().catch(this.onError), 30000); }
  stop() { clearInterval(this.timer); this.timer = null; }
}
module.exports = { BatteryMonitor };
