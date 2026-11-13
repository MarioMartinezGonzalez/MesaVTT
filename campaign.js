'use strict';

/*
 * Campañas de Mesa VTT: una carpeta de archivos por run.
 *
 * userData/campaigns/
 *   index.json
 *   <campaignId>/
 *     campaign.json
 *     run.json
 *     characters/<sheetId>.json
 *     enemies/<sheetId>.json
 *     maps/index.json
 *     maps/<mapId>.<ext>
 *
 * El módulo no depende de Electron para poder probarse con Node.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'];
const IMAGE_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
};

const INDEX_VERSION = 1;

function sanitizeName(name, fallback, max = 60) {
  const cleaned = String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  return cleaned || fallback;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function assertId(value) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new Error('Identificador no válido');
  }
}

function parseImageDataUrl(dataUrl) {
  const text = String(dataUrl || '');
  const comma = text.indexOf(',');
  if (!text.startsWith('data:image/') || comma === -1) {
    throw new Error('Imagen no válida');
  }

  const header = text.slice('data:'.length, comma);
  const parts = header.split(';');
  const mime = parts[0] || '';
  const isBase64 = parts.slice(1).some((part) => part.toLowerCase() === 'base64');
  if (!mime.startsWith('image/') || !isBase64) throw new Error('Imagen no válida');

  const subtype = mime.slice('image/'.length).toLowerCase();
  const extension = subtype === 'jpeg' ? 'jpg' : subtype;
  if (!IMAGE_EXTENSIONS.includes(extension)) {
    throw new Error('Formato de imagen no admitido');
  }

  const buffer = Buffer.from(text.slice(comma + 1), 'base64');
  if (!buffer.length) throw new Error('Imagen vacía');
  return { extension, mime, buffer };
}

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(temp, file);
}

function sanitizeSheet(raw, type) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const hpMax = clampInt(source.hp && source.hp.max, 1, 9999, 10);
  const hpCur = clampInt(source.hp && source.hp.cur, 0, hpMax, hpMax);
  return {
    id: crypto.randomUUID(),
    name: sanitizeName(source.name, 'Token', 40),
    type: type === 'enemy' ? 'enemy' : 'player',
    color:
      typeof source.color === 'string' && /^#[0-9a-f]{6}$/i.test(source.color)
        ? source.color
        : type === 'enemy'
          ? '#ef5b5b'
          : '#4da3ff',
    size: clampInt(source.size, 1, 4, 1),
    hp: { cur: hpCur, max: hpMax },
    initiativeBonus: clampInt(source.initiativeBonus, -20, 20, 0),
    img:
      typeof source.img === 'string' && source.img.startsWith('data:image/')
        ? source.img
        : null,
    createdAt: new Date().toISOString(),
  };
}

function createCampaignStore({ root } = {}) {
  if (!root) throw new Error('El almacén de campañas necesita una carpeta raíz');

  const indexFile = path.join(root, 'index.json');
  let queue = Promise.resolve();

  function serial(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  function campaignDir(id) {
    assertId(id);
    return path.join(root, id);
  }

  async function ensureRoot() {
    await fs.mkdir(root, { recursive: true });
  }

  async function readIndex() {
    await ensureRoot();
    const data = await readJson(indexFile, { version: INDEX_VERSION, campaigns: [] });
    if (!data || !Array.isArray(data.campaigns)) {
      throw new Error('El índice de campañas no es válido');
    }
    return data;
  }

  async function writeIndex(data) {
    await writeJson(indexFile, data);
  }

  async function readCampaign(id) {
    const dir = campaignDir(id);
    const campaign = await readJson(path.join(dir, 'campaign.json'), null);
    if (!campaign) throw new Error('Campaña no encontrada');
    return { dir, campaign };
  }

  async function touch(id) {
    const now = new Date().toISOString();
    const { dir, campaign } = await readCampaign(id);
    campaign.updatedAt = now;
    await writeJson(path.join(dir, 'campaign.json'), campaign);

    const data = await readIndex();
    const entry = data.campaigns.find((item) => item.id === id);
    if (entry) {
      entry.updatedAt = now;
      await writeIndex(data);
    }
    return now;
  }

  async function list() {
    const data = await readIndex();
    return {
      root,
      campaigns: data.campaigns
        .map((campaign) => ({
          id: campaign.id,
          name: campaign.name,
          createdAt: campaign.createdAt,
          updatedAt: campaign.updatedAt,
        }))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
    };
  }

  function create(name) {
    return serial(async () => {
      const data = await readIndex();
      const now = new Date().toISOString();
      const campaign = {
        id: crypto.randomUUID(),
        name: sanitizeName(name, `Campaña ${data.campaigns.length + 1}`),
        createdAt: now,
        updatedAt: now,
      };

      const dir = campaignDir(campaign.id);
      await fs.mkdir(path.join(dir, 'characters'), { recursive: true });
      await fs.mkdir(path.join(dir, 'enemies'), { recursive: true });
      await fs.mkdir(path.join(dir, 'maps'), { recursive: true });
      await writeJson(path.join(dir, 'campaign.json'), campaign);
      data.campaigns.push(campaign);
      await writeIndex(data);
      return campaign;
    });
  }

  function remove(id) {
    return serial(async () => {
      assertId(id);
      const data = await readIndex();
      if (!data.campaigns.some((campaign) => campaign.id === id)) {
        throw new Error('Campaña no encontrada');
      }
      data.campaigns = data.campaigns.filter((campaign) => campaign.id !== id);
      await writeIndex(data);
      await fs.rm(campaignDir(id), { recursive: true, force: true });
      return { ok: true };
    });
  }

  async function get(id) {
    const { dir, campaign } = await readCampaign(id);
    const run = await readJson(path.join(dir, 'run.json'), null);
    const mapIndex = await readJson(path.join(dir, 'maps', 'index.json'), {
      version: 1,
      maps: [],
    });

    async function readSheets(folder) {
      const sheetDir = path.join(dir, folder);
      let files = [];
      try {
        files = await fs.readdir(sheetDir);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const sheets = [];
      for (const file of files.filter((name) => name.endsWith('.json')).sort()) {
        const sheet = await readJson(path.join(sheetDir, file), null);
        if (sheet && sheet.id) sheets.push(sheet);
      }
      return sheets.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    }

    return {
      root,
      campaign,
      run,
      characters: await readSheets('characters'),
      enemies: await readSheets('enemies'),
      maps: Array.isArray(mapIndex.maps) ? mapIndex.maps : [],
    };
  }

  function saveRun(id, run) {
    return serial(async () => {
      const { dir } = await readCampaign(id);
      if (!run || typeof run !== 'object') throw new Error('Progreso no válido');
      await writeJson(path.join(dir, 'run.json'), run);
      const savedAt = await touch(id);
      return { savedAt };
    });
  }

  function saveSheet(id, kind, token) {
    return serial(async () => {
      const { dir } = await readCampaign(id);
      const folder = kind === 'enemy' ? 'enemies' : 'characters';
      const sheet = sanitizeSheet(token, kind === 'enemy' ? 'enemy' : 'player');
      await writeJson(path.join(dir, folder, `${sheet.id}.json`), sheet);
      await touch(id);
      return sheet;
    });
  }

  function deleteSheet(id, kind, sheetId) {
    return serial(async () => {
      assertId(sheetId);
      const { dir } = await readCampaign(id);
      const folder = kind === 'enemy' ? 'enemies' : 'characters';
      await fs.rm(path.join(dir, folder, `${sheetId}.json`), { force: true });
      await touch(id);
      return { ok: true };
    });
  }

  async function readMapIndex(dir) {
    return readJson(path.join(dir, 'maps', 'index.json'), { version: 1, maps: [] });
  }

  function saveMap(id, payload) {
    return serial(async () => {
      const { dir } = await readCampaign(id);
      const source = payload && typeof payload === 'object' ? payload : {};
      const image = parseImageDataUrl(source.dataUrl);
      const mapId = crypto.randomUUID();
      const storedName = `${mapId}.${image.extension}`;
      await fs.writeFile(path.join(dir, 'maps', storedName), image.buffer);

      const index = await readMapIndex(dir);
      const map = {
        id: mapId,
        name: sanitizeName(source.name, 'Mapa', 120),
        width: Number(source.width) || 0,
        height: Number(source.height) || 0,
        format: image.extension,
        storedName,
        addedAt: new Date().toISOString(),
      };
      index.maps.push(map);
      await writeJson(path.join(dir, 'maps', 'index.json'), index);
      await touch(id);
      return map;
    });
  }

  async function readMap(id, mapId) {
    assertId(mapId);
    const { dir } = await readCampaign(id);
    const index = await readMapIndex(dir);
    const map = index.maps.find((item) => item.id === mapId);
    if (!map) throw new Error('Mapa no encontrado');
    const buffer = await fs.readFile(path.join(dir, 'maps', map.storedName));
    const mime = IMAGE_MIME[map.format] || `image/${map.format}`;
    return {
      id: map.id,
      name: map.name,
      width: map.width,
      height: map.height,
      dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
    };
  }

  function deleteMap(id, mapId) {
    return serial(async () => {
      assertId(mapId);
      const { dir } = await readCampaign(id);
      const index = await readMapIndex(dir);
      const position = index.maps.findIndex((item) => item.id === mapId);
      if (position === -1) throw new Error('Mapa no encontrado');
      const [map] = index.maps.splice(position, 1);
      await writeJson(path.join(dir, 'maps', 'index.json'), index);
      await fs.rm(path.join(dir, 'maps', map.storedName), { force: true });
      await touch(id);
      return { ok: true };
    });
  }

  return {
    root,
    list,
    create,
    remove,
    get,
    saveRun,
    saveSheet,
    deleteSheet,
    saveMap,
    readMap,
    deleteMap,
  };
}

module.exports = { createCampaignStore };
