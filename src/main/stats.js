const { spawn } = require('child_process');
const os = require('os');

// The Stats card is the only consumer, so the reader runs only while the card is open and
// dies with it. One long-lived PowerShell process does the expensive Windows counters
// (GPU engines, VRAM, adapter throughput, process list) behind a single spawn: a fresh
// powershell.exe costs ~650 ms to start, while a repeated query in a live process costs a
// few hundred milliseconds of mostly-waiting time.
const SAMPLE_MS = 2000;
const APPS_EVERY = 3;      // ticks: the process list is the heaviest of the three reads
const PS_APPS_LIMIT = 6;

function buildScript() {
  return [
    "$ErrorActionPreference='SilentlyContinue'",
    '$inv=[Globalization.CultureInfo]::InvariantCulture',
    "$gpuName=''; $v=(Get-CimInstance Win32_VideoController | Select-Object -First 1); if($v){ $gpuName=[string]$v.Name }",
    '$i=0',
    // The GPU performance provider is the slowest to initialise, so the first line skips
    // it: the rest of the card is on screen while the counters warm up.
    '$first=$true',
    'while($true){',
    '  $gpu=0.0; $vram=0.0',
    '  if(-not $first){',
    '    foreach($x in (Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine)){',
    "      if($x.Name -like '*engtype_3D*'){ $gpu += [double]$x.UtilizationPercentage }",
    '    }',
    '    foreach($x in (Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory)){',
    '      $vram += [double]$x.DedicatedUsage',
    '    }',
    '  }',
    '  $rx=0.0; $tx=0.0',
    '  foreach($x in (Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface)){',
    '    $rx += [double]$x.BytesReceivedPersec; $tx += [double]$x.BytesSentPersec',
    '  }',
    "  $disk=Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='C:'\"",
    '  $diskTotal=0; $diskFree=0',
    '  if($disk){ $diskTotal=[double]$disk.Size; $diskFree=[double]$disk.FreeSpace }',
    '  $procs=0; $apps=\'\'',
    '  if(($i % ' + APPS_EVERY + ') -eq 0){',
    '    $list=Get-Process',
    '    $procs=@($list).Count',
    `    $apps=(($list | Group-Object ProcessName | ForEach-Object { [pscustomobject]@{ n=$_.Name; ws=($_.Group | Measure-Object WorkingSet64 -Sum).Sum } } | Sort-Object ws -Descending | Select-Object -First ${PS_APPS_LIMIT} | ForEach-Object { "$($_.n)=$([math]::Round($_.ws/1MB))" }) -join ';')`,
    '  }',
    '  $i++; $first=$false',
    '  $gpuText=$gpu.ToString($inv)',
    '  $rxText=$rx.ToString($inv)',
    '  $txText=$tx.ToString($inv)',
    '  $dtText=$diskTotal.ToString($inv)',
    '  $dfText=$diskFree.ToString($inv)',
    '  $vrText=$vram.ToString($inv)',
    '  Write-Output "$gpuText|$vrText|$rxText|$txText|$dtText|$dfText|$procs|$apps|$gpuName"',
    '  [Console]::Out.Flush()',
    '  Start-Sleep -Milliseconds ' + SAMPLE_MS,
    '}'
  ].join('\n');
}

class StatsMonitor {
  constructor({ onUpdate, onError } = {}) {
    this.onUpdate = onUpdate || (() => {});
    this.onError = onError || (() => {});
    this.child = null;
    this.buffer = '';
    this.started = false;
    this.ps = null;
    this.apps = [];
    this.procs = 0;
    this.cpuPrev = null;
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.cpuPrev = null;
    try {
      this.child = spawn('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', buildScript()],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.child.stdout.setEncoding('utf8');
      this.child.stdout.on('data', chunk => this.consume(chunk));
      this.child.stderr.resume();
      this.child.on('error', error => this.onError(error));
      this.child.on('exit', code => {
        if (!this.started) return;
        this.child = null;
        this.onError(new Error(`Stats reader exited (${code}).`));
      });
    } catch (error) {
      this.onError(error);
    }
  }

  consume(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      const parts = line.trim().split('|');
      if (parts.length < 9) continue;
      const nums = parts.slice(0, 8).map(value => Number.parseFloat(value));
      this.ps = {
        gpu: Number.isFinite(nums[0]) ? nums[0] : 0,
        vramGB: Number.isFinite(nums[1]) ? nums[1] / 1073741824 : 0,
        down: Number.isFinite(nums[2]) ? nums[2] : 0,
        up: Number.isFinite(nums[3]) ? nums[3] : 0,
        diskTotalGB: Number.isFinite(nums[4]) ? nums[4] / 1073741824 : 0,
        diskFreeGB: Number.isFinite(nums[5]) ? nums[5] / 1073741824 : 0,
        gpuName: parts[8] || 'GPU'
      };
      const procs = Number.parseInt(parts[6], 10);
      if (Number.isFinite(procs) && procs > 0) this.procs = procs;
      const apps = parts[7];
      if (apps) {
        this.apps = apps.split(';').map(entry => {
          const [name, mb] = entry.split('=');
          return { name: name || 'App', mb: Number.parseFloat(mb) || 0 };
        }).filter(app => app.mb > 0);
      }
      // The reader already pushes one line per SAMPLE_MS, so each sample is painted exactly
      // once: a timer on the same cadence only re-sent the sample it had just sent.
      this.emit();
    }
  }

  cpuPercent() {
    const cores = os.cpus();
    let idle = 0;
    let total = 0;
    for (const core of cores) {
      for (const value of Object.values(core.times)) total += value;
      idle += core.times.idle;
    }
    const previous = this.cpuPrev;
    this.cpuPrev = { idle, total };
    if (!previous) return 0;
    const deltaTotal = total - previous.total;
    const deltaIdle = idle - previous.idle;
    if (deltaTotal <= 0) return 0;
    return Math.max(0, Math.min(100, 100 * (1 - deltaIdle / deltaTotal)));
  }

  emit() {
    if (!this.started || !this.ps) return;
    const cores = os.cpus();
    const totalGB = os.totalmem() / 1073741824;
    const freeGB = os.freemem() / 1073741824;
    const usedGB = Math.max(0, totalGB - freeGB);
    this.onUpdate({
      cpu: {
        percent: this.cpuPercent(),
        name: cores[0]?.model?.replace(/\s+/g, ' ').trim() || 'CPU',
        mhz: cores[0]?.speed || 0,
        cores: cores.length
      },
      gpu: {
        percent: Math.max(0, Math.min(100, this.ps.gpu)),
        name: this.ps.gpuName,
        vramGB: this.ps.vramGB
      },
      ram: { usedGB, totalGB, freeGB, percent: totalGB ? (usedGB / totalGB) * 100 : 0 },
      disk: { usedGB: this.ps.diskTotalGB - this.ps.diskFreeGB, totalGB: this.ps.diskTotalGB },
      net: { down: this.ps.down, up: this.ps.up },
      uptime: os.uptime(),
      procs: this.procs,
      apps: this.apps
    });
  }

  stop() {
    this.started = false;
    this.ps = null;
    this.apps = [];
    this.procs = 0;
    this.buffer = '';
    if (this.child) {
      try { this.child.kill(); } catch (_) {}
      this.child = null;
    }
  }
}

module.exports = { StatsMonitor };
