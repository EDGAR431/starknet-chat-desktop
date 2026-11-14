import { contextBridge, ipcRenderer } from "electron";

import { version } from "../../package.json";

contextBridge.exposeInMainWorld("native", {
  versions: {
    node: () => process.versions.node,
    chrome: () => process.versions.chrome,
    electron: () => process.versions.electron,
    desktop: () => version,
  },

  minimise: () => ipcRenderer.send("minimise"),
  maximise: () => ipcRenderer.send("maximise"),
  close: () => ipcRenderer.send("close"),
  onMaximisedChange: (cb: (maximised: boolean) => void) => {
    ipcRenderer.removeAllListeners("maximised");
    ipcRenderer.on("maximised", (_, value) => cb(!!value));
  },
  setVoiceShortcuts: (map: {
    mute: string;
    deafen: string;
  }): Promise<{ mute: boolean; deafen: boolean }> =>
    ipcRenderer.invoke("setVoiceShortcuts", map),
  onVoiceShortcut: (cb: (action: "mute" | "deafen") => void) => {
    ipcRenderer.removeAllListeners("voiceShortcut");
    ipcRenderer.on("voiceShortcut", (_, action) => {
      if (action === "mute" || action === "deafen") cb(action);
    });
  },
  googleSignIn: (
    clientId: string,
  ): Promise<{ idToken?: string; error?: string }> =>
    ipcRenderer.invoke("googleSignIn", clientId),
  checkForUpdates: (): Promise<string> => ipcRenderer.invoke("checkForUpdates"),
  installUpdate: () => ipcRenderer.send("installUpdate"),
  onUpdateReady: (cb: () => void) => {
    ipcRenderer.removeAllListeners("updateReady");
    ipcRenderer.on("updateReady", () => cb());
  },
  dragStart: () => ipcRenderer.send("dragStart"),
  dragEnd: () => ipcRenderer.send("dragEnd"),
  relaunch: () => ipcRenderer.send("relaunch"),

  setBadgeCount: (count: number) => ipcRenderer.send("setBadgeCount", count),

  onceScreenPicker: (
    onScreenPick: (
      sources: {
        idx: number;
        name: string;
        isFullScreen: boolean;
        image?: string;
      }[],
    ) => void,
  ) => {
    const eventName = "screenPicker";
    ipcRenderer.removeAllListeners(eventName);
    ipcRenderer.once(eventName, (_, sources) => onScreenPick(sources));
  },
  screenPickerCallback: (idx: number, audio: boolean) =>
    ipcRenderer.send("screenPickerCallback", idx, audio),

  isWayland: () => ipcRenderer.invoke("getIsWayland"),
  loopbackExcludesApp: (): Promise<boolean> =>
    ipcRenderer.invoke("getLoopbackExcludesApp"),
});
