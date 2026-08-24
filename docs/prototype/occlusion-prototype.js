const video = document.getElementById("webcam");
const liveOverlay = document.getElementById("live-overlay");
const frozenCanvas = document.getElementById("frozen-canvas");
const heatmapOverlay = document.getElementById("heatmap-overlay");
const snapshotCanvas = document.createElement("canvas");

const liveCtx = liveOverlay.getContext("2d");
const frozenCtx = frozenCanvas.getContext("2d");
const heatmapCtx = heatmapOverlay.getContext("2d");
const snapshotCtx = snapshotCanvas.getContext("2d");

const statusText = document.getElementById("status-text");
const fpsText = document.getElementById("fps-text");
const modeText = document.getElementById("mode-text");
const detectionCount = document.getElementById("detection-count");
const detectionList = document.getElementById("detection-list");

const startCameraButton = document.getElementById("start-camera");
const freezeFrameButton = document.getElementById("freeze-frame");
const resumeLiveButton = document.getElementById("resume-live");
const generateHeatmapButton = document.getElementById("generate-heatmap");

let model;
let stream;
let animationFrameId;
let livePredictions = [];
let frozenPredictions = [];
let selectedDetectionIndex = -1;
let isFrozen = false;
let lastInferenceTime = performance.now();

const HEATMAP_GRID_SIZE = 10;
const OVERLAP_THRESHOLD = 0.3;

boot();

async function boot() {
  try {
    await tf.ready();
    model = await cocoSsd.load({ base: "mobilenet_v2" });
    statusText.textContent = "Model ready. Enable the webcam.";
    startCameraButton.disabled = false;
  } catch (error) {
    console.error(error);
    statusText.textContent = "The model could not be loaded.";
  }
}

startCameraButton.addEventListener("click", startCamera);
freezeFrameButton.addEventListener("click", freezeFrame);
resumeLiveButton.addEventListener("click", resumeLive);
generateHeatmapButton.addEventListener("click", generateHeatmap);

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });

    video.srcObject = stream;

    await new Promise((resolve) => {
      video.onloadedmetadata = () => resolve();
    });

    resizeCanvases(video.videoWidth, video.videoHeight);

    statusText.textContent = "Webcam enabled. Detecting objects...";
    modeText.textContent = "Live video";
    freezeFrameButton.disabled = false;
    startCameraButton.disabled = true;

    runDetectionLoop();
  } catch (error) {
    console.error(error);
    statusText.textContent = "The webcam could not be accessed.";
  }
}

function resizeCanvases(width, height) {
  [liveOverlay, frozenCanvas, heatmapOverlay, snapshotCanvas].forEach((canvas) => {
    canvas.width = width;
    canvas.height = height;
  });
}

async function runDetectionLoop() {
  if (!model || isFrozen || video.readyState < 2) {
    return;
  }

  const startedAt = performance.now();
  livePredictions = await model.detect(video);
  const inferenceTime = performance.now() - startedAt;
  const now = performance.now();
  const fps = 1000 / Math.max(now - lastInferenceTime, 1);
  lastInferenceTime = now;

  drawPredictions(liveCtx, livePredictions, selectedDetectionIndex);
  fpsText.textContent = `Detection FPS: ${fps.toFixed(1)} | inference: ${inferenceTime.toFixed(0)} ms`;

  animationFrameId = requestAnimationFrame(runDetectionLoop);
}

function drawPredictions(context, predictions, activeIndex, options = {}) {
  const { clear = true, width = context.canvas.width, height = context.canvas.height } = options;

  if (clear) {
    context.clearRect(0, 0, width, height);
  }

  predictions.forEach((prediction, index) => {
    const [x, y, boxWidth, boxHeight] = prediction.bbox;
    const isActive = index === activeIndex;

    context.strokeStyle = isActive ? "#ff9d3e" : "#0725b8";
    context.lineWidth = isActive ? 4 : 2;
    context.fillStyle = isActive ? "rgba(255, 157, 62, 0.92)" : "rgba(7, 37, 184, 0.92)";
    context.font = "16px 'IBM Plex Mono'";

    context.strokeRect(x, y, boxWidth, boxHeight);

    const label = `${prediction.class} ${(prediction.score * 100).toFixed(1)}%`;
    const textWidth = context.measureText(label).width;
    const tagHeight = 28;

    context.fillRect(x, Math.max(0, y - tagHeight), textWidth + 16, tagHeight);
    context.fillStyle = "#ffffff";
    context.fillText(label, x + 8, Math.max(18, y - 9));
  });
}

