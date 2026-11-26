# Dyno

A Dynamic Island for Windows. Dyno is a small Electron companion that lives at the top of your screen: a compact pill for now-playing and system HUDs, a pair of robot eyes when nothing is happening, and a full card with media, lyrics, stats, timer, calendar, notes and connectivity when you hover.

![Release](https://img.shields.io/github/v/release/sidaimbot/Dyno?label=release)
![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D4)
![License](https://img.shields.io/badge/license-MIT-green)

## Download

Grab the 1.0.1 installer from [Releases](https://github.com/sidaimbot/Dyno/releases/latest):

- **`Dyno-1.0.1-Setup.exe`** — installs Dyno, adds Start menu and desktop shortcuts, and supports automatic updates.

The 1.0.1 release ships the NSIS installer only; there is no portable build for this version. `npm run dist` can still produce a portable executable from source, but it does not auto-update.

The build is not code-signed yet, so Windows SmartScreen may show "Unknown publisher". Choose **More info → Run anyway** if you trust the download.

> Dyno is Windows-only. It uses Windows media sessions (SMTC), WMI, PowerShell and the Windows tray.

## What's new in 1.0.1

This release is a UI and behavior pass on top of 1.0.0, plus a working update feed.

### Now-playing pill

- The media pill is wider (540 × 58 px), with artwork on the left, a single centred lyric or title, and animated waveform bars on the right.
- Lyrics are sized once per track instead of per line: Dyno measures the track's longest line and picks one size between **13.5 px and 19 px**, so the line does not pulse bigger and smaller as playback advances.
- When a track's longest line still overflows at the smallest size, every line of that track switches to a left-aligned, edge-fading treatment instead of being cropped.
- The pill's border and radius were simplified so growing and collapsing run on one smooth timeline.
- A small drag grip is always visible at the top edge of the island.

### Island interaction

- **Move the island:** double-tap the island and slide sideways. The position is session-only, so relaunching puts it back at the top centre.
- A hint on the first card open of each launch explains the gesture; it stops for good once the island is actually moved.
- Idle eyes now blink on a one-shot timer (instead of an endless animation) and only follow the pointer while idle and while the cursor is moving.
- Eyes and cursor-follow each have their own switch in Settings.

### New and reworked views

- **Today:** clock, local weather, this week's strip and a per-day to-do list.
- **Stats:** CPU, GPU and RAM dials, disk C: usage, network throughput, uptime and the top memory-using apps.
- **Notes:** a scratchpad saved locally as you type.
- **Notifications:** session history of the last 40 alerts, an unread dot, and a Clear action.
- **Connectivity:** Wi-Fi and Bluetooth cards plus rows that open the matching Windows settings page.
- **App menu:** the `+` button and the `•••` dot open a floating panel with volume, All apps, Customize, Settings, Startup, Fold in and Quit.

### Performance and behavior

- Brightness and battery share a single long-lived PowerShell reader instead of starting a new process for every reading.
- The Stats sampler runs only while the Stats card is open.
- The Wi-Fi/Bluetooth reading is cached for 15 seconds (and refreshed every 6 seconds inside the view) to avoid repeated PowerShell launches.
- Bluetooth connection popups and the Bluetooth module were removed.
- Lyrics and artwork cross-fade instead of restarting animations, clocks skip unchanged text, and the waveform is only rebuilt when its state changes.
- Media that is paused or stopped for two seconds is treated as ended, so the island returns to the idle eyes instead of holding a frozen card.

### Updates

- Updates now come from this repository's GitHub Releases through `electron-updater`.
- The release publishes `latest.yml`, the NSIS installer and its blockmap. Installed copies check about 12 seconds after launch, download in the background, and install on quit or from **Restart to install update** in the tray.
- `latest.yml` is required — the updater ignores `latest.yaml`.

## Features

### Compact pill

- Idle: a 104 × 36 px pill with two glowing robot eyes that blink and lean toward the cursor.
- Now playing: artwork, the current synced lyric (or title and artist when no synced lyrics exist), and a seven-bar waveform.
- Volume and brightness show a level bar and a matching value.
- Battery events show a real gauge: outline, percentage fill, a pulsing bolt while charging, red under 20 %, and a pop when the charge state flips.
- Notifications and timers get their own icon tiles.
- Every activity has a priority, so volume and critical alerts interrupt media, and the interrupted item resumes afterwards.

### Expanded card

Hover the island to open the card. The header holds the Wi-Fi/Bluetooth pill, date, battery gauge, 12-hour clock and menu button. The eyes belong to the idle pill and are not part of the card.

| Button | Opens |
| --- | --- |
| Home | Today: clock, weather, week strip, to-dos |
| Stats | CPU / GPU / RAM / disk / network / top apps |
| Sparkle | Synced lyrics, current line highlighted and auto-scrolled |
| Music | Now playing: artwork, lyrics, seek bar, transport controls |
| Mini player | Folds back to the compact pill |
| Clock | Focus timer with 1 / 5 / 10 / 25 minute presets, pause and reset |
| Moon | Do not disturb: banners are suppressed but alerts are still recorded |
| Message | Notification history with an unread dot and Clear |
| Copy | Copies `Title — Artist` to the clipboard |
| Document | Notes scratchpad |
| Calendar | Month calendar, Monday-first, with month paging |
| Envelope | Sends a test alert to the local notification API |
| Wi-Fi | Connectivity: Wi-Fi network and Bluetooth state |
| Volume | Master volume slider and mute |

`+` opens the app menu: volume, All apps, Customize, Settings, Startup, Fold in and Quit. <kbd>Esc</kbd> closes the menu, then leaves a tool view, then folds the card.

### Windows integration

- **Now Playing:** a bundled helper (PyInstaller build of `helpers/smtc_helper.py`) reads the current Windows SMTC session and streams JSON lines; play/pause, previous, next and seek commands go back to the player. Works with Spotify, supported browsers, VLC and other players that publish SMTC metadata.
- **Lyrics:** [LRCLIB](https://lrclib.net) `/api/get` then `/api/search`, with synced LRC parsing, plain-lyrics fallback, a disk cache and an on-demand lookup. The current and next line update from the SMTC playback position.
- **Volume:** Windows master volume and mute through `loudness`, polled about every 1.2 s with one helper run per poll, and shown as a transient speaker HUD.
- **Brightness:** best-effort WMI `WmiMonitorBrightness`, read by the shared system reader every 2 seconds.
- **Battery:** `Win32_Battery` every 6 seconds through the same reader. Plugged/unplugged transitions raise a banner, and 20 % / 10 % low-battery thresholds are watched.
- **Weather:** current conditions from Open-Meteo, with location from a one-time IP lookup. Cached for 30 minutes.
- **Network:** Wi-Fi SSID and Bluetooth radio state from a single on-demand PowerShell call.
- **Notifications:** a local HTTP endpoint, filtered into the island's own banner and history.

## Settings

Open Settings from the tray or the app menu. The Customize tile holds the live feature switches inside the island (eyes, now playing, lyrics, HUDs, battery and notifications).

- Feature switches: Now Playing, Synced lyrics, Volume HUD, Brightness HUD, Battery and charging, Timer, Local notifications.
- Eyes: show or hide, and follow the cursor or stay still.
- Appearance: top offset (0–120 px) and animation speed (0.5×–1.8×, applied to the island's 360 ms morph).
- Startup: start with Windows.

Settings are stored with `electron-store` at `%APPDATA%\dyno\config.json`. Notes, to-dos and the weather cache use the renderer's local storage.

## Using the island

- Hover the pill to expand the card; move away to collapse it.
- Double-tap and drag sideways to move the island along the top edge. Moving it is a session gesture only.
- Right-click the tray icon for Show/Hide, Start with Windows, Start timer, Settings, Check for updates and Quit.
- Clicking the tray icon toggles the island.
- Only one Dyno instance runs; launching it again shows the existing island.

## Local notification API

POST JSON to the loopback-only endpoint:

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:47831/notify `
  -ContentType 'application/json' `
  -Body '{"title":"Build complete","message":"Your export is ready.","app":"My script"}'
```

```bash
curl -X POST http://127.0.0.1:47831/notify \
  -H "Content-Type: application/json" \
  -d '{"title":"Build complete","message":"Your export is ready.","app":"My script"}'
```

The server listens on `127.0.0.1` only and is not exposed to the LAN. Fields are `title`, `message` and `app`.

## Automatic updates

Installed copies (the NSIS setup, not a portable build) update themselves from GitHub Releases:

1. Dyno checks about 12 seconds after launch. Background checks are limited to one every 4 hours; a manual check bypasses that gate.
2. A new version downloads in the background; the card shows progress briefly.
3. A downloaded update installs when you quit, or immediately from **Restart** on the card or **Restart to install update** in the tray.

To check on demand, use the tray → **Check for updates**. The tray item becomes **Restart to install update** once a download is ready. Background failures stay silent; a manual check reports a failure with one short message and stays quiet when you are already up to date.

The feed is configured by `update-feed.json` (public repository `sidaimbot/Dyno`). The release ships:

- `Dyno-<version>-Setup.exe`
- `Dyno-<version>-Setup.exe.blockmap`
- `latest.yml`

`latest.yml` is the file `electron-updater` requires and must keep that exact name; the blockmap only makes later downloads incremental. Portable builds and development runs skip updates; a manual check there reports "Updates run in the installed app."

## Build from source

### Requirements

- Windows 10 or 11 (64-bit)
- Node.js 22.12 or newer and npm (Electron 40 requires it)
- Python 3.10+ (optional, only to rebuild the SMTC media helper)

### Install and run

```powershell
npm install
npm start
```

`npm install` also runs `electron-builder install-app-deps` for native modules.

Demo mode cycles through sample media, volume, lyrics, charging and timer activities:

```powershell
npm run demo
```

### Media helper

The release bundles a prebuilt `helpers/smtc_helper.exe`. To rebuild it:

```powershell
py -m pip install --upgrade pip
py -m pip install winsdk pyinstaller
npm run build:helper
```

Without the helper, Dyno still runs; now-playing simply stays empty.

### Packaging

```powershell
npm run pack    # unpacked app for a quick test
npm run dist    # NSIS installer + portable exe in dist/
npm run release # build NSIS x64 and publish to GitHub Releases
```

`electron-builder.config.js` reads the publish target from `update-feed.json` or from `UPDATE_GITHUB_OWNER` / `UPDATE_GITHUB_REPO`. No token belongs in that file; `GH_TOKEN` is needed only to publish.

### Publishing a release

Bump `package.json` so the tag matches (`v1.0.1` for `"version": "1.0.1"`), then either push the tag or publish locally:

```powershell
$env:GH_TOKEN = "github-token-with-repo-scope"
npm run release
```

`.github/workflows/release.yml` builds the NSIS installer on a Windows runner and uploads the installer, blockmap and `latest.yml`. `electron-updater` verifies each download against the sha512 in `latest.yml`. The installer is still unsigned, so SmartScreen warns on first run; signing it is the remaining step for a warning-free install.

## Project layout

```text
dynamic-island/
  main.js                    Electron main process: windows, tray, IPC, activity routing
  preload.js                 Restricted contextBridge API for the renderer
  electron-builder.config.js  Build and publish configuration
  update-feed.json           Public GitHub update feed (owner/repo)
  build/icon.ico             App and installer icon
  assets/icons/              Tray and window icons (tray.png, icon.png, icon.ico)
  helpers/
    smtc_helper.py           Windows media-session helper source
    smtc_helper.exe          Bundled helper executable
  src/
    main/
      media.js               SMTC bridge and transport commands
      lyrics.js              LRCLIB lookup, LRC parsing, disk cache
      volume.js              Master volume and mute
      brightness.js          WMI brightness events
      battery.js             Battery state and thresholds
      sysmon.js              Shared PowerShell reader for brightness + battery
      network.js             Wi-Fi and Bluetooth state
      notifications.js       Loopback notification server
      stats.js               CPU/GPU/RAM/disk/network/top-apps sampler
      updater.js             electron-updater wrapper and state machine
    renderer/
      index.html             Island, card and view markup
      island.css             Island, card and animation styles
      island.js              Activity queue, views, lyrics fitting, drag, stats
      settings.html/.css/.js Settings window
  screenshots/               Development screenshots
  .github/workflows/         Release and repo-analysis workflows
```

## Data and privacy

Dyno has no account and no telemetry.

- Notes, to-dos and weather cache live in the renderer's local storage.
- Settings live in `%APPDATA%\dyno\config.json`.
- Lyrics requests go to `lrclib.net`; weather goes to `open-meteo.com`; the one-time location lookup goes to `ipwho.is`.
- Update checks go to GitHub Releases.
- The notification API is unauthenticated but bound to `127.0.0.1`.

## Troubleshooting

- **Island does not appear:** use the tray → **Show**. After a display change Dyno repositions itself on the primary display; check the top offset in Settings if it sits too high.
- **No media card:** make sure `helpers/smtc_helper.exe` exists and the player publishes a Windows media session.
- **No lyrics:** check access to `lrclib.net`; instrumentals and uncommon tracks may have none.
- **No brightness:** many external monitors and desktops do not expose WMI brightness.
- **No battery card:** desktop PCs without a battery are skipped.
- **Stats stay empty:** the card needs PowerShell and WMI performance counters; some locked-down systems block them.
- **Update check says updates run in the installed app:** you are running the portable build or `npm start`. Install the NSIS setup.
- **Update is not offered:** confirm the release has `latest.yml` (not `latest.yaml`), the version in `package.json` is higher, and the app was restarted after publishing.
- **Installer build fails:** run `npm install` first, build on Windows, and make sure antivirus is not locking `dist/`.
- **Native module errors:** use a supported 64-bit Node LTS release and reinstall dependencies.

## Known limitations

1. The installer is unsigned, so SmartScreen warns on first run.
2. SMTC metadata and artwork vary by player and Windows build; missing artwork falls back to a neutral tile.
3. Brightness is unavailable on most external monitors and desktops.
4. Volume is polled about every 1.2 seconds instead of hooking Windows keys, so the HUD can lag a key press slightly.
5. Weather needs an internet connection and an IP-based location; it is approximate by design.
6. Bluetooth device popups are intentionally disabled; the Connectivity view only reports radio state.
7. Portable builds do not auto-update.
8. The local notification endpoint accepts loopback POSTs without authentication.

## Security notes

The renderer runs with `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`, and reaches the system only through the allow-listed API in `preload.js`. System access and child processes stay in the main process. Do not expose the notification endpoint beyond loopback.

## License

MIT, as declared in `package.json`.
