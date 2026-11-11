const fs = require('fs');
const path = require('path');
const https = require('https');
const { app } = require('electron');
const cacheDir = () => path.join(app.getPath('userData'), 'lyrics-cache');

// Bumped whenever matching/parsing changes so old cached entries are ignored.
const CACHE_VERSION = 3;
// A candidate must look like the same recording: title + artist, and not a different duration.
const MIN_SCORE = 55;
const VARIANT_RE = /\s*[-–—]\s*(remaster(ed)?|live|radio edit|acoustic|instrumental|mono|stereo|deluxe|explicit|edit|version|mix|demo)\b.*$/i;
const FEAT_RE = /\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i;

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Dyno/1.2 (https://lrclib.net)' },
      timeout: 9000
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; if (body.length > 2_000_000) req.destroy(new Error('LRCLIB response too large')); });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`LRCLIB HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('LRCLIB request timed out')));
    req.on('error', reject);
  });
}

function parseLrc(text) {
  const lines = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const matches = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const lyric = raw.replace(/\[[^\]]+\]/g, '').trim();
    for (const m of matches) {
      const digits = String(m[3] || '0');
      const fraction = Number(`0.${digits.padEnd(2, '0')}`);
      lines.push({ time: Number(m[1]) * 60 + Number(m[2]) + fraction, text: lyric });
    }
  }
  return lines.filter(x => x.text).sort((a, b) => a.time - b.time);
}

function normalize(result) {
  if (!result) return null;
  const lines = parseLrc(result.syncedLyrics || '');
  const plain = String(result.plainLyrics || '').trim() || null;
  if (!lines.length && !plain) return null;
  return { synced: lines.length > 0, lines, plain };
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[([][^)\]]*[)\]]/g, ' ')
    .replace(FEAT_RE, ' ')
    .replace(VARIANT_RE, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function scoreCandidate(result, track) {
  if (!result) return -Infinity;
  const wantTitle = normalizeName(track.title);
  const wantArtist = normalizeName(track.artist);
  const gotTitle = normalizeName(result.trackName);
  const gotArtist = normalizeName(result.artistName);
  if (!wantTitle || !gotTitle) return -Infinity;
  let score = 0;

  if (gotTitle === wantTitle) score += 50;
  else if (gotTitle.includes(wantTitle) || wantTitle.includes(gotTitle)) score += 22;
  else score -= 40;

  if (gotArtist && gotArtist === wantArtist) score += 45;
  else if (gotArtist && (gotArtist.includes(wantArtist) || wantArtist.includes(gotArtist))) score += 24;
  else score -= 70; // Unrelated artist means a different song, however close the title is.

  const haveDuration = Number(result.duration);
  const wantDuration = Number(track.duration);
  if (haveDuration > 0 && wantDuration > 0) {
    const delta = Math.abs(haveDuration - wantDuration);
    if (delta <= 2) score += 40;
    else if (delta <= 5) score += 22;
    else if (delta <= 10) score += 4;
    else score -= 70; // A large length difference means a different recording (live, extended, remix).
  }
  return score;
}

function pickBest(candidates, track) {
  let best = null;
  let bestScore = MIN_SCORE;
  for (const candidate of candidates) {
    const data = normalize(candidate);
    if (!data) continue;
    const score = scoreCandidate(candidate, track) + (data.synced ? 12 : 0);
    if (score > bestScore) { best = data; bestScore = score; }
  }
  return best;
}

async function fetchLyrics(track, { force = false } = {}) {
  const artist = String(track.artist || '').trim();
  const title = String(track.title || '').trim();
  if (!artist || !title) return null;
  const duration = Math.round(Number(track.duration) || 0);

  // Duration is part of the key: remasters/live versions of the same title must not share lyrics.
  const file = path.join(cacheDir(),
    `${Buffer.from(`${CACHE_VERSION}|${artist}|${title}|${track.album || ''}|${duration}`).toString('hex')}.json`);
  if (!force) {
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  }

  const params = new URLSearchParams({ artist_name: artist, track_name: title });
  if (track.album) params.set('album_name', String(track.album));
  if (duration > 0) params.set('duration', String(duration));

  let value = null;
  let exact = null;
  try {
    exact = await requestJson(`https://lrclib.net/api/get?${params.toString()}`);
    value = pickBest([exact], track);
  } catch (_) { /* exact lookup misses are expected for loose Spotify metadata */ }

  if (!value || !value.synced) {
    try {
      const searchParams = new URLSearchParams({ artist_name: artist, track_name: title });
      const found = await requestJson(`https://lrclib.net/api/search?${searchParams.toString()}`);
      if (Array.isArray(found) && found.length) {
        const ranked = value ? [exact, ...found] : found;
        const searched = pickBest(ranked.filter(Boolean), track);
        if (searched && (!value || searched.synced)) value = searched;
      }
    } catch (_) { /* keep whatever the exact lookup produced */ }
  }

  if (value) {
    try { fs.mkdirSync(cacheDir(), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); } catch (_) {}
  }
  return value;
}

module.exports = { fetchLyrics, parseLrc, normalizeName, scoreCandidate };
