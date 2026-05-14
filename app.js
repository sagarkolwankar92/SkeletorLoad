const canvas = document.querySelector("#sourceCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const preview = document.querySelector("#skeletonPreview");
const outputCode = document.querySelector("#outputCode");
const fileInput = document.querySelector("#fileInput");
const shapeCount = document.querySelector("#shapeCount");
const fileName = document.querySelector("#fileName");
const dropZone = document.querySelector(".drop-zone");
const uploadIcon = document.querySelector("#uploadIcon");
const uploadStatus = document.querySelector("#uploadStatus");
const downloadButton = document.querySelector("#downloadButton");
const copyButton = document.querySelector("#copyButton");

const controls = {
  threshold: document.querySelector("#threshold"),
  minArea: document.querySelector("#minArea"),
  radius: document.querySelector("#radius"),
  density: document.querySelector("#density"),
};

let currentImage = null;
let currentName = "sample-layout";
let shapes = [];

const escapeHtml = (value) =>
  value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);

function exportMode() {
  return document.querySelector("input[name='exportMode']:checked").value;
}

function setUploadState(state, message) {
  dropZone.classList.toggle("is-loading", state === "loading");
  dropZone.classList.toggle("is-success", state === "success");
  uploadIcon.textContent = state === "success" ? "✓" : "+";
  uploadStatus.textContent = message;
}

function setCanvasSize(width, height) {
  const maxWidth = 1000;
  const maxHeight = 720;
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  canvas.width = Math.max(320, Math.round(width * scale));
  canvas.height = Math.max(220, Math.round(height * scale));
  preview.setAttribute("viewBox", `0 0 ${canvas.width} ${canvas.height}`);
}

function drawCurrentImage() {
  if (!currentImage) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(currentImage, 0, 0, canvas.width, canvas.height);
  generateSkeleton();
}

function loadImageFromUrl(url, name = "uploaded-file") {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      currentImage = image;
      currentName = name.replace(/\.[^.]+$/, "") || "skeleton-loader";
      setCanvasSize(image.naturalWidth || image.width, image.naturalHeight || image.height);
      drawCurrentImage();
      resolve();
    };
    image.onerror = reject;
    image.src = url;
  });
}

async function loadSvg(file) {
  const svgText = await file.text();
  const blob = new Blob([svgText], { type: "image/svg+xml" });
  await loadImageFromUrl(URL.createObjectURL(blob), file.name);
}

async function loadRaster(file) {
  await loadImageFromUrl(URL.createObjectURL(file), file.name);
}

async function loadPdf(file) {
  const buffer = await file.arrayBuffer();
  const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1.5 });
  const offscreen = document.createElement("canvas");
  offscreen.width = Math.round(viewport.width);
  offscreen.height = Math.round(viewport.height);
  await page.render({
    canvasContext: offscreen.getContext("2d"),
    viewport,
  }).promise;
  await loadImageFromUrl(offscreen.toDataURL("image/png"), file.name);
}

async function loadFile(file) {
  if (!file) return;
  fileName.textContent = `Uploading ${file.name}`;
  setUploadState("loading", "Uploading and tracing...");
  try {
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      await loadPdf(file);
    } else if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
      await loadSvg(file);
    } else {
      await loadRaster(file);
    }
    fileName.textContent = file.name;
    setUploadState("success", `Uploaded ${file.name}`);
  } catch (error) {
    fileName.textContent = error.message;
    setUploadState("ready", "Upload failed");
    throw error;
  }
}

