# Dyno for Windows

A small Electron desktop companion. It uses a transparent always-on-top window, a priority-based activity queue, and a plain HTML/CSS/JS renderer.

## Requirements

- Windows 10 or 11 (64-bit)
- Node.js 20.19+ or 22.12+ and npm
- Python 3.10+ for Windows SMTC media integration (optional)
- Internet access for LRCLIB lyrics lookup (optional)

## Setup

```powershell
cd dynamic-island
npm install
```

For media-session integration, install the Windows Runtime bindings:

```powershell
py -m pip install --upgrade pip
py -m pip install winsdk
```

If `py` is not available, install Python from python.org and ensure it is on PATH. The app still runs without this helper; the media activity simply remains unavailable.

## Run

```powershell
npm start
```

Demo mode cycles through sample media, volume, lyrics, charging and timer activities:

```powershell
npm run demo
```

Use the tray icon to show/hide the island, configure startup, open settings, start a timer, or quit.

## Build installer

```powershell
npx electron-builder --win
```

The NSIS installer is written to `dist/`. For an unpacked test build:

```powershell
npm run pack
```

## Features and implementation

- **Idle eyes:** the idle pill displays a pair of glowing robot eyes that blink and lean toward the global cursor. Cursor sampling is enabled only while idle and is paused for active activities.
- **Motion refinement:** compositor-friendly spring transitions, staggered waveform motion, smooth lyric crossfades/slides, animated marquee for long titles, and album-art crossfades.
- **Refined media pill:** now-playing compact mode widens to a desktop-spanning capsule with left artwork, centered lyric/title text and purple animated waveform bars. The headline auto-fits: it shrinks from 16.5 px down to 10.5 px until the whole lyric line fits the pill, so long lines are never cropped. Low-battery alerts use a red glow; volume/brightness use a clean horizontal level bar.
- **Island window:** frameless, transparent, non-resizable, skip-taskbar, screen-saver always-on-top. The window ignores mouse input except while the pointer is over the island. It is centered on the primary display and repositioned on display metric changes.
- **Activity manager:** renderer-side priority queue. Volume/brightness and critical alerts interrupt lower-priority items; queued items resume after the active item finishes.
- **Now Playing:** Python `winsdk` helper reads the current Windows SMTC session and streams JSON lines. Play/pause, previous, next and seek commands are sent back to the helper. Works with players that publish SMTC metadata (Spotify, supported browsers, VLC when its SMTC integration is active).
- **Lyrics:** LRCLIB `/api/get` then `/api/search`, with exact-match fallback, synced LRC parsing, plain-lyrics fallback, disk cache, and an on-demand lookup when the Lyrics button is pressed. Current/next lyric is updated at 200 ms intervals from the latest SMTC playback position.
- **Volume:** `loudness` polls Windows master volume/mute. A change produces a transient HUD with a drawn speaker glyph (two sound arcs, or a dimmed speaker with an × and "Muted").
- **Brightness:** best-effort WMI `WmiMonitorBrightness` polling. Unsupported external monitors/desktops silently stop polling after a logged warning.
- **Battery:** `systeminformation` checks battery state every 30 seconds, and Electron's `powerMonitor` triggers an extra reading the moment the cable changes. "Plugged" is read from `acConnected` (falling back to `isCharging`), because a charge cap reports not-charging while the cable is still connected. Both directions of a charge transition (plugged in, unplugged) raise a banner, and 20%/10% low-battery thresholds are watched. The header pill draws a real gauge: outline plus a fill that matches the percentage, a pulsing bolt while plugged in, red under 20%, and a pop animation whenever the charge state flips.
- **Timer:** countdown can be started from the tray or expanded island prompt; timer state displays a compact countdown and ring.
- **Notifications:** local HTTP API on `127.0.0.1:47831`. Windows notification listener is not used.
- **Bluetooth:** intentionally disabled; no connected/disconnected device popups are shown.
- **Settings:** `electron-store` persists feature toggles, top offset, animation speed and startup preference.
- **Calendar:** built into the expanded card as a local month view (Monday-first grid, today highlighted, month paging). It reads the system clock only; no OAuth or account is required.

