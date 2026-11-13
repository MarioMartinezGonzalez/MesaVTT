'use strict';

const { app, BrowserWindow, dialog, ipcMain, nativeImage, screen } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createLibrary, IMAGE_EXTENSIONS } = require('./library');
const { createCampaignStore } = require('./campaign');

const IMAGE_MIME = {
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  webp: 'webp',
  gif: 'gif',
  bmp: 'bmp',
  avif: 'avif',
};

let mainWindow = null;
let mapLibrary = null;
let campaignStore = null;
let playerWindow = null;
const playerCache = {
  map: null,
  grid: null,
  tokens: [],
  measure: null,
  display: { hp: true, measure: true },
  combat: { active: false, round: 1, turnId: null, order: [] },
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0b0d12',
    title: 'Mesa VTT · D&D 5e',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (playerIsOpen()) playerWindow.close();
  });
}

function playerIsOpen() {
  return Boolean(playerWindow && !playerWindow.isDestroyed());
}

function notifyPlayerStatus() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('player:status', {
    open: playerIsOpen(),
    fullscreen: playerIsOpen() ? playerWindow.isFullScreen() : false,
  });
}

function sendToPlayer(channel, payload) {
  if (playerIsOpen()) playerWindow.webContents.send(channel, payload);
}

// La pantalla de jugadores solo recibe una proporción de vida, nunca las cifras exactas.
function sanitizePlayerToken(token) {
  if (!token || typeof token !== 'object') return null;
  const id = typeof token.id === 'string' ? token.id.slice(0, 80) : '';
  if (!id) return null;

  const type = token.type === 'enemy' ? 'enemy' : 'player';
  const clean = {
    id,
    name: typeof token.name === 'string' ? token.name.slice(0, 40) : 'Token',
    type,
    color:
      typeof token.color === 'string' && /^#[0-9a-f]{6}$/i.test(token.color)
        ? token.color
        : type === 'enemy'
          ? '#ef5b5b'
          : '#4da3ff',
    size: Math.min(4, Math.max(1, Math.round(Number(token.size) || 1))),
    x: Number.isFinite(Number(token.x)) ? Number(token.x) : 0,
    y: Number.isFinite(Number(token.y)) ? Number(token.y) : 0,
  };

  if (typeof token.img === 'string' && token.img.startsWith('data:image/')) {
    clean.img = token.img;
  }

  const hp = token.hp && typeof token.hp === 'object' ? token.hp : null;
  if (hp && Number.isFinite(Number(hp.pct))) {
    const pct = Math.min(1, Math.max(0, Number(hp.pct)));
    clean.hp = {
      pct: Math.round(pct * 1000) / 1000,
      down: Boolean(hp.down) || pct <= 0,
    };
  }
  return clean;
}

function sanitizePlayerTokens(tokens) {
  return Array.isArray(tokens) ? tokens.map(sanitizePlayerToken).filter(Boolean) : [];
}

function sanitizePlayerMeasure(measure) {
  if (!measure || typeof measure !== 'object') return null;
  if (!['ruler', 'circle', 'cone'].includes(measure.kind)) return null;
  const start = measure.start;
  const end = measure.end;
  if (!start || !end) return null;
  if (!Number.isFinite(Number(start.x)) || !Number.isFinite(Number(start.y))) return null;
  if (!Number.isFinite(Number(end.x)) || !Number.isFinite(Number(end.y))) return null;

  return {
    kind: measure.kind,
    start: { x: Number(start.x), y: Number(start.y) },
    end: { x: Number(end.x), y: Number(end.y) },
    coneAngle: [45, 53, 90].includes(Number(measure.coneAngle)) ? Number(measure.coneAngle) : 53,
  };
}

function sanitizePlayerDisplay(display) {
  return {
    hp: !display || display.hp !== false,
    measure: !display || display.measure !== false,
  };
}

