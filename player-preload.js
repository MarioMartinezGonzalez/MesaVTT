'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  ipcRenderer.on(channel, (_event, payload) => callback(payload));
}

contextBridge.exposeInMainWorld('playerApi', {
  ready: () => ipcRenderer.send('player:ready'),
  getStatus: () => ipcRenderer.invoke('player:getStatus'),
  toggleFullscreen: () => ipcRenderer.invoke('player:toggleFullscreen'),
  onMap: (callback) => subscribe('player:map', callback),
  onGrid: (callback) => subscribe('player:grid', callback),
  onTokens: (callback) => subscribe('player:tokens', callback),
  onUpdateTokens: (callback) => subscribe('player:updateTokens', callback),
  onMeasure: (callback) => subscribe('player:measure', callback),
  onDisplay: (callback) => subscribe('player:display', callback),
  onCombat: (callback) => subscribe('player:combat', callback),
  onFullscreen: (callback) => subscribe('player:fullscreen', callback),
});
