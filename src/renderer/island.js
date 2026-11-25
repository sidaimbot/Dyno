(() => {
  const $ = id => document.getElementById(id);
  const island = $('island');
  const PLAY_PATH = 'M8.4 3.6 19.6 12 8.4 20.4z';
  const PAUSE_PATH = 'M6.8 3.4h4.5v17.2H6.8zM12.9 3.4h4.5v17.2h-4.5z';
  const ARC = 226.2;
  const DIAL_ARC = 163.4;   // 2πr for the r=26 rings in the Stats pane
  // Durations mirrored from island.css. `animationend` is the completion signal everywhere;
  // these numbers only size the safety fallbacks and the --speed value written back into the
  // stylesheet, so each one must keep matching the keyframes it names.
  const ANIM = {
    enter: 780,   // .island.entering → @keyframes islandEnter
    exit: 640,    // .island.exiting  → @keyframes islandExit
    wake: 780,    // .island.waking   → @keyframes wakeEyes
    blink: 440,   // .island.blinking → @keyframes blink
    morph: 360    // :root --speed    → width / height / border-radius
  };
  // Slack added to a fallback so it never cuts an animation short if the event is missed.
  const FALLBACK_SLACK = 120;
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const PRIORITY = {
    volume: 100, brightness: 95, 'battery-low': 90, notification: 80,
    timer: 50, 'timer:prompt': 50, charging: 30, battery: 25, lyrics: 22, media: 20
  };
  const VIEW_TITLES = {
    home: 'Today', music: 'Now playing', lyrics: 'Lyrics', timer: 'Focus timer',
    calendar: 'Calendar', notes: 'Notes', alerts: 'Notifications', send: 'Send alert',
    volume: 'Volume', apps: 'All apps', customize: 'Customize', network: 'Connectivity',
    stats: 'Stats'
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
  let idleWatch = null;
  let lyrics = null, displayedLyricIndex = -999, activeTrackKey = '', lyricLoading = false;
  let timerState = null, timerTick = null;
  let settings = { animationSpeed: 1, dnd: false };
  let lastVolume = null;
  let cardView = '';
  let battery = null;
  let alertLog = [];
  let unreadAlerts = 0;
  let calCursor = new Date();
  let todoItems = null, todoKey = '';
  let weekKey = '';
  let weatherLoading = false;
  let statsActive = false, statsLast = null;
  let stageReplica = null;
  let volumeState = { value: 50, muted: false };
  let volumeSendTimer = null;
  let toastTimer = null;
  let updateBannerTimer = null;
  let notesSaveTimer = null;
  let lastLyricLine = -999;
  let headerKey = '';
  let audioCtx = null;
  let exiting = false;
  let blinkTimer = null;
  let expandIo = null;
  let expandNet = null;

  /* ---------------- helpers ---------------- */
  // Fires `done` exactly once: on the matching animationend/animationcancel, or on a
  // fallback timer if neither arrives. Those events bubble from children, so the name is
  // checked and both listeners are detached either way — that is what stops a blink or
  // cardIn ending from satisfying the entrance/exit callback.
  function onceAnimation(el, name, done, fallbackMs) {
    let finished = false;
    let timer = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      el.removeEventListener('animationend', onEnd);
      el.removeEventListener('animationcancel', onEnd);
      done();
    };
    const onEnd = event => { if (event.animationName === name) finish(); };
    el.addEventListener('animationend', onEnd);
    el.addEventListener('animationcancel', onEnd);
    timer = setTimeout(finish, fallbackMs);
    return finish;
  }

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
    // wakeEyes runs 780 ms; clearing the class earlier would cut the double-blink short.
    wakeEyes.timer = setTimeout(() => island.classList.remove('waking'), ANIM.wake + 40);
  }

  function finishEnter() {
    if (!island.classList.contains('entering')) return;
    island.classList.remove('entering');
    wakeEyes();
    // The window is shown and sized by now, so this pass produces the raster the first
    // real hover reuses instead of paying for it inside its morph.
    warmCard();
  }

  function playExit() {
    if (exiting) return;
    exiting = true;
    playCue('exit');
    closeMenu();
    if (expanded) collapse();
    island.classList.remove('entering', 'waking', 'blinking');
    island.classList.add('exiting');
    let done = false;
    const complete = () => {
      if (done) return;
      done = true;
      window.islandAPI.exitDone();
    };
    // islandExit (640 ms) is the completion signal. The fallback lands at 760 ms, still
    // inside the 900 ms quit fallback in main.js.
    onceAnimation(island, 'islandExit', complete, ANIM.exit + FALLBACK_SLACK);
  }

  function setText(el, value) {
    if (!el) return;
    const next = String(value ?? '');
    if (el.textContent === next) return;
    el.textContent = next;
  }
  // Assigning the value `hidden` already has still counts as a write, and the media pill
  // re-renders on every state change.
  function setHidden(el, hidden) {
    if (el && el.hidden !== hidden) el.hidden = hidden;
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
      // The line was already given its fitted size before this swap started, so the new
      // text never shows up unfitted for a frame.
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
    img.dataset.src = url;
    // Artwork set while the card is closed has nothing to cross-fade from, and painting a
    // blur filter over a just-assigned (still undecoded) image is what made the first card
    // open stutter. Decode it up front and let the card's own fade cover the swap.
    if (img.hidden || !img.offsetParent) {
      img.src = url;
      if (url && typeof img.decode === 'function') img.decode().catch(() => {});
      applyArtTint(url);
      return;
    }
    img.classList.add('art-swapping');
    setTimeout(() => {
      img.src = url;
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
  // Each banner renderer owns the right-hand slot and sets it to whatever it needs (the
  // others clear it); the equality check makes repeating a value free, so the seven level
  // bars are not rebuilt - and their animations not restarted - on every media update.
  let compactRightHtml = null;
  function compactRight(html) {
    const next = String(html ?? '');
    if (next === compactRightHtml) return;
    compactRightHtml = next;
    $('compactRight').innerHTML = next;
  }
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

  function toast(message, ms = 1700) {
    const el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }
  // Moving the island is a gesture with nothing on screen to press, so the card keeps
  // explaining it until the island has actually been moved once: the note comes back on the
  // first open of each launch while the gesture is still unused, then stops for good. The
  // warm-up opens the card too, and must not use the note up unseen.
  let dragHintTimer = null, dragHintShown = false;
  function maybeDragHint() {
    if (settings.dragHintSeen || dragHintShown) return;
    dragHintShown = true;
    clearTimeout(dragHintTimer);
    dragHintTimer = setTimeout(() => {
      if (expanded) toast('Double-tap the island and drag to move it', 3200);
    }, 500);
  }
  // Called once the island has really moved: from then on the card's handle and the grab
  // cursor are the cue, and the note is spent.
  function markDragLearned() {
    clearTimeout(dragHintTimer);
    dragHintTimer = null;
    if (settings.dragHintSeen) return;
    settings.dragHintSeen = true;
    window.islandAPI.setSetting('dragHintSeen', true).catch(() => {});
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
    // A blink belongs to the idle pill; leaving idle must not leave the class behind, or it
    // would keep fighting the wake animation over the same .eye transform.
    if (mode !== 'idle') island.classList.remove('blinking');
  }
  function landingView() {
    return mediaState?.title ? 'music' : 'home';
  }
  // Playback owns the music tab: a track that starts (or resumes) puts the card on the
  // player straight away when open, and makes it the pane the next hover lands on when
  // the island is at rest.
  function focusMusicTab() {
    if (exiting || cardView === 'music') return;
    if (warm) { cardView = 'music'; return; }
    if (expanded) { setCardView('music'); return; }
    cardView = 'music';
    island.dataset.view = 'music';
  }
  function expand() {
    clearTimeout(hoverTimer);
    setMode('expanded');
    const type = manager.current?.type;
    if (type) island.dataset.kind = type;
    else island.removeAttribute('data-kind');
    closeMenu();
    // Both reads come back over IPC and the Wi-Fi one spawns PowerShell (~600 ms of
    // CPU). Firing them on the same frame as the grow put that work inside the
    // animation, so let the card finish opening first.
    clearTimeout(expandIo);
    expandIo = setTimeout(() => {
      if (!expanded) return;
      refreshBattery();
    }, 420);
    // The Wi-Fi read spawns PowerShell (~600 ms of CPU machine-wide). Even deferred, it
    // landed on the tail of the morph and cost frames, so it waits until the card is open.
    clearTimeout(expandNet);
    expandNet = setTimeout(() => {
      if (!expanded) return;
      refreshNetwork();
    }, 900);
    updateHeader();
    setCardView(cardView || landingView());
    requestAnimationFrame(fitLyric);
    if (!island.classList.contains('warming')) maybeDragHint();
  }
  function collapse() {
    clearTimeout(expandIo);
    clearTimeout(expandNet);
    stopStats();
    const type = manager.current?.type;
    setMode(type ? 'compact' : 'idle');
    closeMenu();
    if (!type) island.removeAttribute('data-kind');
    // The lyric size is refitted once the collapsing pill has its final width; fitting
    // here would read the card's width and paint the line at the open card's size.
  }

  // --speed drives width, height, border-radius and the card fade (a fraction of it), so the
  // setting has to reach the stylesheet before the next morph starts.
  function applyAnimationSpeed() {
    const morph = Math.round(ANIM.morph / (settings.animationSpeed || 1));
    island.style.setProperty('--speed', `${morph}ms`);
  }
  // Eyes have their own on/off switch, and the gaze is a separate one: with the eyes hidden
  // the cursor should not keep moving something nobody can see.
  function applyEyes() {
    const eyesOn = settings.eyes !== false;
    const follow = eyesOn && settings.eyesFollow !== false;
    island.classList.toggle('eyes-off', !eyesOn);
    island.classList.toggle('eyes-static', !follow);
    if (!follow) {
      const view = $('idleView');
      view.style.setProperty('--gx', '0px');
      view.style.setProperty('--gy', '0px');
    }
  }
  // The island moves along the top edge by double-tapping it and sliding sideways: the second
  // press of the tap becomes the drag, and releasing leaves the island there. Screen
  // coordinates, because the island follows the pointer — a client-relative delta would read
  // that movement as more dragging and run away. The offset is session-only, so a relaunch
  // puts the island back at the top centre of the screen.
  let positionX = 0;
  let pointerDrag = null;
  let positionSend = 0;
  let lastTapAt = 0, lastTapX = 0, lastTapY = 0;
  // As far as the host window can travel before its edge meets the screen edge; the card keeps
  // its own margin inside it. Matches the clamp in the main process's positionIsland().
  function clampPosition(value) {
    const limit = Math.max(0, (window.screen.width - window.innerWidth) / 2);
    return Math.max(-limit, Math.min(limit, Math.round(Number(value) || 0)));
  }
  // Each step moves the window, so coalesce the raw pointer rate into one per frame.
  function previewPosition() {
    if (positionSend) return;
    positionSend = requestAnimationFrame(() => {
      positionSend = 0;
      window.islandAPI.moveIslandX(positionX);
    });
  }
  // Controls keep their own presses (a double click on a button should fire it, not drag the
  // card), so the gesture only starts on the island's own surface.
  const DRAG_IGNORE = 'button, a, input, textarea, select, [contenteditable], #menuPop';
  island.addEventListener('pointerdown', event => {
    if (pointerDrag || event.button !== 0) return;
    if (event.target.closest(DRAG_IGNORE)) return;
    // A double tap is two presses in quick succession that did not wander apart.
    const now = event.timeStamp;
    const again = now - lastTapAt < 420
      && Math.abs(event.screenX - lastTapX) < 26 && Math.abs(event.screenY - lastTapY) < 26;
    lastTapAt = now; lastTapX = event.screenX; lastTapY = event.screenY;
    if (!again) return;
    lastTapAt = 0;
    // Also stops the second press selecting the text under it.
    event.preventDefault();
    pointerDrag = { screenX: event.screenX, value: positionX };
    island.classList.add('moving');
    island.setPointerCapture(event.pointerId);
  });
  island.addEventListener('pointermove', event => {
    if (!pointerDrag) return;
    const next = clampPosition(pointerDrag.value + (event.screenX - pointerDrag.screenX));
    if (next === positionX) return;
    positionX = next;
    previewPosition();
  });
  function endMoveDrag(event) {
    if (!pointerDrag) return;
    // Only a drag that actually shifted the island retires the teaching note; a double tap
    // that ends where it started has not shown the user anything yet.
    const moved = positionX !== pointerDrag.value;
    pointerDrag = null;
    island.classList.remove('moving');
    if (moved) markDragLearned();
    // Sliding the card suppresses the leave it causes; replay it if the pointer is off the card
    // (a clamped drag can finish with the cursor past the edge the island stopped at).
    if (event?.pointerType !== 'mouse' || !expanded) return;
    const r = island.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right
      || event.clientY < r.top || event.clientY > r.bottom) leaveIsland();
  }
  island.addEventListener('pointerup', endMoveDrag);
  island.addEventListener('pointercancel', endMoveDrag);
  // Capture is dropped without a pointerup when the window loses the pointer (focus loss,
  // devtools); without this the drag state would stay set and hold the card open.
  island.addEventListener('lostpointercapture', endMoveDrag);

  /* ---------------- compact render ---------------- */
  // `type` also decides which compact slots are visible, so a media tick no longer flips
  // the icon/artwork/bar hidden flags back and forth on every update.
  function resetCompact(keepFit = false, type = '') {
    island.classList.remove('lyrics-line');
    // A media tick re-renders the pill several times a second; clearing the fitted lyric
    // size there would put the stylesheet's 16.5px back on screen between ticks, which is
    // the lyric text pulsing big and small. The size is only reset when the pill really
    // stops showing a lyric line.
    if (!keepFit) resetCompactFit();
    const isMedia = type === 'media';
    const isHud = type === 'volume' || type === 'brightness';
    const icon = $('compactIcon');
    setHidden(icon, isMedia);
    // Removing tokens an element does not have still rewrites its class attribute, which is
    // one style invalidation per media tick for nothing.
    if (icon.classList.contains('bare') || icon.classList.contains('is-muted')) icon.classList.remove('bare', 'is-muted');
    setText(icon, '✦');
    setHidden($('compactArt'), !isMedia);
    setHidden($('compactCopy'), isHud);
    setHidden($('compactBar'), !isHud);
  }
  function render(item) {
    const { type, data } = item;
    // Idle watching only changes when the island enters or leaves the idle state; sending
    // it on every media tick was an IPC round-trip 3×/s for the same value.
    const wantIdleWatch = type === 'idle';
    if (wantIdleWatch !== idleWatch) { idleWatch = wantIdleWatch; window.islandAPI.setIdleWatch(wantIdleWatch); }
    if (type === 'idle') {
      island.removeAttribute('data-kind');
      setMode(hovering ? 'expanded' : 'idle');
      if (hovering) { updateHeader(); setCardView(cardView || landingView()); }
      return;
    }
    island.dataset.kind = type;
    applyAnimationSpeed();
    setMode(expanded ? 'expanded' : 'compact');
    resetCompact(type === 'media', type);
    if (type === 'media') renderCompactMedia();
    else if (type === 'volume' || type === 'brightness') renderCompactHud(type, data);
    else if (type === 'notification') renderNotice(data);
    else if (type === 'timer' || type === 'timer:prompt') renderTimer(type, data);
    else if (type === 'charging' || type === 'battery' || type === 'battery-low') renderBattery(type, data);
    else if (type === 'lyrics') renderLegacyLyrics(data);
    if (expanded) { updateHeader(); updateCard(); }
    // A card that changed while the island was at rest needs its new content rasterised
    // before the next hover, or that hover pays for it (the artwork of a track that
    // started after boot is the common case).
    else scheduleWarmForContent();
  }

  function renderCompactMedia() {
    const media = mediaState || activeMedia || {};
    activeMedia = media;
    setArt($('compactArt'), media.art);
    // The level bars fill the right-hand slot and take width away from the lyric box, so
    // they go in before any fit. Fitting while the slot is still empty sized the line for
    // a pill 11px wider than the one on screen, and the ResizeObserver then fitted it
    // again once the bars landed - that pair of sizes once per tick was the pulsing.
    compactRight(wave(!!media.playing));
    if (lyrics && lyrics.synced) showCurrentLyric();
    else {
      island.classList.remove('lyrics-line');
      resetCompactFit();
      setText($('compactTitle'), media.title || 'Nothing playing');
      setText($('compactSubtitle'), media.artist || prettySource(media.source));
    }
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
    $('compactFill').style.width = `${value}%`;
    compactRight(muted ? 'Muted' : `${value}%`);
    lastVolume = { value, muted };
    if (type === 'volume') {
      volumeState = { value, muted };
      applyVolumeUi();
    }
  }

  function renderNotice(data) {
    setText($('compactIcon'), '●');
    compactRight('');
    setText($('compactTitle'), data.title || 'Notification');
    setText($('compactSubtitle'), data.message || data.app || '');
  }

  function renderTimer(type, data) {
    setText($('compactIcon'), '◷');
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
    if (type === 'battery-low') setText(icon, '!');
    else icon.innerHTML = batteryGauge(percent, 'batt-lg');
    if (type === 'battery-low') {
      compactRight('');
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
    setText($('compactIcon'), '♫');
    compactRight('');
    setText($('compactTitle'), data.current || 'No lyrics found');
    setText($('compactSubtitle'), data.next || '');
  }

  /* ---------------- header ---------------- */
  function updateHeader() {
    const now = new Date();
    // Intl formatting is not free and the header only shows minutes, so once per minute
    // is all the ticker needs to do instead of re-formatting four times a second.
    const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    if (key === headerKey) return;
    headerKey = key;
    const date = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
      .replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    setText($('headDate'), date.toUpperCase());
    setText($('headClock'), clock12(now));
    const hours = now.getHours() % 12 || 12;
    setText($('todayHour'), String(hours));
    setText($('todayMin'), String(now.getMinutes()).padStart(2, '0'));
    setText($('todayDay'), `${now.getHours() < 12 ? 'AM' : 'PM'} · ${now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}`);
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
    stats: startStats,
    music: updateCard,
    home: renderToday
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
    if (name !== 'stats') stopStats();
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

  /* the compact pill lyric line: one size per track, taken from the track's longest line,
     so the text reads at a steady size instead of rescaling line by line */
  const COMPACT_MAX = 19, COMPACT_MIN = 13.5;
  let compactMeasureEl = null;
  let lyricFit = { track: '', avail: 0, size: 0 };
  let lyricSizeRetry = 0;
  // Candidate sizes are tried on a hidden twin, never on the line on screen: the pill only
  // receives the size that was chosen, together with the text it belongs to, so a new line
  // is never painted once at the stylesheet's size and then shrunk.
  function compactMeasure() {
    const box = $('compactCopy');
    if (!box) return null;
    if (!compactMeasureEl || !compactMeasureEl.isConnected) {
      compactMeasureEl = document.createElement('strong');
      compactMeasureEl.className = 'fit-measure';
      compactMeasureEl.setAttribute('aria-hidden', 'true');
      box.appendChild(compactMeasureEl);
    }
    return compactMeasureEl;
  }
  // The copy box animates with the island's morph, so its width is only usable once it has
  // held still: fitting every intermediate width would drag the lyric up and down with the
  // opening and closing card. Zero while the card is open, where the pill has none.
  let compactWidth = 0, compactWidthAt = 0;
  function compactWidthReady(avail) {
    if (avail !== compactWidth) {
      compactWidth = avail;
      compactWidthAt = performance.now();
      return false;
    }
    return performance.now() - compactWidthAt >= 90;
  }
  // Width scales with size, so the line that is widest at the maximum size is the one that
  // decides the size the whole track can use. Only that line is then tried against the
  // candidates, so a track costs one pass over its lines per pill width, not one per tick.
  function lyricTrackSize() {
    const avail = $('compactCopy')?.clientWidth || 0;
    if (!avail || expanded || !lyrics?.synced || !lyrics.lines?.length) return 0;
    if (!compactWidthReady(avail)) return 0;
    const track = trackKeyOf(mediaState || activeMedia || {});
    if (lyricFit.track === track && lyricFit.avail === avail) return lyricFit.size;
    const measure = compactMeasure();
    if (!measure) return 0;
    const at = size => {
      measure.style.fontSize = `${size}px`;
      measure.style.letterSpacing = `${(-size * 0.021).toFixed(2)}px`;
    };
    let widest = '';
    let width = 0;
    at(COMPACT_MAX);
    for (const line of lyrics.lines) {
      const text = String(line.text || '').trim();
      if (!text) continue;
      measure.textContent = text;
      if (measure.scrollWidth > width) { width = measure.scrollWidth; widest = text; }
    }
    let size = 0, overflow = false;
    if (widest) {
      measure.textContent = widest;
      at(COMPACT_MIN);
      // Checked at the smallest size the pill will use: if the longest line still does not
      // fit there, every line of the track needs the fading, left-aligned treatment.
      overflow = measure.scrollWidth > avail + 0.5;
      size = COMPACT_MIN;
      if (!overflow) {
        for (let candidate = COMPACT_MAX; candidate > COMPACT_MIN; candidate -= 0.5) {
          at(candidate);
          if (measure.scrollWidth <= avail + 0.5) { size = candidate; break; }
        }
      }
      measure.textContent = '';
    }
    lyricFit = { track, avail, size, overflow };
    return size;
  }
  function applyCompactSize(size) {
    const el = $('compactTitle');
    if (!el || !size) return;
    el.style.fontSize = `${size}px`;
    el.style.letterSpacing = `${(-size * 0.021).toFixed(2)}px`;
  }
  // The lyric box changes width whenever the pill appears or finishes collapsing. The
  // observer only waits for the width to settle; showCurrentLyric then re-sizes the line
  // already on screen, so the text keeps its size while the pill grows or shrinks.
  let compactFitTimer = 0;
  if (typeof ResizeObserver === 'function' && $('compactCopy')) {
    new ResizeObserver(() => {
      clearTimeout(compactFitTimer);
      compactFitTimer = setTimeout(() => {
        if (expanded || !island.classList.contains('compact')) return;
        if (manager.current?.type === 'media') showCurrentLyric();
      }, 110);
    }).observe($('compactCopy'));
  }
  function resetCompactFit() {
    const el = $('compactTitle');
    if (el && el.style.fontSize) { el.style.fontSize = ''; el.style.letterSpacing = ''; }
    island.classList.remove('lyrics-long');
    lyricFit = { track: '', avail: 0, size: 0 };
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
  /* Long lyrics shrink to the pane instead of spilling out of it. The step is
     measured from the laid-out box (so wrapped words and the pane height both
     count, not just the character count), which keeps a paragraph reading in
     full while short lines stay at their normal size. */
  const LYRIC_TEXT_MAX = 15, LYRIC_CURRENT_MAX = 19;
  // Plain lyrics are a whole song in one block of short lines, so a single column can
  // only hold them by shrinking below a comfortable size. Below these limits it flows
  // into a second column instead, and scrolling is the last resort.
  const PLAIN_READABLE = 12, PLAIN_COLUMN_MIN = 10;
  function sizeToFit(el, base, min, boxHeight, lineHeight = 1.3) {
    const apply = value => {
      el.style.fontSize = `${value}px`;
      el.style.lineHeight = String(lineHeight);
      el.style.letterSpacing = `${(-value * 0.012).toFixed(2)}px`;
    };
    // font-size is animated by the stylesheet, so the intermediate values of the
    // search must not be transitioned or every measurement would read the old size.
    const transition = el.style.transition;
    el.style.transition = 'none';
    let size = base;
    apply(size);
    while (size > min && el.scrollHeight > boxHeight + 1) {
      size = Math.max(min, size - 0.5);
      apply(size);
    }
    void el.offsetHeight;
    el.style.transition = transition;
    return size;
  }
  // The pane keeps ticking while the card is collapsed, where it has no height at all.
  // Measuring there would shrink every line to the minimum and leave the list
  // unreadable the next time it opens, so fitting only happens in a real pane.
  function lyricsRoom() {
    const scroll = $('lyricsScroll');
    return scroll && scroll.clientHeight > 60 ? scroll.clientHeight - 12 : 0;
  }
  function fitPlainLyrics() {
    const scroll = $('lyricsScroll');
    const block = scroll?.querySelector('.lyric-line.plain');
    const room = lyricsRoom();
    if (!scroll || !block || !room) return;
    // Short paragraphs stay on one line-per-row column at full size.
    block.classList.remove('two-col');
    sizeToFit(block, LYRIC_TEXT_MAX, PLAIN_READABLE, room, 1.45);
    // A song that would have to go smaller than that reads better in two columns, where
    // each column holds half as many lines and the type can stay large.
    if (block.scrollHeight > room + 1) {
      block.classList.add('two-col');
      sizeToFit(block, LYRIC_TEXT_MAX, PLAIN_COLUMN_MIN, room, 1.42);
    }
    scroll.scrollTop = 0;
  }
  function fitLyricsText() {
    const scroll = $('lyricsScroll');
    const room = lyricsRoom();
    if (!scroll || !room) return;
    if (scroll.querySelector('.lyric-line.plain')) { fitPlainLyrics(); return; }
    scroll.querySelectorAll('.lyric-line').forEach(el => {
      const current = el.classList.contains('current');
      // The active line leads the view, so it may use more of the height than the
      // lines around it; the rest stay compact so the list still scans at a glance.
      const size = sizeToFit(el, current ? LYRIC_CURRENT_MAX : LYRIC_TEXT_MAX, 9,
        room * (current ? 0.62 : 0.42));
      // Remember the resting size so a line that stops being current returns to it.
      if (!current) el.dataset.fit = String(size);
    });
  }
  function restoreLyricLine(el) {
    if (!el) return;
    const room = lyricsRoom();
    const size = Number(el.dataset.fit);
    if (!size && room) { sizeToFit(el, LYRIC_TEXT_MAX, 9, room * 0.42); return; }
    el.style.fontSize = `${size || LYRIC_TEXT_MAX}px`;
    el.style.lineHeight = '1.3';
    el.style.letterSpacing = `${(-size * 0.012).toFixed(2)}px`;
  }

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
      block.textContent = text;
      scroll.appendChild(block);
      fitPlainLyrics();
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
    fitLyricsText();
  }

  function markLyricLines(force) {
    if (!lyrics?.synced || cardView !== 'lyrics') return;
    const index = lyricIndex(currentPosition());
    if (!force && index === lastLyricLine) return;
    const previous = lastLyricLine;
    lastLyricLine = index;
    const scroll = $('lyricsScroll');
    const lines = scroll.querySelectorAll('.lyric-line');
    lines.forEach((el, i) => {
      el.classList.toggle('current', i === index);
      el.classList.toggle('past', i < index);
    });
    // The line that just lost the highlight goes back to its resting size, and the
    // new one grows to lead the view - unless it is a long line that has to shrink.
    if (previous >= 0 && previous !== index) restoreLyricLine(lines[previous]);
    const active = lines[index];
    const room = lyricsRoom();
    if (active && room && !scroll.querySelector('.lyric-line.plain')) {
      sizeToFit(active, LYRIC_CURRENT_MAX, 9, room * 0.62);
    }
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
      resetCompactFit();
      setText($('compactTitle'), media.title || '♪');
      setText($('compactSubtitle'), media.artist || '');
      return;
    }
    const index = lyricIndex(currentPosition());
    const current = index >= 0 ? lyrics.lines[index].text : '♪';
    const label = current === '♪' ? (media.title || '♪') : current;
    const size = lyricTrackSize();    if (!size) {
      // No measurable pill yet (card open, cold-start warm-up, first frames of the media
      // morph). Setting the line now would paint it at the stylesheet's 16.5px and then
      // shrink it, so the pill keeps the title it already has for one more frame instead.
      if (!lyricSizeRetry) {
        lyricSizeRetry = requestAnimationFrame(() => {
          lyricSizeRetry = 0;
          if (!expanded && manager.current?.type === 'media') showCurrentLyric();
        });
      }
      return;
    }
    // Size first: the line still fading out must not pop to the stylesheet's 16.5px when
    // the lyrics style lands a moment before the new text does.
    applyCompactSize(size);
    island.classList.add('lyrics-line');
    island.classList.toggle('lyrics-long', !!lyricFit.overflow);
    $('compactSubtitle').textContent = '';
    if (index === displayedLyricIndex) return;
    displayedLyricIndex = index;
    setSmoothLine($('compactTitle'), label);
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
      setText($('compactSubtitle'), fmt(Math.ceil(left)));
      compactRight(fmt(Math.ceil(left)));
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

  /* ---------------- today ---------------- */
  function dayStamp() {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  }

  function renderWeek() {
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const key = String(monday.getTime());
    if (key === weekKey) return;
    weekKey = key;
    const end = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    const short = date => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    setText($('weekRange'), `${short(monday)} – ${short(end)}`);
    const strip = $('weekStrip');
    strip.replaceChildren();
    for (let i = 0; i < 7; i++) {
      const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      const cell = document.createElement('div');
      cell.className = 'week-day' + (date.toDateString() === now.toDateString() ? ' today' : '');
      const label = document.createElement('small');
      label.textContent = WEEKDAYS[i];
      const number = document.createElement('b');
      number.textContent = String(date.getDate());
      cell.append(label, number);
      strip.appendChild(cell);
    }
  }

  function loadTodos() {
    try {
      const saved = JSON.parse(localStorage.getItem('dyno.todos') || 'null');
      if (saved?.date === dayStamp() && Array.isArray(saved.items)) return saved.items.filter(item => item && item.text);
    } catch (_) {}
    return [];
  }
  function saveTodos() {
    try { localStorage.setItem('dyno.todos', JSON.stringify({ date: dayStamp(), items: todoItems })); } catch (_) {}
  }
  function renderTodos(force) {
    if (!todoItems) todoItems = loadTodos();
    const key = todoItems.map(item => `${item.id}:${item.done ? 1 : 0}:${item.text}`).join('|');
    if (!force && key === todoKey) return;
    todoKey = key;
    const list = $('todoList');
    list.replaceChildren();
    if (!todoItems.length) {
      list.innerHTML = '<div class="todo-empty">Nothing on the list yet.</div>';
    } else {
      const fragment = document.createDocumentFragment();
      for (const item of todoItems) {
        const row = document.createElement('div');
        row.className = 'todo-item' + (item.done ? ' done' : '');
        row.dataset.id = String(item.id);
        const dot = document.createElement('i');
        dot.className = 'todo-dot';
        dot.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.textContent = item.text;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'todo-x';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `Remove ${item.text}`);
        row.append(dot, text, remove);
        fragment.appendChild(row);
      }
      list.appendChild(fragment);
    }
    const done = todoItems.reduce((count, item) => count + (item.done ? 1 : 0), 0);
    setText($('todoCount'), `${done}/${todoItems.length}`);
  }

  function paintWeather(weather) {
    const icon = $('wxIcon');
    if (!weather || !Number.isFinite(weather.temp)) {
      setText($('wxTemp'), '—°');
      setText($('wxDesc'), 'Weather');
      if (icon) icon.textContent = '☀';
      return;
    }
    const code = Number(weather.code) || 0;
    const state = code === 0 ? 'Clear' : code <= 3 ? 'Partly cloudy' : code <= 48 ? 'Cloudy'
      : code <= 67 ? 'Rain' : code <= 77 ? 'Snow' : code <= 82 ? 'Showers' : 'Storm';
    const glyph = code <= 1 ? '☀' : code <= 3 ? '⛅' : code <= 77 ? '☁' : '☂';
    if (icon) icon.textContent = glyph;
    setText($('wxTemp'), `${Math.round(weather.temp)}°C`);
    setText($('wxDesc'), state);
  }

  async function refreshWeather() {
    if (weatherLoading) return;
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem('dyno.weather') || 'null'); } catch (_) {}
    if (cached && Number.isFinite(cached.temp)) paintWeather(cached);
    if (cached && Date.now() - cached.at < 30 * 60 * 1000) return;
    weatherLoading = true;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 6000);
    try {
      let location = cached?.location;
      if (!location) {
        const found = await fetch('https://ipwho.is/', { signal: abort.signal }).then(response => response.json());
        if (found?.success !== false && Number.isFinite(found?.latitude)) {
          location = { lat: found.latitude, lon: found.longitude };
        }
      }
      if (!location) throw new Error('no location');
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}&current=temperature_2m,weather_code`;
      const forecast = await fetch(url, { signal: abort.signal }).then(response => response.json());
      const current = forecast?.current;
      if (!Number.isFinite(current?.temperature_2m)) throw new Error('no reading');
      const weather = { at: Date.now(), temp: current.temperature_2m, code: current.weather_code, location };
      try { localStorage.setItem('dyno.weather', JSON.stringify(weather)); } catch (_) {}
      paintWeather(weather);
    } catch (_) {
      if (!cached) paintWeather(null);
    } finally {
      clearTimeout(timer);
      weatherLoading = false;
    }
  }

  function renderToday() {
    renderWeek();
    renderTodos();
    refreshWeather();
  }

  /* ---------------- stats ---------------- */
  const APP_COLORS = ['#e9b84e', '#b66bff', '#58c98a', '#5aa9f0'];
  function bytesRate(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value >= 1048576) return `${(value / 1048576).toFixed(1)} MB/s`;
    if (value >= 1024) return `${Math.round(value / 1024)} KB/s`;
    return `${Math.round(value)} B/s`;
  }
  function sizeGB(value) {
    const number = Math.max(0, Number(value) || 0);
    return number >= 100 ? String(Math.round(number)) : number.toFixed(1);
  }
  // "AMD Ryzen 7 8840U w/ Radeon 780M Graphics" -> "Ryzen 7 8840U": the vendor and the
  // integrated-graphics tail only cost space in a 120px meter, and the ellipsis looked broken.
  function chipName(name) {
    const short = String(name || '')
      .replace(/\s*\((?:tm|r|c)\)/gi, '')
      .replace(/^(?:AMD|Intel|NVIDIA|Qualcomm|Apple)\s+/i, '')
      .replace(/\s+(?:w\/|with)\s+.*$/i, '')
      .replace(/\s+CPU\s*@.*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    return short || '—';
  }
  function sizeMB(mb) {
    const value = Math.max(0, Number(mb) || 0);
    return value >= 1024 ? `${(value / 1024).toFixed(1)} GB` : `${Math.round(value)} MB`;
  }
  function paintStats(snapshot) {
    statsLast = snapshot;
    if (!snapshot) return;
    const ring = (id, percent) => {
      const arc = $(id);
      if (arc) arc.style.strokeDashoffset = String(DIAL_ARC * (1 - Math.max(0, Math.min(100, percent)) / 100));
    };
    setText($('cpuPct'), `${Math.round(snapshot.cpu.percent)}%`);
    ring('cpuArc', snapshot.cpu.percent);
    setText($('cpuName'), chipName(snapshot.cpu.name));
    setText($('cpuClock'), `${(snapshot.cpu.mhz / 1000).toFixed(1)} GHz`);
    setText($('cpuProcs'), snapshot.procs ? `${snapshot.procs} proc` : '—');

    setText($('gpuPct'), `${Math.round(snapshot.gpu.percent)}%`);
    ring('gpuArc', snapshot.gpu.percent);
    setText($('gpuName'), chipName(snapshot.gpu.name));
    const vram = snapshot.gpu.vramGB ? `${sizeGB(snapshot.gpu.vramGB)} GB` : '';
    setText($('gpuVram'), vram || '—');
    $('gpuVram').parentElement.hidden = !vram;

    setText($('ramPct'), `${Math.round(snapshot.ram.percent)}%`);
    ring('ramArc', snapshot.ram.percent);
    setText($('ramUse'), `${sizeGB(snapshot.ram.usedGB)} / ${sizeGB(snapshot.ram.totalGB)} GB`);
    setText($('ramFree'), `${sizeGB(snapshot.ram.freeGB)} GB free`);

    setText($('diskUse'), `${sizeGB(snapshot.disk.usedGB)} / ${sizeGB(snapshot.disk.totalGB)} GB`);
    const diskBar = $('diskBar');
    if (diskBar && snapshot.disk.totalGB) {
      diskBar.style.width = `${Math.max(0, Math.min(100, (snapshot.disk.usedGB / snapshot.disk.totalGB) * 100))}%`;
    }
    setText($('netDown'), bytesRate(snapshot.net.down));
    setText($('netUp'), bytesRate(snapshot.net.up));

    const up = Math.max(0, Math.round(snapshot.uptime));
    setText($('uptime'), `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m`);

    const apps = snapshot.apps || [];
    const host = $('topApps');
    host.replaceChildren();
    const peak = apps.reduce((max, app) => Math.max(max, app.mb), 0) || 1;
    apps.forEach((app, index) => {
      const row = document.createElement('div');
      row.className = 'app-row';
      const icon = document.createElement('i');
      icon.className = 'app-ico';
      icon.style.background = APP_COLORS[index % APP_COLORS.length];
      icon.textContent = app.name.slice(0, 1).toUpperCase();
      const name = document.createElement('b');
      name.textContent = app.name;
      const value = document.createElement('span');
      value.className = 'app-mb';
      value.textContent = sizeMB(app.mb);
      const track = document.createElement('i');
      track.className = 'app-track';
      const fill = document.createElement('i');
      fill.style.width = `${Math.max(2, Math.round((app.mb / peak) * 100))}%`;
      track.appendChild(fill);
      row.append(icon, name, value, track);
      host.appendChild(row);
    });
  }

  function startStats() {
    if (warm || !expanded) return;
    if (!statsActive) {
      statsActive = true;
      window.islandAPI.statsStart().catch(() => {});
    }
    paintStats(statsLast);
  }
  function stopStats() {
    if (!statsActive) return;
    statsActive = false;
    window.islandAPI.statsStop().catch(() => {});
  }
  window.islandAPI.on('stats:update', snapshot => {
    if (expanded && cardView === 'stats') paintStats(snapshot);
  });

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
    network: '<path d="M2.4 8.4a14.2 14.2 0 0 1 19.2 0"/><path d="M5.7 12.1a9.4 9.4 0 0 1 12.6 0"/><path d="M9 15.8a4.7 4.7 0 0 1 6 0"/><circle cx="12" cy="19.6" r="1.3"/>',
    stats: '<path d="M4 19V10M9.3 19V4.6M14.7 19v-6.4M20 19V7.4"/>'
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

  // The list scrolls, so the pair that most people come looking for sits at the top.
  const FEATURE_KEYS = {
    eyes: 'Eyes', eyesFollow: 'Eyes follow cursor',
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
      // Following only means anything while the eyes are drawn.
      if (key === 'eyesFollow' && settings.eyes === false) {
        input.disabled = true;
        row.classList.add('off');
      }
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
  $('todoList').addEventListener('click', event => {
    const row = event.target.closest('.todo-item');
    if (!row || !todoItems) return;
    const id = Number(row.dataset.id);
    todoItems = event.target.closest('.todo-x')
      ? todoItems.filter(item => item.id !== id)
      : todoItems.map(item => (item.id === id ? { ...item, done: !item.done } : item));
    saveTodos();
    renderTodos(true);
  });
  $('todoAdd').addEventListener('submit', event => {
    event.preventDefault();
    const input = $('todoInput');
    const text = input.value.trim();
    if (!text) return;
    if (!todoItems) todoItems = loadTodos();
    todoItems = [...todoItems, { id: Date.now(), text, done: false }];
    input.value = '';
    saveTodos();
    renderTodos(true);
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

  function openOnHover() {
    if (exiting || island.classList.contains('entering')) return;
    hovering = true;
    window.islandAPI.setInteractive(true);
    clearTimeout(hoverTimer);
    cancelWarm();
    expand();
  }
  island.addEventListener('mouseenter', openOnHover);
  // While a warm-up is running the island itself is invisible and not hit-testable, so the
  // pill standing in for it carries the hover instead.
  $('idleView').addEventListener('mouseenter', openOnHover);
  function leaveIsland() {
    hovering = false;
    window.islandAPI.setInteractive(false);
    // Short grace period only: long enough to survive a jittery edge crossing, short
    // enough that leaving the card reads as an instant repack (the morph itself is
    // still --speed long). The old 380 ms stacked on top of the 360 ms morph and made
    // closing feel like it lagged behind the pointer by more than half a second.
    hoverTimer = setTimeout(collapse, 90);
  }
  island.addEventListener('mouseleave', () => {
    // Moving the island out from under the pointer mid-slide would otherwise read as the
    // pointer leaving the card and fold it up during the drag.
    if (pointerDrag) return;
    leaveIsland();
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
      // The helper only ships artwork on the first tick of a track: keep the previous
      // one so a several-hundred-KB base64 string is not copied across process
      // boundaries (and re-parsed) several times a second.
      if (!('art' in incoming)) incoming.art = mediaState?.art || activeMedia?.art || '';
      const sameTrack = activeTrackKey === trackKeyOf(incoming);
      if (sameTrack && mediaState) {
        const live = currentPosition();
        if (Number(incoming.position) + 0.3 < live) {
          incoming.position = Math.min(live, Number(incoming.duration) || live);
        }
      }
      const key = trackKeyOf(incoming);
      const trackChanged = key !== activeTrackKey;
      const wasPlaying = !!mediaState?.playing;
      if (trackChanged) {
        activeTrackKey = key;
        displayedLyricIndex = -999;
        lastLyricLine = -999;
        lyrics = null;
      }
      mediaState = incoming;
      mediaAt = Date.now();
      if (incoming.title && incoming.playing && (trackChanged || !wasPlaying)) focusMusicTab();
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
    if (settings.eyes === false || settings.eyesFollow === false) return;
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
    applyAnimationSpeed();
    applyDnd();
    applyEyes();
    syncInstallLabel();
    if (cardView === 'customize' && expanded) renderCustomize();
  });
  window.islandAPI.getSettings()
    .then(value => { settings = value || settings; applyAnimationSpeed(); applyDnd(); applyEyes(); syncInstallLabel(); })
    .catch(() => {});

  /* ---------------- clocks ---------------- */
  window.islandAPI.getBattery().then(value => { battery = value; renderBatteryPill(); }).catch(() => {});

  /* ---------------- cold-start warm-up ---------------- */
  // A fresh process used to pay a one-time GPU cost inside the very first morph: D3D shader
  // compilation for the card's rounded clip, artwork blend and glow, plus the card's first
  // raster. So the real open runs at 1 % opacity with nothing visible, then snaps back to
  // the pill. It runs twice, because the two costs are only paid once the window is in a
  // different state:
  //  • before the drop-in, while the window is still blank — compiles the pipelines (this
  //    was the 1.2 s freeze the first hover used to have);
  //  • after the drop-in, when the window has been shown and sized — the raster produced
  //    here is the one the first real hover can reuse. A warm-up painted earlier is thrown
  //    away by the window's first composition, which is why the first hover still stuttered.
  // The island paints at 1 % while warming, so the idle pill is lifted out to #stage for the
  // duration and put straight back (see .warming / .stage-pill in island.css).
  const WARM_HOLD = 600;                  // long enough for the card's raster to land
  let warm = null;
  // The warm-up paints the whole expanded island, so the idle pill has to be taken out of
  // it to stay on screen; it is put straight back when the warm-up ends.
  const stage = document.getElementById('stage');
  function liftPill() {
    if (stageReplica) return;
    // Idle: the eyes are moved out, so they keep standing still while the shell is hidden.
    if (island.classList.contains('idle')) {
      const view = $('idleView');
      if (view.parentElement === stage) return;
      view.classList.add('stage-pill');
      stage.appendChild(view);
      return;
    }
    // Any compact banner: a stand-in carrying the same classes paints exactly like the
    // pill the user is looking at, without moving the live compact view out of the shell.
    const replica = document.createElement('div');
    replica.className = `island compact stage-replica${island.classList.contains('lyrics-line') ? ' lyrics-line' : ''}`;
    if (island.dataset.kind) replica.dataset.kind = island.dataset.kind;
    replica.appendChild($('compactView').cloneNode(true));
    replica.addEventListener('mouseenter', openOnHover);
    stage.appendChild(replica);
    stageReplica = replica;
  }
  function dropPill() {
    if (stageReplica) {
      stageReplica.remove();
      stageReplica = null;
    }
    const view = $('idleView');
    if (view.parentElement !== stage) return;
    view.classList.remove('stage-pill');
    island.insertBefore(view, island.firstElementChild);
  }
  function warmCard({ veiled = false, done } = {}) {
    if (expanded || hovering || exiting || warm) { done?.(); return; }
    const run = { timer: 0, previousView: cardView };
    warm = run;
    warmKey = warmKeyNow();
    island.classList.add('warming');
    island.classList.toggle('veiled', veiled);
    // Only the settled pass lifts the pill: before the drop-in nothing may be visible.
    if (!veiled) liftPill();
    // Jump straight to the card's final size: the morph is not what the warm-up needs and
    // skipping it keeps the unseen open short.
    island.style.transition = 'none';
    // Timer first: the boot drop-in waits on this callback, so it has to run even if the
    // throwaway open fails halfway through.
    run.timer = setTimeout(() => {
      if (warm !== run) return;
      warm = null;
      abortWarm(run);
      done?.();
      // The pre-entrance pass only has to compile the pipelines (measured under the morph),
      // while the settled pass needs longer for the raster to be produced and kept.
    }, veiled ? ANIM.morph + FALLBACK_SLACK : WARM_HOLD);
    try { expand(); } catch (_) { /* the timer still cleans up and boots the entrance */ }
  }
  // Snaps the unseen card back to the pill and drops the warm-up styling. The warm-up must
  // not decide where the first real open lands, so the pane the card was showing is put
  // back; setCardView itself re-applies it on the next open.
  function abortWarm(run) {
    try {
      island.style.transition = 'none';
      collapse();                           // snap back, so no shrink is ever seen
      cardView = run.previousView;
      if (run.previousView) island.dataset.view = run.previousView;
      else island.removeAttribute('data-view');
    } finally {
      island.classList.remove('warming', 'veiled');
      dropPill();
      void island.offsetHeight;
      island.style.transition = '';
    }
  }
  // A real hover arriving during a warm-up ends it early and opens normally instead.
  function cancelWarm() {
    if (!warm) return;
    const run = warm;
    warm = null;
    clearTimeout(run.timer);
    abortWarm(run);
  }
  // The card's content also changes while the island is at rest — a track starts, its
  // artwork arrives, an activity lands. Those all paint something the warm-up has never
  // seen, so the card is warmed again; the key keeps it to one pass per content change.
  let warmKey = null;
  function warmKeyNow() {
    // Only what the card itself shows: the compact activity kind is left out so a volume
    // key press or a timer does not trigger another pass.
    return `${cardView || landingView()}|${(mediaState?.art || activeMedia?.art || '').length}`;
  }
  function scheduleWarmForContent() {
    if (expanded || hovering || exiting || warm) return;
    if (warmKeyNow() === warmKey) return;
    warmCard();
  }
  // Boot: compile the card's pipelines unseen, then drop in from above with a cute cue.
  warmCard({
    veiled: true,
    done: () => {
      island.classList.add('entering');
      // islandEnter (780 ms) finishing is the entrance completing; the fallback only covers
      // a missed event, so it is generous enough (900 ms) never to cut the drop-in short.
      onceAnimation(island, 'islandEnter', finishEnter, ANIM.enter + FALLBACK_SLACK);
      // After the class, so building the AudioContext (several hundred ms on Windows) runs
      // during the drop-in instead of holding it back.
      playCue('enter');
    }
  });

  window.islandAPI.on('island:exit', playExit);
  window.islandAPI.on('update:status', renderUpdate);
  $('updateRestart')?.addEventListener('click', event => {
    event.stopPropagation();
    window.islandAPI.installUpdate();
  });

  // One short blink every few seconds instead of an endless animation: the idle pill stays
  // completely still (and presents no frames) until it is time to blink.
  function scheduleBlink() {
    clearTimeout(blinkTimer);
    blinkTimer = setTimeout(() => {
      // Never blink over the entrance, a wake, an exit, or a card/banner: those either own
      // the same .eye transform or have hidden the idle view entirely.
      const busy = island.classList.contains('waking')
        || island.classList.contains('entering')
        || island.classList.contains('exiting');
      if (!busy && island.classList.contains('idle') && !expanded) {
        island.classList.add('blinking');
        setTimeout(() => { island.classList.remove('blinking'); scheduleBlink(); }, ANIM.blink + 40);
      } else {
        scheduleBlink();
      }
    }, 3400 + Math.random() * 3800);
  }
  scheduleBlink();

  setInterval(() => {
    updateHeader();
    // Nothing below this line applies without a track, and a paused player's clock does
    // not move, so an idle island does no layout work on this tick at all.
    if (!mediaState) return;
    if (lyrics?.synced) {
      if (cardView === 'lyrics') markLyricLines();
      if (manager.current?.type === 'media' && !expanded) showCurrentLyric();
    }
    // The timeline lives in the music pane, so a collapsed island or another pane needs no
    // layout here at all; opening the card refreshes it through updateCard.
    if (mediaState.playing && expanded && cardView === 'music') updateTimeline();
  }, 250);
  setInterval(() => {
    updateHeader();
    if (expanded) refreshBattery();
    if (cardView === 'volume' && expanded) refreshVolume();
  }, 60000);
})();
