const canvas = document.querySelector("#sourceCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const preview = document.querySelector("#skeletonPreview");
const fileInput = document.querySelector("#fileInput");
const shapeCount = document.querySelector("#shapeCount");
const fileName = document.querySelector("#fileName");
const dropZone = document.querySelector("#dropZone");
const uploadIcon = document.querySelector("#uploadIcon");
const uploadTitle = document.querySelector("#uploadTitle");
const uploadHint = document.querySelector("#uploadHint");
const uploadStatus = document.querySelector("#uploadStatus");
const removeFileButton = document.querySelector("#removeFileButton");
const sourceEmpty = document.querySelector("#sourceEmpty");
const loaderEmpty = document.querySelector("#loaderEmpty");
const downloadButton = document.querySelector("#downloadButton");
const exportName = document.querySelector("#exportName");
const exportMeta = document.querySelector("#exportMeta");
const advancedControls = document.querySelector("#advancedControls");

const controls = {
  threshold: document.querySelector("#threshold"),
  shapeLimit: document.querySelector("#shapeLimit"),
  radius: document.querySelector("#radius"),
  useColor: document.querySelector("#useColor"),
  targetSize: document.querySelector("#targetSize"),
};

const outputs = {
  threshold: document.querySelector("#thresholdValue"),
  shapeLimit: document.querySelector("#shapeLimitValue"),
};

let currentImage = null;
let currentName = "skeleton-loader";
let shapes = [];
let sourcePixels = null;

function exportMode() {
  return document.querySelector("input[name='exportMode']:checked").value;
}

function controlMode() {
  return document.querySelector("input[name='controlMode']:checked").value;
}

function safeFileName(value) {
  return (value || "skeleton-loader")
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    || "skeleton-loader";
}

function setUploadState(state, message) {
  const hasFile = state === "success";
  dropZone.classList.toggle("is-loading", state === "loading");
  dropZone.classList.toggle("has-file", hasFile);
  uploadIcon.textContent = hasFile ? "OK" : "+";
  uploadTitle.textContent = hasFile ? currentName : "Upload file";
  uploadHint.textContent = hasFile ? "Click the X to remove it" : "PNG, JPG, WebP, SVG, or PDF";
  uploadStatus.textContent = message;
}

function setEmptyState(isEmpty) {
  sourceEmpty.classList.toggle("is-hidden", !isEmpty);
  loaderEmpty.classList.toggle("is-hidden", !isEmpty);
  downloadButton.disabled = isEmpty;
}

function updateControlLabels() {
  outputs.threshold.textContent = controls.threshold.value;
  outputs.shapeLimit.textContent = `${controls.shapeLimit.value} boxes`;
  advancedControls.classList.toggle("is-visible", controlMode() === "advanced");
}

function setCanvasSize(width, height) {
  const maxWidth = 1100;
  const maxHeight = 760;
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  canvas.width = Math.max(320, Math.round(width * scale));
  canvas.height = Math.max(220, Math.round(height * scale));
  document.querySelectorAll(".canvas-frame").forEach((frame) => {
    frame.style.setProperty("--preview-aspect", `${canvas.width} / ${canvas.height}`);
  });
  preview.setAttribute("viewBox", `0 0 ${canvas.width} ${canvas.height}`);
}

function drawCurrentImage() {
  if (!currentImage) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(currentImage, 0, 0, canvas.width, canvas.height);
  sourcePixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  generateSkeleton();
}

function clearFile() {
  currentImage = null;
  sourcePixels = null;
  shapes = [];
  fileInput.value = "";
  currentName = "skeleton-loader";
  exportName.value = currentName;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  preview.innerHTML = "";
  shapeCount.textContent = "0";
  fileName.textContent = "No file loaded";
  exportMeta.textContent = "Upload a file to enable export.";
  setEmptyState(true);
  setUploadState("ready", "Ready for upload");
}

function loadImageFromUrl(url, name = "uploaded-file") {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      currentImage = image;
      currentName = safeFileName(name);
      exportName.value = currentName;
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
    setUploadState("success", file.name);
    setEmptyState(false);
    renderExportMeta();
  } catch (error) {
    fileName.textContent = error.message;
    setUploadState("ready", "Upload failed");
    setEmptyState(!currentImage);
    throw error;
  }
}

