const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('alexia', {
  getState: () => ipcRenderer.invoke('get-state'),
  ytdlpVersion: () => ipcRenderer.invoke('ytdlp-version'),
  ytdlpUpdate: () => ipcRenderer.invoke('ytdlp-update'),
  pickFile: () => ipcRenderer.invoke('pick-file'),
  download: (url) => ipcRenderer.invoke('download', url),
  select: (p) => ipcRenderer.invoke('select', p),
  remove: (p) => ipcRenderer.invoke('delete', p),
  setOption: (k, v) => ipcRenderer.invoke('set-option', k, v),
  setPaused: (v) => ipcRenderer.invoke('set-paused', v),
  removeLink: (l) => ipcRenderer.invoke('remove-link', l),
  commons: (q, offset) => ipcRenderer.invoke('commons', q, offset),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  on: (channel, cb) => {
    if (['media', 'progress', 'state-changed', 'toast'].includes(channel)) {
      ipcRenderer.on(channel, (_e, data) => cb(data));
    }
  },
});
