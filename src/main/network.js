const { execFile } = require('child_process');

// One PowerShell round-trip keeps the pane responsive. The Wi-Fi profile comes from
// Get-NetConnectionProfile (locale-independent properties) and Bluetooth "on" from the
// presence of an adapter in the PnP list; paired-device names there are stale history.
const SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$wifi=@(Get-NetAdapter | Where-Object {$_.PhysicalMediaType -match '802.11' -or $_.InterfaceDescription -match 'Wi-?Fi|Wireless|WLAN'})",
  "$prof=Get-NetConnectionProfile | Where-Object { $_.InterfaceAlias -in $wifi.Name } | Select-Object -First 1",
  "$bt=@(Get-PnpDevice -Class Bluetooth -Status OK | Select-Object -ExpandProperty FriendlyName)",
  "[pscustomobject]@{wifi=($wifi.Count -gt 0);wifiUp=($wifi.Status -contains 'Up');ssid=$prof.Name;bt=@($bt)} | ConvertTo-Json -Compress"
].join('; ');

function readNetwork() {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') { resolve(null); return; }
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT],
      { windowsHide: true, timeout: 6000 }, (error, stdout) => {
        if (error) { reject(error); return; }
        try {
          const raw = JSON.parse(String(stdout).trim() || '{}');
          const names = (Array.isArray(raw.bt) ? raw.bt : [raw.bt]).filter(Boolean);
          resolve({
            wifi: { available: !!raw.wifi, connected: !!raw.wifiUp && !!raw.ssid, ssid: raw.ssid || '' },
            bluetooth: { on: names.some(name => /adapter|radio/i.test(name)) }
          });
        } catch (e) { reject(e); }
      });
  });
}

module.exports = { readNetwork };
