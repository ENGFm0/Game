/* ═══════════════════════════════════════════════════════════
   Puzzle — image loading, slicing into pieces, and drawing the
   progress board (found pieces revealed, missing ones covered).
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const label = (r, c) => String.fromCharCode(65 + r) + (c + 1);

  function load(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('تعذر قراءة الصورة'));
      img.src = src;
    });
  }

  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  /** Reads a picked file, downsizes it to `maxSide`, returns {img, dataURL}. */
  async function fileToImage(file, maxSide) {
    const url = URL.createObjectURL(file);
    let img;
    try { img = await load(url); } finally { URL.revokeObjectURL(url); }
    const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
    const c = canvas(w, h);
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    const dataURL = c.toDataURL('image/jpeg', .88);
    return { img: await load(dataURL), dataURL };
  }

  /** Cuts the image into rows × cols pieces (JPEG data URLs). */
  function slice(img, rows, cols) {
    const W = img.naturalWidth, H = img.naturalHeight;
    const pieces = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = Math.round(c * W / cols), x1 = Math.round((c + 1) * W / cols);
        const y0 = Math.round(r * H / rows), y1 = Math.round((r + 1) * H / rows);
        const cv = canvas(x1 - x0, y1 - y0);
        cv.getContext('2d').drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
        pieces.push({ index: pieces.length, r, c, label: label(r, c), dataURL: cv.toDataURL('image/jpeg', .9), width: x1 - x0, height: y1 - y0 });
      }
    }
    return pieces;
  }

  /**
   * Draws the board: the photo with unfound pieces covered.
   * opts.grid draws all cell borders/labels (admin preview);
   * opts.selected highlights one cell.
   */
  function drawBoard(cv, img, rows, cols, found, opts = {}) {
    const maxW = opts.maxWidth || 900;
    const s = Math.min(1, maxW / img.naturalWidth);
    const W = Math.round(img.naturalWidth * s), H = Math.round(img.naturalHeight * s);
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0, W, H);
    const fs = Math.max(12, Math.min(W, H) / Math.max(rows, cols) * .22);
    ctx.font = `800 ${fs}px Tajawal, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = Math.round(c * W / cols), x1 = Math.round((c + 1) * W / cols);
        const y0 = Math.round(r * H / rows), y1 = Math.round((r + 1) * H / rows);
        const w = x1 - x0, h = y1 - y0, i = r * cols + c;
        const isFound = found && found.has(i);

        if (!opts.grid && !isFound) {
          ctx.fillStyle = '#0b3d2e';
          ctx.fillRect(x0, y0, w, h);
          ctx.strokeStyle = 'rgba(212,175,55,.35)'; ctx.lineWidth = 1;
          for (let k = -h; k < w; k += 18) { ctx.beginPath(); ctx.moveTo(x0 + k, y1); ctx.lineTo(x0 + k + h, y0); ctx.stroke(); }
          ctx.fillStyle = 'rgba(212,175,55,.9)';
          ctx.fillText('?', x0 + w / 2, y0 + h / 2 - fs * .15);
          ctx.font = `700 ${fs * .55}px Tajawal, system-ui, sans-serif`;
          ctx.fillText(label(r, c), x0 + w / 2, y0 + h / 2 + fs * .7);
          ctx.font = `800 ${fs}px Tajawal, system-ui, sans-serif`;
        }
        ctx.strokeStyle = isFound ? '#d4af37' : 'rgba(255,255,255,.7)';
        ctx.lineWidth = isFound ? 3 : 2;
        ctx.strokeRect(x0 + 1, y0 + 1, w - 2, h - 2);

        if (opts.grid) {
          ctx.fillStyle = 'rgba(11,61,46,.75)';
          const tw = fs * 1.8, th = fs * 1.1;
          ctx.fillRect(x0 + 6, y0 + 6, tw, th);
          ctx.fillStyle = '#f0d77a';
          ctx.font = `800 ${fs * .7}px Tajawal, system-ui, sans-serif`;
          ctx.fillText(label(r, c), x0 + 6 + tw / 2, y0 + 6 + th / 2);
          if (opts.selected === i) { ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 5; ctx.strokeRect(x0 + 3, y0 + 3, w - 6, h - 6); }
        }
      }
    }
    return { W, H };
  }

  window.Puzzle = { label, load, fileToImage, slice, drawBoard };
})();
