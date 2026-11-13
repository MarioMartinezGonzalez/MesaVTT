'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openImage: (kind) => ipcRenderer.invoke('dialog:openImage', kind),
  saveScene: (json) => ipcRenderer.invoke('scene:save', json),
  loadScene: () => ipcRenderer.invoke('scene:load'),
  player: {
    open: () => ipcRenderer.invoke('player:open'),
    close: () => ipcRenderer.invoke('player:close'),
    getStatus: () => ipcRenderer.invoke('player:getStatus'),
    setMap: (map) => ipcRenderer.send('player:setMap', map),
    setGrid: (grid) => ipcRenderer.send('player:setGrid', grid),
    setTokens: (tokens) => ipcRenderer.send('player:setTokens', tokens),
    updateTokens: (tokens) => ipcRenderer.send('player:updateTokens', tokens),
    setMeasure: (measure) => ipcRenderer.send('player:setMeasure', measure),
    setDisplay: (display) => ipcRenderer.send('player:setDisplay', display),
    setCombat: (combat) => ipcRenderer.send('player:setCombat', combat),
    onStatus: (callback) => {
      ipcRenderer.on('player:status', (_event, status) => callback(status));
    },
  },
  campaign: {
    list: () => ipcRenderer.invoke('campaign:list'),
    get: (id) => ipcRenderer.invoke('campaign:get', id),
    create: (name) => ipcRenderer.invoke('campaign:create', name),
    remove: (id) => ipcRenderer.invoke('campaign:remove', id),
    saveRun: (id, run) => ipcRenderer.invoke('campaign:saveRun', id, run),
    saveSheet: (id, kind, token) => ipcRenderer.invoke('campaign:saveSheet', id, kind, token),
    deleteSheet: (id, kind, sheetId) =>
      ipcRenderer.invoke('campaign:deleteSheet', id, kind, sheetId),
    saveMap: (id, payload) => ipcRenderer.invoke('campaign:saveMap', id, payload),
    readMap: (id, mapId) => ipcRenderer.invoke('campaign:readMap', id, mapId),
    deleteMap: (id, mapId) => ipcRenderer.invoke('campaign:deleteMap', id, mapId),
  },
  library: {
    list: () => ipcRenderer.invoke('library:list'),
    createFolder: (name) => ipcRenderer.invoke('library:createFolder', name),
    renameFolder: (id, name) => ipcRenderer.invoke('library:renameFolder', id, name),
    deleteFolder: (id) => ipcRenderer.invoke('library:deleteFolder', id),
    importMaps: (folderId) => ipcRenderer.invoke('library:importMaps', folderId),
    importFolder: () => ipcRenderer.invoke('library:importFolder'),
    setThumbnail: (folderId, mapId, payload) =>
      ipcRenderer.invoke('library:setThumbnail', folderId, mapId, payload),
    deleteMap: (folderId, mapId) => ipcRenderer.invoke('library:deleteMap', folderId, mapId),
    loadMap: (folderId, mapId) => ipcRenderer.invoke('library:loadMap', folderId, mapId),
    addMap: (folderId, payload) => ipcRenderer.invoke('library:addMap', folderId, payload),
    moveMap: (fromFolderId, mapId, toFolderId) =>
      ipcRenderer.invoke('library:moveMap', fromFolderId, mapId, toFolderId),
  },
});