function shapeColor(shape) {
  if (!sourcePixels) {
    return { fill: "#e2e8f0", shine: "#f8fafc", palette: [226, 232, 240] };
  }

  const data = sourcePixels.data;
  const startX = Math.max(0, Math.floor(shape.x));
  const startY = Math.max(0, Math.floor(shape.y));
  const endX = Math.min(sourcePixels.width, Math.ceil(shape.x + shape.width));
  const endY = Math.min(sourcePixels.height, Math.ceil(shape.y + shape.height));
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (let y = startY; y < endY; y += 2) {
    for (let x = startX; x < endX; x += 2) {
      const index = (y * sourcePixels.width + x) * 4;
      r += data[index];
      g += data[index + 1];
      b += data[index + 2];
      count += 1;
    }
  }

  if (!count) return { fill: "#e2e8f0", shine: "#f8fafc", palette: [226, 232, 240] };
  r = Math.round(r / count);
  g = Math.round(g / count);
  b = Math.round(b / count);

  if (!controls.useColor.checked) {
    const gray = Math.round(210 + ((r + g + b) / 3 / 255) * 24);
    return {
      fill: `rgb(${gray}, ${gray + 4}, ${gray + 10})`,
      shine: "#f8fafc",
      palette: [gray, Math.min(255, gray + 4), Math.min(255, gray + 10)],
    };
  }

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const luminance = (r + g + b) / 3;
  let hue = (luminance / 255) * 300;

  if (max !== min) {
    if (max === r) hue = (60 * ((g - b) / (max - min)) + 360) % 360;
    if (max === g) hue = 60 * ((b - r) / (max - min)) + 120;
    if (max === b) hue = 60 * ((r - g) / (max - min)) + 240;
  }

  return {
    fill: `hsl(${Math.round(hue)}, 42%, 82%)`,
    shine: `hsl(${Math.round(hue)}, 70%, 96%)`,
    palette: [r, g, b],
  };
}

function findComponents(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const results = [];
  const step = controlMode() === "advanced" ? 2 : 4;
  const minArea = controlMode() === "advanced" ? 12 : 32;
  const queue = [];

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const start = y * width + x;
      if (!mask[start] || visited[start]) continue;

      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let pixelCount = 0;
      queue.length = 0;
      queue.push(start);
      visited[start] = 1;

      while (queue.length) {
        const index = queue.pop();
        const px = index % width;
        const py = Math.floor(index / width);
        pixelCount += 1;
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);

        const neighbors = [
          [px + step, py],
          [px - step, py],
          [px, py + step],
          [px, py - step],
        ];

        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (mask[next] && !visited[next]) {
            visited[next] = 1;
            queue.push(next);
          }
        }
      }

      const boxWidth = maxX - minX + step;
      const boxHeight = maxY - minY + step;
      const area = pixelCount * step * step;
      if (area >= minArea && boxWidth > 6 && boxHeight > 6) {
        results.push({
          x: Math.max(0, minX),
          y: Math.max(0, minY),
          width: Math.min(width - minX, boxWidth),
          height: Math.min(height - minY, boxHeight),
          area,
        });
      }
    }
  }

  const limit = Number(controls.shapeLimit.value);
  return mergeOverlapping(mergeNearby(results))
    .sort((a, b) => b.area - a.area)
    .slice(0, limit)
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));
}