function freezeFrame() {
  if (!livePredictions.length) {
    statusText.textContent = "There are no detections yet. Please wait a moment.";
    return;
  }

  isFrozen = true;
  cancelAnimationFrame(animationFrameId);

  snapshotCtx.drawImage(video, 0, 0, snapshotCanvas.width, snapshotCanvas.height);
  frozenPredictions = structuredClone(livePredictions);
  selectedDetectionIndex = frozenPredictions.length ? 0 : -1;

  video.hidden = true;
  frozenCanvas.hidden = false;
  heatmapOverlay.hidden = false;
  drawFrozenSelection();
  clearHeatmap();
  renderDetectionList();

  freezeFrameButton.disabled = true;
  resumeLiveButton.disabled = false;
  generateHeatmapButton.disabled = selectedDetectionIndex === -1;

  modeText.textContent = "Frozen frame";
  statusText.textContent = "Frame frozen. Select a detection.";
}

function resumeLive() {
  isFrozen = false;
  frozenPredictions = [];
  selectedDetectionIndex = -1;
  detectionList.innerHTML = "";
  detectionCount.textContent = "0 items";

  video.hidden = false;
  frozenCanvas.hidden = true;
  heatmapOverlay.hidden = true;
  liveCtx.clearRect(0, 0, liveOverlay.width, liveOverlay.height);
  clearHeatmap();

  freezeFrameButton.disabled = false;
  resumeLiveButton.disabled = true;
  generateHeatmapButton.disabled = true;

  modeText.textContent = "Live video";
  statusText.textContent = "Returning to real-time detection...";
  runDetectionLoop();
}

function renderDetectionList() {
  detectionList.innerHTML = "";
  detectionCount.textContent = `${frozenPredictions.length} items`;

  frozenPredictions.forEach((prediction, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "detection-item";

    if (index === selectedDetectionIndex) {
      button.classList.add("active");
    }

    const [x, y, width, height] = prediction.bbox;
    button.innerHTML = `
      <strong>${prediction.class}</strong>
      <div class="detection-meta">
        <span>Confidence ${(prediction.score * 100).toFixed(1)}%</span>
        <span>${Math.round(width)}×${Math.round(height)} px</span>
      </div>
      <div class="detection-meta">
        <span>x:${Math.round(x)} y:${Math.round(y)}</span>
        <span>#${index + 1}</span>
      </div>
    `;

    button.addEventListener("click", () => {
      selectedDetectionIndex = index;
      drawFrozenSelection();
      renderDetectionList();
      generateHeatmapButton.disabled = false;
      statusText.textContent = `Detection "${prediction.class}" selected.`;
    });

    detectionList.appendChild(button);
  });
}

function drawFrozenSelection() {
  frozenCtx.clearRect(0, 0, frozenCanvas.width, frozenCanvas.height);
  frozenCtx.drawImage(snapshotCanvas, 0, 0, frozenCanvas.width, frozenCanvas.height);
  drawPredictions(frozenCtx, frozenPredictions, selectedDetectionIndex, { clear: false });
}

function clearHeatmap() {
  heatmapCtx.clearRect(0, 0, heatmapOverlay.width, heatmapOverlay.height);
}

async function generateHeatmap() {
  const prediction = frozenPredictions[selectedDetectionIndex];

  if (!prediction) {
    statusText.textContent = "Select a detection before generating the heatmap.";
    return;
  }

  generateHeatmapButton.disabled = true;
  statusText.textContent = `Calculating heatmap for "${prediction.class}"...`;
  clearHeatmap();

  try {
    const heatmap = await computeOcclusionHeatmap(prediction);
    paintHeatmap(heatmap, prediction.bbox);
    statusText.textContent = `Heatmap ready for "${prediction.class}".`;
  } catch (error) {
    console.error(error);
    statusText.textContent = "The heatmap could not be calculated.";
  } finally {
    generateHeatmapButton.disabled = false;
  }
}