## Expanded card
Hovering the island opens the full card: a Wi-Fi/Bluetooth status pill and the date on the left; battery pill, 12-hour clock and a menu button on the right, with the pair of eyes centred in the middle of the header; then either the now-playing view (full-height artwork, title and artist, the current lyric in large type with the next line beneath, elapsed/remaining time with a seek bar, transport controls) or one of the tool views. The lyric auto-fits: it starts at 26 px and steps down (down to 12 px, spilling to a third line only when a line is very long) until the whole line reads inside the column, so long lines are never cut off. The icon bar along the bottom routes every button:

| Button | Action |
| --- | --- |
| Home | Clock, date and a now-playing summary |
| Sparkle | Synced lyrics list, current line highlighted and auto-scrolled |
| Music | Now playing |
| Mini player | Folds back to the compact pill |
| Clock | Focus timer with 1/5/10/25 minute presets, pause and reset |
| Moon | Do not disturb: notification banners are suppressed but still recorded |
| Tray | Notification history with an unread dot and Clear |
| Copy | Copies `Title — Artist` to the clipboard |
| Document | Notes scratchpad, saved to local storage as you type |
| Calendar | Month calendar with today highlighted and month paging |
| Envelope | Send a test alert to the local notification API |
| Wi-Fi | Connectivity: Wi-Fi network and Bluetooth state, with rows that open the matching Windows settings |
| Volume | Master volume slider and mute |

`+` opens the app menu: a compact floating panel with the volume slider and a 3 x 2 grid of All apps, Customize, Settings, Startup, Fold in and Quit, over a dimmed card. Startup toggles the start-with-Windows preference; All apps lists the island's tool views; Customize edits the feature switches live; Quit exits the app. Escape closes the menu, then leaves a tool view, then folds the card.

### Connectivity

The Wi-Fi / Bluetooth pill in the header (or the Wi-Fi icon in the bottom bar) opens the Connectivity view: one card per radio showing the joined network name or `Off`, and two rows that hand off to the Windows Wi-Fi and Bluetooth pages for joining or pairing. Both readings come from a single PowerShell call (`Get-NetAdapter` / `Get-NetConnectionProfile` / `Get-PnpDevice`) on demand — the header pill reuses a reading for 15 seconds, and the view refreshes every 6 seconds while it is open.

## Local notification API

Send JSON to the loopback-only endpoint:

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:47831/notify `
  -ContentType 'application/json' `
  -Body '{"title":"Build complete","message":"Your export is ready.","app":"My script"}'