function mergeNearby(boxes) {
  const sorted = [...boxes].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const merged = [];

  for (const box of sorted) {
    const match = merged.find((item) => {
      const verticalOverlap = Math.min(item.y + item.height, box.y + box.height) - Math.max(item.y, box.y);
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
      match.area = match.width * match.height;
    } else {
      merged.push({ ...box });
    }
  }

  return merged;
}

function mergeOverlapping(boxes) {
  const merged = [];

  for (const box of boxes) {
    const match = merged.find((item) => {
      const left = Math.max(item.x, box.x);
      const top = Math.max(item.y, box.y);
      const right = Math.min(item.x + item.width, box.x + box.width);
      const bottom = Math.min(item.y + item.height, box.y + box.height);
      if (right <= left || bottom <= top) return false;
      const intersection = (right - left) * (bottom - top);
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
      match.area = match.width * match.height;
    } else {
      merged.push({ ...box });
    }
  }

  return merged;
}

function generateSkeleton() {
  if (!currentImage || !sourcePixels) return;
  const { width, height } = canvas;
  const data = sourcePixels.data;
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

  shapes = findComponents(mask, width, height).map((shape) => ({
    ...shape,
    color: shapeColor(shape),
  }));
  renderPreview();
  renderExportMeta();
}

function gradientDef(shape, index) {
  if (!controls.useColor.checked) return "";
  return `
      <linearGradient id="shine-${index}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="${shape.color.fill}"></stop>
        <stop offset="50%" stop-color="${shape.color.shine}"></stop>
        <stop offset="100%" stop-color="${shape.color.fill}"></stop>
      </linearGradient>`;
}

function renderPreview() {
  const radius = Math.max(0, Number(controls.radius.value) || 0);
  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;
  const gradients = shapes.map(gradientDef).join("");
  const rects = shapes.map((shape, index) => {
    const fill = controls.useColor.checked ? `url(#shine-${index})` : "url(#shine)";
    return `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" rx="${Math.min(radius, shape.height / 2)}" fill="${fill}"></rect>`;
  }).join("");

  preview.innerHTML = `
    <defs>
      <linearGradient id="shine-grad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#e2e8f0"></stop>
        <stop offset="35%" stop-color="#e2e8f0"></stop>
        <stop offset="50%" stop-color="#f8fafc"></stop>
        <stop offset="65%" stop-color="#e2e8f0"></stop>
        <stop offset="100%" stop-color="#e2e8f0"></stop>
      </linearGradient>
      <pattern id="shine" x="0" y="0" width="${canvasWidth * 3}" height="${canvasHeight}" patternUnits="userSpaceOnUse">
        <rect width="${canvasWidth}" height="${canvasHeight}" fill="#e2e8f0"></rect>
        <rect x="${canvasWidth * 0.1}" width="${canvasWidth * 0.8}" height="${canvasHeight}" fill="url(#shine-grad)"></rect>
        <animateTransform attributeName="patternTransform" type="translate"
          from="-${canvasWidth}" to="${canvasWidth * 2}"
          dur="1.5s" repeatCount="indefinite"></animateTransform>
      </pattern>
      ${gradients}
    </defs>
    <style>
      #skeletonPreview rect { animation: loader-pulse 1.5s ease-in-out infinite; }
      @keyframes loader-pulse { 0%, 100% { opacity: .8; } 50% { opacity: 1; } }
    </style>
    ${rects}
  `;
  shapeCount.textContent = shapes.length;
}

function lottieColor(shape) {
  if (!controls.useColor.checked) return [0.886, 0.91, 0.941, 1];
  const [r, g, b] = shape.color.palette;
  return [r / 255, g / 255, b / 255, 1];
}

function lottieMarkup() {
  const radius = Math.max(0, Number(controls.radius.value) || 0);
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
          { t: 0, s: [55], e: [100], i: { x: [0.42], y: [1] }, o: { x: [0.58], y: [0] } },
          { t: 30, s: [100], e: [55], i: { x: [0.42], y: [1] }, o: { x: [0.58], y: [0] } },
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
        c: { a: 0, k: lottieColor(shape) },
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
    nm: `${safeFileName(exportName.value)} lottie`,
    ddd: 0,
    assets: [],
    layers,
  }, null, 2);
}