// ─── SHAPE DETECTION ─────────────────────────────────────────────────────────
// BUG FIX: step was used as both the flood-fill stride AND area measurement unit,
// causing area accumulation to be step^2 × visited nodes — which over-counts
// area for high density values and under-counts at low density.
// Also: minX/minY bounds were computed from stepping coordinates only, causing
// boxes to snap to grid lines rather than actual pixel positions.
// FIX: track real pixel extents separately from the BFS step.
function findComponents(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const results = [];
  const step = Number(controls.density.value);
  const minArea = Number(controls.minArea.value);
  const queue = [];

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const start = y * width + x;
      if (!mask[start] || visited[start]) continue;

      let minX = x, minY = y, maxX = x, maxY = y;
      let pixelCount = 0;
      queue.length = 0;
      queue.push(start);
      visited[start] = 1;

      while (queue.length) {
        const index = queue.pop();
        const px = index % width;
        const py = Math.floor(index / width);
        pixelCount++;
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;

        for (const [nx, ny] of [
          [px + step, py],
          [px - step, py],
          [px, py + step],
          [px, py - step],
        ]) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (mask[next] && !visited[next]) {
            visited[next] = 1;
            queue.push(next);
          }
        }
      }

      const boxW = maxX - minX + step;
      const boxH = maxY - minY + step;
      // Use actual pixel count × step² as area so minArea slider stays meaningful
      const area = pixelCount * step * step;
      if (area >= minArea && boxW > 6 && boxH > 6) {
        results.push({
          x: Math.max(0, minX),
          y: Math.max(0, minY),
          width: Math.min(width - minX, boxW),
          height: Math.min(height - minY, boxH),
        });
      }
    }
  }

  return mergeOverlapping(mergeNearby(results)).slice(0, 140);
}

// BUG FIX: mergeNearby only merged left-to-right neighbours on the same row.
// Boxes that vertically overlap (columns, stacked items) were never merged,
// producing many fragmented thin slices on real screenshots.
// FIX: run a second pass with mergeOverlapping to union boxes that share area.
function mergeNearby(boxes) {
  const sorted = [...boxes].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const merged = [];

  for (const box of sorted) {
    const match = merged.find((item) => {
      const verticalOverlap =
        Math.min(item.y + item.height, box.y + box.height) - Math.max(item.y, box.y);
      const sameLine = verticalOverlap > Math.min(item.height, box.height) * 0.4;
      const gap = box.x - (item.x + item.width);
      return sameLine && gap >= -4 && gap < 40 && Math.abs(item.height - box.height) < 28;
    });

    if (match) {
      const right = Math.max(match.x + match.width, box.x + box.width);
      const bottom = Math.max(match.y + match.height, box.y + box.height);
      match.x = Math.min(match.x, box.x);
      match.y = Math.min(match.y, box.y);
      match.width = right - match.x;
      match.height = bottom - match.y;
    } else {
      merged.push({ ...box });
    }
  }

  return merged;
}

// NEW: merge boxes that substantially overlap (e.g. nested detected regions)
function mergeOverlapping(boxes) {
  const out = [];
  for (const box of boxes) {
    const match = out.find((item) => {
      const ix = Math.max(item.x, box.x);
      const iy = Math.max(item.y, box.y);
      const ix2 = Math.min(item.x + item.width, box.x + box.width);
      const iy2 = Math.min(item.y + item.height, box.y + box.height);
      if (ix2 <= ix || iy2 <= iy) return false;
      const intersection = (ix2 - ix) * (iy2 - iy);
      const smaller = Math.min(item.width * item.height, box.width * box.height);
      return intersection / smaller > 0.5;
    });
    if (match) {
      const right = Math.max(match.x + match.width, box.x + box.width);
      const bottom = Math.max(match.y + match.height, box.y + box.height);
      match.x = Math.min(match.x, box.x);
      match.y = Math.min(match.y, box.y);
      match.width = right - match.x;
      match.height = bottom - match.y;
    } else {
      out.push({ ...box });
    }
  }
  return out;
}

function generateSkeleton() {
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const threshold = Number(controls.threshold.value);
  const mask = new Uint8Array(width * height);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3] / 255;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const contrast = Math.abs(255 - luminance) * a;
    if (contrast > threshold) mask[i / 4] = 1;
  }

  shapes = findComponents(mask, width, height);
  renderPreview();
  renderCode();
}