async function computeOcclusionHeatmap(targetPrediction) {
  const [boxX, boxY, boxWidth, boxHeight] = targetPrediction.bbox;
  const gridWidth = Math.max(4, Math.ceil(boxWidth / HEATMAP_GRID_SIZE));
  const gridHeight = Math.max(4, Math.ceil(boxHeight / HEATMAP_GRID_SIZE));
  const heatmap = Array.from({ length: gridHeight }, () => Array(gridWidth).fill(0));

  for (let row = 0; row < gridHeight; row += 1) {
    for (let col = 0; col < gridWidth; col += 1) {
      const patch = getPatchForCell(boxX, boxY, boxWidth, boxHeight, col, row, gridWidth, gridHeight);
      const occludedCanvas = createOccludedCanvas(patch);
      const predictions = await model.detect(occludedCanvas);
      const bestMatch = findMatchingPrediction(predictions, targetPrediction);

      const drop = Math.max(0, targetPrediction.score - (bestMatch?.score ?? 0));
      heatmap[row][col] = drop;
    }
  }

  normalizeHeatmap(heatmap);
  return heatmap;
}

function getPatchForCell(boxX, boxY, boxWidth, boxHeight, col, row, gridWidth, gridHeight) {
  const cellWidth = boxWidth / gridWidth;
  const cellHeight = boxHeight / gridHeight;

  return {
    x: Math.round(boxX + col * cellWidth),
    y: Math.round(boxY + row * cellHeight),
    width: Math.max(6, Math.ceil(cellWidth)),
    height: Math.max(6, Math.ceil(cellHeight)),
  };
}

function createOccludedCanvas(patch) {
  const canvas = document.createElement("canvas");
  canvas.width = frozenCanvas.width;
  canvas.height = frozenCanvas.height;
  const context = canvas.getContext("2d");

  context.drawImage(snapshotCanvas, 0, 0);
  context.fillStyle = "rgba(127, 127, 127, 1)";
  context.fillRect(patch.x, patch.y, patch.width, patch.height);

  return canvas;
}

function findMatchingPrediction(predictions, targetPrediction) {
  const sameClassPredictions = predictions
    .filter((prediction) => prediction.class === targetPrediction.class)
    .map((prediction) => ({
      ...prediction,
      overlap: computeIoU(prediction.bbox, targetPrediction.bbox),
    }))
    .filter((prediction) => prediction.overlap >= OVERLAP_THRESHOLD)
    .sort((a, b) => b.overlap - a.overlap || b.score - a.score);

  return sameClassPredictions[0];
}

function computeIoU(boxA, boxB) {
  const [ax, ay, aw, ah] = boxA;
  const [bx, by, bw, bh] = boxB;
  const left = Math.max(ax, bx);
  const top = Math.max(ay, by);
  const right = Math.min(ax + aw, bx + bw);
  const bottom = Math.min(ay + ah, by + bh);

  if (left >= right || top >= bottom) {
    return 0;
  }

  const intersection = (right - left) * (bottom - top);
  const union = aw * ah + bw * bh - intersection;
  return union > 0 ? intersection / union : 0;
}

function normalizeHeatmap(heatmap) {
  const values = heatmap.flat();
  const maxValue = Math.max(...values, 0);

  if (maxValue === 0) {
    return;
  }

  for (let row = 0; row < heatmap.length; row += 1) {
    for (let col = 0; col < heatmap[row].length; col += 1) {
      heatmap[row][col] /= maxValue;
    }
  }
}

function paintHeatmap(heatmap, bbox) {
  clearHeatmap();

  const [boxX, boxY, boxWidth, boxHeight] = bbox;
  const rows = heatmap.length;
  const cols = heatmap[0]?.length ?? 0;

  if (!rows || !cols) {
    return;
  }

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const value = heatmap[row][col];
      const x = boxX + (col / cols) * boxWidth;
      const y = boxY + (row / rows) * boxHeight;
      const width = boxWidth / cols;
      const height = boxHeight / rows;

      heatmapCtx.fillStyle = heatColor(value);
      heatmapCtx.fillRect(x, y, width, height);
    }
  }

  drawPredictions(heatmapCtx, frozenPredictions, selectedDetectionIndex, { clear: false });
}

function heatColor(value) {
  const clamped = Math.max(0, Math.min(1, value));
  const hue = 210 - clamped * 195;
  const saturation = 92;
  const lightness = 67 - clamped * 14;
  const alpha = 0.12 + clamped * 0.56;
  return `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
}