function sanitizePlayerCombat(combat) {
  const empty = { active: false, round: 1, turnId: null, order: [] };
  if (!combat || typeof combat !== 'object') return empty;

  const order = Array.isArray(combat.order)
    ? combat.order
        .slice(0, 100)
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const id = typeof entry.id === 'string' ? entry.id.slice(0, 80) : '';
          if (!id) return null;
          const initiative = Number(entry.initiative);
          if (!Number.isFinite(initiative)) return null;
          return {
            id,
            name: typeof entry.name === 'string' ? entry.name.slice(0, 40) : 'Token',
            type: entry.type === 'enemy' ? 'enemy' : 'player',
            initiative: Math.max(-100, Math.min(100, Math.round(initiative))),
          };
        })
        .filter(Boolean)
    : [];

  if (order.length === 0) return empty;
  const requestedTurn = typeof combat.turnId === 'string' ? combat.turnId.slice(0, 80) : null;
  const turnId = order.some((entry) => entry.id === requestedTurn)
    ? requestedTurn
    : order[0].id;

  return {
    active: Boolean(combat.active),
    round: Math.min(999, Math.max(1, Math.round(Number(combat.round) || 1))),
    turnId,
    order,
  };
}

function createPlayerWindow() {
  if (playerIsOpen()) {
    playerWindow.show();
    playerWindow.focus();
    return playerWindow;
  }

  let secondary = null;
  try {
    const primary = screen.getPrimaryDisplay();
    secondary = screen.getAllDisplays().find((display) => display.id !== primary.id) || null;
  } catch (error) {
    secondary = null;
  }

  const options = {
    width: 1280,
    height: 800,
    minWidth: 480,
    minHeight: 320,
    backgroundColor: '#000000',
    title: 'Mesa VTT · Pantalla de jugadores',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'player-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };

  // Si hay un segundo monitor, la pantalla de jugadores se abre allí a pantalla completa.
  if (secondary) {
    options.x = secondary.bounds.x;
    options.y = secondary.bounds.y;
    options.width = secondary.bounds.width;
    options.height = secondary.bounds.height;
  }

  playerWindow = new BrowserWindow(options);
  // Sin menú propio: evita que F11 se dispare dos veces por el acelerador por defecto.
  playerWindow.setMenu(null);
  playerWindow.loadFile('player.html');

  playerWindow.once('ready-to-show', () => {
    if (!playerIsOpen()) return;
    if (secondary) playerWindow.setBounds(secondary.bounds);
    playerWindow.show();
    if (secondary) playerWindow.setFullScreen(true);
    notifyPlayerStatus();
  });

  playerWindow.on('enter-full-screen', () => {
    sendToPlayer('player:fullscreen', true);
    notifyPlayerStatus();
  });
  playerWindow.on('leave-full-screen', () => {
    sendToPlayer('player:fullscreen', false);
    notifyPlayerStatus();
  });
  playerWindow.on('closed', () => {
    playerWindow = null;
    notifyPlayerStatus();
  });

  notifyPlayerStatus();
  return playerWindow;
}

app.whenReady().then(() => {
  app.setName('Mesa VTT');
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function ownerOf(event) {
  return BrowserWindow.fromWebContents(event.sender) || mainWindow;
}

function makeThumbnail(filePath) {
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) return null;

  const size = image.getSize();
  const scale = Math.min(1, 360 / Math.max(1, size.width));
  const resized =
    scale < 1
      ? image.resize({ width: Math.max(1, Math.round(size.width * scale)), quality: 'good' })
      : image;

  const jpeg = resized.toJPEG(72);
  return {
    width: size.width,
    height: size.height,
    jpeg: jpeg && jpeg.length ? jpeg : null,
  };
}

function getLibrary() {
  if (!mapLibrary) {
    mapLibrary = createLibrary({
      root: path.join(app.getPath('userData'), 'library'),
      thumbnailer: makeThumbnail,
    });
  }
  return mapLibrary;
}

function getCampaignStore() {
  if (!campaignStore) {
    campaignStore = createCampaignStore({
      root: path.join(app.getPath('userData'), 'campaigns'),
    });
  }
  return campaignStore;
}

ipcMain.handle('player:open', () => {
  createPlayerWindow();
  return { open: true };
});

ipcMain.handle('player:close', () => {
  if (playerIsOpen()) playerWindow.close();
  return { open: false };
});

ipcMain.handle('player:getStatus', () => ({
  open: playerIsOpen(),
  fullscreen: playerIsOpen() ? playerWindow.isFullScreen() : false,
}));

ipcMain.handle('player:toggleFullscreen', () => {
  if (!playerIsOpen()) return false;
  playerWindow.setFullScreen(!playerWindow.isFullScreen());
  return playerWindow.isFullScreen();
});

ipcMain.on('player:setMap', (event, map) => {
  playerCache.map =
    map && typeof map === 'object' && typeof map.src === 'string'
      ? {
          name: typeof map.name === 'string' ? map.name : 'Mapa',
          src: map.src,
          w: Number(map.w) || 0,
          h: Number(map.h) || 0,
        }
      : null;
  sendToPlayer('player:map', playerCache.map);
});

ipcMain.on('player:setGrid', (event, grid) => {
  playerCache.grid = grid && typeof grid === 'object' ? grid : null;
  sendToPlayer('player:grid', playerCache.grid);
});

ipcMain.on('player:setTokens', (event, tokens) => {
  playerCache.tokens = sanitizePlayerTokens(tokens);
  sendToPlayer('player:tokens', playerCache.tokens);
});

ipcMain.on('player:updateTokens', (event, tokens) => {
  const updates = sanitizePlayerTokens(tokens);
  const byId = new Map(updates.map((token) => [token.id, token]));
  playerCache.tokens = playerCache.tokens.map((token) =>
    byId.has(token.id) ? Object.assign({}, token, byId.get(token.id)) : token
  );
  for (const token of updates) {
    if (!playerCache.tokens.some((item) => item.id === token.id)) playerCache.tokens.push(token);
  }
  sendToPlayer('player:updateTokens', updates);
});

ipcMain.on('player:setMeasure', (event, measure) => {
  playerCache.measure = sanitizePlayerMeasure(measure);
  sendToPlayer('player:measure', playerCache.measure);
});

ipcMain.on('player:setDisplay', (event, display) => {
  playerCache.display = sanitizePlayerDisplay(display);
  sendToPlayer('player:display', playerCache.display);
});

ipcMain.on('player:setCombat', (event, combat) => {
  playerCache.combat = sanitizePlayerCombat(combat);
  sendToPlayer('player:combat', playerCache.combat);
});

ipcMain.on('player:ready', (event) => {
  if (!playerIsOpen() || event.sender !== playerWindow.webContents) return;
  event.sender.send('player:map', playerCache.map);
  event.sender.send('player:grid', playerCache.grid);
  event.sender.send('player:tokens', playerCache.tokens);
  event.sender.send('player:measure', playerCache.measure);
  event.sender.send('player:display', playerCache.display);
  event.sender.send('player:combat', playerCache.combat);
  event.sender.send('player:fullscreen', playerIsOpen() && playerWindow.isFullScreen());
});

ipcMain.handle('dialog:openImage', async (event, kind) => {
  try {
    const win = ownerOf(event);
    const options = {
      title: kind === 'map' ? 'Importar mapa' : 'Imagen del token',
      properties: ['openFile'],
      filters: [{ name: 'Imágenes', extensions: IMAGE_EXTENSIONS }],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;

    const filePath = result.filePaths[0];
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const buffer = await fs.readFile(filePath);

    return {
      name: path.basename(filePath),
      dataUrl: `data:image/${IMAGE_MIME[ext] || ext};base64,${buffer.toString('base64')}`,
    };
  } catch (error) {
    console.error('No se pudo leer la imagen:', error);
    return null;
  }
});

ipcMain.handle('scene:save', async (event, json) => {
  try {
    const win = ownerOf(event);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const options = {
      title: 'Exportar escena',
      defaultPath: `escena-${stamp}.json`,
      filters: [{ name: 'Escena VTT', extensions: ['json'] }],
    };
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;

    await fs.writeFile(result.filePath, json, 'utf8');
    return result.filePath;
  } catch (error) {
    console.error('No se pudo exportar la escena:', error);
    return null;
  }
});

ipcMain.handle('scene:load', async (event) => {
  try {
    const win = ownerOf(event);
    const options = {
      title: 'Importar escena',
      properties: ['openFile'],
      filters: [{ name: 'Escena VTT', extensions: ['json'] }],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;

    const filePath = result.filePaths[0];
    const text = await fs.readFile(filePath, 'utf8');
    return { path: filePath, text };
  } catch (error) {
    console.error('No se pudo importar la escena:', error);
    return null;
  }
});

ipcMain.handle('library:list', async () => {
  try {
    return await getLibrary().list();
  } catch (error) {
    console.error('No se pudo leer la biblioteca:', error);
    return { folders: [] };
  }
});

ipcMain.handle('library:createFolder', (event, name) => getLibrary().createFolder(name));

ipcMain.handle('library:renameFolder', (event, id, name) => getLibrary().renameFolder(id, name));

ipcMain.handle('library:deleteFolder', (event, id) => getLibrary().deleteFolder(id));

ipcMain.handle('library:importMaps', async (event, folderId) => {
  try {
    const win = ownerOf(event);
    const options = {
      title: 'Añadir mapas a la biblioteca',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Imágenes', extensions: IMAGE_EXTENSIONS }],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;

    return await getLibrary().importFiles(folderId, result.filePaths);
  } catch (error) {
    console.error('No se pudieron importar los mapas:', error);
    throw error;
  }
});

ipcMain.handle('library:importFolder', async (event) => {
  try {
    const win = ownerOf(event);
    const options = {
      title: 'Importar carpeta de mapas',
      properties: ['openDirectory'],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;

    const source = result.filePaths[0];
    const root = await getLibrary().createFolder(path.basename(source) || 'Mapas importados');
    const tree = await getLibrary().importTree(root.id, source);
    return Object.assign({}, tree, { rootFolderId: root.id });
  } catch (error) {
    console.error('No se pudo importar la carpeta:', error);
    throw error;
  }
});

ipcMain.handle('library:setThumbnail', (event, folderId, mapId, payload) =>
  getLibrary().setThumbnail(folderId, mapId, payload)
);

ipcMain.handle('library:deleteMap', (event, folderId, mapId) =>
  getLibrary().deleteMap(folderId, mapId)
);

ipcMain.handle('library:loadMap', (event, folderId, mapId) =>
  getLibrary().readMap(folderId, mapId)
);

ipcMain.handle('library:addMap', (event, folderId, payload) =>
  getLibrary().addMap(folderId, payload)
);

ipcMain.handle('library:moveMap', (event, fromFolderId, mapId, toFolderId) =>
  getLibrary().moveMap(fromFolderId, mapId, toFolderId)
);

ipcMain.handle('campaign:list', () => getCampaignStore().list());

ipcMain.handle('campaign:get', (event, id) => getCampaignStore().get(id));

ipcMain.handle('campaign:create', (event, name) => getCampaignStore().create(name));

ipcMain.handle('campaign:remove', (event, id) => getCampaignStore().remove(id));

ipcMain.handle('campaign:saveRun', (event, id, run) => getCampaignStore().saveRun(id, run));

ipcMain.handle('campaign:saveSheet', (event, id, kind, token) =>
  getCampaignStore().saveSheet(id, kind, token)
);

ipcMain.handle('campaign:deleteSheet', (event, id, kind, sheetId) =>
  getCampaignStore().deleteSheet(id, kind, sheetId)
);

ipcMain.handle('campaign:saveMap', (event, id, payload) =>
  getCampaignStore().saveMap(id, payload)
);

ipcMain.handle('campaign:readMap', (event, id, mapId) =>
  getCampaignStore().readMap(id, mapId)
);

ipcMain.handle('campaign:deleteMap', (event, id, mapId) =>
  getCampaignStore().deleteMap(id, mapId)
);