function renderExportMeta(extra = "") {
  const mode = exportMode();
  downloadButton.textContent = mode === "gif" ? "Download GIF" : "Download Lottie";
  downloadButton.disabled = !currentImage;
  if (!currentImage) {
    exportMeta.textContent = "Upload a file to enable export.";
    return;
  }
  const targetMb = Math.max(0.1, Number(controls.targetSize.value) || 1);
  exportMeta.textContent = extra || `${shapes.length} boxes. Target GIF size around ${targetMb.toFixed(1)} MB.`;
}

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
  const maxCode = 4096;
  const output = [];
  let bitBuffer = 0;
  let bitLength = 0;

  const tableSize = 16411;
  const keys = new Int32Array(tableSize).fill(-1);
  const values = new Uint16Array(tableSize);

  const emit = (code, size) => {
    bitBuffer |= code << bitLength;
    bitLength += size;
    while (bitLength >= 8) {
      output.push(bitBuffer & 255);
      bitBuffer >>= 8;
      bitLength -= 8;
    }
  };

  const tableGet = (key) => {
    let index = (key >>> 0) % tableSize;
    while (keys[index] !== -1 && keys[index] !== key) index = (index + 1) % tableSize;
    return keys[index] === key ? values[index] : -1;
  };

  const tableSet = (key, value) => {
    let index = (key >>> 0) % tableSize;
    while (keys[index] !== -1 && keys[index] !== key) index = (index + 1) % tableSize;
    keys[index] = key;
    values[index] = value;
  };

  let codeSize = minCodeSize + 1;
  let nextCode = end + 1;

  const reset = () => {
    keys.fill(-1);
    codeSize = minCodeSize + 1;
    nextCode = end + 1;
    emit(clear, codeSize);
  };

  reset();

  let prefix = indices[0] || 0;

  for (let i = 1; i < indices.length; i += 1) {
    const suffix = indices[i];
    const key = (prefix << 8) | suffix;
    const found = tableGet(key);
    if (found !== -1) {
      prefix = found;
    } else {
      emit(prefix, codeSize);
      if (nextCode < maxCode) {
        tableSet(key, nextCode);
        nextCode += 1;
        if (nextCode > (1 << codeSize) && codeSize < 12) codeSize += 1;
      } else {
        reset();
      }
      prefix = suffix;
    }
  }

  emit(prefix, codeSize);
  emit(end, codeSize);
  if (bitLength > 0) output.push(bitBuffer & 255);
  return output;
}

const baseGifPalette = [
  [255, 255, 255],
  [226, 232, 240],
  [248, 250, 252],
  [203, 213, 225],
];

