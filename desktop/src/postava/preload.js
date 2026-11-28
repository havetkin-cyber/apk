const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('postava', {
  info: () => ipcRenderer.invoke('postava-info'),
  model: (id) => ipcRenderer.invoke('postava-model', id),
  vlastna: () => ipcRenderer.invoke('postava-vlastna'),
  mozog: () => ipcRenderer.invoke('postava-mozog'),
  chat: (t) => ipcRenderer.invoke('postava-chat', t),
  kurzor: () => ipcRenderer.invoke('postava-kurzor'),
  mys: (nad) => ipcRenderer.send('postava-mys', nad),
  tah: (d) => ipcRenderer.send('postava-tah', d),
  pohladkaj: () => ipcRenderer.send('postava-pohladkaj'),
  skry: () => ipcRenderer.send('postava-skry'),
  hovor: (t, e) => ipcRenderer.invoke('postava-hovor', t, e),
  hlasPrepni: () => ipcRenderer.invoke('postava-hlas-prepni'),
  tanec: (t) => ipcRenderer.send('postava-tanec', t),
  tanecPrepni: () => ipcRenderer.invoke('postava-tanec-prepni'),
  tance: () => ipcRenderer.invoke('postava-tance'),
  tanecPridaj: () => ipcRenderer.invoke('postava-tanec-pridaj'),
  tancePriecinok: () => ipcRenderer.send('postava-tance-priecinok'),
  on: (k, cb) => {
    if (['postava-povedz', 'postava-stav', 'postava-smer', 'postava-akcia', 'postava-priebeh'].includes(k)) ipcRenderer.on(k, (_e, d) => cb(d));
  },
});
