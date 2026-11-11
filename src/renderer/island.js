(() => {
  const $ = id => document.getElementById(id);
  const island = $('island');
  const PLAY_PATH = 'M8.4 3.6 19.6 12 8.4 20.4z';
  const PAUSE_PATH = 'M6.8 3.4h4.5v17.2H6.8zM12.9 3.4h4.5v17.2h-4.5z';
  const ARC = 226.2;
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const PRIORITY = {
    volume: 100, brightness: 95, 'battery-low': 90, notification: 80,
    timer: 50, 'timer:prompt': 50, charging: 30, battery: 25, lyrics: 22, media: 20
  };
  const VIEW_TITLES = {
    home: 'Home', music: 'Now playing', lyrics: 'Lyrics', timer: 'Focus timer',
    calendar: 'Calendar', notes: 'Notes', alerts: 'Notifications', send: 'Send alert',
    volume: 'Volume', apps: 'All apps', customize: 'Customize', network: 'Connectivity'
  };

  class ActivityManager {
    constructor() { this.current = null; this.queue = []; this.serial = 0; this.timer = null; }
    show(type, data = {}, options = {}) {
      if (type === 'media-ended') {
        this.queue = this.queue.filter(item => item.type !== 'media');
        if (this.current?.type === 'media') this.finish(this.current.id);
        return;
      }
      const priority = options.priority ?? PRIORITY[type] ?? 10;
      const item = { type, data, priority, id: ++this.serial, duration: options.duration || 0 };
      if (this.current && this.current.type === type) { this.activate(item); return; }
      if (!this.current) this.activate(item);
      else if (priority > this.current.priority) {
        if (this.current.type !== 'idle') {
          this.queue = this.queue.filter(x => x.type !== this.current.type).concat(this.current);
        }
        this.activate(item);
      } else {
        this.queue = this.queue.filter(x => x.type !== type).concat(item);
        this.queue.sort((a, b) => b.priority - a.priority);
      }
    }
    activate(item) {
      clearTimeout(this.timer);
      this.current = item;
      render(item);
      if (item.duration) this.timer = setTimeout(() => this.finish(item.id), item.duration);
    }
    dismiss() {
      if (this.current) this.finish(this.current.id);
    }
    finish(id) {
      if (!this.current || this.current.id !== id) return;
      this.current = null;
      this.queue.sort((a, b) => b.priority - a.priority);
      const next = this.queue.shift();
      if (next) this.activate(next);
      else render({ type: 'idle', data: {}, priority: 0 });
    }
  }
  const manager = new ActivityManager();

  let expanded = false, hovering = false, hoverTimer = null;
  let mediaState = null, mediaAt = 0, activeMedia = null;
  let lyrics = null, displayedLyricIndex = -999, activeTrackKey = '', lyricLoading = false;
  let timerState = null, timerTick = null;
  let settings = { animationSpeed: 1, dnd: false };
  let lastVolume = null;
  let cardView = '';
  let battery = null;
  let alertLog = [];
  let unreadAlerts = 0;
  let calCursor = new Date();
  let volumeState = { value: 50, muted: false };
  let volumeSendTimer = null;
  let toastTimer = null;
  let updateBannerTimer = null;
  let notesSaveTimer = null;
  let lastLyricLine = -999;
  let audioCtx = null;
  let exiting = false;

  /* ---------------- helpers ---------------- */
  function playCue(kind) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const t = audioCtx.currentTime;
      const master = audioCtx.createGain();
      master.connect(audioCtx.destination);

      if (kind === 'enter') {
        // Soft rising pop as the island drops in.
        master.gain.setValueAtTime(0.0001, t);
        master.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
        master.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        const a = audioCtx.createOscillator();
        a.type = 'sine';
        a.frequency.setValueAtTime(280, t);
        a.frequency.exponentialRampToValueAtTime(660, t + 0.16);
        a.connect(master);
        const b = audioCtx.createOscillator();
        b.type = 'triangle';
        b.frequency.setValueAtTime(520, t + 0.08);
        b.frequency.exponentialRampToValueAtTime(880, t + 0.22);
        const bg = audioCtx.createGain();
        bg.gain.setValueAtTime(0.0001, t + 0.08);
        bg.gain.exponentialRampToValueAtTime(0.12, t + 0.1);
        bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        b.connect(bg); bg.connect(audioCtx.destination);
        a.start(t); a.stop(t + 0.3);
        b.start(t + 0.08); b.stop(t + 0.3);
      } else {
        // Descending wrap as it slips away.
        master.gain.setValueAtTime(0.0001, t);
        master.gain.exponentialRampToValueAtTime(0.2, t + 0.015);
        master.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
        const a = audioCtx.createOscillator();
        a.type = 'sine';
        a.frequency.setValueAtTime(640, t);
        a.frequency.exponentialRampToValueAtTime(180, t + 0.28);
        a.connect(master);
        const b = audioCtx.createOscillator();
        b.type = 'triangle';
        b.frequency.setValueAtTime(420, t + 0.04);
        b.frequency.exponentialRampToValueAtTime(120, t + 0.3);
        const bg = audioCtx.createGain();
        bg.gain.setValueAtTime(0.0001, t + 0.04);
        bg.gain.exponentialRampToValueAtTime(0.1, t + 0.06);
        bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
        b.connect(bg); bg.connect(audioCtx.destination);
        a.start(t); a.stop(t + 0.34);
        b.start(t + 0.04); b.stop(t + 0.34);
      }
    } catch (_) { /* audio optional */ }
  }

  function wakeEyes() {
    island.classList.remove('waking');
    void island.offsetWidth;
    island.classList.add('waking');
    clearTimeout(wakeEyes.timer);
    wakeEyes.timer = setTimeout(() => island.classList.remove('waking'), 860);
  }

  function finishEnter() {
    if (!island.classList.contains('entering')) return;
    island.classList.remove('entering');
    wakeEyes();
  }

  function playExit() {
    if (exiting) return;
    exiting = true;
    playCue('exit');
    closeMenu();
    if (expanded) collapse();
    island.classList.remove('entering', 'waking');
    island.classList.add('exiting');
    let done = false;
    const complete = () => {
      if (done) return;
      done = true;
      window.islandAPI.exitDone();
    };
    island.addEventListener('animationend', event => {
      if (event.animationName === 'islandExit') complete();
    }, { once: true });
    setTimeout(complete, 720);
  }

  function setText(el, value) {
    if (!el) return;
    const next = String(value ?? '');
    if (el.textContent === next) return;
    el.textContent = next;
  }
  function setSmoothLine(el, value) {
    const next = String(value ?? '');
    if (el.dataset.targetText === next) return;
    el.dataset.targetText = next;
    el.getAnimations().forEach(animation => animation.cancel());
    el.animate(
      [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-8px)' }],
      { duration: 130, easing: 'ease-in', fill: 'forwards' }
    ).onfinish = () => {
      el.textContent = next;
      el.animate(
        [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' }
      );
    };
  }
  function setArt(img, src) {
    const url = src || '';
    if ((img.dataset.src || '') === url) return;
    img.classList.add('art-swapping');
    setTimeout(() => {
      img.src = url;
      img.dataset.src = url;
      requestAnimationFrame(() => requestAnimationFrame(() => img.classList.remove('art-swapping')));
    }, 90);
    applyArtTint(url);
  }

  /* ---------------- artwork colour ---------------- */
  const tintCache = new Map();
  function artTint(src) {
    if (!src) return Promise.resolve(null);
    if (tintCache.has(src)) return Promise.resolve(tintCache.get(src));
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => {
        try {
          const size = 24;
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = size;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(image, 0, 0, size, size);
          const data = ctx.getImageData(0, 0, size, size).data;
          let r = 0, g = 0, b = 0, weights = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 40) continue;
            const red = data[i], green = data[i + 1], blue = data[i + 2];
            const max = Math.max(red, green, blue), min = Math.min(red, green, blue);
            const saturation = (max - min) / 255;
            const luma = (red * 0.299 + green * 0.587 + blue * 0.114) / 255;
            const weight = 0.06 + saturation * saturation * (0.4 + luma);
            r += red * weight; g += green * weight; b += blue * weight; weights += weight;
          }
          if (!weights) { resolve(null); return; }
          const base = [r, g, b].map(v => Math.round(Math.min(235, Math.max(30, v / weights))));
          const tint = { rgb: base, light: base.map(v => Math.round(v + (255 - v) * 0.5)) };
          tintCache.set(src, tint);
          if (tintCache.size > 24) tintCache.delete(tintCache.keys().next().value);
          resolve(tint);
        } catch (_) { resolve(null); }
      };
      image.onerror = () => resolve(null);
      image.src = src;
    });
  }
  let tintToken = 0;
  async function applyArtTint(src) {
    const token = ++tintToken;
    const tint = await artTint(src);
    if (token !== tintToken) return;
    const base = tint ? tint.rgb : [190, 190, 202];
    const light = tint ? tint.light : [255, 255, 255];
    island.style.setProperty('--tint', base.join(','));
    island.style.setProperty('--tint-light', light.join(','));
  }
  function compactRight(html) { $('compactRight').innerHTML = html; }
  function wave(playing) {
    return `<div class="wave${playing ? '' : ' paused'}">${'<i></i>'.repeat(7)}</div>`;
  }
  function fmt(n) {
    const value = Math.max(0, Math.floor(Number(n) || 0));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  }
  function clock12(date) {
    const hours = date.getHours() % 12 || 12;
    return `${hours}:${String(date.getMinutes()).padStart(2, '0')} ${date.getHours() < 12 ? 'AM' : 'PM'}`;
  }
  function prettySource(source) {
    const raw = String(source || '').trim();
    if (!raw) return 'Media';
    return raw.replace(/\.exe$/i, '').replace(/^.*[\\/]/, '').replace(/[_]+/g, ' ').slice(0, 20) || 'Media';
  }
  function trackKeyOf(data) {
    return `${data?.artist || ''}|${data?.title || ''}|${data?.source || ''}`;
  }
  function renderUpdate(status) {
    const banner = $('updateBanner');
    const text = $('updateText');
    const restart = $('updateRestart');
    if (!banner || !status) return;
    const message = String(status.message || '').trim();
    const ready = status.status === 'downloaded' || status.ready === true;
    // Only a finished download stays on screen and offers Restart. Progress and
    // failures are short notes, and "already up to date" stays silent.
    const visible = !!message && status.status !== 'idle' && status.status !== 'latest';
    clearTimeout(updateBannerTimer);
    updateBannerTimer = null;
    banner.hidden = !visible;
    if (text) text.textContent = message;
    if (restart) restart.hidden = !ready;
    if (visible && !ready) {
      updateBannerTimer = setTimeout(() => { banner.hidden = true; }, 7000);
    }
  }

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 1700);
  }

  /* ---------------- playback clock ---------------- */
  function currentPosition() {
    if (!mediaState) return 0;
    const duration = Number(mediaState.duration) || 0;
    let position = Number(mediaState.position) || 0;
    if (mediaState.playing) position += Math.max(0, (Date.now() - mediaAt) / 1000);
    if (duration > 0) position = Math.min(position, duration);
    return Math.max(0, position);
  }
  function lyricIndex(position) {
    if (!lyrics?.synced) return -1;
    const lines = lyrics.lines;
    let index = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= position) index = i;
      else break;
    }
    return index;
  }

  /* ---------------- modes ---------------- */
  function setMode(mode) {
    island.classList.remove('idle', 'compact', 'expanded');
    island.classList.add(mode);
    expanded = mode === 'expanded';
  }
  function landingView() {
    return mediaState?.title ? 'music' : 'home';
  }
  function expand() {
    clearTimeout(hoverTimer);
    setMode('expanded');
    const type = manager.current?.type;
    if (type) island.dataset.kind = type;
    else island.removeAttribute('data-kind');
    closeMenu();
    refreshBattery();
    refreshNetwork();
    updateHeader();
    setCardView(cardView || landingView());
    requestAnimationFrame(fitLyric);
  }
  function collapse() {
    const type = manager.current?.type;
    setMode(type ? 'compact' : 'idle');
    closeMenu();
    if (!type) island.removeAttribute('data-kind');
    requestAnimationFrame(() => {
      if (island.classList.contains('lyrics-line')) fitCompactLine(compactFitText || $('compactTitle').textContent);
    });
  }

  /* ---------------- compact render ---------------- */
  function resetCompact() {
    island.classList.remove('lyrics-line');
    resetCompactFit();
    const icon = $('compactIcon');
    icon.hidden = false;
    icon.classList.remove('bare', 'is-muted');
    icon.textContent = '✦';
    $('compactArt').hidden = true;
    $('compactCopy').hidden = false;
    $('compactBar').hidden = true;
    $('compactRight').textContent = '';
  }
  function render(item) {
    const { type, data } = item;
    window.islandAPI.setIdleWatch(type === 'idle');
    if (type === 'idle') {
      island.removeAttribute('data-kind');
      setMode(hovering ? 'expanded' : 'idle');
      if (hovering) { updateHeader(); setCardView(cardView || landingView()); }
      return;
    }
    island.dataset.kind = type;
    island.style.setProperty('--speed', `${Math.round(460 / (settings.animationSpeed || 1))}ms`);
    island.classList.remove('lyrics-line');
    setMode(expanded ? 'expanded' : 'compact');
    resetCompact();
    if (type === 'media') renderCompactMedia();
    else if (type === 'volume' || type === 'brightness') renderCompactHud(type, data);
    else if (type === 'notification') renderNotice(data);
    else if (type === 'timer' || type === 'timer:prompt') renderTimer(type, data);
    else if (type === 'charging' || type === 'battery' || type === 'battery-low') renderBattery(type, data);
    else if (type === 'lyrics') renderLegacyLyrics(data);
    if (expanded) { updateHeader(); updateCard(); }
  }

  function renderCompactMedia() {
    const media = mediaState || activeMedia || {};
    activeMedia = media;
    $('compactIcon').hidden = true;
    $('compactArt').hidden = false;
    setArt($('compactArt'), media.art);
    if (lyrics && lyrics.synced) showCurrentLyric();
    else {
      island.classList.remove('lyrics-line');
      setText($('compactTitle'), media.title || 'Nothing playing');
      setText($('compactSubtitle'), media.artist || prettySource(media.source));
    }
    compactRight(wave(!!media.playing));
  }

  // Speaker glyph shared by the volume HUD: one wedge plus level-dependent arcs.
  function volumeIcon(value, muted) {
    // Fixed two-arc speaker, the way Windows and macOS draw their volume HUD.
    const waves = muted || value <= 0 ? ''
      : '<path class="wave" d="M14.6 8.6a5.1 5.1 0 0 1 0 6.8"/><path class="wave" d="M17.9 5.6a9.6 9.6 0 0 1 0 12.8"/>';
    const cross = muted ? '<path class="wave" d="M15.6 9.6 19.4 14.4M19.4 9.6 15.6 14.4"/>' : '';
    return '<svg class="vol-lg" viewBox="0 0 25 24" aria-hidden="true">' +
      '<path class="body" d="M3 8.3h3.9l4.7-4v15.4l-4.7-4H3z"/>' +
      waves + cross + '</svg>';
  }

  function renderCompactHud(type, data) {
    const value = Math.max(0, Math.min(100, Math.round(Number(data.value) || 0)));
    const muted = type === 'volume' && !!data.muted;
    const icon = $('compactIcon');
    icon.classList.add('bare');
    icon.classList.toggle('is-muted', muted);
    if (type === 'volume') icon.innerHTML = volumeIcon(value, muted);
    else icon.textContent = '☀';
    $('compactCopy').hidden = true;
    $('compactBar').hidden = false;
    $('compactFill').style.width = `${value}%`;
    compactRight(muted ? 'Muted' : `${value}%`);
    lastVolume = { value, muted };
    if (type === 'volume') {
      volumeState = { value, muted };
      applyVolumeUi();
    }
  }

  function renderNotice(data) {
    $('compactIcon').textContent = '●';
    setText($('compactTitle'), data.title || 'Notification');
    setText($('compactSubtitle'), data.message || data.app || '');
  }

  function renderTimer(type, data) {
    $('compactIcon').textContent = '◷';
    if (type === 'timer:prompt') {
      setText($('compactTitle'), 'Start timer');
      setText($('compactSubtitle'), 'Choose a duration');
      compactRight('◷');
      return;
    }
    setText($('compactTitle'), 'Timer');
    if (!timerState) startTimer(Math.max(1, Number(data?.seconds) || 60));
    else updateTimerUi();
  }

  // Battery gauge markup shared by the header pill and the compact banner icon.
  function batteryGauge(percent, cls = '') {
    return `<svg class="${cls}" viewBox="0 0 26.4 13.6" aria-hidden="true">` +
      '<rect class="shell" x=".7" y=".7" width="20.4" height="12.2" rx="3.8"/>' +
      `<rect class="fill" x="2.5" y="2.5" width="${(16.8 * percent / 100).toFixed(2)}" height="8.6" rx="2.4"/>` +
      '<rect class="tip" x="22.1" y="4.7" width="2" height="4.2" rx="1"/></svg>';
  }
  const BOLT = '<span class="bolt">' +
    '<svg viewBox="0 0 24 24" style="width:11px;height:14px;fill:currentColor"><path d="M13.6 1.6 5.2 13.1h4.9L9.4 22.4l8.6-12.1h-5z"/></svg></span>';

  function renderBattery(type, data) {
    const percent = Math.max(0, Math.min(100, Math.round(Number(data.percent) || 0)));
    const charging = !!data.charging;
    battery = { percent, charging, minutes: Number(data.timeRemaining ?? data.minutes) || Number(battery?.minutes) || 0 };
    renderBatteryPill();
    island.dataset.level = type === 'battery-low' ? 'low' : charging ? 'charging' : 'normal';
    const icon = $('compactIcon');
    icon.textContent = '';
    if (type === 'battery-low') icon.textContent = '!';
    else icon.innerHTML = batteryGauge(percent, 'batt-lg');
    if (type === 'battery-low') {
      setText($('compactTitle'), `Only ${percent}% battery left`);
      setText($('compactSubtitle'), 'Plug in your charger!');
    } else {
      setText($('compactTitle'), charging ? 'Charging' : 'On battery');
      setText($('compactSubtitle'), `${percent}%${charging ? ' · plugged in' : ' · unplugged'}`);
      const remaining = Number(battery.minutes) || 0;
      const left = remaining > 0
        ? (remaining >= 60 ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : `${remaining}m`)
        : '';
      compactRight(charging ? BOLT : left);
    }
  }

  function renderLegacyLyrics(data) {
    $('compactIcon').textContent = '♫';
    setText($('compactTitle'), data.current || 'No lyrics found');
    setText($('compactSubtitle'), data.next || '');
  }

  /* ---------------- header ---------------- */
  function updateHeader() {
    const now = new Date();
    const date = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
      .replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    setText($('headDate'), date.toUpperCase());
    setText($('headClock'), clock12(now));
    setText($('homeTime'), clock12(now));
    setText($('homeDate'), now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }));
  }

  async function refreshBattery() {
    try { battery = await window.islandAPI.getBattery(); }
    catch (_) { battery = null; }
    renderBatteryPill();
  }
  function renderBatteryPill() {
    const pill = $('headBattery');
    if (!battery) { pill.hidden = true; return; }
    const percent = Math.max(0, Math.min(100, Math.round(Number(battery.percent) || 0)));
    const charging = !!battery.charging;
    const state = charging ? 'charging' : percent <= 20 ? 'low' : 'normal';
    pill.hidden = false;
    // A charge state that just flipped gets one pop, so plugging in and pulling the cable are both visible.
    if (pill.dataset.state && pill.dataset.state !== state) {
      pill.classList.remove('changed');
      void pill.offsetWidth;
      pill.classList.add('changed');
      clearTimeout(renderBatteryPill.popTimer);
      renderBatteryPill.popTimer = setTimeout(() => pill.classList.remove('changed'), 900);
    }
    pill.dataset.state = state;
    $('headBatteryFill').setAttribute('width', (16.8 * percent / 100).toFixed(2));
    $('headBatteryBolt').toggleAttribute('hidden', !charging);
    setText($('headBatteryPct'), `${percent}%`);
    if (!charging && battery.minutes > 0) {
      const hours = Math.floor(battery.minutes / 60);
      setText($('headBatteryTime'), `· ${hours}:${String(battery.minutes % 60).padStart(2, '0')}`);
    } else setText($('headBatteryTime'), '');
    pill.title = charging ? `Charging · ${percent}%` : `Battery · ${percent}%`;
  }

  /* ---------------- card views ---------------- */
  const viewLoaders = {
    lyrics: renderLyricsPane,
    calendar: renderCalendar,
    notes: loadNotes,
    alerts: renderAlerts,
    volume: refreshVolume,
    apps: renderApps,
    customize: renderCustomize,
    network: renderNetwork,
    timer: renderTimerPane,
    music: updateCard,
    home: updateCard
  };
  function setCardView(name) {
    if (!VIEW_TITLES[name]) name = landingView();
    cardView = name;
    island.dataset.view = name;
    document.querySelectorAll('.view-pane').forEach(pane => {
      pane.classList.toggle('active', pane.dataset.view === name);
    });
    document.querySelectorAll('.nav-btn[data-goto]').forEach(button => {
      button.classList.toggle('active', button.dataset.goto === name);
    });
    closeMenu();
    if (name !== 'network') clearInterval(netTimer);
    if (name === 'alerts') { unreadAlerts = 0; renderAlertBadge(); }
    updateCard();
    viewLoaders[name]?.();
    if (name === 'music') { lyricFitKey = ''; requestAnimationFrame(fitLyric); }
  }

  /* ---------------- now playing ---------------- */
  function updateCard() {
    const media = mediaState || {};
    const has = !!media.title;
    const art = media.art || '';

    setText($('mediaTitle'), has ? media.title : 'Nothing playing');
    setText($('mediaArtist'), has ? (media.artist || prettySource(media.source)) : 'No active session');

    const bigArt = $('bigArt');
    if (art) setArt(bigArt, art);
    bigArt.hidden = !art;
    $('artPlaceholder').hidden = !!art;

    updateLyricText();
    updateTimeline();
    $('playPausePath').setAttribute('d', media.playing ? PAUSE_PATH : PLAY_PATH);
    $('homePlayPath').setAttribute('d', media.playing ? PAUSE_PATH : PLAY_PATH);

    setText($('homeTitle'), has ? media.title : 'Nothing playing');
    setText($('homeArtist'), has ? `${media.artist || 'Unknown artist'} · ${prettySource(media.source)}` : 'Open a player to begin');
    const homeArt = $('homeArt');
    if (art) {
      if ((homeArt.dataset.src || '') !== art) { homeArt.src = art; homeArt.dataset.src = art; }
      homeArt.hidden = false;
    } else {
      homeArt.hidden = true;
      homeArt.dataset.src = '';
      homeArt.removeAttribute('src');
    }
  }

  function updateTimeline() {
    if (!mediaState) return;
    const position = currentPosition();
    const duration = Number(mediaState.duration) || 0;
    const seek = $('seek');
    seek.max = duration || 100;
    if (document.activeElement !== seek) seek.value = Math.min(position, duration || 100);
    const progress = duration > 0 ? Math.max(0, Math.min(100, (position / duration) * 100)) : 0;
    seek.style.setProperty('--p', `${progress}%`);
    setText($('tElapsed'), fmt(position));
    setText($('tRemain'), `-${fmt(Math.max(0, duration - position))}`);
  }

  /* Shrinks the hero lyric until it reads inside two lines, so a long line
     never overflows and a short one stays big and bold. */
  const LYRIC_MAX = 26, LYRIC_MIN = 12, LYRIC_GAP = 7;
  let lyricFitKey = '';
  function fitLyric() {
    const el = $('bigLyric');
    if (!el || !el.clientWidth) return;
    const box = el.parentElement;
    if (!box || box.clientHeight < 40) return;
    const next = $('nextLyric');
    const room = box.clientHeight - (next && !next.hidden ? next.offsetHeight + LYRIC_GAP : 0);
    const key = `${el.textContent}|${el.clientWidth}|${Math.round(room)}`;
    if (key === lyricFitKey) return;
    lyricFitKey = key;
    const apply = size => {
      el.style.fontSize = `${size}px`;
      el.style.letterSpacing = `${(-size * 0.035).toFixed(2)}px`;
    };
    const tryFit = lines => {
      for (let size = LYRIC_MAX; size >= LYRIC_MIN; size -= 1) {
        apply(size);
        el.style.maxHeight = `${Math.round(size * 1.12 * lines + 2)}px`;
        if (el.scrollHeight <= el.clientHeight + 2) return true;
      }
      return false;
    };
    if (tryFit(2) || tryFit(3)) return;
    apply(LYRIC_MIN);
    el.style.maxHeight = `${Math.round(LYRIC_MIN * 1.12 * 3 + 2)}px`;
  }

  /* the compact pill headline: shrink until the whole line fits the pill */
  const COMPACT_MAX = 16.5, COMPACT_MIN = 11;
  const compactFitCache = new Map();
  let compactFitText = '';
  function fitCompactLine(text) {
    const el = $('compactTitle');
    if (!el) return;
    const value = String(text ?? el.textContent ?? '');
    compactFitText = value;
    // Zero while the card is open (the pill is display:none) and still the card's
    // width on the first frames of the collapse, so the observer below refits
    // once the pill has its real width instead of baking a wrong size in.
    if (!$('compactCopy')?.clientWidth || !el.clientWidth) return;
    const key = `${value}|${el.clientWidth}`;
    let size = compactFitCache.get(key);
    if (!size) {
      // Measure the lyric element itself: it is already laid out at the pill's
      // real width, so the size comes from what will actually be drawn and can
      // never disagree with the box the text ends up clipped in.
      const shown = el.textContent;
      const swap = shown !== value;
      if (swap) el.textContent = value;
      size = COMPACT_MIN;
      for (let candidate = COMPACT_MAX; candidate > COMPACT_MIN; candidate -= 0.5) {
        el.style.fontSize = `${candidate}px`;
        el.style.letterSpacing = `${(-candidate * 0.021).toFixed(2)}px`;
        if (el.scrollWidth <= el.clientWidth + 0.5) { size = candidate; break; }
      }
      if (swap) el.textContent = shown;
      if (compactFitCache.size > 60) compactFitCache.clear();
      compactFitCache.set(key, size);
    }
    el.style.fontSize = `${size}px`;
    el.style.letterSpacing = `${(-size * 0.021).toFixed(2)}px`;
  }
  // The lyric box changes width whenever the pill appears or finishes collapsing;
  // refit on those changes so a line is never left sized for a different pill.
  if (typeof ResizeObserver === 'function' && $('compactCopy')) {
    new ResizeObserver(entries => {
      const width = Math.round(entries[entries.length - 1].contentRect.width);
      if (!width || !island.classList.contains('compact')) return;
      if (!island.classList.contains('lyrics-line')) return;
      fitCompactLine(compactFitText || $('compactTitle').textContent);
    }).observe($('compactCopy'));
  }
  function resetCompactFit() {
    const el = $('compactTitle');
    if (el) { el.style.fontSize = ''; el.style.letterSpacing = ''; }
  }

  function updateLyricText() {
    const media = mediaState || {};
    const big = $('bigLyric'), next = $('nextLyric');
    if (!media.title) {
      setText(big, 'Open a player to begin');
      setText(next, lyrics ? 'Instrumental' : '');
      fitLyric();
      return;
    }
    if (lyrics?.synced) {
      const index = lyricIndex(currentPosition());
      setText(big, lyrics.lines[index]?.text || media.title);
      setText(next, lyrics.lines[index + 1]?.text || '');
      fitLyric();
      return;
    }
    if (lyrics?.plain) {
      setText(big, media.title);
      setText(next, 'Lyrics available — open the lyrics view');
      fitLyric();
      return;
    }
    setText(big, media.title);
    setText(next, 'Looking up lyrics…');
    fitLyric();
  }

  /* ---------------- lyrics ---------------- */
  function renderLyricsPane() {
    const media = mediaState || {};
    setText($('lyricsTrack'), media.title ? `${media.title} · ${media.artist || 'Unknown artist'}` : '');
    const scroll = $('lyricsScroll');
    scroll.replaceChildren();
    if (!media.title) {
      scroll.innerHTML = '<div class="empty">Play a track to see its lyrics</div>';
      return;
    }
    if (!lyrics) {
      scroll.innerHTML = '<div class="empty">Looking up lyrics…</div>';
      loadLyrics();
      return;
    }
    if (!lyrics.synced) {
      const text = String(lyrics.plain || '').trim();
      if (!text) { scroll.innerHTML = '<div class="empty">No lyrics found for this track</div>'; return; }
      const block = document.createElement('div');
      block.className = 'lyric-line plain';
      block.style.whiteSpace = 'pre-wrap';
      block.textContent = text;
      scroll.appendChild(block);
      return;
    }
    lyrics.lines.forEach((line, index) => {
      const el = document.createElement('div');
      el.className = 'lyric-line';
      el.dataset.index = String(index);
      el.textContent = line.text || '♪';
      el.addEventListener('click', () => window.islandAPI.mediaControl('seek', line.time));
      scroll.appendChild(el);
    });
    lastLyricLine = -999;
    markLyricLines(true);
  }

  function markLyricLines(force) {
    if (!lyrics?.synced || cardView !== 'lyrics') return;
    const index = lyricIndex(currentPosition());
    if (!force && index === lastLyricLine) return;
    lastLyricLine = index;
    const scroll = $('lyricsScroll');
    const lines = scroll.querySelectorAll('.lyric-line');
    lines.forEach((el, i) => {
      el.classList.toggle('current', i === index);
      el.classList.toggle('past', i < index);
    });
    const active = lines[index];
    if (active) {
      scroll.scrollTo({ top: active.offsetTop - scroll.clientHeight / 2 + active.offsetHeight / 2, behavior: force ? 'auto' : 'smooth' });
    }
  }

  async function loadLyrics() {
    if (lyricLoading || !mediaState?.title || !mediaState?.artist) return;
    lyricLoading = true;
    const requested = trackKeyOf(mediaState);
    try {
      const found = await window.islandAPI.getLyrics({
        title: mediaState.title, artist: mediaState.artist,
        album: mediaState.album || '', duration: mediaState.duration || 0
      });
      if (trackKeyOf(mediaState) === requested) lyrics = found || null;
    } catch (_) { lyrics = null; }
    finally { lyricLoading = false; }
    if (cardView === 'lyrics') renderLyricsPane();
    updateLyricText();
    showCurrentLyric();
  }

  function showCurrentLyric() {
    const media = mediaState || activeMedia || {};
    updateLyricText();
    if (!lyrics?.synced) {
      island.classList.remove('lyrics-line');
      setText($('compactTitle'), media.title || '♪');
      setText($('compactSubtitle'), media.artist || '');
      return;
    }
    const index = lyricIndex(currentPosition());
    const current = index >= 0 ? lyrics.lines[index].text : '♪';
    island.classList.add('lyrics-line');
    $('compactSubtitle').textContent = '';
    fitCompactLine(current === '♪' ? (media.title || '♪') : current);
    if (index === displayedLyricIndex) return;
    displayedLyricIndex = index;
    setSmoothLine($('compactTitle'), current === '♪' ? (media.title || '♪') : current);
  }

  /* ---------------- timer ---------------- */
  function timerRemaining() {
    if (!timerState) return 0;
    return timerState.paused
      ? timerState.remaining
      : Math.max(0, (timerState.ends - Date.now()) / 1000);
  }
  function renderTimerPane() {
    const running = !!timerState;
    $('timerPresets').hidden = running;
    $('timerActions').hidden = !running;
    if (running) updateTimerUi();
    else {
      $('timerText').textContent = '05:00';
      $('timerArc').style.strokeDashoffset = '0';
    }
  }
  function updateTimerUi() {
    const left = timerRemaining();
    const total = timerState?.total || 1;
    setText($('timerText'), fmt(Math.ceil(left)));
    $('timerArc').style.strokeDashoffset = String(ARC * (1 - Math.max(0, Math.min(1, left / total))));
    if (island.dataset.kind === 'timer' || island.dataset.kind === 'timer:prompt') {
      $('compactSubtitle').textContent = fmt(Math.ceil(left));
      $('compactRight').textContent = fmt(Math.ceil(left));
    }
  }
  function startTimer(seconds) {
    clearInterval(timerTick);
    timerState = { total: seconds, ends: Date.now() + seconds * 1000, paused: false, remaining: seconds };
    $('timerPause').textContent = 'Pause';
    updateTimerUi();
    renderTimerPane();
    timerTick = setInterval(() => {
      if (!timerState) return;
      updateTimerUi();
      if (timerRemaining() <= 0) {
        clearInterval(timerTick);
        timerState = null;
        renderTimerPane();
        if (manager.current?.type === 'timer') manager.dismiss();
        pushAlert({ app: 'TIMER', title: 'Timer finished', message: 'Your timer is complete.' });
        if (!settings.dnd) {
          manager.show('notification', { title: 'Timer finished', message: 'Your timer is complete.', app: 'TIMER' },
            { priority: 85, duration: 4000 });
        }
      }
    }, 200);
  }
  function startFocus(seconds = 300) {
    startTimer(seconds);
    setCardView('timer');
    manager.show('timer', { seconds }, { priority: 50, duration: seconds * 1000 + 600 });
  }
  function openTimerPanel() {
    manager.show('timer', { seconds: Math.max(1, Math.ceil(timerRemaining())) }, { priority: 50, duration: 0 });
    updateTimerUi();
  }

  /* ---------------- calendar ---------------- */
  function renderCalendar() {
    const year = calCursor.getFullYear(), month = calCursor.getMonth();
    setText($('calMonth'), calCursor.toLocaleDateString('en-GB', { month: 'long' }));
    setText($('calSub'), String(year));
    const weekdays = $('calWeekdays');
    if (!weekdays.childElementCount) {
      WEEKDAYS.forEach(day => {
        const span = document.createElement('span');
        span.textContent = day.slice(0, 1);
        weekdays.appendChild(span);
      });
    }
    const grid = $('calGrid');
    grid.replaceChildren();
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7;
    const today = new Date();
    const start = new Date(year, month, 1 - offset);
    for (let i = 0; i < 42; i++) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const button = document.createElement('button');
      button.className = 'cal-day';
      button.textContent = String(date.getDate());
      const outside = date.getMonth() !== month;
      if (outside) button.classList.add('outside');
      if (date.getDay() === 0 || date.getDay() === 6) button.classList.add('weekend');
      if (date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate()) {
        button.classList.add('today');
      }
      button.addEventListener('click', () => {
        calCursor = new Date(date.getFullYear(), date.getMonth(), 1);
        renderCalendar();
      });
      grid.appendChild(button);
    }
  }

  /* ---------------- notes ---------------- */
  function loadNotes() {
    const notes = $('notesText');
    if (document.activeElement !== notes) notes.value = localStorage.getItem('island.notes') || '';
    setText($('notesStatus'), 'Saved locally');
    $('notesStatus').classList.remove('saved');
  }
  $('notesText').addEventListener('input', () => {
    setText($('notesStatus'), 'Saving…');
    $('notesStatus').classList.remove('saved');
    clearTimeout(notesSaveTimer);
    notesSaveTimer = setTimeout(() => {
      try { localStorage.setItem('island.notes', $('notesText').value); } catch (_) {}
      setText($('notesStatus'), 'Saved');
      $('notesStatus').classList.add('saved');
    }, 420);
  });

  /* ---------------- alerts ---------------- */
  function pushAlert(data) {
    alertLog = [{
      app: String(data.app || 'Island'),
      title: String(data.title || 'Notification'),
      message: String(data.message || ''),
      at: Date.now()
    }, ...alertLog].slice(0, 40);
    if (cardView === 'alerts' && expanded) { renderAlerts(); unreadAlerts = 0; }
    else { unreadAlerts += 1; }
    renderAlertBadge();
  }
  function renderAlertBadge() {
    $('alertBadge').hidden = unreadAlerts === 0;
  }
  function renderAlerts() {
    const list = $('alertList');
    list.replaceChildren();
    if (!alertLog.length) {
      list.innerHTML = '<div class="empty">No notifications yet.<br>Anything sent to the local API appears here.</div>';
      return;
    }
    alertLog.forEach(item => {
      const row = document.createElement('div');
      row.className = 'alert-item';
      const top = document.createElement('div');
      top.className = 'alert-top';
      const app = document.createElement('span');
      app.textContent = item.app;
      const time = document.createElement('time');
      time.textContent = clock12(new Date(item.at));
      top.append(app, time);
      const title = document.createElement('b');
      title.textContent = item.title;
      row.append(top, title);
      if (item.message) {
        const message = document.createElement('p');
        message.textContent = item.message;
        row.appendChild(message);
      }
      list.appendChild(row);
    });
  }
  $('alertsClear').addEventListener('click', event => {
    event.stopPropagation();
    alertLog = [];
    unreadAlerts = 0;
    renderAlertBadge();
    renderAlerts();
  });
  $('sendGo').addEventListener('click', async event => {
    event.stopPropagation();
    const payload = {
      title: $('sendTitle').value.trim() || 'Notification',
      message: $('sendMessage').value.trim(),
      app: $('sendApp').value.trim() || 'Island'
    };
    try {
      const response = await fetch('http://127.0.0.1:47831/notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(String(response.status));
      toast('Alert sent');
      setCardView('alerts');
    } catch (_) {
      toast('Notification API is offline');
    }
  });

  /* ---------------- volume ---------------- */
  function applyVolumeUi() {
    const value = Math.max(0, Math.min(100, Math.round(volumeState.value)));
    const muted = !!volumeState.muted;
    setText($('volValue'), muted ? 'Muted' : `${value}%`);
    $('volFill').style.width = `${muted ? 0 : value}%`;
    $('volRange').value = value;
    $('popVolFill').style.width = `${muted ? 0 : value}%`;
    $('popVolRange').value = value;
    $('volMute').textContent = muted ? 'Unmute' : 'Mute';
    $('volMute').classList.toggle('active', muted);
  }
  async function refreshVolume() {
    try { volumeState = await window.islandAPI.getVolume(); } catch (_) {}
    applyVolumeUi();
  }
  function queueVolume(value) {
    volumeState = { ...volumeState, value, muted: value === 0 ? volumeState.muted : false };
    applyVolumeUi();
    clearTimeout(volumeSendTimer);
    volumeSendTimer = setTimeout(async () => {
      try {
        const result = await window.islandAPI.setVolume(value);
        volumeState = { value: result.value, muted: result.muted };
        applyVolumeUi();
      } catch (_) { toast('Could not change volume'); }
    }, 90);
  }
  $('volRange').addEventListener('input', event => queueVolume(Number(event.target.value)));
  $('popVolRange').addEventListener('input', event => queueVolume(Number(event.target.value)));
  $('volMute').addEventListener('click', async event => {
    event.stopPropagation();
    const next = !volumeState.muted;
    try {
      await window.islandAPI.setMuted(next);
      volumeState = { value: volumeState.value || 30, muted: next };
      applyVolumeUi();
    } catch (_) { toast('Could not mute'); }
  });

  /* ---------------- connectivity ---------------- */
  let netState = null, netTimer = null, netFetchedAt = 0;
  async function refreshNetwork(force = false) {
    // PowerShell spawns are not free, so hovering reuses a reading younger than 15 s.
    if (!force && netState && Date.now() - netFetchedAt < 15000) return;
    try { netState = await window.islandAPI.getNetwork(); }
    catch (_) { netState = null; }
    netFetchedAt = Date.now();
    paintNetwork();
  }
  function paintNetwork() {
    const wifi = netState?.wifi, bluetooth = netState?.bluetooth;
    const wifiOn = !!wifi?.connected;
    $('netPill').dataset.wifi = wifiOn ? 'on' : 'off';
    $('netPill').dataset.bt = bluetooth?.on ? 'on' : 'off';
    $('wifiCard').dataset.on = String(wifiOn);
    $('btCard').dataset.on = String(!!bluetooth?.on);
    setText($('netWifiName'), wifiOn ? wifi.ssid : (wifi && !wifi.available) ? 'Off' : 'Not connected');
    setText($('netBtState'), bluetooth?.on ? 'On' : 'Off');
    $('netPill').title = `${wifiOn ? wifi.ssid : 'Wi-Fi off'} · Bluetooth ${bluetooth?.on ? 'on' : 'off'}`;
  }
  function renderNetwork() {
    refreshNetwork(true);
    clearInterval(netTimer);
    netTimer = setInterval(() => {
      if (expanded && cardView === 'network') refreshNetwork(true);
    }, 6000);
  }

  /* ---------------- all apps / customize ---------------- */
  const APP_ICONS = {
    home: '<path d="M3.8 10.4 12 3.9l8.2 6.5V20h-5.4v-5.4H9.2V20H3.8z"/>',
    music: '<path d="M9 17.4V6.2l10-1.9v11"/><circle cx="6.6" cy="17.6" r="2.4"/><circle cx="16.6" cy="15.6" r="2.4"/>',
    lyrics: '<path d="M11.5 3.4l1.8 4.9 4.9 1.8-4.9 1.8-1.8 4.9-1.8-4.9-4.9-1.8 4.9-1.8z"/><path d="M18.2 14.8l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z"/>',
    timer: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.4V12l3.3 2"/>',
    calendar: '<rect x="3.6" y="5.4" width="16.8" height="15" rx="2.4"/><path d="M3.6 10.2h16.8M8.4 3.2v4M15.6 3.2v4"/>',
    notes: '<path d="M5.8 3.2h8L18.2 7.6v13.2H5.8z"/><path d="M13.6 3.4v4.2h4.4"/><path d="M8.8 12h6.4M8.8 15.4h6.4M8.8 8.8h2.6"/>',
    alerts: '<path d="M20.4 11.6a8.4 8.4 0 0 1-8.4 8.4H7.6L3.6 23v-4.5a8.4 8.4 0 1 1 16.8-6.9z"/><path d="M8.4 9.6h7.2M8.4 13h4.8"/>',
    send: '<rect x="3" y="5.6" width="18" height="12.8" rx="2.4"/><path d="m3.9 7.1 8.1 6 8.1-6"/>',
    volume: '<path d="M4 9.4h3.6L12 5.6v12.8L7.6 14.6H4z"/><path d="M15.4 9.2a4 4 0 0 1 0 5.6M18 6.8a8 8 0 0 1 0 10.4"/>',
    customize: '<path d="M4.6 19.4l4.2-1L18.9 8.3a2 2 0 0 0-2.8-2.8L5.7 15.6z"/><path d="M14.8 5.8l3.4 3.4"/>',
    network: '<path d="M2.4 8.4a14.2 14.2 0 0 1 19.2 0"/><path d="M5.7 12.1a9.4 9.4 0 0 1 12.6 0"/><path d="M9 15.8a4.7 4.7 0 0 1 6 0"/><circle cx="12" cy="19.6" r="1.3"/>'
  };
  function renderApps() {
    const grid = $('appGrid');
    grid.replaceChildren();
    Object.keys(APP_ICONS).forEach(name => {
      const button = document.createElement('button');
      button.className = 'app-tile';
      button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${APP_ICONS[name]}</svg>`;
      const label = document.createElement('span');
      label.textContent = VIEW_TITLES[name];
      button.appendChild(label);
      button.addEventListener('click', event => { event.stopPropagation(); setCardView(name); });
      grid.appendChild(button);
    });
  }

  const FEATURE_KEYS = {
    media: 'Now playing', lyrics: 'Synced lyrics', volume: 'Volume HUD',
    brightness: 'Brightness HUD', battery: 'Battery alerts', notifications: 'Notifications'
  };
  function renderCustomize() {
    const list = $('toggleList');
    list.replaceChildren();
    Object.entries(FEATURE_KEYS).forEach(([key, label]) => {
      const row = document.createElement('label');
      row.className = 'toggle-row';
      const text = document.createElement('span');
      text.textContent = label;
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = settings[key] !== false;
      input.addEventListener('change', async () => {
        try { settings = await window.islandAPI.setSetting(key, input.checked); }
        catch (_) { toast('Could not save setting'); }
      });
      row.append(text, input);
      list.appendChild(row);
    });
  }

  /* ---------------- app menu ---------------- */
  function syncInstallLabel() {
    setText($('installLabel'), settings.startWithWindows ? 'Enabled' : 'Startup');
  }
  function openMenu() {
    $('menuPop').hidden = false;
    // The menu is a small floating panel, so the card behind it steps back instead of peeking out.
    island.classList.add('menu-open');
    refreshVolume();
    syncInstallLabel();
  }
  function closeMenu() {
    if ($('menuPop').hidden) return;
    $('menuPop').hidden = true;
    island.classList.remove('menu-open');
  }
  function toggleMenu() { $('menuPop').hidden ? openMenu() : closeMenu(); }

  $('netPill').addEventListener('click', event => { event.stopPropagation(); setCardView('network'); });
  document.querySelectorAll('.net-row').forEach(row => {
    row.addEventListener('click', async event => {
      event.stopPropagation();
      const opened = await window.islandAPI.openNetworkSettings(row.dataset.net).catch(() => false);
      if (!opened) toast('Could not open Windows settings');
    });
  });
  $('navPlus').addEventListener('click', event => { event.stopPropagation(); toggleMenu(); });
  $('menuToggle').addEventListener('click', event => { event.stopPropagation(); toggleMenu(); });
  $('menuPop').addEventListener('click', event => {
    event.stopPropagation();
    const tile = event.target.closest('[data-menu]');
    if (!tile) { closeMenu(); return; }
    const action = tile.dataset.menu;
    if (action === 'install') {
      settings.startWithWindows = !settings.startWithWindows;
      syncInstallLabel();
      window.islandAPI.setSetting('startWithWindows', settings.startWithWindows)
        .then(value => { settings = value || settings; syncInstallLabel(); toast(settings.startWithWindows ? 'Starts with Windows' : 'Removed from startup'); })
        .catch(() => toast('Could not update startup'));
    } else if (action === 'apps') { closeMenu(); setCardView('apps'); }
    else if (action === 'customize') { closeMenu(); setCardView('customize'); }
    else if (action === 'settings') { closeMenu(); window.islandAPI.openSettings(); }
    else if (action === 'fold') { closeMenu(); collapse(); }
    else if (action === 'quit') { window.islandAPI.quit(); }
  });

  /* ---------------- nav + controls ---------------- */
  document.querySelectorAll('[data-goto]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      setCardView(button.dataset.goto);
    });
  });
  $('navFold').addEventListener('click', event => { event.stopPropagation(); collapse(); });
  $('navDnd').addEventListener('click', event => {
    event.stopPropagation();
    settings.dnd = !settings.dnd;
    applyDnd();
    window.islandAPI.setSetting('dnd', settings.dnd).catch(() => {});
    toast(settings.dnd ? 'Do not disturb on' : 'Do not disturb off');
  });
  function applyDnd() {
    island.classList.toggle('dnd', !!settings.dnd);
    $('navDnd').classList.toggle('dnd-on', !!settings.dnd);
  }
  $('navCopy').addEventListener('click', async event => {
    event.stopPropagation();
    const media = mediaState;
    if (!media?.title) { toast('Nothing playing'); return; }
    try {
      await window.islandAPI.copyText(`${media.title} — ${media.artist || 'Unknown artist'}`);
      toast('Track copied');
    } catch (_) { toast('Could not copy'); }
  });
  $('timerPause').addEventListener('click', event => {
    event.stopPropagation();
    if (!timerState) return;
    if (timerState.paused) {
      timerState.ends = Date.now() + timerState.remaining * 1000;
      timerState.paused = false;
      $('timerPause').textContent = 'Pause';
    } else {
      timerState.remaining = Math.max(0, (timerState.ends - Date.now()) / 1000);
      timerState.paused = true;
      $('timerPause').textContent = 'Resume';
    }
  });
  $('timerReset').addEventListener('click', event => {
    event.stopPropagation();
    if (timerState) startTimer(timerState.total);
  });
  document.querySelectorAll('[data-preset]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      startFocus(Math.max(1, Number(button.dataset.preset) || 5) * 60);
    });
  });
  $('homePlay').addEventListener('click', event => {
    event.stopPropagation();
    window.islandAPI.mediaControl('playPause');
  });
  $('calPrev').addEventListener('click', event => {
    event.stopPropagation();
    calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1);
    renderCalendar();
  });
  $('calNext').addEventListener('click', event => {
    event.stopPropagation();
    calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1);
    renderCalendar();
  });
  $('seek').addEventListener('change', event => window.islandAPI.mediaControl('seek', Number(event.target.value)));
  document.querySelectorAll('[data-media]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      window.islandAPI.mediaControl(button.dataset.media);
    });
  });

  island.addEventListener('transitionend', event => {
    if (event.propertyName === 'width' && expanded) fitLyric();
  });
  window.addEventListener('resize', () => { lyricFitKey = ''; fitLyric(); });

  island.addEventListener('mouseenter', () => {
    if (exiting || island.classList.contains('entering')) return;
    hovering = true;
    window.islandAPI.setInteractive(true);
    clearTimeout(hoverTimer);
    expand();
  });
  island.addEventListener('mouseleave', () => {
    hovering = false;
    window.islandAPI.setInteractive(false);
    hoverTimer = setTimeout(collapse, 380);
  });
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!$('menuPop').hidden) { closeMenu(); return; }
    if (cardView !== 'music' && cardView !== 'home') { setCardView(landingView()); return; }
    collapse();
  });

  /* ---------------- system events ---------------- */
  window.islandAPI.on('activity:show', item => {
    if (item.type === 'media') {
      const incoming = { ...(item.data || {}) };
      const sameTrack = activeTrackKey === trackKeyOf(incoming);
      if (sameTrack && mediaState) {
        const live = currentPosition();
        if (Number(incoming.position) + 0.3 < live) {
          incoming.position = Math.min(live, Number(incoming.duration) || live);
        }
      }
      const key = trackKeyOf(incoming);
      if (key !== activeTrackKey) {
        activeTrackKey = key;
        displayedLyricIndex = -999;
        lastLyricLine = -999;
        lyrics = null;
        // A new track should land on the player, unless the user is busy in another tool.
        if (expanded && (cardView === 'home' || cardView === '')) setCardView('music');
      }
      mediaState = incoming;
      mediaAt = Date.now();
      if (item.data && item.data.lyrics !== undefined) lyrics = item.data.lyrics || null;
      if (lyrics && !lyrics.synced && !lyrics.plain) lyrics = null;
    } else if (item.type === 'media-ended') {
      mediaState = null;
      lyrics = null;
      activeTrackKey = '';
      displayedLyricIndex = -999;
      lastLyricLine = -999;
      if (cardView === 'music' || cardView === 'lyrics') setCardView('home');
    } else if (item.type === 'notification') {
      pushAlert(item.data || {});
      if (settings.dnd) return;   // logged, but no banner while do not disturb is on
    }
    const wasExpanded = expanded;
    manager.show(item.type, item.data, item.options || {});
    if (wasExpanded && (cardView === 'music' || cardView === 'home')) updateCard();
  });
  // Idle eyes lean toward the pointer. Only active while idle (the main process
  // stops polling as soon as an activity takes over).
  window.islandAPI.on('cursor:position', point => {
    if (!island.classList.contains('idle') || !point) return;
    const view = $('idleView');
    const rect = view.getBoundingClientRect();
    if (!rect.width) return;
    const clamp = (n) => Math.max(-1, Math.min(1, n));
    const gx = clamp((point.x - (rect.left + rect.width / 2)) / 240);
    const gy = clamp((point.y - (rect.top + rect.height / 2)) / 180);
    view.style.setProperty('--gx', `${(gx * 3.4).toFixed(2)}px`);
    view.style.setProperty('--gy', `${(gy * 2.2).toFixed(2)}px`);
  });
  window.islandAPI.on('settings:updated', value => {
    settings = value || settings;
    applyDnd();
    syncInstallLabel();
    if (cardView === 'customize' && expanded) renderCustomize();
  });
  window.islandAPI.getSettings()
    .then(value => { settings = value || settings; applyDnd(); syncInstallLabel(); })
    .catch(() => {});

  /* ---------------- clocks ---------------- */
  window.islandAPI.getBattery().then(value => { battery = value; renderBatteryPill(); }).catch(() => {});

  // Boot: drop in from above with a cute cue, then open the eyes.
  playCue('enter');
  island.addEventListener('animationend', event => {
    if (event.animationName === 'islandEnter') finishEnter();
  }, { once: true });
  setTimeout(finishEnter, 820);
  window.islandAPI.on('island:exit', playExit);
  window.islandAPI.on('update:status', renderUpdate);
  $('updateRestart')?.addEventListener('click', event => {
    event.stopPropagation();
    window.islandAPI.installUpdate();
  });

  setInterval(() => {
    updateHeader();
    if (lyrics?.synced) {
      if (cardView === 'lyrics') markLyricLines();
      if (manager.current?.type === 'media' && !expanded) showCurrentLyric();
    }
    updateTimeline();
  }, 250);
  setInterval(() => {
    updateHeader();
    if (expanded) refreshBattery();
    if (cardView === 'volume' && expanded) refreshVolume();
  }, 60000);
})();