function nearestPaletteIndex(r, g, b, palette) {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < palette.length; i += 1) {
    const [paletteR, paletteG, paletteB] = palette[i];
    const distance = (r - paletteR) ** 2 + (g - paletteG) ** 2 + (b - paletteB) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

function gifBudget() {
  const targetMb = Math.max(0.1, Number(controls.targetSize.value) || 1);
  const frameScale = Math.min(1, Math.max(0.36, Math.sqrt(targetMb / 1.6)));
  const frames = Math.max(6, Math.min(24, Math.round(10 + targetMb * 6)));
  return {
    frames,
    maxWidth: Math.round(480 * frameScale),
    maxHeight: Math.round(360 * frameScale),
  };
}

function gifPalette() {
  if (!controls.useColor.checked || !shapes.length) return baseGifPalette;
  const palette = [[255, 255, 255], [248, 250, 252]];
  for (const shape of shapes.slice(0, 6)) {
    palette.push(shape.color.palette);
  }
  while (palette.length < 8) palette.push([226, 232, 240]);
  return palette.slice(0, 8);
}

function renderGifFrame(progress, budget, palette) {
  const scale = Math.min(budget.maxWidth / canvas.width, budget.maxHeight / canvas.height, 1);
  const width = Math.max(1, Math.round(canvas.width * scale));
  const height = Math.max(1, Math.round(canvas.height * scale));
  const offscreen = document.createElement("canvas");
  offscreen.width = width;
  offscreen.height = height;
  const gifCtx = offscreen.getContext("2d", { willReadFrequently: true });

  gifCtx.fillStyle = "#ffffff";
  gifCtx.fillRect(0, 0, width, height);
  const shineWidth = Math.round(width * 0.45);
  const shineX = Math.round((width + shineWidth * 2) * progress) - shineWidth;

  for (const shape of shapes) {
    const x = Math.round(shape.x * scale);
    const y = Math.round(shape.y * scale);
    const shapeWidth = Math.max(2, Math.round(shape.width * scale));
    const shapeHeight = Math.max(2, Math.round(shape.height * scale));
    gifCtx.fillStyle = controls.useColor.checked ? shape.color.fill : "#e2e8f0";
    gifCtx.fillRect(x, y, shapeWidth, shapeHeight);

    gifCtx.save();
    gifCtx.beginPath();
    gifCtx.rect(x, y, shapeWidth, shapeHeight);
    gifCtx.clip();
    const gradient = gifCtx.createLinearGradient(shineX, 0, shineX + shineWidth, 0);
    gradient.addColorStop(0, controls.useColor.checked ? shape.color.fill : "#e2e8f0");
    gradient.addColorStop(0.5, controls.useColor.checked ? shape.color.shine : "#f8fafc");
    gradient.addColorStop(1, controls.useColor.checked ? shape.color.fill : "#e2e8f0");
    gifCtx.fillStyle = gradient;
    gifCtx.fillRect(shineX, y, shineWidth, shapeHeight);
    gifCtx.restore();
  }

  const data = gifCtx.getImageData(0, 0, width, height).data;
  const indices = new Uint8Array(width * height);
  for (let i = 0; i < indices.length; i += 1) {
    indices[i] = nearestPaletteIndex(data[i * 4], data[i * 4 + 1], data[i * 4 + 2], palette);
  }

  return { width, height, indices };
}

function gifBlob() {
  const budget = gifBudget();
  const palette = gifPalette();
  const minCodeSize = Math.max(2, Math.ceil(Math.log2(palette.length)));
  const colorTableSize = 1 << minCodeSize;
  while (palette.length < colorTableSize) palette.push([226, 232, 240]);
  const firstFrame = renderGifFrame(0, budget, palette);
  const bytes = [];
  pushString(bytes, "GIF89a");
  pushWord(bytes, firstFrame.width);
  pushWord(bytes, firstFrame.height);
  bytes.push(0b10000000 | ((minCodeSize - 1) << 4) | (minCodeSize - 1), 0, 0);
  for (const [r, g, b] of palette) bytes.push(r, g, b);
  bytes.push(0x21, 0xff, 0x0b);
  pushString(bytes, "NETSCAPE2.0");
  bytes.push(0x03, 0x01);
  pushWord(bytes, 0);
  bytes.push(0x00);

  for (let i = 0; i < budget.frames; i += 1) {
    const frame = i === 0 ? firstFrame : renderGifFrame(i / budget.frames, budget, palette);
    bytes.push(0x21, 0xf9, 0x04, 0b00001000);
    pushWord(bytes, 6);
    bytes.push(0x00, 0x00);
    bytes.push(0x2c);
    pushWord(bytes, 0);
    pushWord(bytes, 0);
    pushWord(bytes, frame.width);
    pushWord(bytes, frame.height);
    bytes.push(0);
    bytes.push(minCodeSize);
    bytes.push(...subBlocks(lzwEncode(frame.indices, minCodeSize)));
  }

  bytes.push(0x3b);
  return new Blob([new Uint8Array(bytes)], { type: "image/gif" });
}

async function downloadExport() {
  if (!currentImage) return;
  const name = safeFileName(exportName.value || currentName);
  if (exportMode() === "lottie") {
    downloadBlob(new Blob([lottieMarkup()], { type: "application/json" }), `${name}.json`);
    return;
  }

  downloadButton.disabled = true;
  downloadButton.textContent = "Rendering GIF...";
  await new Promise((resolve) => setTimeout(resolve, 0));
  try {
    const blob = gifBlob();
    downloadBlob(blob, `${name}.gif`);
    renderExportMeta(`GIF ready: ${(blob.size / 1024 / 1024).toFixed(2)} MB.`);
  } finally {
    downloadButton.disabled = false;
    downloadButton.textContent = "Download GIF";
  }
}

fileInput.addEventListener("change", (event) => {
  loadFile(event.target.files[0]).catch((error) => {
    fileName.textContent = error.message;
  });
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  loadFile(event.dataTransfer.files[0]).catch((error) => {
    fileName.textContent = error.message;
  });
});

removeFileButton.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  clearFile();
});

[controls.threshold, controls.shapeLimit, controls.radius, controls.useColor, controls.targetSize].forEach((control) => {
  control.addEventListener("input", () => {
    updateControlLabels();
    if (currentImage) drawCurrentImage();
    renderExportMeta();
  });
});

document.querySelectorAll("input[name='controlMode']").forEach((input) => {
  input.addEventListener("change", () => {
    updateControlLabels();
    if (currentImage) drawCurrentImage();
  });
});

document.querySelectorAll("input[name='exportMode']").forEach((input) => {
  input.addEventListener("change", renderExportMeta);
});

exportName.addEventListener("input", () => {
  currentName = safeFileName(exportName.value);
});

downloadButton.addEventListener("click", downloadExport);

updateControlLabels();
clearFile();
