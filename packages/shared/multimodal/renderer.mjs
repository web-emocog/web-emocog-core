const DEFAULT_LAYERS = Object.freeze({
  density: true,
  valence: false,
  arousal: false,
  engagement: false,
  fixation: true
});

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function rgba(red, green, blue, alpha) {
  return `rgba(${red},${green},${blue},${clamp01(alpha)})`;
}

function colorFor(layer, value, opacity) {
  if (layer === 'valence') {
    const normalized = clamp01((Number(value) + 1) / 2);
    return normalized >= 0.5
      ? rgba(220, 62, 75, (normalized - 0.5) * 2 * opacity)
      : rgba(43, 101, 212, (0.5 - normalized) * 2 * opacity);
  }
  if (layer === 'engagement') return rgba(0, 128, 122, clamp01(value) * opacity);
  if (layer === 'arousal') return rgba(0, 147, 189, clamp01(value) * opacity);
  return rgba(239, 131, 42, clamp01(value) * opacity);
}

export function getMultimodalLegend(model, selectedLayers = DEFAULT_LAYERS) {
  return (model?.legend || []).filter(item => selectedLayers[item.layer] !== false);
}

export function renderMultimodalHeatmap(canvas, presentation, options = {}) {
  if (!canvas?.getContext || !presentation?.grid || !presentation?.layers) {
    return { rendered: false, reason: 'invalid_input', legend: [] };
  }
  const context = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const gridWidth = presentation.grid.width;
  const gridHeight = presentation.grid.height;
  if (!(width > 0 && height > 0 && gridWidth > 0 && gridHeight > 0)) {
    return { rendered: false, reason: 'invalid_geometry', legend: [] };
  }
  const selectedLayers = { ...DEFAULT_LAYERS, ...(options.layers || {}) };
  const opacity = Number.isFinite(options.opacity) ? clamp01(options.opacity) : 0.72;
  if (options.clear !== false) context.clearRect(0, 0, width, height);
  const cellWidth = width / gridWidth;
  const cellHeight = height / gridHeight;
  const order = ['density', 'arousal', 'engagement', 'valence'];
  for (const layerName of order) {
    if (!selectedLayers[layerName]) continue;
    const values = presentation.layers[layerName]?.values || [];
    values.forEach((value, index) => {
      if (!Number.isFinite(value)) return;
      const x = (index % gridWidth) * cellWidth;
      const y = Math.floor(index / gridWidth) * cellHeight;
      context.fillStyle = colorFor(layerName, value, opacity);
      context.fillRect(x, y, cellWidth + 0.5, cellHeight + 0.5);
    });
  }
  if (selectedLayers.fixation) {
    const values = presentation.layers.fixation?.values || [];
    context.strokeStyle = options.fixationColor || 'rgba(21,49,58,.82)';
    values.forEach((value, index) => {
      if (!Number.isFinite(value) || value <= 0) return;
      const x = (index % gridWidth + 0.5) * cellWidth;
      const y = (Math.floor(index / gridWidth) + 0.5) * cellHeight;
      context.lineWidth = Math.max(1, value * 3);
      context.beginPath();
      context.arc(x, y, Math.max(2, value * Math.min(cellWidth, cellHeight) * 0.48), 0, Math.PI * 2);
      context.stroke();
    });
  }
  return {
    rendered: true,
    selectedLayers,
    legend: getMultimodalLegend(options.model || {}, selectedLayers),
    sampleCount: presentation.sampleCount || 0,
    qc: presentation.qc || null
  };
}
