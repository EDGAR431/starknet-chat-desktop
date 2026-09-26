import { contextBridge, ipcRenderer } from "electron";

// valor por defecto seguro mientras llega el IPC "config" desde el proceso
// principal (evita que el cliente web reciba `undefined` si consulta la
// config antes de que el evento haya llegado — race condition observado
// contra instancias autoalojadas con carga más rápida que la oficial)
let config: DesktopConfig = {
  firstLaunch: true,
  customFrame: true,
  minimiseToTray: true,
  startMinimisedToTray: false,
  spellchecker: true,
  hardwareAcceleration: true,
  discordRpc: true,
  windowState: {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    isMaximised: false,
  },
};

ipcRenderer.on("config", (_, data) => (config = data));

contextBridge.exposeInMainWorld("desktopConfig", {
  get: () => config,
  set: (config: DesktopConfig) => ipcRenderer.send("config", config),
  getAutostart() {
    return ipcRenderer.invoke("getAutostart") as Promise<boolean>;
  },
  setAutostart(value: boolean) {
    return ipcRenderer.invoke("setAutostart", value) as Promise<boolean>;
  },
});
