/* ═══════════════════════════════════════════════════════════
   HuntAR — WebAR engine wrapper (MindAR.js + A-Frame)
   Libraries are loaded lazily on first camera start so the
   dashboard stays light until the player opts in.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const AFRAME_SRC = 'https://cdn.jsdelivr.net/npm/aframe@1.4.2/dist/aframe.min.js';
  const MINDAR_SRC = 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-aframe.prod.js';

  let cfg, els, on = {}, scene = null, libsReady = null, running = false, simTimer = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src; s.async = true; s.onload = resolve; s.onerror = () => reject(new Error('فشل تحميل ' + src));
      document.head.appendChild(s);
    });
  }

  function loadLibs() {
    if (!libsReady) libsReady = loadScript(AFRAME_SRC).then(() => loadScript(MINDAR_SRC));
    return libsReady;
  }

  function setStatus(text, level) {
    const dot = { live: '', idle: 'dot--idle', warn: 'dot--warn' }[level || 'idle'];
    els.status.innerHTML = `<span class="dot ${dot}"></span> ${text}`;
    on.status && on.status(text, level);
  }

  function init(options) {
    cfg = options.config; els = options.els; on = options;
    els.permission.hidden = true;
    setStatus('WebAR Idle', 'idle');
  }

  /** Shows the in-page permission sheet; resolves true when the player allows. */
  function askPermission() {
    return new Promise((resolve) => {
      els.permission.hidden = false;
      const done = (ok) => { els.permission.hidden = true; els.allow.onclick = els.deny.onclick = null; resolve(ok); };
      els.allow.onclick = () => done(true);
      els.deny.onclick = () => done(false);
    });
  }

  /** Builds the golden sword as A-Frame primitives (no external model required). */
  function swordEntity() {
    return `
      <a-entity id="arSword" position="0 0 0.15" rotation="0 0 -30" scale="0.35 0.35 0.35"
                animation="property: rotation; to: 0 360 -30; loop: true; dur: 6000; easing: linear"
                animation__float="property: position; from: 0 -0.05 0.15; to: 0 0.1 0.15; dir: alternate; loop: true; dur: 1600; easing: easeInOutSine">
        <a-box position="0 0.55 0" width="0.12" height="1.1" depth="0.03" color="#f0d77a" metalness="0.8" roughness="0.25"></a-box>
        <a-cone position="0 1.16 0" radius-bottom="0.06" radius-top="0" height="0.2" color="#fff1b8" metalness="0.9" roughness="0.2"></a-cone>
        <a-box position="0 0 0" width="0.45" height="0.08" depth="0.08" color="#d4af37" metalness="0.9" roughness="0.3"></a-box>
        <a-cylinder position="0 -0.2 0" radius="0.045" height="0.35" color="#7a5a12"></a-cylinder>
        <a-sphere position="0 -0.42 0" radius="0.07" color="#d4af37" metalness="0.9"></a-sphere>
        <a-light type="point" intensity="0.8" color="#ffe9a8" position="0 0.6 0.4"></a-light>
      </a-entity>`;
  }

  async function start() {
    if (running) return;
    setStatus('Loading WebAR…', 'warn');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('الكاميرا غير مدعومة', 'warn');
      on.error && on.error('المتصفح لا يدعم الوصول إلى الكاميرا. استخدم Chrome أو Safari الحديث عبر HTTPS.');
      return false;
    }

    try {
      await loadLibs();
    } catch (e) {
      setStatus('WebAR load failed', 'warn');
      on.error && on.error(e.message);
      return false;
    }

    els.scene.innerHTML = `
      <a-scene mindar-image="imageTargetSrc: ${cfg.ar.targetSrc}; autoStart: false; uiLoading: no; uiScanning: no; uiError: no;"
               color-space="sRGB" renderer="colorManagement: true, physicallyCorrectLights"
               vr-mode-ui="enabled: false" device-orientation-permission-ui="enabled: false" embedded>
        <a-camera position="0 0 0" look-controls="enabled: false"></a-camera>
        <a-entity mindar-image-target="targetIndex: 0">${swordEntity()}</a-entity>
      </a-scene>`;
    scene = els.scene.querySelector('a-scene');

    scene.addEventListener('targetFound', () => {
      els.box.classList.add('is-found');
      setStatus('Target locked — ' + cfg.ar.targetLabel, 'live');
      on.found && on.found();
    });
    scene.addEventListener('targetLost', () => {
      els.box.classList.remove('is-found');
      setStatus('WebAR Active - MindAR.js Engine Running', 'live');
    });

    const boot = () => new Promise((resolve, reject) => {
      const sys = scene.systems['mindar-image-system'];
      if (!sys) return reject(new Error('MindAR system missing'));
      sys.start().then(resolve).catch(reject);
    });

    try {
      if (scene.hasLoaded) await boot();
      else await new Promise((resolve, reject) => scene.addEventListener('loaded', () => boot().then(resolve, reject), { once: true }));
      running = true;
      els.box.classList.add('is-live');
      setStatus('WebAR Active - MindAR.js Engine Running', 'live');
      return true;
    } catch (e) {
      stop();
      const denied = /denied|permission|NotAllowed/i.test(String(e && (e.name || e.message)));
      setStatus(denied ? 'Camera blocked' : 'WebAR error', 'warn');
      on.error && on.error(denied ? 'تم رفض إذن الكاميرا. فعّل الإذن من إعدادات المتصفح ثم أعد المحاولة.' : 'تعذر تشغيل محرك الواقع المعزز: ' + (e.message || e));
      return false;
    }
  }

  function stop() {
    if (scene) {
      try { const sys = scene.systems['mindar-image-system']; sys && sys.stop(); } catch (_) { /* ignore */ }
      els.scene.innerHTML = '';
      scene = null;
    }
    running = false;
    els.box.classList.remove('is-live', 'is-found');
    setStatus('WebAR Idle', 'idle');
  }

  /** Demo mode: plays the recognition animation without a camera. */
  function simulate() {
    clearTimeout(simTimer);
    els.box.classList.remove('is-found');
    setStatus('Scanning…', 'warn');
    simTimer = setTimeout(() => {
      els.box.classList.add('is-found');
      setStatus('WebAR Active - MindAR.js Engine Running', 'live');
      on.found && on.found({ simulated: true });
      simTimer = setTimeout(() => { if (!running) { els.box.classList.remove('is-found'); setStatus('WebAR Idle', 'idle'); } }, 6000);
    }, 1400);
  }

  window.HuntAR = { init, askPermission, start, stop, simulate, get running() { return running; } };
})();
