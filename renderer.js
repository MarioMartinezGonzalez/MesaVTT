'use strict';

/* Mesa VTT · D&D 5e — lógica de la mesa (renderer) */

const TAU = Math.PI * 2;
const STORAGE_KEY = 'mesa-vtt.scene.v2';
const DEFAULT_COLORS = { player: '#4da3ff', enemy: '#ef5b5b' };
const CONE_ANGLES = [45, 53, 90];
const CAMPAIGN_KEY = 'mesa-vtt.campaign.v1';

const TOOL_HINTS = {
  select: 'Arrastra un token para moverlo · rueda = zoom · espacio + arrastrar = mover vista',
  ruler: 'Arrastra entre dos puntos para medir la distancia',
  cone: 'Arrastra desde el vértice del cono hacia su dirección',
  circle: 'Arrastra desde el centro para fijar el radio',
};

const state = {
  sceneName: 'Escena sin título',
  map: null, // { name, src, w, h, x, y }
  grid: { cell: 70, offsetX: 0, offsetY: 0, visible: true, opacity: 0.38, snap: true },
  tokens: [],
  view: { zoom: 1, panX: 0, panY: 0 },
  selectedId: null,
  tool: 'select',
  coneAngle: 53,
  measure: null, // { kind: 'ruler' | 'cone' | 'circle', start, end }
  measuring: false,
  drag: null,
  pan: null,
  playerDisplay: { hp: true, measure: true },
  combat: { active: false, round: 1, turnId: null },
};

/* ───────────────────────── Referencias del DOM ───────────────────────── */

const $ = (id) => document.getElementById(id);

const canvas = $('board');
const ctx = canvas.getContext('2d');
const stage = $('stage');
const emptyState = $('emptyState');
const toastEl = $('toast');
const measureReadout = $('measureReadout');
const tokenList = $('tokenList');
const mapInfo = $('mapInfo');
const zoomLabel = $('zoomLabel');
const saveStatus = $('saveStatus');
const sceneNameInput = $('sceneName');
const hudScene = $('hudScene');
const toolHint = $('toolHint');
const coneAngleRow = $('coneAngleRow');
const coneAngleSelect = $('coneAngle');
const gridCellInput = $('gridCell');
const gridOffsetXInput = $('gridOffsetX');
const gridOffsetYInput = $('gridOffsetY');
const gridOpacityInput = $('gridOpacity');
const gridVisibleInput = $('gridVisible');
const gridSnapInput = $('gridSnap');

const mapLibrary = $('mapLibrary');
const newFolderBtn = $('newFolderBtn');
const folderForm = $('folderForm');
const folderNameInput = $('folderName');
const librarySearch = $('librarySearch');
const libraryFormatSelect = $('libraryFormat');
const saveToLibraryBtn = $('saveToLibraryBtn');
const saveMapForm = $('saveMapForm');
const saveMapFolder = $('saveMapFolder');
const importFolderBtn = $('importFolderBtn');
const playerWindowBtn = $('playerWindowBtn');
const playerShowHpInput = $('playerShowHp');
const playerShowMeasureInput = $('playerShowMeasure');

const campaignSelect = $('campaignSelect');
const campaignStatus = $('campaignStatus');
const newCampaignBtn = $('newCampaignBtn');
const deleteCampaignBtn = $('deleteCampaignBtn');
const campaignForm = $('campaignForm');
const campaignNameInput = $('campaignName');
const saveRunBtn = $('saveRunBtn');
const loadRunBtn = $('loadRunBtn');
const saveCharacterBtn = $('saveCharacterBtn');
const saveEnemyBtn = $('saveEnemyBtn');
const saveCampaignMapBtn = $('saveCampaignMapBtn');
const characterListEl = $('characterList');
const enemyListEl = $('enemyList');
const campaignMapListEl = $('campaignMapList');

const tokenForm = $('tokenForm');
const tokenNameInput = $('tokenName');
const tokenHpInput = $('tokenHp');
const tokenInitiativeInput = $('tokenInitiative');
const tokenSizeInput = $('tokenSize');
const tokenColorInput = $('tokenColor');
const tokenImageThumb = $('tokenImageThumb');
const tokenImagePreview = $('tokenImagePreview');
const tokenEditor = $('tokenEditor');
const tokenEditorForm = $('tokenEditorForm');
const tokenEditorName = $('tokenEditorName');
const tokenEditX = $('tokenEditX');
const tokenEditY = $('tokenEditY');
const tokenEditHpCur = $('tokenEditHpCur');
const tokenEditHpMax = $('tokenEditHpMax');
const tokenEditInitiative = $('tokenEditInitiative');
const combatRound = $('combatRound');
const combatOrderEl = $('combatOrder');
const rollInitiativeBtn = $('rollInitiativeBtn');
const nextTurnBtn = $('nextTurnBtn');
const endCombatBtn = $('endCombatBtn');

/* ───────────────────────── Utilidades ───────────────────────── */

let dpr = 1;
let spaceDown = false;
let pendingTokenImage = null;
let editingTokenId = null;
let toastTimer = 0;
let saveTimer = 0;

let mapLibraryData = { folders: [] };
const openFolders = new Set();
let renamingFolderId = null;
let libraryQuery = '';
let libraryFormatFilter = '';
let playerOpen = false;
let playerTokenSyncQueued = false;
let campaignEntries = [];
let activeCampaignId = null;
let activeCampaign = null;

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function uid() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function roundRect(c, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  if (typeof c.roundRect === 'function') {
    c.beginPath();
    c.roundRect(x, y, w, h, radius);
    return;
  }
  c.beginPath();
  c.moveTo(x + radius, y);
  c.arcTo(x + w, y, x + w, y + h, radius);
  c.arcTo(x + w, y + h, x, y + h, radius);
  c.arcTo(x, y + h, x, y, radius);
  c.arcTo(x, y, x + w, y, radius);
  c.closePath();
}

function formatSquares(squares) {
  const rounded = Math.round(squares * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace('.', ',');
  return `${text} ${rounded === 1 ? 'casilla' : 'casillas'}`;
}

function hpColor(pct) {
  if (pct > 0.5) return '#45c46d';
  if (pct > 0.25) return '#e6b93f';
  return '#e2574c';
}

/* ───────────────────────── Carga de imágenes ───────────────────────── */

const images = new Map();
const loadingImages = new Map();

function loadImage(src) {
  if (!src) return Promise.reject(new Error('Sin imagen'));
  if (images.has(src)) return Promise.resolve(images.get(src));
  if (loadingImages.has(src)) return loadingImages.get(src);

  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      images.set(src, img);
      loadingImages.delete(src);
      resolve(img);
    };
    img.onerror = () => {
      loadingImages.delete(src);
      reject(new Error('No se pudo decodificar la imagen'));
    };
    img.src = src;
  });

  loadingImages.set(src, promise);
  return promise;
}

function getImage(src) {
  return (src && images.get(src)) || null;
}

function preload(src) {
  loadImage(src)
    .then(() => requestDraw())
    .catch(() => {});
}

/* ───────────────────────── Dibujo ───────────────────────── */

let rafId = 0;

function requestDraw() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    draw();
  });
}

function resizeCanvas() {
  const rect = stage.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  requestDraw();
}

function draw() {
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  if (!width || !height) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const backdrop = ctx.createLinearGradient(0, 0, 0, height);
  backdrop.addColorStop(0, '#0d1119');
  backdrop.addColorStop(1, '#07090e');
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, width, height);

  const map = state.map;
  const mapImage = map ? getImage(map.src) : null;
  if (map && mapImage) {
    ctx.save();
    ctx.translate(state.view.panX, state.view.panY);
    ctx.scale(state.view.zoom, state.view.zoom);
    ctx.drawImage(mapImage, map.x, map.y, map.w, map.h);
    ctx.restore();
  }

  drawGrid(width, height);
  drawMeasurement();
  drawTokens();
}

function drawGrid(width, height) {
  const grid = state.grid;
  const zoom = state.view.zoom;
  if (!grid.visible) return;
  if (grid.cell * zoom < 5) return;

  const left = -state.view.panX / zoom;
  const top = -state.view.panY / zoom;
  const right = left + width / zoom;
  const bottom = top + height / zoom;

  const startX = Math.floor((left - grid.offsetX) / grid.cell);
  const endX = Math.ceil((right - grid.offsetX) / grid.cell);
  const startY = Math.floor((top - grid.offsetY) / grid.cell);
  const endY = Math.ceil((bottom - grid.offsetY) / grid.cell);

  ctx.save();
  ctx.translate(state.view.panX, state.view.panY);
  ctx.scale(zoom, zoom);

  if (state.map) {
    ctx.beginPath();
    ctx.rect(state.map.x, state.map.y, state.map.w, state.map.h);
    ctx.clip();
  }

  const lineWidth = 1 / zoom;

  ctx.strokeStyle = `rgba(7, 10, 16, ${grid.opacity})`;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  for (let x = startX; x <= endX; x += 1) {
    const px = grid.offsetX + x * grid.cell;
    ctx.moveTo(px, top);
    ctx.lineTo(px, bottom);
  }
  for (let y = startY; y <= endY; y += 1) {
    const py = grid.offsetY + y * grid.cell;
    ctx.moveTo(left, py);
    ctx.lineTo(right, py);
  }
  ctx.stroke();

  ctx.strokeStyle = `rgba(7, 10, 16, ${Math.min(0.92, grid.opacity + 0.28)})`;
  ctx.lineWidth = lineWidth * 1.6;
  ctx.beginPath();
  for (let x = startX; x <= endX; x += 1) {
    if (x % 5 !== 0) continue;
    const px = grid.offsetX + x * grid.cell;
    ctx.moveTo(px, top);
    ctx.lineTo(px, bottom);
  }
  for (let y = startY; y <= endY; y += 1) {
    if (y % 5 !== 0) continue;
    const py = grid.offsetY + y * grid.cell;
    ctx.moveTo(left, py);
    ctx.lineTo(right, py);
  }
  ctx.stroke();

  ctx.restore();
}

function drawTokens() {
  for (const token of state.tokens) {
    if (token.id !== state.selectedId) drawToken(token);
  }
  const selected = state.tokens.find((token) => token.id === state.selectedId);
  if (selected) drawToken(selected);
}