```

Only listens on `127.0.0.1`; it is not exposed to the LAN.

## Automatic updates

Installed copies (the NSIS setup, not the portable exe) check GitHub Releases about 12 seconds after launch, then at most once every 4 hours. Downloads run in the background. A downloaded update installs when you quit, or immediately from **Restart** / the tray item **Restart to install update**.

Updates are published to the public repository [sidaimbot/Dyno](https://github.com/sidaimbot/Dyno). `update-feed.json` already points there. Do not put a token in that file. `GH_TOKEN` is only needed in the environment when you publish a release.

```powershell
# bump package.json version, then:
$env:GH_TOKEN = "github-token-with-repo-scope"
npm run release
```

Or push a tag that matches the version (`v1.0.1` for `"version": "1.0.1"`). `.github/workflows/release.yml` builds the NSIS installer and uploads it with `latest.yml` and the blockmap. The feed is HTTPS. Update metadata is checked with the sha512 in `latest.yml`, and Windows Authenticode verification stays enabled, so release builds should be code-signed or the signature check will reject the installer.

## Known limitations

1. **Native Windows runtime not verified in this source-generation environment.** Install and test on Windows. The app is configured for Windows packaging.
2. SMTC requires `winsdk` and a media player that publishes a Windows media session. Some browser tabs or players do not expose controls/metadata.
3. Windows SMTC thumbnail extraction varies by player and Windows build. If artwork is absent, the art tile remains a neutral placeholder.
4. `loudness` and `systeminformation` rely on OS support. Volume polling is deliberately slower than key-event hooks to avoid global keyboard interception.
5. Brightness WMI is generally unavailable on desktop monitors; unsupported systems skip the feature.
6. Bluetooth polling depends on PowerShell `Get-PnpDevice` and may show adapter/paired-device entries as well as audio devices.
7. The local notification endpoint accepts loopback POSTs without authentication. Do not forward it to an untrusted network interface.
8. The initial build does not install a custom signed application icon. Add your own PNG/ICO in `assets/icons` before publishing.

## Troubleshooting

- **Window doesn't appear:** check the tray; choose Show. Try `npm start` from PowerShell to inspect logs.
- **SMTC unavailable:** run `py -m pip install winsdk`, then restart. Check that the player exposes a Windows media session in the Windows media flyout.
- **Native module install errors:** use a supported 64-bit Node.js LTS release and run `npm install` again. `loudness` may need Windows build tools depending on the Node version.
- **Brightness not detected:** many external monitors do not expose WMI brightness controls; this is expected.
- **No battery card:** desktop PCs without a battery are skipped.
- **No lyrics:** check network access to `lrclib.net`; instrumental or uncommon tracks may not have lyrics.
- **Installer build fails:** run `npm install` first, then `npx electron-builder --win` on Windows. Ensure no antivirus process is locking `dist/`.

## Project layout

```text
dynamic-island/
  package.json
  main.js
  preload.js
  src/
    main/
      media.js
      lyrics.js
      volume.js
      brightness.js
      battery.js
      notifications.js
      bluetooth.js
    renderer/
      index.html
      island.css
      island.js
      settings.html
      settings.css
      settings.js
  helpers/
    smtc_helper.py
  assets/icons/
  README.md
```

## Security notes

Renderer has `contextIsolation: true`, `nodeIntegration: false`, and a restricted preload bridge. System access and child-process execution remain in the main process. Do not expose this local notification endpoint outside loopback.


## UI polish update
The latest clean UI pass removes the always-visible empty artwork tile from non-media activities, gives charging/volume/timer/notification states their own compact icon tile, improves battery fill visibility, and replaces the earlier conflicting CSS overrides with one consistent style sheet. Lyrics now guard against restarting the same line transition on every 200 ms playback tick. The island uses a restrained 420 ms ease-out morph and simpler opacity/translation transitions to reduce the overshoot and blur that made the earlier pass feel busy.


## Latest behavior fixes
- Charging is a 3.6-second transition alert, not a permanent activity. Unplugging raises the matching "On battery" alert, and the interrupted media activity resumes afterwards.
- Bluetooth polling and all Bluetooth connection/disconnection popups are disabled.
- Lyrics are fetched on demand as well as when a track changes; failed exact LRCLIB lookups fall back to search, including plain lyrics. A stale lookup for a previous track is ignored.
- Idle eyes are two glowing robot ovals that blink periodically and drift a few pixels toward the pointer; the idle view is fully removed from layout once an activity takes over so it cannot bleed through the compact banner.
- A player that stops (or is paused) keeps advertising its track, so after a two-second grace the media activity is treated as ended and the island drops back to the idle eyes instead of holding a frozen card. Pressing play again brings the media pill back.
- The update banner is not a permanent fixture: download progress and failures show for about seven seconds and then leave, a check that finds nothing new says nothing at all, and only a downloaded update stays on screen with its Restart button until the app restarts.


## v7 visual and activity fixes
- Removed the island's broad outer drop shadows; the transparent host window remains shadowless.
- Prevented hover from opening an empty expanded panel while the activity manager is idle.
- When synced LRCLIB lyrics are available, the compact music headline shows the current lyric line and hides the artist subtitle. The song title/artist remain available in the expanded media panel.
- Kept lyrics as the compact headline during subsequent SMTC heartbeat updates, avoiding the title/artist flashing back over the lyric line.
- Volume and brightness HUDs use a shorter 1.6-second timeout, then resume the most recent queued media snapshot.
