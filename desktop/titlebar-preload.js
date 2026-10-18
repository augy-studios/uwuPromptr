// window.bar: the title bar's own page talking to main.js. Nothing else gets it.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bar", {
  platform: process.platform,
  act: (action) => ipcRenderer.send("bar-action", String(action)),
  onState: (fn) => {
    ipcRenderer.on("bar-state", (_event, state) => fn(state));
  },
});