function drawToken(token) {
  const center = worldToScreen(token.x, token.y);
  const radius = Math.max(7, (token.size * state.grid.cell * state.view.zoom) / 2);
  const down = token.hp.cur <= 0;

  ctx.save();

  // Sombra
  ctx.beginPath();
  ctx.arc(center.x, center.y + Math.max(1, radius * 0.06), radius, 0, TAU);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fill();

  // Cuerpo
  const image = token.img ? getImage(token.img) : null;
  ctx.save();
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, TAU);
  ctx.clip();

  if (image) {
    if (down) ctx.filter = 'grayscale(1) brightness(0.72)';
    const scale = Math.max((radius * 2) / image.naturalWidth, (radius * 2) / image.naturalHeight);
    const w = image.naturalWidth * scale;
    const h = image.naturalHeight * scale;
    ctx.drawImage(image, center.x - w / 2, center.y - h / 2, w, h);
    if (down) ctx.filter = 'none';
  } else {
    const gradient = ctx.createRadialGradient(
      center.x - radius * 0.35,
      center.y - radius * 0.4,
      radius * 0.15,
      center.x,
      center.y,
      radius
    );
    gradient.addColorStop(0, lighten(token.color, 0.28));
    gradient.addColorStop(1, token.color);
    ctx.fillStyle = down ? '#4b5563' : gradient;
    ctx.fillRect(center.x - radius, center.y - radius, radius * 2, radius * 2);

    const initial = (token.name.trim()[0] || '?').toUpperCase();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.font = `700 ${Math.max(10, radius * 0.85)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initial, center.x, center.y + radius * 0.03);
  }
  ctx.restore();

  // Anillo de tipo
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius - 1, 0, TAU);
  ctx.lineWidth = Math.max(2, radius * 0.09);
  ctx.strokeStyle = down ? '#7b8494' : token.color;
  ctx.stroke();

  // Selección
  if (token.id === state.selectedId) {
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius + Math.max(3, radius * 0.14), 0, TAU);
    ctx.strokeStyle = '#f2c14e';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Barra de vida
  const barWidth = Math.max(16, radius * 1.55);
  const barHeight = Math.max(4, Math.min(9, radius * 0.17));
  const barX = center.x - barWidth / 2;
  const barY = center.y + radius - barHeight - Math.max(2, radius * 0.07);

  ctx.fillStyle = 'rgba(5, 8, 13, 0.82)';
  roundRect(ctx, barX, barY, barWidth, barHeight, barHeight / 2);
  ctx.fill();

  const pct = token.hp.max > 0 ? Geo.clamp(token.hp.cur / token.hp.max, 0, 1) : 0;
  if (pct > 0) {
    ctx.fillStyle = hpColor(pct);
    roundRect(ctx, barX, barY, Math.max(barHeight, barWidth * pct), barHeight, barHeight / 2);
    ctx.fill();
  }

  // Nombre
  if (radius >= 9) {
    const label = down ? `${truncate(token.name, 18)} · caído` : truncate(token.name, 20);
    ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const textWidth = ctx.measureText(label).width;
    const labelY = center.y + radius + 11;

    ctx.fillStyle = 'rgba(8, 11, 17, 0.8)';
    roundRect(ctx, center.x - textWidth / 2 - 7, labelY - 9, textWidth + 14, 18, 9);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = down ? '#9aa3b4' : '#e9eef7';
    ctx.fillText(label, center.x, labelY + 0.5);
  }

  ctx.restore();
}

function drawMeasurement() {
  const measure = state.measure;
  if (!measure) return;

  const a = worldToScreen(measure.start.x, measure.start.y);
  const b = worldToScreen(measure.end.x, measure.end.y);
  const zoom = state.view.zoom;
  const cell = state.grid.cell;
  const dx = measure.end.x - measure.start.x;
  const dy = measure.end.y - measure.start.y;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (measure.kind === 'ruler') {
    const feet = Geo.roundFeet(Geo.feetFromPixels(dx, dy, cell));
    const squares = Geo.gridUnits(dx, dy, cell);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);

    ctx.strokeStyle = '#f2c14e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    drawCap(a.x, a.y, angle, 8);
    drawCap(b.x, b.y, angle, 8);
    drawCap(a.x, a.y, angle + Math.PI / 2, 4);

    ctx.beginPath();
    ctx.arc(a.x, a.y, 3.5, 0, TAU);
    ctx.fillStyle = '#f2c14e';
    ctx.fill();

    drawPill(`${feet} pies · ${formatSquares(squares)}`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 18);
  } else if (measure.kind === 'circle') {
    const radius = Math.hypot(dx, dy) * zoom;
    const feet = Geo.roundFeet(Geo.euclidFeet(dx, dy, cell));

    ctx.beginPath();
    ctx.arc(a.x, a.y, radius, 0, TAU);
    ctx.fillStyle = 'rgba(242, 193, 78, 0.14)';
    ctx.fill();
    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = 'rgba(242, 193, 78, 0.95)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = 'rgba(242, 193, 78, 0.45)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(a.x, a.y, 3.5, 0, TAU);
    ctx.fillStyle = '#f2c14e';
    ctx.fill();

    drawPill(`Círculo · radio ${feet} pies`, a.x, a.y - radius - 18);
  } else if (measure.kind === 'cone') {
    const radius = Math.hypot(dx, dy) * zoom;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const half = ((state.coneAngle * Math.PI) / 180) / 2;
    const feet = Geo.roundFeet(Geo.euclidFeet(dx, dy, cell));

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.arc(a.x, a.y, radius, angle - half, angle + half);
    ctx.closePath();
    ctx.fillStyle = 'rgba(242, 193, 78, 0.16)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(242, 193, 78, 0.95)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(a.x, a.y, 3.5, 0, TAU);
    ctx.fillStyle = '#f2c14e';
    ctx.fill();

    drawPill(
      `Cono ${state.coneAngle}° · ${feet} pies`,
      a.x + Math.cos(angle) * radius * 0.62,
      a.y + Math.sin(angle) * radius * 0.62
    );
  }

  ctx.restore();
}

function drawCap(x, y, angle, size) {
  const nx = Math.cos(angle + Math.PI / 2);
  const ny = Math.sin(angle + Math.PI / 2);
  ctx.beginPath();
  ctx.moveTo(x - nx * size, y - ny * size);
  ctx.lineTo(x + nx * size, y + ny * size);
  ctx.stroke();
}

function drawPill(text, cx, cy) {
  ctx.font = '600 12px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const paddingX = 11;
  const width = ctx.measureText(text).width + paddingX * 2;
  const height = 25;
  const viewWidth = canvas.width / dpr;
  const viewHeight = canvas.height / dpr;
  const x = Geo.clamp(cx, width / 2 + 4, viewWidth - width / 2 - 4);
  const y = Geo.clamp(cy, height / 2 + 4, viewHeight - height / 2 - 4);

  ctx.fillStyle = 'rgba(10, 13, 20, 0.93)';
  roundRect(ctx, x - width / 2, y - height / 2, width, height, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(242, 193, 78, 0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#f7d488';
  ctx.fillText(text, x, y + 0.5);
}

/* ───────────────────────── Conversiones y ayudas de malla ───────────────────────── */

function pointerPos(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function screenToWorld(x, y) {
  return {
    x: (x - state.view.panX) / state.view.zoom,
    y: (y - state.view.panY) / state.view.zoom,
  };
}

function worldToScreen(x, y) {
  return {
    x: x * state.view.zoom + state.view.panX,
    y: y * state.view.zoom + state.view.panY,
  };
}

function snapPoint(point) {
  if (!state.grid.snap) return { x: point.x, y: point.y };
  return Geo.snapToCellCenter(point.x, point.y, state.grid.cell, state.grid.offsetX, state.grid.offsetY);
}

function viewCenterWorld() {
  const rect = stage.getBoundingClientRect();
  return screenToWorld(rect.width / 2, rect.height / 2);
}

function hitTestToken(point) {
  const cell = state.grid.cell;
  const zoom = state.view.zoom;
  for (let i = state.tokens.length - 1; i >= 0; i -= 1) {
    const token = state.tokens[i];
    const center = worldToScreen(token.x, token.y);
    const radius = Math.max(7, (token.size * cell * zoom) / 2);
    if (Math.hypot(point.x - center.x, point.y - center.y) <= radius + 2) return token;
  }
  return null;
}

function lighten(hex, amount) {
  const value = hex.replace('#', '');
  if (value.length !== 6) return hex;
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  const mixed = channels.map((channel) => Math.round(channel + (255 - channel) * amount));
  return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/* ───────────────────────── Herramientas ───────────────────────── */

function setTool(tool) {
  state.tool = tool;
  state.measuring = false;
  document.querySelectorAll('.tool').forEach((button) => {
    button.classList.toggle('active', button.dataset.tool === tool);
  });
  coneAngleRow.hidden = tool !== 'cone';
  toolHint.textContent = TOOL_HINTS[tool] || '';
  canvastoolCursor();
  requestDraw();
}

function canvastoolCursor() {
  if (state.pan) {
    canvas.style.cursor = 'grabbing';
  } else if (state.drag) {
    canvas.style.cursor = 'grabbing';
  } else if (spaceDown) {
    canvas.style.cursor = 'grab';
  } else if (state.tool === 'select') {
    canvas.style.cursor = 'default';
  } else {
    canvas.style.cursor = 'crosshair';
  }
}

function clearMeasurement() {
  state.measure = null;
  state.measuring = false;
  updateReadout();
  requestDraw();
  syncPlayerMeasure();
}

/* ───────────────────────── Medición ───────────────────────── */

function updateReadout() {
  const measure = state.measure;
  if (!measure) {
    measureReadout.innerHTML =
      '<div class="readout-empty">Sin medición. Elige una herramienta y arrastra sobre el mapa.</div>';
    return;
  }

  const cell = state.grid.cell;
  const dx = measure.end.x - measure.start.x;
  const dy = measure.end.y - measure.start.y;

  if (measure.kind === 'ruler') {
    const feet = Geo.roundFeet(Geo.feetFromPixels(dx, dy, cell));
    const squares = Geo.gridUnits(dx, dy, cell);
    const meters = (feet * 0.3048).toFixed(1).replace('.', ',');
    measureReadout.innerHTML = readoutBlock(
      'Distancia',
      `${feet} pies`,
      `${formatSquares(squares)} · ${meters} m`
    );
  } else if (measure.kind === 'circle') {
    const feet = Geo.roundFeet(Geo.euclidFeet(dx, dy, cell));
    measureReadout.innerHTML = readoutBlock(
      'Radio del círculo',
      `${feet} pies`,
      `${formatSquares(Geo.gridUnits(dx, dy, cell))} de radio · diámetro ${feet * 2} pies`
    );
  } else {
    const feet = Geo.roundFeet(Geo.euclidFeet(dx, dy, cell));
    measureReadout.innerHTML = readoutBlock(
      'Cono',
      `${feet} pies`,
      `Apertura ${state.coneAngle}° · ${formatSquares(Geo.gridUnits(dx, dy, cell))}`
    );
  }
}

function readoutBlock(label, value, sub) {
  return `<div class="readout-main"><span class="readout-label">${label}</span><strong>${value}</strong></div><p class="readout-sub">${sub}</p>`;
}

/* ───────────────────────── Iniciativa y combate ───────────────────────── */

function combatOrder() {
  return state.tokens
    .filter((token) => Number.isFinite(token.initiative))
    .sort(
      (a, b) =>
        b.initiative - a.initiative ||
        (b.initiativeBonus || 0) - (a.initiativeBonus || 0) ||
        a.name.localeCompare(b.name, 'es')
    );
}

function ensureCombatTurn() {
  if (!state.combat.active) return;
  const order = combatOrder();
  if (order.length === 0) {
    state.combat.active = false;
    state.combat.round = 1;
    state.combat.turnId = null;
    return;
  }
  if (!order.some((token) => token.id === state.combat.turnId)) {
    state.combat.turnId = order[0].id;
  }
}

function rollD20() {
  return Math.floor(Math.random() * 20) + 1;
}

function rollInitiativeForAll() {
  if (state.tokens.length === 0) {
    toast('Añade tokens antes de tirar iniciativa');
    return;
  }

  for (const token of state.tokens) {
    token.initiative = rollD20() + (token.initiativeBonus || 0);
  }
  state.combat.active = true;
  state.combat.round = 1;
  const order = combatOrder();
  state.combat.turnId = order.length ? order[0].id : null;
  if (order.length === 0) state.combat.active = false;

  renderTokenList();
  renderCombatPanel();
  saveSceneSoon();
  syncPlayerCombat();
  toast(order.length ? `Iniciativa tirada · turno de ${order[0].name}` : 'Iniciativa tirada');
}

function advanceCombatTurn() {
  if (!state.combat.active) return;
  const order = combatOrder();
  if (order.length === 0) {
    endCombat();
    return;
  }

  const currentIndex = order.findIndex((token) => token.id === state.combat.turnId);
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % order.length;
  if (currentIndex === order.length - 1) state.combat.round += 1;
  state.combat.turnId = order[nextIndex].id;

  renderCombatPanel();
  saveSceneSoon();
  syncPlayerCombat();
}

function endCombat() {
  if (!state.combat.active) return;
  state.combat.active = false;
  state.combat.round = 1;
  state.combat.turnId = null;
  renderCombatPanel();
  saveSceneSoon();
  syncPlayerCombat();
  toast('Combate terminado');
}

function renderCombatPanel() {
  const active = state.combat.active;
  const order = active ? combatOrder() : [];
  combatRound.textContent = active ? `Ronda ${state.combat.round}` : 'Sin combate';
  rollInitiativeBtn.textContent = active ? 'Volver a tirar iniciativa' : 'Tirar iniciativa';
  nextTurnBtn.disabled = !active || order.length === 0;
  endCombatBtn.disabled = !active;

  if (!active) {
    combatOrderEl.innerHTML = '<li class="combat-empty">Sin combate activo.</li>';
    return;
  }
  if (order.length === 0) {
    combatOrderEl.innerHTML = '<li class="combat-empty">Sin iniciativa tirada.</li>';
    return;
  }

  combatOrderEl.innerHTML = order
    .map((token, index) => {
      const current = token.id === state.combat.turnId ? ' current' : '';
      return `<li class="combat-entry${current}">
        <span class="combat-position">${index + 1}</span>
        <span class="combat-name">${escapeHtml(token.name)}</span>
        <span class="combat-total">${token.initiative}</span>
      </li>`;
    })
    .join('');
}

/* ───────────────────────── Tokens ───────────────────────── */

function findToken(id) {
  return state.tokens.find((token) => token.id === id) || null;
}

function selectToken(id) {
  if (state.selectedId === id) return;
  state.selectedId = id;
  renderTokenList();
  requestDraw();
}

function openTokenEditor(id) {
  const token = findToken(id);
  if (!token) return;

  editingTokenId = id;
  selectToken(id);
  tokenEditorName.textContent = `${token.name} · ${token.type === 'enemy' ? 'Enemigo' : 'Jugador'}`;
  tokenEditX.value = String(Math.round(token.x));
  tokenEditY.value = String(Math.round(token.y));
  tokenEditHpMax.value = String(token.hp.max);
  tokenEditHpCur.value = String(token.hp.cur);
  tokenEditInitiative.value = String(token.initiativeBonus || 0);
  tokenEditor.hidden = false;

  requestAnimationFrame(() => {
    tokenEditX.focus();
    tokenEditX.select();
  });
}

function closeTokenEditor() {
  editingTokenId = null;
  tokenEditor.hidden = true;
}

function saveTokenEditor() {
  const token = findToken(editingTokenId);
  if (!token) {
    closeTokenEditor();
    return;
  }

  const x = Number(tokenEditX.value);
  const y = Number(tokenEditY.value);
  const hpMax = clampInt(tokenEditHpMax.value, 1, 9999, token.hp.max);
  const hpCur = clampInt(tokenEditHpCur.value, 0, hpMax, token.hp.cur);
  const oldBonus = token.initiativeBonus || 0;
  const initiativeBonus = clampInt(tokenEditInitiative.value, -20, 20, oldBonus);

  if (Number.isFinite(x)) token.x = x;
  if (Number.isFinite(y)) token.y = y;
  token.hp.max = hpMax;
  token.hp.cur = hpCur;
  if (Number.isFinite(token.initiative)) {
    token.initiative += initiativeBonus - oldBonus;
  }
  token.initiativeBonus = initiativeBonus;

  closeTokenEditor();
  renderTokenList();
  renderCombatPanel();
  requestDraw();
  saveSceneSoon();
  syncPlayerTokenPositions();
  syncPlayerCombat();
  toast(`Token «${token.name}» actualizado`);
}

function renderTokenList() {
  if (state.tokens.length === 0) {
    tokenList.innerHTML = '<p class="empty-note">Sin tokens todavía. Crea un jugador o un enemigo arriba.</p>';
    return;
  }

  tokenList.innerHTML = state.tokens
    .map((token) => {
      const pct = token.hp.max > 0 ? Geo.clamp((token.hp.cur / token.hp.max) * 100, 0, 100) : 0;
      const level = token.hp.cur <= 0 ? 'down' : pct <= 25 ? 'low' : pct <= 50 ? 'mid' : 'ok';
      const selected = token.id === state.selectedId ? ' selected' : '';
      const initiativeBadge =
        token.initiative == null
          ? ''
          : `<span class="init-badge" title="Iniciativa">Inic. ${token.initiative}</span>`;
      return `
        <div class="token-row${selected}" data-id="${token.id}">
          <div class="token-row-head">
            <span class="dot ${token.type}"></span>
            <span class="token-name" title="${escapeHtml(token.name)}">${escapeHtml(token.name)}</span>
            <span class="tag ${token.type}">${token.type === 'player' ? 'Jugador' : 'Enemigo'}</span>
            ${initiativeBadge}
            <button type="button" class="icon-btn edit" data-act="edit" title="Editar posición y PG">✎</button>
            <button type="button" class="icon-btn" data-act="delete" title="Eliminar token">✕</button>
          </div>
          <div class="hp-bar ${level}"><i style="width:${pct}%"></i></div>
          <div class="hp-controls">
            <button type="button" class="mini" data-act="hp" data-value="-5">−5</button>
            <button type="button" class="mini" data-act="hp" data-value="-1">−1</button>
            <input class="hp-input" data-field="hpCur" type="number" inputmode="numeric" value="${token.hp.cur}" aria-label="PG actuales de ${escapeHtml(token.name)}" />
            <span class="hp-sep">/</span>
            <input class="hp-input" data-field="hpMax" type="number" inputmode="numeric" value="${token.hp.max}" aria-label="PG máximos de ${escapeHtml(token.name)}" />
            <button type="button" class="mini" data-act="hp" data-value="1">+1</button>
            <button type="button" class="mini" data-act="hp" data-value="5">+5</button>
          </div>
        </div>`;
    })
    .join('');
}

function syncTokenRow(token) {
  const row = tokenList.querySelector(`.token-row[data-id="${token.id}"]`);
  if (!row) return;
  const pct = token.hp.max > 0 ? Geo.clamp((token.hp.cur / token.hp.max) * 100, 0, 100) : 0;
  const level = token.hp.cur <= 0 ? 'down' : pct <= 25 ? 'low' : pct <= 50 ? 'mid' : 'ok';
  const bar = row.querySelector('.hp-bar');
  bar.className = `hp-bar ${level}`;
  bar.querySelector('i').style.width = `${pct}%`;
  row.querySelector('[data-field="hpCur"]').value = token.hp.cur;
  row.querySelector('[data-field="hpMax"]').value = token.hp.max;
}

function adjustHp(id, delta) {
  const token = findToken(id);
  if (!token) return;
  token.hp.cur = Math.round(Geo.clamp(token.hp.cur + delta, 0, token.hp.max));
  syncTokenRow(token);
  requestDraw();
  saveSceneSoon();
  queuePlayerTokenSync();
}

function deleteToken(id) {
  const index = state.tokens.findIndex((token) => token.id === id);
  if (index === -1) return;
  const [removed] = state.tokens.splice(index, 1);
  if (state.selectedId === id) state.selectedId = null;
  ensureCombatTurn();
  renderTokenList();
  renderCombatPanel();
  requestDraw();
  saveSceneSoon();
  syncPlayerTokens();
  syncPlayerCombat();
  toast(`Token «${removed.name}» eliminado`);
}

function removeSelectedToken() {
  if (state.selectedId) deleteToken(state.selectedId);
}

function resetTokenForm() {
  tokenForm.reset();
  tokenColorInput.value = DEFAULT_COLORS.player;
  pendingTokenImage = null;
  tokenImageThumb.hidden = true;
  tokenImagePreview.removeAttribute('src');
}

/* ───────────────────────── Mapa y malla ───────────────────────── */

async function pickImage(kind) {
  if (window.api && typeof window.api.openImage === 'function') {
    return window.api.openImage(kind);
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, dataUrl: String(reader.result) });
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

function setMapFromImage(name, dataUrl, image) {
  const replacing = Boolean(state.map);
  const cell = replacing
    ? state.grid.cell
    : Geo.clamp(Math.round(image.naturalWidth / 26), 30, 200);

  state.map = {
    name,
    src: dataUrl,
    w: image.naturalWidth,
    h: image.naturalHeight,
    x: 0,
    y: 0,
  };

  if (!replacing) {
    state.grid.cell = cell;
    state.grid.offsetX = 0;
    state.grid.offsetY = 0;
  }

  syncGridInputs();
  updateMapInfo();
  updateEmptyState();
  fitMap();
  requestDraw();
  saveSceneSoon();
  syncPlayerAll();
}

async function importMap() {
  const picked = await pickImage('map');
  if (!picked || !picked.dataUrl) return;

  try {
    const image = await loadImage(picked.dataUrl);
    setMapFromImage(picked.name, picked.dataUrl, image);
    toast(`Mapa «${picked.name}» importado`);
  } catch (error) {
    toast('No se pudo leer esa imagen');
  }
}

function fitMap() {
  const rect = stage.getBoundingClientRect();
  if (!state.map || rect.width < 10 || rect.height < 10) {
    state.view = { zoom: 1, panX: 0, panY: 0 };
    updateZoomLabel();
    requestDraw();
    return;
  }

  const padding = 44;
  const zoom = Geo.clamp(
    Math.min((rect.width - padding * 2) / state.map.w, (rect.height - padding * 2) / state.map.h),
    0.05,
    3
  );
  state.view.zoom = zoom;
  state.view.panX = (rect.width - state.map.w * zoom) / 2;
  state.view.panY = (rect.height - state.map.h * zoom) / 2;
  updateZoomLabel();
  requestDraw();
  saveSceneSoon();
}

function zoomBy(factor) {
  const rect = stage.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const before = screenToWorld(cx, cy);
  const next = Geo.clamp(state.view.zoom * factor, 0.08, 8);
  if (next === state.view.zoom) return;
  state.view.zoom = next;
  state.view.panX = cx - before.x * next;
  state.view.panY = cy - before.y * next;
  updateZoomLabel();
  requestDraw();
  saveSceneSoon();
}

function updateZoomLabel() {
  zoomLabel.textContent = `${Math.round(state.view.zoom * 100)}%`;
}

function updateMapInfo() {
  if (!state.map) {
    mapInfo.textContent = 'Sin mapa cargado';
    return;
  }
  const columns = Math.max(1, Math.round(state.map.w / state.grid.cell));
  const rows = Math.max(1, Math.round(state.map.h / state.grid.cell));
  mapInfo.textContent = `${state.map.name} · ${state.map.w}×${state.map.h} px · ≈${columns}×${rows} casillas`;
}

function updateEmptyState() {
  emptyState.hidden = Boolean(state.map);
  saveToLibraryBtn.disabled = !state.map;
  if (!state.map) saveMapForm.hidden = true;
}

function syncGridInputs() {
  gridCellInput.value = String(Math.round(state.grid.cell));
  gridOffsetXInput.value = String(Math.round(state.grid.offsetX));
  gridOffsetYInput.value = String(Math.round(state.grid.offsetY));
  gridOpacityInput.value = String(Math.round(state.grid.opacity * 100));
  gridVisibleInput.checked = state.grid.visible;
  gridSnapInput.checked = state.grid.snap;
  coneAngleSelect.value = String(state.coneAngle);
}

function syncPlayerDisplayInputs() {
  playerShowHpInput.checked = state.playerDisplay.hp;
  playerShowMeasureInput.checked = state.playerDisplay.measure;
}

/* ───────────────────────── Biblioteca de mapas ───────────────────────── */

async function refreshLibrary() {
  if (!window.api || !window.api.library) {
    mapLibrary.innerHTML =
      '<p class="empty-note">La biblioteca está disponible en la app de escritorio.</p>';
    return;
  }

  try {
    const data = await window.api.library.list();
    mapLibraryData = data && Array.isArray(data.folders) ? data : { folders: [] };
    // No expandir ni leer todos los mapas al arrancar: cada carpeta se abre
    // cuando el usuario la pulsa y cada mapa se carga solo al seleccionarlo.
    renderLibrary();
  } catch (error) {
    console.error('No se pudo leer la biblioteca:', error);
    mapLibrary.innerHTML = '<p class="empty-note">No se pudo leer la biblioteca.</p>';
  }
}

function mapMatchesFilters(map) {
  const query = libraryQuery.trim().toLowerCase();
  const format = String(map.format || '').toLowerCase();
  if (libraryFormatFilter && format !== libraryFormatFilter) return false;
  if (!query) return true;
  return String(map.name || '').toLowerCase().includes(query) || format.includes(query);
}

function folderChildren(parentId) {
  const key = parentId || null;
  return mapLibraryData.folders.filter((folder) => (folder.parentId || null) === key);
}

function folderPath(folder) {
  const byId = new Map(mapLibraryData.folders.map((item) => [item.id, item]));
  const parts = [];
  let current = folder;
  let guard = 0;
  while (current && guard < 40) {
    parts.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : null;
    guard += 1;
  }
  return parts.join(' / ');
}

function descendantFolders(folderId) {
  const result = [];
  const queue = [folderId];
  while (queue.length) {
    const current = queue.shift();
    for (const folder of mapLibraryData.folders) {
      if (folder.parentId === current) {
        result.push(folder);
        queue.push(folder.id);
      }
    }
  }
  return result;
}

function renderLibrary() {
  const filtering = Boolean(libraryQuery.trim() || libraryFormatFilter);
  const folders = mapLibraryData.folders;

  if (folders.length === 0) {
    mapLibrary.innerHTML =
      '<p class="empty-note">Sin carpetas todavía. Crea una y añade tus mapas.</p>';
    return;
  }

  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const matched = new Map();
  for (const folder of folders) {
    matched.set(folder.id, filtering ? folder.maps.filter(mapMatchesFilters) : folder.maps);
  }

  // Al filtrar se muestran las carpetas con coincidencias y sus antecesoras.
  const visible = new Set();
  if (filtering) {
    for (const folder of folders) {
      if (matched.get(folder.id).length === 0) continue;
      let current = folder;
      let guard = 0;
      while (current && guard < 40) {
        visible.add(current.id);
        current = current.parentId ? byId.get(current.parentId) : null;
        guard += 1;
      }
    }
  }

  if (filtering && visible.size === 0) {
    mapLibrary.innerHTML = '<p class="empty-note">Ningún mapa coincide con la búsqueda.</p>';
    return;
  }

  const folderMarkup = (folder, depth) => {
    if (depth > 30 || (filtering && !visible.has(folder.id))) return '';

    const maps = matched.get(folder.id) || [];
    const children = folderChildren(folder.id);
    const open = filtering || openFolders.has(folder.id);
    const childHtml = children
      .map((child) => folderMarkup(child, depth + 1))
      .join('');
    const mapHtml = maps.length
      ? `<div class="map-grid">${maps
          .map((map) => mapCardMarkup(folder, map))
          .join('')}</div>`
      : '';
    const body =
      mapHtml + childHtml ||
      (children.length === 0
        ? '<p class="empty-note">Carpeta vacía. Usa ＋ para añadir mapas.</p>'
        : '');

    const title =
      renamingFolderId === folder.id
        ? `<form class="folder-rename" data-folder-id="${folder.id}"><input type="text" maxlength="48" value="${escapeHtml(folder.name)}" aria-label="Nombre de la carpeta" /></form>`
        : `<span class="folder-name" title="${escapeHtml(folderPath(folder))}">${escapeHtml(folder.name)}</span>`;

    const count = filtering
      ? (maps.length ? `${maps.length}/${folder.maps.length}` : '')
      : String(folder.maps.length);

    return `<div class="folder" data-folder-id="${folder.id}">
      <div class="folder-head" style="--depth:${depth}">
        <button type="button" class="folder-toggle" data-act="toggle-folder" title="${open ? 'Contraer' : 'Expandir'}">${open ? '▾' : '▸'}</button>
        ${title}
        <span class="folder-count"${count ? '' : ' hidden'}>${count}</span>
        <button type="button" class="folder-action" data-act="add-maps" title="Añadir mapas a esta carpeta">＋</button>
        <button type="button" class="folder-action" data-act="rename-folder" title="Renombrar carpeta">✎</button>
        <button type="button" class="folder-action" data-act="delete-folder" title="Eliminar carpeta">✕</button>
      </div>
      <div class="folder-body"${open ? '' : ' hidden'}>${body}</div>
    </div>`;
  };

  const roots = folders.filter((folder) => !folder.parentId || !byId.has(folder.parentId));
  mapLibrary.innerHTML = roots.map((folder) => folderMarkup(folder, 0)).join('');

  const renameInput = mapLibrary.querySelector('.folder-rename input');
  if (renameInput) {
    renameInput.focus();
    renameInput.select();
  }
}

function mapCardMarkup(folder, map) {
  const dimensions = map.width && map.height ? `${map.width}×${map.height} px` : 'Mapa';
  const format = map.format ? map.format.toUpperCase() : '';
  const meta = format ? `${format} · ${dimensions}` : dimensions;
  const thumb = map.thumb
    ? `<span class="map-thumb"><img src="${map.thumb}" alt="" /></span>`
    : '<span class="map-thumb no-thumb">▧</span>';

  return `<div class="map-card" role="button" tabindex="0" draggable="true" data-map-id="${map.id}" data-folder-id="${folder.id}" title="${escapeHtml(map.name)}">
    ${thumb}
    <span class="map-card-name">${escapeHtml(map.name)}</span>
    <span class="map-card-meta">${meta}</span>
    <button type="button" class="map-delete" draggable="false" data-act="delete-map" title="Quitar de la biblioteca">✕</button>
  </div>`;
}

function handleLibraryClick(event) {
  const folderEl = event.target.closest('.folder');
  if (!folderEl) return;
  const folderId = folderEl.dataset.folderId;
  const action = event.target.closest('[data-act]');

  if (action) {
    const kind = action.dataset.act;
    if (kind === 'toggle-folder') {
      if (openFolders.has(folderId)) openFolders.delete(folderId);
      else openFolders.add(folderId);
      renderLibrary();
      return;
    }
    if (kind === 'add-maps') {
      importLibraryMaps(folderId);
      return;
    }
    if (kind === 'rename-folder') {
      renamingFolderId = folderId;
      renderLibrary();
      return;
    }
    if (kind === 'delete-folder') {
      deleteLibraryFolder(folderId);
      return;
    }
    if (kind === 'delete-map') {
      const card = action.closest('[data-map-id]');
      if (card) deleteLibraryMap(folderId, card.dataset.mapId);
      return;
    }
  }

  const card = event.target.closest('.map-card');
  if (card) loadLibraryMap(folderId, card.dataset.mapId);
}

function handleLibraryKeyDown(event) {
  if (event.key === 'Escape' && renamingFolderId) {
    renamingFolderId = null;
    renderLibrary();
    return;
  }

  if (event.target.closest('button')) return;
  const card = event.target.closest('.map-card');
  if (card && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    loadLibraryMap(card.dataset.folderId, card.dataset.mapId);
  }
}

async function handleLibrarySubmit(event) {
  const form = event.target.closest('.folder-rename');
  if (!form) return;
  event.preventDefault();

  const folderId = form.dataset.folderId;
  const name = form.querySelector('input').value.trim();
  renamingFolderId = null;

  if (!name) {
    renderLibrary();
    return;
  }

  try {
    await window.api.library.renameFolder(folderId, name);
    await refreshLibrary();
    toast('Carpeta renombrada');
  } catch (error) {
    console.error(error);
    toast('No se pudo renombrar la carpeta');
    renderLibrary();
  }
}

function handleLibraryFocusOut(event) {
  const form = event.target.closest('.folder-rename');
  if (!form) return;
  if (form.contains(event.relatedTarget)) return;
  if (renamingFolderId !== form.dataset.folderId) return;
  renamingFolderId = null;
  setTimeout(renderLibrary, 0);
}

async function createLibraryFolder(name) {
  if (!window.api || !window.api.library) return;
  try {
    const folder = await window.api.library.createFolder(name);
    if (folder && folder.id) openFolders.add(folder.id);
    folderForm.reset();
    folderForm.hidden = true;
    await refreshLibrary();
    toast(`Carpeta «${folder.name}» creada`);
  } catch (error) {
    console.error(error);
    toast('No se pudo crear la carpeta');
  }
}

async function importLibraryMaps(folderId) {
  if (!window.api || !window.api.library) return;
  try {
    const result = await window.api.library.importMaps(folderId);
    if (!result) return;
    openFolders.add(folderId);
    await refreshLibrary();
    if (result.added > 0) {
      toast(
        `${result.added} ${result.added === 1 ? 'mapa añadido' : 'mapas añadidos'} a la biblioteca`
      );
    } else {
      toast('No se añadió ningún mapa');
    }
  } catch (error) {
    console.error(error);
    toast('No se pudieron importar los mapas');
  }
}

async function importLibraryFolder() {
  if (!window.api || !window.api.library || !window.api.library.importFolder) return;
  try {
    const result = await window.api.library.importFolder();
    if (!result) return;
    if (result.rootFolderId) openFolders.add(result.rootFolderId);
    await refreshLibrary();

    const folderCount = Number(result.foldersCreated || 0) + 1;
    if (result.added > 0) {
      toast(
        `${result.added} mapa(s) importados en ${folderCount} carpeta(s), con su estructura`
      );
    } else {
      toast('La carpeta no contenía imágenes compatibles');
    }
    if (result.errors && result.errors.length) {
      console.warn('Elementos que no se pudieron importar:', result.errors);
    }
  } catch (error) {
    console.error(error);
    toast('No se pudo importar la carpeta');
  }
}

async function deleteLibraryFolder(folderId) {
  const folder = mapLibraryData.folders.find((item) => item.id === folderId);
  if (!folder) return;

  const descendants = descendantFolders(folderId);
  const totalMaps =
    folder.maps.length + descendants.reduce((sum, item) => sum + item.maps.length, 0);
  const extra =
    descendants.length > 0
      ? ` y sus ${descendants.length} subcarpeta(s)`
      : '';
  const confirmed = window.confirm(
    `¿Eliminar la carpeta «${folderPath(folder)}»${extra} con ${totalMaps} mapa(s)?`
  );
  if (!confirmed) return;

  try {
    await window.api.library.deleteFolder(folderId);
    openFolders.delete(folderId);
    descendants.forEach((item) => openFolders.delete(item.id));
    await refreshLibrary();
    toast('Carpeta eliminada');
  } catch (error) {
    console.error(error);
    toast('No se pudo eliminar la carpeta');
  }
}

async function deleteLibraryMap(folderId, mapId) {
  const folder = mapLibraryData.folders.find((item) => item.id === folderId);
  const map = folder && folder.maps.find((item) => item.id === mapId);
  if (!map) return;
  if (!window.confirm(`¿Quitar «${map.name}» de la biblioteca?`)) return;

  try {
    await window.api.library.deleteMap(folderId, mapId);
    await refreshLibrary();
    toast('Mapa quitado de la biblioteca');
  } catch (error) {
    console.error(error);
    toast('No se pudo quitar el mapa');
  }
}

async function loadLibraryMap(folderId, mapId) {
  if (!window.api || !window.api.library) return;
  try {
    const result = await window.api.library.loadMap(folderId, mapId);
    if (!result || !result.dataUrl) throw new Error('Mapa vacío');
    const image = await loadImage(result.dataUrl);
    setMapFromImage(result.name, result.dataUrl, image);

    // Generar la miniatura solo para el mapa que el usuario acaba de abrir.
    const folder = mapLibraryData.folders.find((item) => item.id === folderId);
    const map = folder && folder.maps.find((item) => item.id === mapId);
    if (map && !map.thumb) {
      try {
        const thumbDataUrl = makeThumbnailDataUrl(image);
        await window.api.library.setThumbnail(folderId, mapId, {
          dataUrl: thumbDataUrl,
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
        map.thumb = thumbDataUrl;
        map.width = image.naturalWidth;
        map.height = image.naturalHeight;
        renderLibrary();
      } catch (error) {
        console.warn(`Sin miniatura para ${map.name}:`, error.message);
      }
    }

    toast(`Mapa «${result.name}» cargado`);
  } catch (error) {
    console.error(error);
    toast('No se pudo cargar el mapa');
  }
}

function handleLibraryDragStart(event) {
  const card = event.target.closest('.map-card');
  if (!card || event.target.closest('button')) {
    event.preventDefault();
    return;
  }

  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData(
    'text/plain',
    JSON.stringify({ folderId: card.dataset.folderId, mapId: card.dataset.mapId })
  );
  card.classList.add('dragging');
}

function handleLibraryDragEnd() {
  mapLibrary.querySelectorAll('.map-card.dragging').forEach((card) => {
    card.classList.remove('dragging');
  });
  mapLibrary.querySelectorAll('.folder.drop-target').forEach((folder) => {
    folder.classList.remove('drop-target');
  });
}

function handleLibraryDragOver(event) {
  const folderEl = event.target.closest('.folder');
  if (!folderEl) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

  mapLibrary.querySelectorAll('.folder.drop-target').forEach((folder) => {
    if (folder !== folderEl) folder.classList.remove('drop-target');
  });
  folderEl.classList.add('drop-target');
}

function handleLibraryDragLeave(event) {
  const folderEl = event.target.closest('.folder');
  if (!folderEl || folderEl.contains(event.relatedTarget)) return;
  folderEl.classList.remove('drop-target');
}

function handleLibraryDrop(event) {
  const folderEl = event.target.closest('.folder');
  if (!folderEl) return;
  event.preventDefault();
  folderEl.classList.remove('drop-target');

  let payload = null;
  try {
    payload = JSON.parse(event.dataTransfer.getData('text/plain'));
  } catch (error) {
    return;
  }

  if (!payload || !payload.folderId || !payload.mapId) return;
  moveLibraryMap(payload.folderId, payload.mapId, folderEl.dataset.folderId);
}

async function moveLibraryMap(fromFolderId, mapId, toFolderId) {
  if (!window.api || !window.api.library) return;
  if (!fromFolderId || !toFolderId || fromFolderId === toFolderId) return;

  try {
    await window.api.library.moveMap(fromFolderId, mapId, toFolderId);
    openFolders.add(toFolderId);
    await refreshLibrary();
    const target = mapLibraryData.folders.find((folder) => folder.id === toFolderId);
    toast(`Mapa movido a «${target ? target.name : 'la carpeta'}»`);
  } catch (error) {
    console.error('No se pudo mover el mapa:', error);
    toast('No se pudo mover el mapa');
  }
}

function openSaveMapForm() {
  if (!state.map) {
    toast('No hay ningún mapa cargado');
    return;
  }

  if (!saveMapForm.hidden) {
    saveMapForm.hidden = true;
    return;
  }

  if (mapLibraryData.folders.length === 0) {
    toast('Crea primero una carpeta en la biblioteca');
    folderForm.hidden = false;
    folderNameInput.focus();
    return;
  }

  saveMapFolder.innerHTML = mapLibraryData.folders
    .map((folder) => `<option value="${folder.id}">${escapeHtml(folderPath(folder))}</option>`)
    .join('');
  saveMapForm.hidden = false;
  saveMapFolder.focus();
}

function makeThumbnailDataUrl(image) {
  const maxWidth = 360;
  const scale = Math.min(1, maxWidth / Math.max(1, image.naturalWidth));
  const canvasEl = document.createElement('canvas');
  canvasEl.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvasEl.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvasEl.getContext('2d');
  context.drawImage(image, 0, 0, canvasEl.width, canvasEl.height);
  return canvasEl.toDataURL('image/jpeg', 0.72);
}

async function saveCurrentMapToLibrary(folderId) {
  if (!state.map) return;
  if (!window.api || !window.api.library) return;

  const image = getImage(state.map.src);
  if (!image) {
    toast('El mapa todavía no está listo');
    return;
  }

  const folder = mapLibraryData.folders.find((item) => item.id === folderId);
  if (!folder) {
    toast('Elige una carpeta de destino');
    return;
  }

  try {
    await window.api.library.addMap(folderId, {
      name: state.map.name || 'Mapa cargado',
      dataUrl: state.map.src,
      thumbDataUrl: makeThumbnailDataUrl(image),
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
    openFolders.add(folderId);
    saveMapForm.hidden = true;
    await refreshLibrary();
    toast(`Mapa guardado en «${folder.name}»`);
  } catch (error) {
    console.error('No se pudo guardar el mapa en la biblioteca:', error);
    toast('No se pudo guardar el mapa en la biblioteca');
  }
}

/* ───────────────────────── Campañas / Runs ───────────────────────── */

function getCampaignApi() {
  return window.api && window.api.campaign ? window.api.campaign : null;
}

function setCampaignStatus(message, isError) {
  campaignStatus.textContent = message;
  campaignStatus.style.color = isError ? '#ff9a8f' : '';
}

function persistActiveCampaign() {
  try {
    if (activeCampaignId) localStorage.setItem(CAMPAIGN_KEY, activeCampaignId);
    else localStorage.removeItem(CAMPAIGN_KEY);
  } catch (error) {
    /* sin almacenamiento local */
  }
}

function storedCampaignId() {
  try {
    return localStorage.getItem(CAMPAIGN_KEY) || '';
  } catch (error) {
    return '';
  }
}

function renderCampaignSelect() {
  campaignSelect.innerHTML =
    '<option value="">Sin campaña</option>' +
    campaignEntries
      .map((campaign) => `<option value="${campaign.id}">${escapeHtml(campaign.name)}</option>`)
      .join('');
  campaignSelect.value = campaignEntries.some((campaign) => campaign.id === activeCampaignId)
    ? activeCampaignId
    : '';
  deleteCampaignBtn.disabled = !activeCampaignId;
}

function campaignSheetIcon(sheet) {
  const color =
    typeof sheet.color === 'string' && /^#[0-9a-f]{6}$/i.test(sheet.color)
      ? sheet.color
      : '#4da3ff';
  const initial = (String(sheet.name || '?').trim()[0] || '?').toUpperCase();
  return sheet.img
    ? `<span class="campaign-icon"><img src="${escapeHtml(sheet.img)}" alt="" /></span>`
    : `<span class="campaign-icon" style="--campaign-color:${color}">${escapeHtml(initial)}</span>`;
}

function renderCampaignSheetList(container, sheets, kind) {
  if (!sheets.length) {
    container.innerHTML =
      `<p class="campaign-empty">Sin ${kind === 'enemy' ? 'enemigos' : 'fichas'} guardados.</p>`;
    return;
  }

  container.innerHTML = sheets
    .map((sheet) => {
      const bonus = Number(sheet.initiativeBonus) || 0;
      const hp = sheet.hp || {};
      return `<div class="campaign-entry" data-campaign-kind="${kind}" data-campaign-id="${sheet.id}">
        ${campaignSheetIcon(sheet)}
        <span class="campaign-entry-main">
          <span class="campaign-entry-name" title="${escapeHtml(sheet.name)}">${escapeHtml(sheet.name)}</span>
          <span class="campaign-entry-meta">PG ${Number(hp.cur) || 0}/${Number(hp.max) || 0} · Inic ${bonus >= 0 ? '+' : ''}${bonus}</span>
        </span>
        <button type="button" class="icon-btn" data-campaign-act="load-sheet" title="Cargar en la mesa">↧</button>
        <button type="button" class="icon-btn" data-campaign-act="delete-sheet" title="Eliminar">✕</button>
      </div>`;
    })
    .join('');
}

function renderCampaignMapList(maps) {
  if (!maps.length) {
    campaignMapListEl.innerHTML = '<p class="campaign-empty">Sin mapas guardados.</p>';
    return;
  }

  campaignMapListEl.innerHTML = maps
    .map(
      (map) => `<div class="campaign-entry" data-campaign-kind="map" data-campaign-id="${map.id}">
        <span class="campaign-icon map">▧</span>
        <span class="campaign-entry-main">
          <span class="campaign-entry-name" title="${escapeHtml(map.name)}">${escapeHtml(map.name)}</span>
          <span class="campaign-entry-meta">${Number(map.width) || 0}×${Number(map.height) || 0} · ${escapeHtml(String(map.format || '').toUpperCase())}</span>
        </span>
        <button type="button" class="icon-btn" data-campaign-act="load-map" title="Cargar mapa">↧</button>
        <button type="button" class="icon-btn" data-campaign-act="delete-map" title="Eliminar">✕</button>
      </div>`
    )
    .join('');
}

function renderCampaignDetails() {
  const hasCampaign = Boolean(activeCampaign && activeCampaign.campaign);
  deleteCampaignBtn.disabled = !hasCampaign;
  saveRunBtn.disabled = !hasCampaign;
  loadRunBtn.disabled = !hasCampaign || !activeCampaign.run;
  saveCharacterBtn.disabled = !hasCampaign;
  saveEnemyBtn.disabled = !hasCampaign;
  saveCampaignMapBtn.disabled = !hasCampaign;

  if (!hasCampaign) {
    setCampaignStatus('Sin campaña');
    characterListEl.innerHTML = '<p class="campaign-empty">Crea o selecciona una campaña.</p>';
    enemyListEl.innerHTML = '<p class="campaign-empty">Crea o selecciona una campaña.</p>';
    campaignMapListEl.innerHTML = '<p class="campaign-empty">Crea o selecciona una campaña.</p>';
    renderCampaignSelect();
    return;
  }

  setCampaignStatus(activeCampaign.run ? 'Run guardada' : 'Sin run');
  renderCampaignSheetList(characterListEl, activeCampaign.characters || [], 'character');
  renderCampaignSheetList(enemyListEl, activeCampaign.enemies || [], 'enemy');
  renderCampaignMapList(activeCampaign.maps || []);
  renderCampaignSelect();
}

async function loadCampaignDetails(id) {
  if (!id) {
    activeCampaignId = null;
    activeCampaign = null;
    persistActiveCampaign();
    renderCampaignDetails();
    return;
  }

  const api = getCampaignApi();
  if (!api) return;
  try {
    const data = await api.get(id);
    activeCampaignId = id;
    activeCampaign = data;
    persistActiveCampaign();
    renderCampaignDetails();
  } catch (error) {
    console.error('No se pudo cargar la campaña:', error);
    setCampaignStatus('Error de campaña', true);
    toast('No se pudo cargar la campaña');
  }
}

async function refreshCampaigns(preferredId) {
  const api = getCampaignApi();
  if (!api) {
    campaignSelect.disabled = true;
    newCampaignBtn.disabled = true;
    deleteCampaignBtn.disabled = true;
    setCampaignStatus('Solo escritorio', true);
    return;
  }

  try {
    const data = await api.list();
    campaignEntries = data && Array.isArray(data.campaigns) ? data.campaigns : [];
    let id = preferredId || storedCampaignId();
    if (!campaignEntries.some((campaign) => campaign.id === id)) {
      id = campaignEntries[0] ? campaignEntries[0].id : '';
    }
    await loadCampaignDetails(id);
  } catch (error) {
    console.error('No se pudo leer la lista de campañas:', error);
    setCampaignStatus('Error de campaña', true);
    toast('No se pudieron leer las campañas');
  }
}

async function createCampaign() {
  const api = getCampaignApi();
  if (!api) return;
  const name = campaignNameInput.value.trim();
  try {
    const created = await api.create(name);
    campaignForm.hidden = true;
    campaignNameInput.value = '';
    await refreshCampaigns(created.id);
    toast(`Campaña «${created.name}» creada`);
  } catch (error) {
    console.error('No se pudo crear la campaña:', error);
    toast('No se pudo crear la campaña');
  }
}

async function deleteCampaign() {
  if (!activeCampaignId || !activeCampaign) return;
  if (!window.confirm(`¿Eliminar la campaña «${activeCampaign.campaign.name}» y todos sus archivos?`)) return;
  const api = getCampaignApi();
  if (!api) return;
  try {
    await api.remove(activeCampaignId);
    activeCampaignId = null;
    activeCampaign = null;
    persistActiveCampaign();
    await refreshCampaigns('');
    toast('Campaña eliminada');
  } catch (error) {
    console.error('No se pudo eliminar la campaña:', error);
    toast('No se pudo eliminar la campaña');
  }
}

async function saveCampaignRun() {
  if (!activeCampaignId) return;
  const api = getCampaignApi();
  if (!api) return;
  try {
    await api.saveRun(activeCampaignId, scenePayload());
    await loadCampaignDetails(activeCampaignId);
    toast('Progreso de la run guardado');
  } catch (error) {
    console.error('No se pudo guardar la run:', error);
    toast('No se pudo guardar la run');
  }
}

async function loadCampaignRun() {
  if (!activeCampaign || !activeCampaign.run) return;
  if (!window.confirm('¿Cargar esta run? Se reemplazará la mesa actual.')) return;
  try {
    await applyScene(activeCampaign.run);
    saveSceneSoon();
    toast('Progreso de la run cargado');
  } catch (error) {
    console.error('No se pudo cargar la run:', error);
    toast('No se pudo cargar la run');
  }
}

async function saveCampaignSheet(kind) {
  if (!activeCampaignId) return;
  const token = findToken(state.selectedId);
  if (!token) {
    toast('Selecciona un token en la mesa');
    return;
  }
  const expected = kind === 'enemy' ? 'enemy' : 'player';
  if (token.type !== expected) {
    toast(kind === 'enemy' ? 'Selecciona un token enemigo' : 'Selecciona un token de jugador');
    return;
  }

  const api = getCampaignApi();
  if (!api) return;
  try {
    await api.saveSheet(activeCampaignId, kind, {
      name: token.name,
      type: token.type,
      color: token.color,
      size: token.size,
      hp:
        kind === 'enemy'
          ? { cur: token.hp.max, max: token.hp.max }
          : { cur: token.hp.cur, max: token.hp.max },
      initiativeBonus: token.initiativeBonus || 0,
      img: token.img || null,
    });
    await loadCampaignDetails(activeCampaignId);
    toast(kind === 'enemy' ? 'Enemigo guardado' : 'Ficha guardada');
  } catch (error) {
    console.error('No se pudo guardar la ficha:', error);
    toast('No se pudo guardar la ficha');
  }
}

function loadCampaignSheet(kind, sheetId) {
  if (!activeCampaign) return;
  const sheets = kind === 'enemy' ? activeCampaign.enemies : activeCampaign.characters;
  const sheet = (sheets || []).find((item) => item.id === sheetId);
  if (!sheet) return;

  const hpMax = clampInt(sheet.hp && sheet.hp.max, 1, 9999, 10);
  const hpCur = clampInt(sheet.hp && sheet.hp.cur, 0, hpMax, hpMax);
  const center = snapPoint(viewCenterWorld());
  const token = {
    id: uid(),
    name: sheet.name,
    type: kind === 'enemy' ? 'enemy' : 'player',
    color: sheet.color || DEFAULT_COLORS[kind === 'enemy' ? 'enemy' : 'player'],
    size: clampInt(sheet.size, 1, 4, 1),
    img: sheet.img || null,
    hp: { cur: hpCur, max: hpMax },
    initiativeBonus: clampInt(sheet.initiativeBonus, -20, 20, 0),
    initiative: null,
    x: center.x,
    y: center.y,
  };

  state.tokens.push(token);
  state.selectedId = token.id;
  if (token.img) preload(token.img);
  renderTokenList();
  renderCombatPanel();
  requestDraw();
  saveSceneSoon();
  syncPlayerTokens();
  toast(`${kind === 'enemy' ? 'Enemigo' : 'Ficha'} «${token.name}» añadido`);
}

async function deleteCampaignSheet(kind, sheetId) {
  if (!activeCampaignId) return;
  if (!window.confirm('¿Eliminar esta ficha guardada?')) return;
  const api = getCampaignApi();
  if (!api) return;
  try {
    await api.deleteSheet(activeCampaignId, kind, sheetId);
    await loadCampaignDetails(activeCampaignId);
    toast('Ficha eliminada');
  } catch (error) {
    console.error('No se pudo eliminar la ficha:', error);
    toast('No se pudo eliminar la ficha');
  }
}

async function saveCampaignMap() {
  if (!activeCampaignId || !state.map) {
    toast('No hay ningún mapa cargado');
    return;
  }
  const api = getCampaignApi();
  if (!api) return;
  try {
    await api.saveMap(activeCampaignId, {
      name: state.map.name,
      dataUrl: state.map.src,
      width: state.map.w,
      height: state.map.h,
    });
    await loadCampaignDetails(activeCampaignId);
    toast('Mapa guardado en la run');
  } catch (error) {
    console.error('No se pudo guardar el mapa:', error);
    toast('No se pudo guardar el mapa');
  }
}

async function loadCampaignMap(mapId) {
  if (!activeCampaignId) return;
  const api = getCampaignApi();
  if (!api) return;
  try {
    const map = await api.readMap(activeCampaignId, mapId);
    const image = await loadImage(map.dataUrl);
    setMapFromImage(map.name, map.dataUrl, image);
    toast(`Mapa «${map.name}» cargado`);
  } catch (error) {
    console.error('No se pudo cargar el mapa de la run:', error);
    toast('No se pudo cargar el mapa');
  }
}

async function deleteCampaignMap(mapId) {
  if (!activeCampaignId) return;
  if (!window.confirm('¿Eliminar este mapa de la run?')) return;
  const api = getCampaignApi();
  if (!api) return;
  try {
    await api.deleteMap(activeCampaignId, mapId);
    await loadCampaignDetails(activeCampaignId);
    toast('Mapa eliminado');
  } catch (error) {
    console.error('No se pudo eliminar el mapa:', error);
    toast('No se pudo eliminar el mapa');
  }
}

function handleCampaignListClick(event) {
  const action = event.target.closest('[data-campaign-act]');
  if (!action) return;
  const entry = action.closest('[data-campaign-id]');
  if (!entry) return;
  const kind = entry.dataset.campaignKind;
  const id = entry.dataset.campaignId;

  if (action.dataset.campaignAct === 'load-sheet') loadCampaignSheet(kind, id);
  if (action.dataset.campaignAct === 'delete-sheet') deleteCampaignSheet(kind, id);
  if (action.dataset.campaignAct === 'load-map') loadCampaignMap(id);
  if (action.dataset.campaignAct === 'delete-map') deleteCampaignMap(id);
}

/* ───────────────────────── Pantalla de jugadores ───────────────────────── */

function getPlayerApi() {
  return window.api && window.api.player ? window.api.player : null;
}

function playerMapData() {
  if (!state.map) return null;
  return {
    name: state.map.name,
    src: state.map.src,
    w: state.map.w,
    h: state.map.h,
  };
}

function playerGridData() {
  return {
    cell: state.grid.cell,
    offsetX: state.grid.offsetX,
    offsetY: state.grid.offsetY,
    visible: state.grid.visible,
    opacity: state.grid.opacity,
  };
}

function playerTokenData(full) {
  return state.tokens.map((token) => {
    const pct = token.hp.max > 0 ? Geo.clamp(token.hp.cur / token.hp.max, 0, 1) : 0;
    return {
      id: token.id,
      name: token.name,
      type: token.type,
      color: token.color,
      size: token.size,
      x: token.x,
      y: token.y,
      hp: { pct: Math.round(pct * 1000) / 1000, down: token.hp.cur <= 0 },
      ...(full ? { img: token.img || null } : {}),
    };
  });
}

function playerMeasureData() {
  const measure = state.measure;
  if (!measure) return null;
  return {
    kind: measure.kind,
    start: { x: measure.start.x, y: measure.start.y },
    end: { x: measure.end.x, y: measure.end.y },
    coneAngle: state.coneAngle,
  };
}

function playerCombatData() {
  const order = state.combat.active
    ? combatOrder().map((token) => ({
        id: token.id,
        name: token.name,
        type: token.type,
        initiative: token.initiative,
      }))
    : [];
  return {
    active: state.combat.active,
    round: state.combat.round,
    turnId: state.combat.turnId,
    order,
  };
}

function syncPlayerMap() {
  const api = getPlayerApi();
  if (api) api.setMap(playerMapData());
}

function syncPlayerGrid() {
  const api = getPlayerApi();
  if (api) api.setGrid(playerGridData());
}

function syncPlayerTokens() {
  const api = getPlayerApi();
  if (api) api.setTokens(playerTokenData(true));
}

function syncPlayerTokenPositions() {
  const api = getPlayerApi();
  if (api) api.updateTokens(playerTokenData(false));
}

function syncPlayerMeasure() {
  const api = getPlayerApi();
  if (api) api.setMeasure(playerMeasureData());
}

function syncPlayerDisplay() {
  const api = getPlayerApi();
  if (api) {
    api.setDisplay({
      hp: state.playerDisplay.hp,
      measure: state.playerDisplay.measure,
    });
  }
}

function syncPlayerCombat() {
  const api = getPlayerApi();
  if (api) api.setCombat(playerCombatData());
}

function queuePlayerTokenSync() {
  if (playerTokenSyncQueued) return;
  playerTokenSyncQueued = true;
  requestAnimationFrame(() => {
    playerTokenSyncQueued = false;
    syncPlayerTokenPositions();
  });
}

function syncPlayerAll() {
  syncPlayerMap();
  syncPlayerGrid();
  syncPlayerTokens();
  syncPlayerMeasure();
  syncPlayerDisplay();
  syncPlayerCombat();
}

function setPlayerOpen(open) {
  playerOpen = Boolean(open);
  playerWindowBtn.textContent = playerOpen
    ? 'Cerrar pantalla de jugadores'
    : 'Abrir pantalla de jugadores';
}

/* ───────────────────────── Escena: guardar, exportar, importar ───────────────────────── */

function scenePayload() {
  return {
    version: 2,
    app: 'mesa-vtt',
    sceneName: state.sceneName,
    map: state.map,
    grid: state.grid,
    tokens: state.tokens,
    view: state.view,
    coneAngle: state.coneAngle,
    combat: state.combat,
  };
}

function setSaveStatus(message, isError) {
  saveStatus.textContent = message;
  saveStatus.style.color = isError ? '#ff9a8f' : '';
}

function persistLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scenePayload()));
    setSaveStatus('Guardado automático activo.');
  } catch (error) {
    setSaveStatus('No se pudo guardar: la imagen es demasiado grande. Usa «Exportar JSON».', true);
  }
}

function saveSceneSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistLocal, 650);
}

function safeReadStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn('Escena guardada ilegible:', error);
    return null;
  }
}

function normalizeToken(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const type = raw.type === 'enemy' ? 'enemy' : 'player';
  const name =
    typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim().slice(0, 40)
      : `Token ${index + 1}`;
  const hpMax = clampInt(raw.hp && raw.hp.max, 1, 9999, 10);
  const hpCur = clampInt(raw.hp && raw.hp.cur, 0, hpMax, hpMax);
  const initiativeBonus = clampInt(raw.initiativeBonus, -20, 20, 0);
  const rawInitiative = raw.initiative;
  const initiative =
    rawInitiative === null || rawInitiative === undefined || rawInitiative === ''
      ? null
      : Number.isFinite(Number(rawInitiative))
        ? Math.round(Number(rawInitiative))
        : null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
    name,
    type,
    color:
      typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color)
        ? raw.color
        : DEFAULT_COLORS[type],
    size: clampInt(raw.size, 1, 4, 1),
    img: typeof raw.img === 'string' && raw.img.startsWith('data:image/') ? raw.img : null,
    hp: { cur: hpCur, max: hpMax },
    initiativeBonus,
    initiative,
    x: Number.isFinite(raw.x) ? raw.x : 0,
    y: Number.isFinite(raw.y) ? raw.y : 0,
  };
}

async function applyScene(data) {
  if (!data || typeof data !== 'object') throw new Error('Escena no válida');

  state.sceneName =
    typeof data.sceneName === 'string' && data.sceneName.trim()
      ? data.sceneName.trim().slice(0, 48)
      : 'Escena sin título';

  state.grid = Object.assign(
    { cell: 70, offsetX: 0, offsetY: 0, visible: true, opacity: 0.38, snap: true },
    data.grid && typeof data.grid === 'object' ? data.grid : {}
  );
  state.grid.cell = clampInt(state.grid.cell, 10, 400, 70);
  state.grid.offsetX = clampInt(state.grid.offsetX, -20000, 20000, 0);
  state.grid.offsetY = clampInt(state.grid.offsetY, -20000, 20000, 0);
  state.grid.opacity = Geo.clamp(Number(state.grid.opacity) || 0, 0, 1);
  state.grid.visible = state.grid.visible !== false;
  state.grid.snap = state.grid.snap !== false;

  state.tokens = Array.isArray(data.tokens)
    ? data.tokens.map(normalizeToken).filter(Boolean)
    : [];

  const combat = data.combat && typeof data.combat === 'object' ? data.combat : {};
  state.combat = {
    active: combat.active === true,
    round: clampInt(combat.round, 1, 999, 1),
    turnId: typeof combat.turnId === 'string' ? combat.turnId : null,
  };
  ensureCombatTurn();

  state.map =
    data.map && typeof data.map.src === 'string'
      ? {
          name: typeof data.map.name === 'string' ? data.map.name : 'Mapa',
          src: data.map.src,
          w: Number(data.map.w) || 0,
          h: Number(data.map.h) || 0,
          x: Number(data.map.x) || 0,
          y: Number(data.map.y) || 0,
        }
      : null;

  if (state.map) {
    try {
      const image = await loadImage(state.map.src);
      if (!state.map.w || !state.map.h) {
        state.map.w = image.naturalWidth;
        state.map.h = image.naturalHeight;
      }
    } catch (error) {
      state.map = null;
      toast('No se pudo cargar el mapa guardado');
    }
  }

  const view = data.view;
  const hasView = Boolean(
    view && Number.isFinite(view.zoom) && Number.isFinite(view.panX) && Number.isFinite(view.panY)
  );
  if (hasView) {
    state.view = {
      zoom: Geo.clamp(view.zoom, 0.08, 8),
      panX: view.panX,
      panY: view.panY,
    };
  } else {
    state.view = { zoom: 1, panX: 0, panY: 0 };
  }

  state.coneAngle = CONE_ANGLES.includes(Number(data.coneAngle)) ? Number(data.coneAngle) : 53;
  state.selectedId = null;
  state.measure = null;
  state.measuring = false;

  for (const token of state.tokens) {
    if (token.img) preload(token.img);
  }

  sceneNameInput.value = state.sceneName;
  hudScene.textContent = state.sceneName;
  syncGridInputs();
  updateMapInfo();
  updateEmptyState();
  updateZoomLabel();
  updateReadout();
  renderTokenList();
  renderCombatPanel();
  requestDraw();
  syncPlayerAll();

  if (!hasView) fitMap();
}

async function exportScene() {
  const json = JSON.stringify(scenePayload(), null, 2);
  if (window.api && typeof window.api.saveScene === 'function') {
    const filePath = await window.api.saveScene(json);
    toast(filePath ? 'Escena exportada a JSON' : 'Exportación cancelada');
    return;
  }
  downloadJson(json);
  toast('Escena descargada como JSON');
}

function downloadJson(json) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'escena-vtt.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importScene() {
  let text = null;
  if (window.api && typeof window.api.loadScene === 'function') {
    const result = await window.api.loadScene();
    if (!result) return;
    text = result.text;
  } else {
    text = await pickJsonText();
    if (text === null) return;
  }

  try {
    const data = JSON.parse(text);
    await applyScene(data);
    saveSceneSoon();
    toast('Escena importada');
  } catch (error) {
    console.error(error);
    toast('El archivo JSON no es una escena válida');
  }
}

function pickJsonText() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}

function newScene() {
  const confirmed = window.confirm(
    '¿Empezar una escena nueva? Se perderá la mesa actual (exporta antes si quieres conservarla).'
  );
  if (!confirmed) return;

  state.sceneName = 'Escena sin título';
  state.map = null;
  state.grid = { cell: 70, offsetX: 0, offsetY: 0, visible: true, opacity: 0.38, snap: true };
  state.tokens = [];
  state.view = { zoom: 1, panX: 0, panY: 0 };
  state.selectedId = null;
  state.tool = 'select';
  state.coneAngle = 53;
  state.measure = null;
  state.measuring = false;
  state.combat = { active: false, round: 1, turnId: null };

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    /* sin almacenamiento disponible */
  }

  resetTokenForm();
  sceneNameInput.value = state.sceneName;
  hudScene.textContent = state.sceneName;
  syncGridInputs();
  updateMapInfo();
  updateEmptyState();
  updateZoomLabel();
  updateReadout();
  renderTokenList();
  renderCombatPanel();
  setTool('select');
  setSaveStatus('Escena nueva. Guardado automático activo.');
  requestDraw();
  syncPlayerAll();
}

/* ───────────────────────── Toast ───────────────────────── */

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
}

/* ───────────────────────── Ratón y teclado en la mesa ───────────────────────── */

function onPointerDown(event) {
  const point = pointerPos(event);

  if (event.button === 1 || (event.button === 0 && (spaceDown || event.altKey))) {
    event.preventDefault();
    state.pan = { x: point.x, y: point.y, panX: state.view.panX, panY: state.view.panY };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
    return;
  }

  if (event.button !== 0) return;

  if (state.tool === 'select') {
    const token = hitTestToken(point);
    if (token) {
      selectToken(token.id);
      const world = screenToWorld(point.x, point.y);
      state.drag = { id: token.id, offX: world.x - token.x, offY: world.y - token.y };
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
    } else {
      selectToken(null);
    }
    return;
  }

  const world = snapPoint(screenToWorld(point.x, point.y));
  state.measure = { kind: state.tool, start: world, end: world };
  state.measuring = true;
  canvas.setPointerCapture(event.pointerId);
  updateReadout();
  requestDraw();
  syncPlayerMeasure();
}

function onPointerMove(event) {
  const point = pointerPos(event);

  if (state.pan) {
    state.view.panX = state.pan.panX + (point.x - state.pan.x);
    state.view.panY = state.pan.panY + (point.y - state.pan.y);
    requestDraw();
    return;
  }

  if (state.drag) {
    const token = findToken(state.drag.id);
    if (!token) return;
    const world = screenToWorld(point.x, point.y);
    token.x = world.x - state.drag.offX;
    token.y = world.y - state.drag.offY;
    requestDraw();
    queuePlayerTokenSync();
    return;
  }

  if (state.measuring && state.measure) {
    state.measure.end = snapPoint(screenToWorld(point.x, point.y));
    updateReadout();
    requestDraw();
    syncPlayerMeasure();
  }
}

function onPointerUp() {
  if (state.pan) {
    state.pan = null;
    canvastoolCursor();
    saveSceneSoon();
    return;
  }

  if (state.drag) {
    const token = findToken(state.drag.id);
    if (token && state.grid.snap) {
      const snapped = Geo.snapToCellCenter(
        token.x,
        token.y,
        state.grid.cell,
        state.grid.offsetX,
        state.grid.offsetY
      );
      token.x = snapped.x;
      token.y = snapped.y;
      requestDraw();
    }
    state.drag = null;
    canvastoolCursor();
    saveSceneSoon();
    syncPlayerTokenPositions();
    return;
  }

  if (state.measuring) {
    state.measuring = false;
    updateReadout();
    syncPlayerMeasure();
  }
}

function onWheel(event) {
  event.preventDefault();
  const point = pointerPos(event);
  const before = screenToWorld(point.x, point.y);
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
  const next = Geo.clamp(state.view.zoom * Math.exp(-delta * 0.0014), 0.08, 8);
  if (next === state.view.zoom) return;

  state.view.zoom = next;
  state.view.panX = point.x - before.x * next;
  state.view.panY = point.y - before.y * next;
  updateZoomLabel();
  requestDraw();
  saveSceneSoon();
}

function nudgeSelected(dx, dy) {
  if (!state.selectedId) return;
  const token = findToken(state.selectedId);
  if (!token) return;
  token.x += dx;
  token.y += dy;
  requestDraw();
  saveSceneSoon();
  queuePlayerTokenSync();
}

function onKeyDown(event) {
  if (!tokenEditor.hidden) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeTokenEditor();
    }
    return;
  }

  if (isTypingTarget(event.target)) return;
  if (event.ctrlKey || event.metaKey) return;

  const key = event.key.toLowerCase();

  if (event.code === 'Space') {
    spaceDown = true;
    canvastoolCursor();
    event.preventDefault();
    return;
  }

  if (event.key === 'Escape') {
    if (state.measure) {
      clearMeasurement();
    } else if (state.selectedId) {
      selectToken(null);
    } else {
      setTool('select');
    }
    return;
  }

  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (state.selectedId) {
      event.preventDefault();
      removeSelectedToken();
    }
    return;
  }

  if (event.key.startsWith('Arrow')) {
    if (!state.selectedId) return;
    event.preventDefault();
    const step = state.grid.cell * (event.shiftKey ? 5 : 1);
    if (event.key === 'ArrowLeft') nudgeSelected(-step, 0);
    if (event.key === 'ArrowRight') nudgeSelected(step, 0);
    if (event.key === 'ArrowUp') nudgeSelected(0, -step);
    if (event.key === 'ArrowDown') nudgeSelected(0, step);
    return;
  }

  if (key === 'v') setTool('select');
  if (key === 'r') setTool('ruler');
  if (key === 'c') setTool('cone');
  if (key === 'o') setTool('circle');
}

function onKeyUp(event) {
  if (event.code === 'Space') {
    spaceDown = false;
    canvastoolCursor();
  }
}

/* ───────────────────────── Conexión de la interfaz ───────────────────────── */

function bindUI() {
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('dblclick', (event) => {
    const token = hitTestToken(pointerPos(event));
    if (token) openTokenEditor(token.id);
  });

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => {
    spaceDown = false;
    canvastoolCursor();
  });

  document.querySelectorAll('.tool').forEach((button) => {
    button.addEventListener('click', () => setTool(button.dataset.tool));
  });

  coneAngleSelect.addEventListener('change', () => {
    state.coneAngle = clampInt(coneAngleSelect.value, 1, 180, 53);
    updateReadout();
    requestDraw();
    saveSceneSoon();
    syncPlayerMeasure();
  });

  $('clearMeasure').addEventListener('click', clearMeasurement);

  $('importMapBtn').addEventListener('click', importMap);
  $('emptyImportBtn').addEventListener('click', importMap);
  $('fitMapBtn').addEventListener('click', fitMap);
  $('zoomIn').addEventListener('click', () => zoomBy(1.2));
  $('zoomOut').addEventListener('click', () => zoomBy(1 / 1.2));

  gridCellInput.addEventListener('input', () => {
    const value = Number.parseInt(gridCellInput.value, 10);
    if (!Number.isFinite(value)) return;
    state.grid.cell = Geo.clamp(value, 10, 400);
    updateMapInfo();
    updateReadout();
    requestDraw();
    saveSceneSoon();
    syncPlayerGrid();
  });
  gridCellInput.addEventListener('change', () => {
    gridCellInput.value = String(Math.round(state.grid.cell));
  });

  const bindOffset = (input, axis) => {
    input.addEventListener('input', () => {
      const value = Number.parseInt(input.value, 10);
      if (!Number.isFinite(value)) return;
      state.grid[axis] = Geo.clamp(value, -20000, 20000);
      requestDraw();
      saveSceneSoon();
      syncPlayerGrid();
    });
    input.addEventListener('change', () => {
      input.value = String(Math.round(state.grid[axis]));
    });
  };
  bindOffset(gridOffsetXInput, 'offsetX');
  bindOffset(gridOffsetYInput, 'offsetY');

  gridOpacityInput.addEventListener('input', () => {
    state.grid.opacity = Geo.clamp(Number(gridOpacityInput.value) / 100, 0, 1);
    requestDraw();
    saveSceneSoon();
    syncPlayerGrid();
  });

  gridVisibleInput.addEventListener('change', () => {
    state.grid.visible = gridVisibleInput.checked;
    requestDraw();
    saveSceneSoon();
    syncPlayerGrid();
  });

  gridSnapInput.addEventListener('change', () => {
    state.grid.snap = gridSnapInput.checked;
    saveSceneSoon();
  });

  tokenForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = tokenNameInput.value.trim();
    if (!name) {
      tokenNameInput.focus();
      toast('Ponle un nombre al token');
      return;
    }

    const typeInput = tokenForm.querySelector('input[name="tokenType"]:checked');
    const type = typeInput && typeInput.value === 'enemy' ? 'enemy' : 'player';
    const hp = clampInt(tokenHpInput.value, 1, 9999, 10);
    const size = clampInt(tokenSizeInput.value, 1, 4, 1);
    const initiativeBonus = clampInt(tokenInitiativeInput.value, -20, 20, 0);
    const center = snapPoint(viewCenterWorld());

    const token = {
      id: uid(),
      name: name.slice(0, 40),
      type,
      color: tokenColorInput.value || DEFAULT_COLORS[type],
      size,
      img: pendingTokenImage ? pendingTokenImage.dataUrl : null,
      hp: { cur: hp, max: hp },
      initiativeBonus,
      initiative: null,
      x: center.x,
      y: center.y,
    };

    state.tokens.push(token);
    state.selectedId = token.id;
    if (token.img) preload(token.img);
    resetTokenForm();
    renderTokenList();
    renderCombatPanel();
    requestDraw();
    saveSceneSoon();
    syncPlayerTokens();
    toast(`Token «${token.name}» creado`);
  });

  tokenForm.querySelectorAll('input[name="tokenType"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      tokenColorInput.value = DEFAULT_COLORS[radio.value] || DEFAULT_COLORS.player;
    });
  });

  $('tokenImageBtn').addEventListener('click', async () => {
    const picked = await pickImage('token');
    if (!picked || !picked.dataUrl) return;
    pendingTokenImage = picked;
    tokenImagePreview.src = picked.dataUrl;
    tokenImageThumb.hidden = false;
    preload(picked.dataUrl);
  });

  $('tokenImageClear').addEventListener('click', () => {
    pendingTokenImage = null;
    tokenImagePreview.removeAttribute('src');
    tokenImageThumb.hidden = true;
  });

  tokenList.addEventListener('click', (event) => {
    const row = event.target.closest('.token-row');
    if (!row) return;
    const id = row.dataset.id;
    // Los inputs no deben provocar un re-render que les quite el foco.
    if (event.target.closest('input, select, textarea')) return;
    const action = event.target.closest('[data-act]');

    if (action) {
      if (action.dataset.act === 'edit') {
        openTokenEditor(id);
        return;
      }
      if (action.dataset.act === 'delete') {
        deleteToken(id);
        return;
      }
      if (action.dataset.act === 'hp') {
        adjustHp(id, Number(action.dataset.value) || 0);
        return;
      }
    }

    selectToken(id);
  });

  tokenList.addEventListener('input', (event) => {
    const row = event.target.closest('.token-row');
    if (!row) return;
    const token = findToken(row.dataset.id);
    if (!token) return;
    const field = event.target.dataset.field;

    if (field === 'hpCur') {
      token.hp.cur = clampInt(event.target.value, 0, token.hp.max, token.hp.cur);
      updateRowBarOnly(token);
      requestDraw();
      saveSceneSoon();
      queuePlayerTokenSync();
    } else if (field === 'hpMax') {
      token.hp.max = clampInt(event.target.value, 1, 9999, token.hp.max);
      if (token.hp.cur > token.hp.max) {
        token.hp.cur = token.hp.max;
        const curInput = row.querySelector('[data-field="hpCur"]');
        if (document.activeElement !== curInput) curInput.value = token.hp.cur;
      }
      updateRowBarOnly(token);
      requestDraw();
      saveSceneSoon();
      queuePlayerTokenSync();
    }
  });

  tokenList.addEventListener('blur', (event) => {
    const row = event.target.closest('.token-row');
    if (!row) return;
    const token = findToken(row.dataset.id);
    if (!token) return;
    if (event.target.dataset.field === 'hpCur') event.target.value = token.hp.cur;
    if (event.target.dataset.field === 'hpMax') event.target.value = token.hp.max;
  }, true);

  tokenEditorForm.addEventListener('submit', (event) => {
    event.preventDefault();
    saveTokenEditor();
  });
  $('tokenEditorClose').addEventListener('click', closeTokenEditor);
  $('tokenEditorCancel').addEventListener('click', closeTokenEditor);
  tokenEditor.addEventListener('pointerdown', (event) => {
    if (event.target === tokenEditor) closeTokenEditor();
  });

  sceneNameInput.addEventListener('input', () => {
    state.sceneName = sceneNameInput.value.trim().slice(0, 48) || 'Escena sin título';
    hudScene.textContent = state.sceneName;
    saveSceneSoon();
  });

  $('exportBtn').addEventListener('click', exportScene);
  $('importBtn').addEventListener('click', importScene);
  $('newSceneBtn').addEventListener('click', newScene);

  campaignSelect.addEventListener('change', () => {
    loadCampaignDetails(campaignSelect.value);
  });

  newCampaignBtn.addEventListener('click', () => {
    campaignForm.hidden = !campaignForm.hidden;
    if (!campaignForm.hidden) campaignNameInput.focus();
  });

  campaignForm.addEventListener('submit', (event) => {
    event.preventDefault();
    createCampaign();
  });

  campaignNameInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    campaignForm.hidden = true;
    campaignForm.reset();
  });

  deleteCampaignBtn.addEventListener('click', deleteCampaign);
  saveRunBtn.addEventListener('click', saveCampaignRun);
  loadRunBtn.addEventListener('click', loadCampaignRun);
  saveCharacterBtn.addEventListener('click', () => saveCampaignSheet('character'));
  saveEnemyBtn.addEventListener('click', () => saveCampaignSheet('enemy'));
  saveCampaignMapBtn.addEventListener('click', saveCampaignMap);
  [characterListEl, enemyListEl, campaignMapListEl].forEach((list) => {
    list.addEventListener('click', handleCampaignListClick);
  });

  playerWindowBtn.addEventListener('click', async () => {
    const api = getPlayerApi();
    if (!api) return;
    try {
      syncPlayerAll();
      if (playerOpen) await api.close();
      else await api.open();
    } catch (error) {
      console.error('No se pudo cambiar la pantalla de jugadores:', error);
      toast('No se pudo abrir la pantalla de jugadores');
    }
  });

  playerShowHpInput.addEventListener('change', () => {
    state.playerDisplay.hp = playerShowHpInput.checked;
    syncPlayerDisplay();
  });

  playerShowMeasureInput.addEventListener('change', () => {
    state.playerDisplay.measure = playerShowMeasureInput.checked;
    syncPlayerDisplay();
  });

  rollInitiativeBtn.addEventListener('click', rollInitiativeForAll);
  nextTurnBtn.addEventListener('click', advanceCombatTurn);
  endCombatBtn.addEventListener('click', endCombat);

  const playerApi = getPlayerApi();
  if (playerApi) {
    playerApi
      .getStatus()
      .then((status) => setPlayerOpen(status && status.open))
      .catch(() => {});
    playerApi.onStatus((status) => setPlayerOpen(status && status.open));
  } else {
    playerWindowBtn.disabled = true;
    playerWindowBtn.title = 'Solo disponible en la app de escritorio';
  }

  newFolderBtn.addEventListener('click', () => {
    folderForm.hidden = !folderForm.hidden;
    if (!folderForm.hidden) folderNameInput.focus();
  });

  importFolderBtn.addEventListener('click', importLibraryFolder);
  if (!window.api || !window.api.library || !window.api.library.importFolder) {
    importFolderBtn.disabled = true;
  }

  folderForm.addEventListener('submit', (event) => {
    event.preventDefault();
    createLibraryFolder(folderNameInput.value);
  });

  folderNameInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    folderForm.hidden = true;
    folderForm.reset();
  });

  mapLibrary.addEventListener('click', handleLibraryClick);
  mapLibrary.addEventListener('keydown', handleLibraryKeyDown);
  mapLibrary.addEventListener('submit', handleLibrarySubmit);
  mapLibrary.addEventListener('focusout', handleLibraryFocusOut);
  mapLibrary.addEventListener('dragstart', handleLibraryDragStart);
  mapLibrary.addEventListener('dragend', handleLibraryDragEnd);
  mapLibrary.addEventListener('dragover', handleLibraryDragOver);
  mapLibrary.addEventListener('dragleave', handleLibraryDragLeave);
  mapLibrary.addEventListener('drop', handleLibraryDrop);

  saveToLibraryBtn.addEventListener('click', openSaveMapForm);

  saveMapForm.addEventListener('submit', (event) => {
    event.preventDefault();
    saveCurrentMapToLibrary(saveMapFolder.value);
  });

  librarySearch.addEventListener('input', () => {
    libraryQuery = librarySearch.value;
    renderLibrary();
  });

  libraryFormatSelect.addEventListener('change', () => {
    libraryFormatFilter = libraryFormatSelect.value;
    renderLibrary();
  });

  const resizeObserver = new ResizeObserver(() => resizeCanvas());
  resizeObserver.observe(stage);
}

function updateRowBarOnly(token) {
  const row = tokenList.querySelector(`.token-row[data-id="${token.id}"]`);
  if (!row) return;
  const pct = token.hp.max > 0 ? Geo.clamp((token.hp.cur / token.hp.max) * 100, 0, 100) : 0;
  const level = token.hp.cur <= 0 ? 'down' : pct <= 25 ? 'low' : pct <= 50 ? 'mid' : 'ok';
  const bar = row.querySelector('.hp-bar');
  bar.className = `hp-bar ${level}`;
  bar.querySelector('i').style.width = `${pct}%`;
}

/* ───────────────────────── Arranque ───────────────────────── */

function init() {
  resizeCanvas();
  bindUI();
  sceneNameInput.value = state.sceneName;
  hudScene.textContent = state.sceneName;
  setTool('select');
  syncGridInputs();
  syncPlayerDisplayInputs();
  updateZoomLabel();
  updateMapInfo();
  updateEmptyState();
  updateReadout();
  renderTokenList();
  renderCombatPanel();
  refreshLibrary();
  refreshCampaigns();

  const stored = safeReadStorage();
  if (stored) {
    applyScene(stored).catch((error) => {
      console.warn('No se pudo restaurar la escena guardada:', error);
      toast('La escena guardada no se pudo restaurar');
    });
  }

  requestDraw();
  syncPlayerAll();
}

init();
