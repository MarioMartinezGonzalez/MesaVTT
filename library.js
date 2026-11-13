'use strict';

/*
 * Biblioteca de mapas: carpetas e imágenes guardadas en disco.
 * Se mantiene independiente de Electron para poder probarla con Node.
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

function sanitizeName(name, fallback) {
  const cleaned = String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
  return cleaned || fallback;
}

function formatOf(map) {
  const extension = path.extname(map.storedName || map.name || '').slice(1).toLowerCase();
  return extension === 'jpeg' ? 'jpg' : extension;
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
  return { extension, buffer };
}

function parseThumbDataUrl(dataUrl) {
  try {
    const image = parseImageDataUrl(dataUrl);
    return image.extension === 'jpg' ? image.buffer : null;
  } catch (error) {
    return null;
  }
}

function createLibrary({ root, thumbnailer } = {}) {
  if (!root) throw new Error('La biblioteca necesita una carpeta raíz');

  const indexFile = path.join(root, 'index.json');
  const filesDir = path.join(root, 'files');
  const thumbsDir = path.join(root, 'thumbs');

  let queue = Promise.resolve();

  // Serializa las escrituras para que dos importaciones no pisen el índice.
  function serial(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  async function ensureDirs() {
    await fs.mkdir(filesDir, { recursive: true });
    await fs.mkdir(thumbsDir, { recursive: true });
  }

  async function readIndex() {
    await ensureDirs();
    try {
      const raw = await fs.readFile(indexFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.folders)) {
        throw new Error('El índice de la biblioteca no es válido');
      }
      return parsed;
    } catch (error) {
      if (error.code === 'ENOENT') {
        const empty = { version: 1, folders: [] };
        await writeIndex(empty);
        return empty;
      }
      throw error;
    }
  }

  async function writeIndex(data) {
    await ensureDirs();
    const tempFile = `${indexFile}.${process.pid}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tempFile, indexFile);
  }

  async function removeMapFiles(maps) {
    for (const map of maps) {
      try {
        await fs.unlink(path.join(filesDir, map.storedName));
      } catch (error) {
        /* el archivo ya no existe */
      }
      try {
        await fs.unlink(path.join(thumbsDir, `${map.id}.jpg`));
      } catch (error) {
        /* sin miniatura */
      }
    }
  }

  async function thumbFor(map) {
    try {
      const buffer = await fs.readFile(path.join(thumbsDir, `${map.id}.jpg`));
      return `data:image/jpeg;base64,${buffer.toString('base64')}`;
    } catch (error) {
      return null;
    }
  }

  async function publicFolder(folder) {
    const maps = [];
    for (const map of folder.maps || []) {
      maps.push({
        id: map.id,
        name: map.name,
        width: map.width || 0,
        height: map.height || 0,
        format: formatOf(map),
        thumb: await thumbFor(map),
      });
    }
    return { id: folder.id, name: folder.name, parentId: folder.parentId || null, maps };
  }

  async function list() {
    const data = await readIndex();
    const folders = [];
    for (const folder of data.folders) {
      folders.push(await publicFolder(folder));
    }
    return { folders };
  }

  function createFolder(name, parentId = null) {
    return serial(async () => {
      const data = await readIndex();
      const parent = parentId ? data.folders.find((item) => item.id === parentId) : null;
      if (parentId && !parent) throw new Error('Carpeta padre no encontrada');

      const folder = {
        id: crypto.randomUUID(),
        name: sanitizeName(name, `Carpeta ${data.folders.length + 1}`),
        parentId: parent ? parent.id : null,
        createdAt: new Date().toISOString(),
        maps: [],
      };
      data.folders.push(folder);
      await writeIndex(data);
      return publicFolder(folder);
    });
  }

  function renameFolder(id, name) {
    return serial(async () => {
      const data = await readIndex();
      const folder = data.folders.find((item) => item.id === id);
      if (!folder) throw new Error('Carpeta no encontrada');
      folder.name = sanitizeName(name, folder.name);
      await writeIndex(data);
      return publicFolder(folder);
    });
  }

  function deleteFolder(id) {
    return serial(async () => {
      const data = await readIndex();
      if (!data.folders.some((item) => item.id === id)) throw new Error('Carpeta no encontrada');

      // Al borrar una carpeta se borran también todas sus subcarpetas.
      const ids = new Set([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const folder of data.folders) {
          if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
            ids.add(folder.id);
            grew = true;
          }
        }
      }

      const removed = data.folders.filter((folder) => ids.has(folder.id));
      data.folders = data.folders.filter((folder) => !ids.has(folder.id));
      await writeIndex(data);
      for (const folder of removed) await removeMapFiles(folder.maps || []);
      return { ok: true, removed: removed.length };
    });
  }

  async function addFileToFolder(folder, filePath, errors) {
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) return false;

      const extension = path.extname(filePath).slice(1).toLowerCase();
      if (!IMAGE_EXTENSIONS.includes(extension)) {
        errors.push(path.basename(filePath));
        return false;
      }

      const id = crypto.randomUUID();
      const storedName = `${id}.${extension}`;
      await fs.copyFile(filePath, path.join(filesDir, storedName));

      let width = 0;
      let height = 0;
      let jpeg = null;

      if (typeof thumbnailer === 'function') {
        try {
          const thumbnail = await thumbnailer(filePath);
          if (thumbnail) {
            width = Number(thumbnail.width) || 0;
            height = Number(thumbnail.height) || 0;
            jpeg = thumbnail.jpeg || null;
          }
        } catch (error) {
          console.warn(`Sin miniatura para ${filePath}:`, error.message);
        }
      }

      if (jpeg && jpeg.length) {
        await fs.writeFile(path.join(thumbsDir, `${id}.jpg`), jpeg);
      }

      folder.maps.push({
        id,
        name: path.basename(filePath).slice(0, 120),
        storedName,
        width,
        height,
        addedAt: new Date().toISOString(),
      });
      return true;
    } catch (error) {
      console.error(`No se pudo importar ${filePath}:`, error);
      errors.push(path.basename(filePath));
      return false;
    }
  }

  function importFiles(folderId, filePaths) {
    return serial(async () => {
      const data = await readIndex();
      const folder = data.folders.find((item) => item.id === folderId);
      if (!folder) throw new Error('Carpeta no encontrada');

      const errors = [];
      let added = 0;

      for (const filePath of filePaths) {
        if (await addFileToFolder(folder, filePath, errors)) added += 1;
      }

      await writeIndex(data);
      const result = await list();
      return { added, errors, folders: result.folders };
    });
  }

  // Importa una carpeta del disco creando una carpeta de la biblioteca por
  // cada subcarpeta, de modo que se conserva la estructura original.
  function importTree(parentFolderId, rootPath) {
    return serial(async () => {
      const data = await readIndex();
      const root = data.folders.find((item) => item.id === parentFolderId);
      if (!root) throw new Error('Carpeta no encontrada');

      const stats = await fs.stat(rootPath);
      if (!stats.isDirectory()) throw new Error('La ruta no es una carpeta');

      const errors = [];
      let added = 0;
      let foldersCreated = 0;

      function createChild(parent, name) {
        const folder = {
          id: crypto.randomUUID(),
          name: sanitizeName(name, `Carpeta ${data.folders.length + 1}`),
          parentId: parent.id,
          createdAt: new Date().toISOString(),
          maps: [],
        };
        data.folders.push(folder);
        foldersCreated += 1;
        return folder;
      }

      async function walk(dirPath, folder, depth) {
        if (depth > 24) return;

        let entries;
        try {
          entries = await fs.readdir(dirPath, { withFileTypes: true });
        } catch (error) {
          errors.push(path.basename(dirPath));
          return;
        }

        entries.sort((a, b) => a.name.localeCompare(b.name, 'es'));
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const fullPath = path.join(dirPath, entry.name);

          if (entry.isFile()) {
            const extension = path.extname(entry.name).slice(1).toLowerCase();
            if (!IMAGE_EXTENSIONS.includes(extension)) continue;
            if (await addFileToFolder(folder, fullPath, errors)) added += 1;
          } else if (entry.isDirectory()) {
            await walk(fullPath, createChild(folder, entry.name), depth + 1);
          }
        }
      }

      await walk(rootPath, root, 0);
      await writeIndex(data);
      const result = await list();
      return {
        added,
        foldersCreated,
        errors,
        rootFolderId: root.id,
        folders: result.folders,
      };
    });
  }

  function addMap(folderId, payload) {
    return serial(async () => {
      const data = await readIndex();
      const folder = data.folders.find((item) => item.id === folderId);
      if (!folder) throw new Error('Carpeta no encontrada');

      const source = payload && typeof payload === 'object' ? payload : {};
      const image = parseImageDataUrl(source.dataUrl);
      const id = crypto.randomUUID();
      const storedName = `${id}.${image.extension}`;
      await fs.writeFile(path.join(filesDir, storedName), image.buffer);

      const thumbnail = parseThumbDataUrl(source.thumbDataUrl);
      if (thumbnail && thumbnail.length) {
        await fs.writeFile(path.join(thumbsDir, `${id}.jpg`), thumbnail);
      }

      folder.maps.push({
        id,
        name: sanitizeName(source.name, 'Mapa cargado').slice(0, 120),
        storedName,
        width: Number(source.width) || 0,
        height: Number(source.height) || 0,
        addedAt: new Date().toISOString(),
      });

      await writeIndex(data);
      return publicFolder(folder);
    });
  }

  function moveMap(fromFolderId, mapId, toFolderId) {
    return serial(async () => {
      const data = await readIndex();
      const from = data.folders.find((item) => item.id === fromFolderId);
      const to = data.folders.find((item) => item.id === toFolderId);
      if (!from || !to) throw new Error('Carpeta no encontrada');
      if (from.id === to.id) return publicFolder(to);

      const index = from.maps.findIndex((item) => item.id === mapId);
      if (index === -1) throw new Error('Mapa no encontrado');

      const [map] = from.maps.splice(index, 1);
      to.maps.push(map);
      await writeIndex(data);
      return publicFolder(to);
    });
  }

  function deleteMap(folderId, mapId) {
    return serial(async () => {
      const data = await readIndex();
      const folder = data.folders.find((item) => item.id === folderId);
      if (!folder) throw new Error('Carpeta no encontrada');

      const mapIndex = folder.maps.findIndex((item) => item.id === mapId);
      if (mapIndex === -1) throw new Error('Mapa no encontrado');

      const [map] = folder.maps.splice(mapIndex, 1);
      await writeIndex(data);
      await removeMapFiles([map]);
      return { ok: true };
    });
  }

  function setThumbnail(folderId, mapId, payload) {
    return serial(async () => {
      const data = await readIndex();
      const folder = data.folders.find((item) => item.id === folderId);
      if (!folder) throw new Error('Carpeta no encontrada');

      const map = folder.maps.find((item) => item.id === mapId);
      if (!map) throw new Error('Mapa no encontrado');

      const source = payload && typeof payload === 'object' ? payload : {};
      const thumbnail = parseThumbDataUrl(source.dataUrl);
      if (!thumbnail || !thumbnail.length) throw new Error('Miniatura no válida');

      await fs.writeFile(path.join(thumbsDir, `${map.id}.jpg`), thumbnail);
      map.width = Number(source.width) || map.width || 0;
      map.height = Number(source.height) || map.height || 0;
      await writeIndex(data);
      return publicFolder(folder);
    });
  }

  async function readMap(folderId, mapId) {
    const data = await readIndex();
    const folder = data.folders.find((item) => item.id === folderId);
    if (!folder) throw new Error('Carpeta no encontrada');

    const map = folder.maps.find((item) => item.id === mapId);
    if (!map) throw new Error('Mapa no encontrado');

    const filePath = path.join(filesDir, map.storedName);
    const buffer = await fs.readFile(filePath);
    const extension = path.extname(map.storedName).slice(1).toLowerCase();
    const mime = IMAGE_MIME[extension] || `image/${extension}`;

    return {
      name: map.name,
      width: map.width || 0,
      height: map.height || 0,
      dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
    };
  }

  return {
    root,
    list,
    createFolder,
    renameFolder,
    deleteFolder,
    importFiles,
    importTree,
    setThumbnail,
    addMap,
    moveMap,
    deleteMap,
    readMap,
  };
}

module.exports = { createLibrary, IMAGE_EXTENSIONS };
