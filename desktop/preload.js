// window.cueDesktop: what the site's page can ask of the desktop app.
//
// The page gates every feature on the method it needs being here, never on
// cueDesktop alone, so an older installed app under a newer site just shows
// less. Every message is checked again in main.js, which answers only the
// site's own page.

const { contextBridge, ipcRenderer } = require("electron");

function argument(name) {
  const prefix = `--cue-${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

/** Subscribe to an event from main. Returns a function that unsubscribes. */
function listen(channel, fn) {
  if (typeof fn !== "function") return () => {};
  const handler = (_event, value) => fn(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("cueDesktop", {
  version: argument("version"),
  platform: process.platform,

  /** The display stays on while `on`, and while the window can be seen. */
  keepAwake: (on) => ipcRenderer.send("keep-awake", Boolean(on)),

  /** F8, F9 and F10 from any app. Listening is what registers them. */
  hotkeys: {
    get: () => ipcRenderer.invoke("hotkeys-get"),
    set: (on) => ipcRenderer.invoke("hotkeys-set", Boolean(on)),
    onPress: (fn) => {
      const stop = listen("hotkey", fn);
      ipcRenderer.send("hotkeys-listen", true);
      return () => {
        stop();
        ipcRenderer.send("hotkeys-listen", false);
      };
    },
  },

  /** The window above every other, also switched from the tray. */
  onTop: {
    get: () => ipcRenderer.invoke("on-top-get"),
    set: (on) => ipcRenderer.invoke("on-top-set", Boolean(on)),
    onChange: (fn) => listen("on-top", fn),
  },

  /** Looks for a new version of the app, and says what it found. */
  checkForUpdates: () => ipcRenderer.send("check-updates"),

  /** Notifications about new versions of the app, unasked. */
  releases: {
    get: () => ipcRenderer.invoke("releases-get"),
    set: (on) => ipcRenderer.invoke("releases-set", Boolean(on)),
  },
});
