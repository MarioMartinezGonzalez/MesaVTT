'use strict';

/* Pantalla de jugadores: mapa, malla, tokens, barras proporcionales y mediciones. */

const canvas = document.getElementById('playerBoard');
const ctx = canvas.getContext('2d');
const waiting = document.getElementById('waiting');
const turnPanel = document.getElementById('turnPanel');
const turnRound = document.getElementById('turnRound');
const turnList = document.getElementById('turnList');

const scene = {
  map: null,
  grid: { cell: 70, offsetX: 0, offsetY: 0, visible: true, opacity: 0.38 },
  tokens: [],
  measure: null,
  display: { hp: true, measure: true },
  combat: { active: false, round: 1, turnId: null, order: [] },
};

const images = new Map();
const loading = new Set();
let mapImage = null;
let dpr = 1;
let fullscreen = false;

function resize() {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  draw();
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

function hpColor(pct) {
  if (pct > 0.5) return '#45c46d';
  if (pct > 0.25) return '#e6b93f';
  return '#e2574c';
}

function formatSquares(squares) {
  const rounded = Math.round(squares * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace('.', ',');
  return `${text} ${rounded === 1 ? 'casilla' : 'casillas'}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderCombat() {
  const combat = scene.combat;
  const order = combat && combat.active && Array.isArray(combat.order) ? combat.order : [];
  if (order.length === 0) {
    turnPanel.hidden = true;
    turnList.innerHTML = '';
    return;
  }

  turnPanel.hidden = false;
  turnRound.textContent = `Ronda ${Number(combat.round) || 1}`;
  const tokensById = new Map(scene.tokens.map((token) => [token.id, token]));
  turnList.innerHTML = order
    .map((entry, index) => {
      const token = tokensById.get(entry.id);
      const type = entry.type === 'enemy' ? ' enemy' : '';
      const current = entry.id === combat.turnId ? ' current' : '';
      const color =
        token && typeof token.color === 'string'
          ? token.color
          : entry.type === 'enemy'
            ? '#ef5b5b'
            : '#4da3ff';
      const icon =
        token && token.img
          ? `<img src="${escapeHtml(token.img)}" alt="" />`
          : escapeHtml((String(entry.name || '?').trim()[0] || '?').toUpperCase());
      return `<li class="turn-item${type}${current}">
        <span class="turn-position">${index + 1}</span>
        <span class="turn-icon" style="--token-color:${escapeHtml(color)}">${icon}</span>
        <span class="turn-name">${escapeHtml(entry.name)}</span>
        <span class="turn-total">${Number(entry.initiative)}</span>
      </li>`;
    })
    .join('');
}

function tokenImage(src) {
  if (!src) return null;
  if (images.has(src)) return images.get(src);
  if (loading.has(src)) return null;

  loading.add(src);
  const image = new Image();
  image.onload = () => {
    loading.delete(src);
    images.set(src, image);
    draw();
  };
  image.onerror = () => loading.delete(src);
  image.src = src;
  return null;
}

function loadMapImage(map) {
  if (!map) {
    mapImage = null;
    waiting.hidden = false;
    draw();
    return;
  }

  const cached = images.get(map.src);
  if (cached) {
    mapImage = cached;
    waiting.hidden = true;
    draw();
    return;
  }

  mapImage = null;
  waiting.hidden = false;
  const image = new Image();
  image.onload = () => {
    images.set(map.src, image);
    if (scene.map && scene.map.src === map.src) {
      mapImage = image;
      waiting.hidden = true;
    }
    draw();
  };
  image.onerror = () => {
    mapImage = null;
    waiting.hidden = false;
    draw();
  };
  image.src = map.src;
}

function drawGrid(ox, oy, mapWidth, mapHeight, scale) {
  const grid = scene.grid;
  if (!grid || !grid.visible || grid.cell * scale < 5) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, mapWidth * scale, mapHeight * scale);
  ctx.clip();

  const cell = grid.cell;
  const startX = Math.floor((0 - grid.offsetX) / cell);
  const endX = Math.ceil((mapWidth - grid.offsetX) / cell);
  const startY = Math.floor((0 - grid.offsetY) / cell);
  const endY = Math.ceil((mapHeight - grid.offsetY) / cell);

  ctx.strokeStyle = `rgba(7, 10, 16, ${grid.opacity})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = startX; x <= endX; x += 1) {
    const px = ox + (grid.offsetX + x * cell) * scale;
    ctx.moveTo(px, oy);
    ctx.lineTo(px, oy + mapHeight * scale);
  }
  for (let y = startY; y <= endY; y += 1) {
    const py = oy + (grid.offsetY + y * cell) * scale;
    ctx.moveTo(ox, py);
    ctx.lineTo(ox + mapWidth * scale, py);
  }
  ctx.stroke();

  ctx.strokeStyle = `rgba(7, 10, 16, ${Math.min(0.92, grid.opacity + 0.28)})`;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let x = startX; x <= endX; x += 1) {
    if (x % 5 !== 0) continue;
    const px = ox + (grid.offsetX + x * cell) * scale;
    ctx.moveTo(px, oy);
    ctx.lineTo(px, oy + mapHeight * scale);
  }
  for (let y = startY; y <= endY; y += 1) {
    if (y % 5 !== 0) continue;
    const py = oy + (grid.offsetY + y * cell) * scale;
    ctx.moveTo(ox, py);
    ctx.lineTo(ox + mapWidth * scale, py);
  }
  ctx.stroke();

  ctx.restore();
}