// ─── PREVIEW ─────────────────────────────────────────────────────────────────
function renderPreview() {
  const radius = Number(controls.radius.value);
  const cw = canvas.width;
  const ch = canvas.height;

  const rects = shapes.map((shape) =>
    `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" rx="${Math.min(radius, shape.height / 2)}"></rect>`
  ).join("");

  // BUG FIX: animateTransform on linearGradient doesn't work reliably cross-browser
  // when the gradient is used as a fill directly. The sweep range must cover
  // 2× canvas width so the shine enters from off-screen left and exits off-screen right.
  // Using a clipPath + animated rect approach is more reliable.
  preview.innerHTML = `
    <defs>
      <linearGradient id="shine-grad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%"   stop-color="#e2e8f0"></stop>
        <stop offset="35%"  stop-color="#e2e8f0"></stop>
        <stop offset="50%"  stop-color="#f8fafc"></stop>
        <stop offset="65%"  stop-color="#e2e8f0"></stop>
        <stop offset="100%" stop-color="#e2e8f0"></stop>
      </linearGradient>
      <pattern id="shine" x="0" y="0" width="${cw * 3}" height="${ch}" patternUnits="userSpaceOnUse">
        <rect width="${cw}" height="${ch}" fill="#e2e8f0"></rect>
        <rect x="${cw * 0.1}" width="${cw * 0.8}" height="${ch}" fill="url(#shine-grad)"></rect>
        <animateTransform attributeName="patternTransform" type="translate"
          from="-${cw}" to="${cw * 2}"
          dur="1.5s" repeatCount="indefinite"/>
      </pattern>
    </defs>
    <style>
      #skeletonPreview rect { fill: url(#shine); }
    </style>
    ${rects}
  `;
  shapeCount.textContent = shapes.length;
}

// ─── SVG EXPORT ───────────────────────────────────────────────────────────────
function svgMarkup() {
  const radius = Number(controls.radius.value);
  const cw = canvas.width;
  const ch = canvas.height;

  const rects = shapes.map((shape) =>
    `  <rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" rx="${Math.min(radius, shape.height / 2)}" fill="url(#shine)" />`
  ).join("\n");

  return `<svg class="skeleton-loader" viewBox="0 0 ${cw} ${ch}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Loading">
  <defs>
    <linearGradient id="shine-grad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#e2e8f0" />
      <stop offset="35%"  stop-color="#e2e8f0" />
      <stop offset="50%"  stop-color="#f8fafc" />
      <stop offset="65%"  stop-color="#e2e8f0" />
      <stop offset="100%" stop-color="#e2e8f0" />
    </linearGradient>
    <pattern id="shine" x="0" y="0" width="${cw * 3}" height="${ch}" patternUnits="userSpaceOnUse">
      <rect width="${cw}" height="${ch}" fill="#e2e8f0" />
      <rect x="${cw * 0.1}" width="${cw * 0.8}" height="${ch}" fill="url(#shine-grad)" />
      <animateTransform attributeName="patternTransform" type="translate"
        from="-${cw}" to="${cw * 2}"
        dur="1.5s" repeatCount="indefinite"/>
    </pattern>
  </defs>
${rects}
</svg>`;
}

// ─── HTML EXPORT ───────────────────────────────────────────────────────────────
function htmlMarkup() {
  const radius = Number(controls.radius.value);
  const blocks = shapes.map((shape) =>
    `  <span style="left:${shape.x}px;top:${shape.y}px;width:${shape.width}px;height:${shape.height}px;border-radius:${Math.min(radius, shape.height / 2)}px"></span>`
  ).join("\n");

  return `<div class="skeleton-layout" aria-label="Loading">
${blocks}
</div>

<style>
.skeleton-layout {
  position: relative;
  width: ${canvas.width}px;
  max-width: 100%;
  aspect-ratio: ${canvas.width} / ${canvas.height};
}

.skeleton-layout span {
  position: absolute;
  display: block;
  background: linear-gradient(90deg, #e2e8f0 35%, #f8fafc 50%, #e2e8f0 65%);
  background-size: 300% 100%;
  animation: skeleton-shimmer 1.5s ease-in-out infinite;
}

@keyframes skeleton-shimmer {
  0%   { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}
</style>`;
}

