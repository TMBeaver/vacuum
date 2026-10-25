const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "vacuum",
  Object.freeze({
    get: () => ipcRenderer.invoke("vacuum:get"),
    start: () => ipcRenderer.invoke("vacuum:start"),
    stop: () => ipcRenderer.invoke("vacuum:stop"),
    settings: (p) => ipcRenderer.invoke("vacuum:settings", p),
    empty: (ids) => ipcRenderer.invoke("vacuum:empty", ids),
    release: (ids) => ipcRenderer.invoke("vacuum:release", ids),
    old: () => ipcRenderer.invoke("vacuum:old"),
    collect: (ids) => ipcRenderer.invoke("vacuum:collect", ids),
    security: () => ipcRenderer.invoke("vacuum:security"),
    storage: () => ipcRenderer.invoke("vacuum:storage"),
    recycleBin: () => ipcRenderer.invoke("vacuum:recycle-bin"),
    compact: (ids, compress = true) =>
      ipcRenderer.invoke("vacuum:compact", ids, compress),
    recoverCompression: () => ipcRenderer.invoke("vacuum:recover-compression"),
    performance: () => ipcRenderer.invoke("vacuum:performance"),
    performanceAction: (id, mode) =>
      ipcRenderer.invoke("vacuum:performance-action", id, mode),
    window: (action) => ipcRenderer.invoke("vacuum:window", action),
    subscribe: (callback) => {
      const fn = (_e, s) => callback(s);
      ipcRenderer.on("vacuum:state", fn);
      ipcRenderer.on("vacuum:progress", fn);
      return () => {
        ipcRenderer.removeListener("vacuum:state", fn);
        ipcRenderer.removeListener("vacuum:progress", fn);
      };
    },
    onDock: (callback) => {
      ipcRenderer.on("vacuum:dock", callback);
      return () => ipcRenderer.removeListener("vacuum:dock", callback);
    },
  }),
);
