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

      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let area = 0;
      queue.length = 0;
      queue.push(start);
      visited[start] = 1;

      while (queue.length) {
        const index = queue.pop();
        const px = index % width;
        const py = Math.floor(index / width);
        area += step * step;
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
      if (area >= minArea && boxWidth > 8 && boxHeight > 8) {
        results.push({
          x: Math.max(0, minX - 2),
          y: Math.max(0, minY - 2),
          width: Math.min(width - minX, boxWidth + 4),
          height: Math.min(height - minY, boxHeight + 4),
        });
      }
    }
  }

  return mergeNearby(results).slice(0, 140);
}

function mergeNearby(boxes) {
  const sorted = [...boxes].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const merged = [];

  for (const box of sorted) {
    const match = merged.find((item) => {
      const verticalOverlap = Math.min(item.y + item.height, box.y + box.height) - Math.max(item.y, box.y);
      const sameLine = verticalOverlap > Math.min(item.height, box.height) * 0.45;
      const gap = box.x - (item.x + item.width);
      return sameLine && gap >= 0 && gap < 16 && Math.abs(item.height - box.height) < 18;
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

function renderPreview() {
  const radius = Number(controls.radius.value);
  const rects = shapes.map((shape) =>
    `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" rx="${Math.min(radius, shape.height / 2)}"></rect>`
  ).join("");

  preview.innerHTML = `
    <defs>
      <linearGradient id="shine" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#dfe6ee"></stop>
        <stop offset="45%" stop-color="#f7f9fb"></stop>
        <stop offset="100%" stop-color="#dfe6ee"></stop>
      </linearGradient>
    </defs>
    <style>
      #skeletonPreview rect { fill: url(#shine); }
      #skeletonPreview rect { animation: pulse 1.4s ease-in-out infinite; transform-origin: center; }
      @keyframes pulse { 0%, 100% { opacity: .72; } 50% { opacity: 1; } }
    </style>
    ${rects}
  `;
  shapeCount.textContent = shapes.length;
}

function svgMarkup() {
  const radius = Number(controls.radius.value);
  const rects = shapes.map((shape) =>
    `  <rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" rx="${Math.min(radius, shape.height / 2)}" />`
  ).join("\n");

  return `<svg class="skeleton-loader" viewBox="0 0 ${canvas.width} ${canvas.height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Loading">
  <defs>
    <linearGradient id="skeleton-shine" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#dfe6ee" />
      <stop offset="45%" stop-color="#f7f9fb" />
      <stop offset="100%" stop-color="#dfe6ee" />
    </linearGradient>
  </defs>
  <style>
    .skeleton-loader rect {
      fill: url(#skeleton-shine);
      animation: skeleton-pulse 1.4s ease-in-out infinite;
    }
    @keyframes skeleton-pulse {
      0%, 100% { opacity: .72; }
      50% { opacity: 1; }
    }
  </style>
${rects}
</svg>`;
}

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
  background: linear-gradient(90deg, #dfe6ee, #f7f9fb, #dfe6ee);
  background-size: 220% 100%;
  animation: skeleton-shimmer 1.35s ease-in-out infinite;
}

@keyframes skeleton-shimmer {
  0% { background-position: 120% 0; }
  100% { background-position: -120% 0; }
}
</style>`;
}

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
        c: { a: 0, k: [0.874, 0.902, 0.933, 1] },
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

function renderCode() {
  const mode = exportMode();
  downloadButton.textContent = mode === "gif" ? "Download GIF" : "Download Lottie";
  copyButton.disabled = mode === "gif";
  outputCode.value = mode === "gif"
    ? "GIF export creates an animated .gif file when you press Download GIF."
    : lottieMarkup();
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

function renderGifIndices(progress) {
  const scale = Math.min(640 / canvas.width, 480 / canvas.height, 1);
  const width = Math.max(1, Math.round(canvas.width * scale));
  const height = Math.max(1, Math.round(canvas.height * scale));
  const offscreen = document.createElement("canvas");
  offscreen.width = width;
  offscreen.height = height;
  const gifCtx = offscreen.getContext("2d", { willReadFrequently: true });

  gifCtx.fillStyle = "#ffffff";
  gifCtx.fillRect(0, 0, width, height);
  for (const shape of shapes) {
    const x = Math.round(shape.x * scale);
    const y = Math.round(shape.y * scale);
    const shapeWidth = Math.max(1, Math.round(shape.width * scale));
    const shapeHeight = Math.max(1, Math.round(shape.height * scale));
    gifCtx.fillStyle = "#dfe6ee";
    gifCtx.fillRect(x, y, shapeWidth, shapeHeight);
    const shineWidth = Math.max(24, Math.round(shapeWidth * 0.42));
    const shineX = x - shineWidth + Math.round((shapeWidth + shineWidth * 2) * progress);
    const gradient = gifCtx.createLinearGradient(shineX, y, shineX + shineWidth, y);
    gradient.addColorStop(0, "#dfe6ee");
    gradient.addColorStop(0.5, "#f7f9fb");
    gradient.addColorStop(1, "#dfe6ee");
    gifCtx.fillStyle = gradient;
    gifCtx.fillRect(x, y, shapeWidth, shapeHeight);
  }

  const data = gifCtx.getImageData(0, 0, width, height).data;
  const indices = new Uint8Array(width * height);
  for (let i = 0; i < indices.length; i += 1) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const luminance = (r + g + b) / 3;
    indices[i] = luminance > 247 ? 0 : luminance > 232 ? 2 : 1;
  }

  return { width, height, indices };
}

function gifBlob() {
  const frames = 16;
  const firstFrame = renderGifIndices(0);
  const bytes = [];
  pushString(bytes, "GIF89a");
  pushWord(bytes, firstFrame.width);
  pushWord(bytes, firstFrame.height);
  bytes.push(0xf1, 0, 0);
  bytes.push(
    255, 255, 255,
    223, 230, 238,
    247, 249, 251,
    210, 219, 229
  );
  bytes.push(0x21, 0xff, 0x0b);
  pushString(bytes, "NETSCAPE2.0");
  bytes.push(0x03, 0x01, 0x00, 0x00, 0x00);

  for (let i = 0; i < frames; i += 1) {
    const frame = i === 0 ? firstFrame : renderGifIndices(i / frames);
    bytes.push(0x21, 0xf9, 0x04, 0x00);
    pushWord(bytes, 7);
    bytes.push(0, 0);
    bytes.push(0x2c);
    pushWord(bytes, 0);
    pushWord(bytes, 0);
    pushWord(bytes, frame.width);
    pushWord(bytes, frame.height);
    bytes.push(0);
    bytes.push(2);
    bytes.push(...subBlocks(lzwEncode(frame.indices, 2)));
  }

  bytes.push(0x3b);
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
  await new Promise((resolve) => requestAnimationFrame(resolve));
  downloadBlob(gifBlob(), `${name}.gif`);
  downloadButton.disabled = false;
  renderCode();
}

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