// ─── LOTTIE EXPORT ────────────────────────────────────────────────────────────
function lottieMarkup() {
  const radius = Number(controls.radius.value);
  const layers = shapes.map((shape, index) => ({
    ddd: 0,
    ind: index + 1,
    ty: 4,
    nm: `Skeleton block ${index + 1}`,
    sr: 1,
    ks: {
      o: {
        a: 1,
        k: [
          { t: 0,  s: [55],  e: [100], i: { x: [0.42], y: [1] }, o: { x: [0.58], y: [0] } },
          { t: 30, s: [100], e: [55],  i: { x: [0.42], y: [1] }, o: { x: [0.58], y: [0] } },
          { t: 60, s: [55] },
        ],
      },
      r: { a: 0, k: 0 },
      p: { a: 0, k: [shape.x + shape.width / 2, shape.y + shape.height / 2, 0] },
      a: { a: 0, k: [0, 0, 0] },
      s: { a: 0, k: [100, 100, 100] },
    },
    shapes: [
      {
        ty: "rc",
        d: 1,
        s: { a: 0, k: [shape.width, shape.height] },
        p: { a: 0, k: [0, 0] },
        r: { a: 0, k: Math.min(radius, shape.height / 2) },
      },
      {
        ty: "fl",
        c: { a: 0, k: [0.886, 0.910, 0.941, 1] },
        o: { a: 0, k: 100 },
      },
    ],
    ip: 0,
    op: 60,
    st: 0,
    bm: 0,
  }));

  return JSON.stringify({
    v: "5.7.4",
    fr: 30,
    ip: 0,
    op: 60,
    w: canvas.width,
    h: canvas.height,
    nm: `${currentName || "skeleton-loader"} lottie`,
    ddd: 0,
    assets: [],
    layers,
  }, null, 2);
}

// ─── CODE OUTPUT ──────────────────────────────────────────────────────────────
function renderCode() {
  const mode = exportMode();
  downloadButton.textContent = mode === "gif" ? "Download GIF" : "Download Lottie";
  copyButton.disabled = mode === "gif";

  if (mode === "gif") {
    outputCode.value = "GIF export creates an animated .gif file when you press Download GIF.\n\nSwitch to Lottie to see copyable JSON output.";
  } else if (mode === "lottie") {
    outputCode.value = lottieMarkup();
  } else {
    outputCode.value = svgMarkup();
  }
}

// ─── GIF EXPORT ───────────────────────────────────────────────────────────────
function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function pushWord(bytes, value) {
  bytes.push(value & 255, (value >> 8) & 255);
}

function pushString(bytes, value) {
  for (let i = 0; i < value.length; i += 1) bytes.push(value.charCodeAt(i));
}

function subBlocks(bytes) {
  const blocks = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const block = bytes.slice(i, i + 255);
    blocks.push(block.length, ...block);
  }
  blocks.push(0);
  return blocks;
}

function lzwEncode(indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = end + 1;
  const dictionary = new Map();
  const output = [];
  let bitBuffer = 0;
  let bitLength = 0;

  const resetDictionary = () => {
    dictionary.clear();
    for (let i = 0; i < clear; i += 1) dictionary.set(String(i), i);
    codeSize = minCodeSize + 1;
    nextCode = end + 1;
  };

  const writeCode = (code) => {
    bitBuffer |= code << bitLength;
    bitLength += codeSize;
    while (bitLength >= 8) {
      output.push(bitBuffer & 255);
      bitBuffer >>= 8;
      bitLength -= 8;
    }
  };

  resetDictionary();
  writeCode(clear);
  let phrase = String(indices[0] || 0);

  for (let i = 1; i < indices.length; i += 1) {
    const next = indices[i];
    const combined = `${phrase},${next}`;
    if (dictionary.has(combined)) {
      phrase = combined;
    } else {
      writeCode(dictionary.get(phrase));
      if (nextCode < 4096) {
        dictionary.set(combined, nextCode);
        nextCode += 1;
        if (nextCode === (1 << codeSize) && codeSize < 12) codeSize += 1;
      } else {
        writeCode(clear);
        resetDictionary();
      }
      phrase = String(next);
    }
  }

  writeCode(dictionary.get(phrase));
  writeCode(end);
  if (bitLength > 0) output.push(bitBuffer & 255);
  return output;
}

