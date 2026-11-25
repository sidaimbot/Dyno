const { spawn } = require('child_process');
const { EventEmitter } = require('events');

// One long-lived PowerShell feeds both readings.
//
// Every earlier approach here paid for process startup rather than for the reading:
// a fresh powershell.exe takes ~640 ms to launch (457 ms of that is startup alone), and
// systeminformation's battery() ran three of them per poll on top of that. Looping in a
// single process turns that into a few milliseconds per query, and the app holds one
// child instead of creating hundreds an hour.
const BRIGHTNESS_MS = 2000;
const BATTERY_EVERY = 3; // ticks, so ~6 s at the brightness cadence: cable changes show up quickly

function buildScript({ brightness, battery }) {
  const lines = [
    "$ErrorActionPreference='SilentlyContinue'",
    '$noBrightness=$false; $pct=\'\'; $status=\'\'; $runtime=\'\'; $tick=0'
  ];
  if (battery) lines.push('$hasBattery=$false; $batteryTicks=0');
  lines.push('while($true){');
  if (brightness) {
    lines.push(
      '  if(-not $noBrightness){',
      '    try { $value=(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1 -ExpandProperty CurrentBrightness) } catch { $value=$null }',
      '    if($null -eq $value){ $noBrightness=$true }',
      '  }'
    );
  }
  if (battery) {
    // Battery cabling changes are the interesting event, so it is read once per BATTERY_EVERY ticks.
    lines.push(
      `  if($tick -eq 0){`,
      '    try {',
      '      $bat=Get-CimInstance -Class Win32_Battery -ErrorAction Stop | Select-Object -First 1 BatteryStatus,EstimatedChargeRemaining,EstimatedRunTime',
      '      if($bat){ $hasBattery=$true; $pct=$bat.EstimatedChargeRemaining; $status=$bat.BatteryStatus; $runtime=$bat.EstimatedRunTime } else { $hasBattery=$false }',
      '    } catch { $hasBattery=$false }',
      '  }'
    );
  }
  lines.push(
    '  $tick++; if($tick -ge ' + BATTERY_EVERY + '){ $tick=0 }',
    `  $field=''; if($noBrightness){ $field='' } elseif($null -ne $value){ $field=$value }`,
    `  Write-Output "$field|$pct|$status|$runtime"`,
    '  [Console]::Out.Flush()',
    `  Start-Sleep -Milliseconds ${BRIGHTNESS_MS}`,
    '}'
  );
  return lines.join('\n');
}

class SysMonitor extends EventEmitter {
  constructor({ brightness = true, battery = true } = {}) {
    super();
    this.child = null;
    this.buffer = '';
    this.started = false;
    this.options = { brightness, battery };
    this.lastBrightness = null;
    this.lastBattery = null;
    this.snapshot = null;
  }
  start() {
    if (process.platform !== 'win32' || this.started) return;
    if (!this.options.brightness && !this.options.battery) return;
    this.started = true;
    try {
      this.child = spawn('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', buildScript(this.options)],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) { this.emit('error', error); return; }
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.consume(chunk));
    this.child.on('error', error => this.emit('error', error));
    this.child.on('exit', code => {
      if (!this.started) return;
      this.child = null;
      this.emit('error', new Error(`System reader exited (${code}).`));
    });
  }
  consume(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      const parts = line.trim().split('|');
      if (parts.length < 4) continue;
      const [rawBrightness, rawPercent, rawStatus, rawRuntime] = parts;
      const brightness = Number.parseInt(rawBrightness, 10);
      if (Number.isFinite(brightness)) {
        const value = Math.max(0, Math.min(100, brightness));
        if (this.lastBrightness !== null && value !== this.lastBrightness) this.emit('brightness', value);
        this.lastBrightness = value;
      }
      const percent = Number.parseInt(rawPercent, 10);
      const status = Number.parseInt(rawStatus, 10);
      if (Number.isFinite(percent) && Number.isFinite(status)) {
        const runtime = Number.parseInt(rawRuntime, 10);
        const reading = {
          percent: Math.max(0, Math.min(100, percent)),
          // 1 = discharging. Anything else means the cable is attached (2 = on A/C), and a
          // charge cap reports "not charging" while still plugged in, so status is the cable.
          charging: status !== 1,
          timeRemaining: Number.isFinite(runtime) && runtime < 6000 ? runtime : 0
        };
        this.snapshot = reading;
        // The reader repeats the last battery values on the ticks between reads so the
        // line layout stays fixed; only an actual change is worth forwarding.
        const previous = this.lastBattery;
        if (!previous || previous.percent !== reading.percent || previous.charging !== reading.charging) {
          this.lastBattery = reading;
          this.emit('battery', reading);
        }
      }
    }
  }
  stop() {
    this.started = false;
    if (this.child) {
      try { this.child.kill(); } catch (_) {}
      this.child = null;
    }
  }
}

module.exports = { SysMonitor };