function drawToken(token, cx, cy, radius) {
  const image = token.img ? tokenImage(token.img) : null;
  const color = token.color || (token.type === 'enemy' ? '#ef5b5b' : '#4da3ff');

  ctx.save();

  ctx.beginPath();
  ctx.arc(cx, cy + Math.max(1, radius * 0.06), radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();

  if (image) {
    const scale = Math.max((radius * 2) / image.naturalWidth, (radius * 2) / image.naturalHeight);
    const w = image.naturalWidth * scale;
    const h = image.naturalHeight * scale;
    ctx.drawImage(image, cx - w / 2, cy - h / 2, w, h);
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

    const initial = (String(token.name || '?').trim()[0] || '?').toUpperCase();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.font = `700 ${Math.max(10, radius * 0.85)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initial, cx, cy + radius * 0.03);
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(2, radius * 0.09);
  ctx.strokeStyle = color;
  ctx.stroke();

  // Barra de vida: solo proporción, sin cifras.
  if (scene.display.hp && token.hp && Number.isFinite(Number(token.hp.pct))) {
    const pct = Math.max(0, Math.min(1, Number(token.hp.pct)));
    const barWidth = Math.max(16, radius * 1.55);
    const barHeight = Math.max(4, Math.min(9, radius * 0.17));
    const barX = cx - barWidth / 2;
    const barY = cy + radius - barHeight - Math.max(2, radius * 0.07);

    ctx.fillStyle = 'rgba(5, 8, 13, 0.82)';
    roundRect(ctx, barX, barY, barWidth, barHeight, barHeight / 2);
    ctx.fill();

    if (pct > 0) {
      ctx.fillStyle = token.hp.down ? '#6b7280' : hpColor(pct);
      roundRect(ctx, barX, barY, Math.max(barHeight, barWidth * pct), barHeight, barHeight / 2);
      ctx.fill();
    }
  }

  if (radius >= 8) {
    const name = String(token.name || '');
    const label = name.length > 20 ? `${name.slice(0, 19)}…` : name;
    const fontSize = Math.max(11, Math.min(22, radius * 0.32));
    ctx.font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const textWidth = ctx.measureText(label).width;
    const labelY = cy + radius + fontSize * 0.85;
    ctx.fillStyle = 'rgba(8, 11, 17, 0.8)';
    roundRect(ctx, cx - textWidth / 2 - 7, labelY - fontSize * 0.78, textWidth + 14, fontSize * 1.55, fontSize);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#e9eef7';
    ctx.fillText(label, cx, labelY);
  }

  ctx.restore();
}

function drawMeasurement(scale, ox, oy) {
  const measure = scene.measure;
  if (!measure || !measure.start || !measure.end) return;
  if (!['ruler', 'circle', 'cone'].includes(measure.kind)) return;

  const startX = Number(measure.start.x);
  const startY = Number(measure.start.y);
  const endX = Number(measure.end.x);
  const endY = Number(measure.end.y);
  if (![startX, startY, endX, endY].every(Number.isFinite)) return;

  const a = { x: ox + startX * scale, y: oy + startY * scale };
  const b = { x: ox + endX * scale, y: oy + endY * scale };
  const cell = scene.grid && scene.grid.cell ? scene.grid.cell : 70;
  const dx = endX - startX;
  const dy = endY - startY;

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
    ctx.arc(a.x, a.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#f2c14e';
    ctx.fill();

    drawPill(`${feet} pies · ${formatSquares(squares)}`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 18);
  } else if (measure.kind === 'circle') {
    const radius = Math.hypot(b.x - a.x, b.y - a.y);
    const feet = Geo.roundFeet(Geo.euclidFeet(dx, dy, cell));

    ctx.beginPath();
    ctx.arc(a.x, a.y, radius, 0, Math.PI * 2);
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
    ctx.arc(a.x, a.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#f2c14e';
    ctx.fill();

    drawPill(`Círculo · radio ${feet} pies`, a.x, a.y - radius - 18);
  } else if (measure.kind === 'cone') {
    const radius = Math.hypot(b.x - a.x, b.y - a.y);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const coneAngle = Number(measure.coneAngle) || 53;
    const half = ((coneAngle * Math.PI) / 180) / 2;
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
    ctx.arc(a.x, a.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#f2c14e';
    ctx.fill();

    drawPill(
      `Cono ${coneAngle}° · ${feet} pies`,
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

function draw() {
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  if (!width || !height) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  if (!scene.map || !mapImage) return;

  const mapWidth = scene.map.w || mapImage.naturalWidth;
  const mapHeight = scene.map.h || mapImage.naturalHeight;
  if (!mapWidth || !mapHeight) return;

  const scale = Math.min(width / mapWidth, height / mapHeight);
  const ox = (width - mapWidth * scale) / 2;
  const oy = (height - mapHeight * scale) / 2;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(mapImage, ox, oy, mapWidth * scale, mapHeight * scale);

  drawGrid(ox, oy, mapWidth, mapHeight, scale);
  if (scene.display.measure) drawMeasurement(scale, ox, oy);

  const cell = scene.grid && scene.grid.cell ? scene.grid.cell : 70;
  for (const token of scene.tokens) {
    const cx = ox + token.x * scale;
    const cy = oy + token.y * scale;
    const radius = Math.max(7, (Number(token.size) || 1) * cell * scale / 2);
    drawToken(token, cx, cy, radius);
  }
}

function mergeTokens(updates) {
  const byId = new Map(updates.map((token) => [token.id, token]));
  scene.tokens = scene.tokens.map((token) =>
    byId.has(token.id) ? Object.assign({}, token, byId.get(token.id)) : token
  );
  for (const token of updates) {
    if (!scene.tokens.some((item) => item.id === token.id)) scene.tokens.push(token);
  }
}

let cursorTimer = 0;
function hideCursorSoon() {
  document.body.classList.remove('idle');
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => document.body.classList.add('idle'), 2000);
}

function bind() {
  if (!window.playerApi) {
    waiting.textContent = 'Abre esta pantalla desde Mesa VTT.';
    return;
  }

  if (typeof window.playerApi.getStatus === 'function') {
    window.playerApi
      .getStatus()
      .then((status) => {
        fullscreen = Boolean(status && status.fullscreen);
      })
      .catch(() => {});
  }

  window.playerApi.onMap((map) => {
    scene.map = map;
    loadMapImage(map);
  });

  window.playerApi.onGrid((grid) => {
    if (grid && typeof grid === 'object') scene.grid = Object.assign({}, scene.grid, grid);
    draw();
  });

  window.playerApi.onTokens((tokens) => {
    scene.tokens = Array.isArray(tokens) ? tokens.map((token) => Object.assign({}, token)) : [];
    renderCombat();
    draw();
  });

  window.playerApi.onUpdateTokens((tokens) => {
    if (!Array.isArray(tokens)) return;
    mergeTokens(tokens);
    renderCombat();
    draw();
  });

  window.playerApi.onMeasure((measure) => {
    scene.measure = measure && typeof measure === 'object' ? measure : null;
    draw();
  });

  window.playerApi.onDisplay((display) => {
    if (!display || typeof display !== 'object') return;
    scene.display.hp = display.hp !== false;
    scene.display.measure = display.measure !== false;
    draw();
  });

  window.playerApi.onCombat((combat) => {
    scene.combat =
      combat && typeof combat === 'object'
        ? combat
        : { active: false, round: 1, turnId: null, order: [] };
    renderCombat();
  });

  window.playerApi.onFullscreen((value) => {
    fullscreen = Boolean(value);
  });

  window.playerApi.ready();
}

window.addEventListener('resize', resize);
window.addEventListener('mousemove', hideCursorSoon);
window.addEventListener('keydown', (event) => {
  if (!window.playerApi) return;
  if (event.key === 'F11' || (event.key === 'Escape' && fullscreen)) {
    event.preventDefault();
    window.playerApi.toggleFullscreen();
  }
});

resize();
bind();
hideCursorSoon();