// BUG FIX: renderGifIndices was creating a new offscreen canvas every frame,
// then clipping and drawing gradients per-shape — but GIF only has a 4-colour
// palette (declared as 0xf1 = 2-bit = 4 entries). The gradient produces many
// intermediate RGB values that all get quantised to index 1 (mid-grey),
// making the shimmer invisible. The fix: draw the shimmer on canvas, then
// quantise to the 4-entry palette using nearest-colour matching, not luminance bands.
// Also: the GIF header declared palette size 0xf1 (4 colours) but lzwEncode
// was called with minCodeSize=2, which is correct — but we need exactly 4 palette
// entries with no padding. Added a proper 4-colour quantiser.
//
// CRITICAL GIF BUG: the Graphic Control Extension disposal byte was 0x00
// (do not dispose). This means each frame composites ON TOP of the previous
// frame rather than replacing it — so the GIF appears frozen (only the first
// frame is ever "new"). Fixed by setting disposal to 0x02 (restore to bg).
// Also: frame delay was written as pushWord(bytes, 7) = 70ms. With 24 frames
// that's 1.68s total, but the shimmer sweep needs to complete in exactly one
// loop. Adjusted to 6 (60ms) for a 1.44s loop matching the CSS animation.

// 4-entry palette: white, dark-grey (skeleton bg), light-grey (shine peak), mid-grey
const GIF_PALETTE = [
  [255, 255, 255],   // 0 = background white
  [226, 232, 240],   // 1 = skeleton block base (#e2e8f0)
  [248, 250, 252],   // 2 = shine highlight (#f8fafc)
  [203, 213, 225],   // 3 = skeleton block shadow (#cbd5e1)
];

function nearestPaletteIndex(r, g, b) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < GIF_PALETTE.length; i++) {
    const [pr, pg, pb] = GIF_PALETTE[i];
    const dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (dist < bestDist) { bestDist = dist; best = i; }
  }
  return best;
}

