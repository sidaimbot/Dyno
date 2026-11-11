const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { fetchLyrics } = require('./lyrics');

function helperCandidates() {
  const names = ['smtc_helper.exe', 'smtc_helper.py'];
  const roots = [];
  // Packaged build: helpers live beside the app as extraResources.
  if (process.resourcesPath) roots.push(path.join(process.resourcesPath, 'helpers'));
  // Dev / asar-unpacked fallbacks.
  roots.push(path.join(__dirname, '../../helpers'));
  roots.push(path.join(__dirname, '../../../helpers'));
  const out = [];
  for (const root of roots) {
    for (const name of names) out.push(path.join(root, name));
  }
  return out;
}

function resolveHelper() {
  for (const candidate of helperCandidates()) {
    try { if (fs.existsSync(candidate)) return candidate; } catch (_) {}
  }
  return null;
}

function pythonLaunchers() {
  const list = [];
  if (process.env.PYTHON) list.push(process.env.PYTHON);
  // Prefer the Windows launcher, then common names.
  list.push('py', 'python', 'python3');
  return [...new Set(list)];
}

class MediaBridge {
  constructor({ onUpdate, onError, demo = false }) {
    this.onUpdate = onUpdate; this.onError = onError; this.demo = demo;
    this.child = null; this.buffer = ''; this.lastTrackKey = '';
    this.lastData = null; this.lastRaw = null; this.stopped = false; this.trackGeneration = 0; this.lastLyrics = null;
  }
  start() {
    if (this.demo || process.platform !== 'win32') {
      if (process.platform !== 'win32') this.onError(new Error('SMTC helper requires Windows; media is inactive.'));
      return;
    }
    const helper = resolveHelper();
    if (!helper) {
      this.onError(new Error('Media helper missing from the app package. Now-playing is unavailable.'));
      return;
    }
    try {
      if (helper.toLowerCase().endsWith('.exe')) {
        this.child = spawn(helper, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      } else {
        // Dev fallback only — packaged builds ship smtc_helper.exe and need no Python.
        const argsFor = (bin) => (bin === 'py' ? ['-3', helper] : [helper]);
        let started = false;
        for (const bin of pythonLaunchers()) {
          try {
            this.child = spawn(bin, argsFor(bin), { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
            started = true;
            break;
          } catch (_) { this.child = null; }
        }
        if (!started || !this.child) {
          this.onError(new Error('Could not start media helper. Packaged builds include smtc_helper.exe.'));
          return;
        }
      }
      this.child.stdout.setEncoding('utf8');
      this.child.stdout.on('data', chunk => this.consume(chunk));
      this.child.stderr.on('data', data => this.onError(new Error(String(data).trim())));
      this.child.on('error', err => this.onError(new Error(`Media helper failed to start: ${err.message}`)));
      this.child.on('exit', code => { if (!this.stopped && code) this.onError(new Error(`Media helper exited (${code}).`)); });
    } catch (e) { this.onError(e); }
  }
  // The helper reports position as of `sampled_at`; project it to the moment we forward it so
  // the renderer's clock starts from the current instant instead of a poll interval behind.
  withLivePosition(data) {
    const sampledAt = Number(data.sampled_at);
    if (!Number.isFinite(sampledAt) || !data.playing) return data;
    const skew = Date.now() / 1000 - sampledAt;
    if (!(skew > 0 && skew < 10)) return data;
    return { ...data, position: Math.max(0, (Number(data.position) || 0) + skew) };
  }
  consume(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/); this.buffer = lines.pop() || '';
    for (const line of lines) {
      try {
        const raw = JSON.parse(line);
        const data = this.withLivePosition(raw);
        this.lastRaw = raw;
        this.lastData = data;
        if (!data.title) {
          if (this.lastTrackKey) {
            this.lastTrackKey = '';
            this.lastLyrics = null;
            this.trackGeneration++;
            this.onUpdate({ ...data, ended: true, lyrics: null });
          }
          continue;
        }
        const key = `${data.title}|${data.artist}|${data.source}`;
        if (key !== this.lastTrackKey) {
          this.lastTrackKey = key;
          this.lastLyrics = null; // Never carry lyrics over from the previous track.
          const generation = ++this.trackGeneration;
          this.onUpdate({ ...data, lyrics: null });
          this.getLyrics(data).then(lyrics => {
            if (!this.stopped && generation === this.trackGeneration) {
              this.lastLyrics = lyrics;
              this.onUpdate({ ...this.withLivePosition(this.lastRaw || data), lyrics });
            }
          }).catch(this.onError);
        } else {
          this.onUpdate({ ...data, lyrics: this.lastLyrics });
        }
      } catch (e) { this.onError(e); }
    }
  }
  async getLyrics(track) {
    if (!track?.title || !track?.artist) return null;
    try {
      const result = await fetchLyrics(track);
      if (result) this.lastLyrics = result;
      return result;
    } catch (e) { this.onError(e); return null; }
  }
  control(action, value) {
    if (!this.child?.stdin?.writable) return false;
    this.child.stdin.write(JSON.stringify({ action, value }) + '\n');
    return true;
  }
  stop() { this.stopped = true; try { this.child?.kill(); } catch (_) {} }
}
module.exports = { MediaBridge };
