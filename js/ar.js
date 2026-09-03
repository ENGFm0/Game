/* ═══════════════════════════════════════════════════════════
   HuntAR — image recognition (MindAR image tracking, vanilla).
   • compile(): turns the puzzle pieces into recognition targets
     right in the browser (admin does this once).
   • start(): opens the rear camera and reports which piece is
     in view.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG;
  let lib = null, controller = null, stream = null, video = null, running = false, frame = null, raf = 0;
  const visible = new Set();

  async function load() {
    // dynamic import() resolves relative to this script, so anchor the path to the page
    if (!lib) lib = await import(new URL(CFG.mindarUrl, document.baseURI).href);
    return lib;
  }

  /** Compiles piece images (data URLs) → Uint8Array of recognition data. */
  async function compile(dataURLs, onProgress) {
    const { Compiler } = await load();
    const images = await Promise.all(dataURLs.map(Puzzle.load));
    const compiler = new Compiler();
    await compiler.compileImageTargets(images, (p) => onProgress && onProgress(p));
    const out = compiler.exportData();
    // exportData returns a view over a shared buffer — copy it before storing.
    return new Uint8Array(out).slice();
  }

  /* base64 helpers for storing the compiled data */
  function toBase64(u8) {
    return new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1]);
      fr.readAsDataURL(new Blob([u8]));
    });
  }
  async function fromBase64(b64) {
    const r = await fetch('data:application/octet-stream;base64,' + b64);
    return r.arrayBuffer();
  }

  const supported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  /**
   * Starts scanning. onFound(index) fires once each time a piece enters view.
   * Throws with an Arabic message on failure.
   */
  async function start({ video: v, buffer, onFound, onLost, onStatus }) {
    if (running) return;
    const status = (t) => onStatus && onStatus(t);
    if (!supported()) throw new Error('المتصفح لا يدعم الكاميرا. استخدم Chrome أو Safari عبر HTTPS.');

    status('جارٍ تحميل محرك التعرف…');
    const { Controller } = await load();

    status('طلب إذن الكاميرا…');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch (e) {
      const denied = /NotAllowed|Permission/i.test(e && e.name);
      throw new Error(denied ? 'تم رفض إذن الكاميرا — فعّله من إعدادات المتصفح ثم أعد المحاولة' : 'تعذر فتح الكاميرا: ' + (e.message || e.name));
    }

    video = v;
    v.srcObject = stream; v.muted = true; v.setAttribute('playsinline', ''); v.setAttribute('autoplay', '');
    await new Promise((res) => { if (v.readyState >= 1) res(); else v.onloadedmetadata = () => res(); });
    await v.play();

    // Frames are copied to a canvas and the canvas is analysed: uploading the
    // <video> element directly to the GPU is unreliable on some browsers.
    frame = document.createElement('canvas');
    frame.width = v.videoWidth; frame.height = v.videoHeight;
    const fctx = frame.getContext('2d', { willReadFrequently: true });
    const pump = () => { if (!frame) return; fctx.drawImage(v, 0, 0, frame.width, frame.height); raf = requestAnimationFrame(pump); };
    pump();

    status('تحميل القطع…');
    visible.clear();
    controller = new Controller({
      inputWidth: frame.width, inputHeight: frame.height,
      maxTrack: 1, warmupTolerance: 5, missTolerance: 12,
      onUpdate: (d) => {
        if (d.type !== 'updateMatrix') return;
        const i = d.targetIndex, on = !!d.worldMatrix;
        if (on && !visible.has(i)) { visible.add(i); onFound && onFound(i); }
        else if (!on && visible.has(i)) { visible.delete(i); onLost && onLost(i); }
      },
    });
    controller.addImageTargetsFromBuffer(buffer);

    status('تهيئة المعالج…');
    await new Promise((r) => setTimeout(r, 30));
    controller.dummyRun(frame);
    controller.processVideo(frame);
    running = true;
    status('وجّه الكاميرا نحو إحدى القطع');
  }

  function stop() {
    if (controller) { try { controller.stopProcessVideo(); controller.dispose(); } catch (_) { /* ignore */ } controller = null; }
    cancelAnimationFrame(raf); frame = null;
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    if (video) { video.srcObject = null; video = null; }
    visible.clear();
    running = false;
  }

  window.HuntAR = { compile, start, stop, toBase64, fromBase64, supported, get running() { return running; } };
})();