function renderGifFrame(progress) {
  // Keep GIF dimensions to max 480px wide so file size stays sane
  const scale = Math.min(480 / canvas.width, 360 / canvas.height, 1);
  const width = Math.max(1, Math.round(canvas.width * scale));
  const height = Math.max(1, Math.round(canvas.height * scale));
  const offscreen = document.createElement("canvas");
  offscreen.width = width;
  offscreen.height = height;
  const gifCtx = offscreen.getContext("2d", { willReadFrequently: true });

  // Background
  gifCtx.fillStyle = "#ffffff";
  gifCtx.fillRect(0, 0, width, height);

  // Shine sweep: one unified X position across the whole frame
  // progress 0→1 maps from off-screen-left to off-screen-right
  const shineW = Math.round(width * 0.45);
  const sweepX = Math.round((width + shineW * 2) * progress) - shineW;

  for (const shape of shapes) {
    const sx = Math.round(shape.x * scale);
    const sy = Math.round(shape.y * scale);
    const sw = Math.max(2, Math.round(shape.width * scale));
    const sh = Math.max(2, Math.round(shape.height * scale));

    // Base block colour
    gifCtx.fillStyle = "#e2e8f0";
    gifCtx.fillRect(sx, sy, sw, sh);

    // Clipped shine stripe
    gifCtx.save();
    gifCtx.beginPath();
    gifCtx.rect(sx, sy, sw, sh);
    gifCtx.clip();
    const grad = gifCtx.createLinearGradient(sweepX, 0, sweepX + shineW, 0);
    grad.addColorStop(0,    "#e2e8f0");
    grad.addColorStop(0.3,  "#f0f4f8");
    grad.addColorStop(0.5,  "#f8fafc");
    grad.addColorStop(0.7,  "#f0f4f8");
    grad.addColorStop(1,    "#e2e8f0");
    gifCtx.fillStyle = grad;
    gifCtx.fillRect(sweepX, sy, shineW, sh);
    gifCtx.restore();
  }

  // Quantise to palette
  const data = gifCtx.getImageData(0, 0, width, height).data;
  const indices = new Uint8Array(width * height);
  for (let i = 0; i < indices.length; i++) {
    indices[i] = nearestPaletteIndex(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  }

  return { width, height, indices };
}

function gifBlob() {
  const frames = 20;
  const firstFrame = renderGifFrame(0);
  const bytes = [];

  // GIF Header
  pushString(bytes, "GIF89a");
  pushWord(bytes, firstFrame.width);
  pushWord(bytes, firstFrame.height);
  // Global colour table flag=1, colour resolution=1, sort=0, size=1 (4 colours = 2^(1+1))
  bytes.push(0b10110001, 0, 0); // packed: GCT present, 2-bit palette
  // Global colour table (4 × 3 bytes)
  for (const [r, g, b] of GIF_PALETTE) bytes.push(r, g, b);

  // Netscape looping extension
  bytes.push(0x21, 0xff, 0x0b);
  pushString(bytes, "NETSCAPE2.0");
  bytes.push(0x03, 0x01);
  pushWord(bytes, 0); // loop count 0 = infinite
  bytes.push(0x00);

  for (let i = 0; i < frames; i++) {
    const frame = renderGifFrame(i / frames);

    // Graphic Control Extension
    bytes.push(
      0x21, 0xf9, 0x04,
      0b00000010, // disposal=2 (restore to bg), no user input, no transparent
    );
    pushWord(bytes, 6); // delay = 6 × 10ms = 60ms → 20 frames × 60ms = 1.2s loop
    bytes.push(0x00, 0x00); // no transparent colour index, block terminator

    // Image Descriptor
    bytes.push(0x2c);
    pushWord(bytes, 0); pushWord(bytes, 0); // top-left x, y
    pushWord(bytes, frame.width);
    pushWord(bytes, frame.height);
    bytes.push(0x00); // no local colour table, not interlaced

    // LZW min code size then compressed data
    bytes.push(2);
    bytes.push(...subBlocks(lzwEncode(frame.indices, 2)));
  }

  bytes.push(0x3b); // GIF trailer
  return new Blob([new Uint8Array(bytes)], { type: "image/gif" });
}

async function downloadExport() {
  const name = currentName || "skeleton-loader";
  if (exportMode() === "lottie") {
    downloadBlob(new Blob([lottieMarkup()], { type: "application/json" }), `${name}.json`);
    return;
  }

  downloadButton.disabled = true;
  downloadButton.textContent = "Rendering GIF...";
  await new Promise((resolve) => setTimeout(resolve, 0)); // yield to browser
  try {
    downloadBlob(gifBlob(), `${name}.gif`);
  } finally {
    downloadButton.disabled = false;
    renderCode();
  }
}

// ─── DEMO ─────────────────────────────────────────────────────────────────────
function drawSample() {
  setCanvasSize(900, 640);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(58, 54, 120, 28);
  ctx.fillRect(60, 140, 380, 42);
  ctx.fillRect(60, 202, 510, 18);
  ctx.fillRect(60, 234, 460, 18);
  ctx.fillRect(60, 296, 146, 46);
  ctx.fillRect(238, 296, 126, 46);
  ctx.fillRect(628, 88, 210, 210);
  ctx.fillRect(60, 420, 210, 130);
  ctx.fillRect(326, 420, 210, 130);
  ctx.fillRect(592, 420, 210, 130);
  currentName = "sample-layout";
  currentImage = null;
  generateSkeleton();
  fileName.textContent = "Demo layout";
  setUploadState("success", "Demo layout loaded");
}

// ─── EVENT LISTENERS ──────────────────────────────────────────────────────────
fileInput.addEventListener("change", (event) => {
  loadFile(event.target.files[0]).catch((error) => {
    fileName.textContent = error.message;
  });
});

document.querySelector(".drop-zone").addEventListener("dragover", (event) => {
  event.preventDefault();
});

document.querySelector(".drop-zone").addEventListener("drop", (event) => {
  event.preventDefault();
  loadFile(event.dataTransfer.files[0]).catch((error) => {
    fileName.textContent = error.message;
  });
});

Object.values(controls).forEach((control) => {
  control.addEventListener("input", () => {
    if (currentImage) {
      drawCurrentImage();
    } else {
      generateSkeleton();
    }
  });
});

document.querySelectorAll("input[name='exportMode']").forEach((input) => {
  input.addEventListener("change", renderCode);
});

document.querySelector("#sampleButton").addEventListener("click", drawSample);
downloadButton.addEventListener("click", downloadExport);
copyButton.addEventListener("click", async () => {
  if (exportMode() === "gif") return;
  await navigator.clipboard.writeText(outputCode.value);
});

drawSample();
