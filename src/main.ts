import fs from "node:fs";
import path from "node:path";
import { IUpdateInfo, updateElectronApp } from "update-electron-app";

import { BrowserWindow, Notification, app, session, shell } from "electron";
import started from "electron-squirrel-startup";

import { initAutoLaunch } from "./native/autoLaunch";
import { config } from "./native/config";
import { initDiscordRpc } from "./native/discordRpc";
import { initShortcuts } from "./native/shortcuts";
import { initTray } from "./native/tray";
import { initStoreNotifier, initUpdater } from "./native/updater";
import { initVirtualMic } from "./native/virtualMic";
import { BUILD_URL, createMainWindow, mainWindow } from "./native/window";

/** Ventanas emergentes de inicio de sesion con Google abiertas por la app. */
const googlePopups = new Set<number>();
let googleUaHooked = false;

function isGoogleHost(host: string): boolean {
  return (
    host === "accounts.google.com" ||
    host === "accounts.youtube.com" ||
    host === "www.google.com" ||
    host.endsWith(".gstatic.com")
  );
}

function isGoogleLoginUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "accounts.google.com";
  } catch {
    return false;
  }
}

// In Flatpak, we have to update the temp dir to a shared directory across host and sandbox;
// otherwise, the icon will not show up in the tray when using app indicators.
if (process.platform === "linux" && process.env.FLATPAK_ID) {
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  if (runtimeDir) {
    try {
      const sharedTmpDir = path.join(runtimeDir, "app", process.env.FLATPAK_ID);
      fs.mkdirSync(sharedTmpDir, { recursive: true });
      process.env.TMPDIR = sharedTmpDir;
    } catch (error) {
      console.error("Failed to set up host-visible TMPDIR:", error);
    }
  }
}

// Squirrel-specific logic
// create/remove shortcuts on Windows when installing / uninstalling
// we just need to close out of the app immediately
if (started) {
  app.quit();
}

// disable hw-accel if so requested
if (!config.hardwareAcceleration) {
  app.disableHardwareAcceleration();
}

// ensure only one copy of the application can run
const acquiredLock = app.requestSingleInstanceLock();

const onNotifyUser = (_info: IUpdateInfo) => {
  const notification = new Notification({
    title: "Update Available",
    body: "Restart the app to install the update.",
    silent: true,
  });

  notification.show();
};

if (acquiredLock) {
  // Nota: comprobación de actualizaciones vía GitHub Releases desactivada.
  // No la necesitamos para distribución privada, y evita que el arranque
  // dependa de que el repositorio del fork tenga releases publicadas.
  // updateElectronApp({ onNotifyUser });

  // create and configure the app when electron is ready
  app.on("ready", () => {
    // create window and application contexts
    createMainWindow();

    // save first launch state
    if (config.firstLaunch) {
      // Doesn't do anything right now. Used to enable auto start, but that behaviour was removed.
      // Left in case it gets used in the future.
      config.firstLaunch = false;
    }

    initTray();
    initDiscordRpc();
    initVirtualMic();
    initAutoLaunch();
    initUpdater();
    initShortcuts();
    initStoreNotifier();

    // Windows specific fix for notifications
    if (process.platform === "win32") {
      app.setAppUserModelId("tech.starknetchat.notifications");
    }
  });

  // focus the window if we try to launch again
  app.on("second-instance", () => {
    mainWindow.show();
    mainWindow.restore();
    mainWindow.focus();
  });

  // macOS specific behaviour to keep app active in dock:
  // (irrespective of the minimise-to-tray option)

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // ensure URLs launch in external context
  app.on("web-contents-created", (_, contents) => {
    // prevent navigation out of build URL origin
    contents.on("will-navigate", (event, navigationUrl) => {
      let origin: string | undefined;
      let host = "";
      try {
        const parsed = new URL(navigationUrl);
        origin = parsed.origin;
        host = parsed.protocol === "https:" ? parsed.hostname : "";
      } catch {
        /* URL malformada: se bloquea */
      }
      // La ventana de inicio de sesion con Google debe poder moverse por
      // las paginas de Google (y solo por ellas).
      if (googlePopups.has(contents.id) && isGoogleHost(host)) {
        return;
      }
      if (origin !== BUILD_URL.origin) {
        event.preventDefault();
      }
    });

    // handle links externally
    contents.setWindowOpenHandler(({ url }) => {
      // "Iniciar sesion con Google" abre una ventana emergente que devuelve
      // el resultado a la ventana que la abrio. Si se abre en el navegador
      // externo pierde esa conexion y se queda en blanco, asi que se abre
      // dentro de la app y solo para accounts.google.com.
      if (isGoogleLoginUrl(url)) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            width: 500,
            height: 680,
            autoHideMenuBar: true,
            title: "Google",
            webPreferences: {
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
            },
          },
        };
      }
      if (
        url.startsWith("http:") ||
        url.startsWith("https:") ||
        url.startsWith("mailto:")
      ) {
        setImmediate(() => {
          shell.openExternal(url);
        });
      }

      return { action: "deny" };
    });

    if (!googleUaHooked) {
      googleUaHooked = true;
      // Las peticiones a Google van con un agente de usuario de Chrome
      // normal (sin "Electron" ni "StarknetChat"), desde la primera.
      session.defaultSession.webRequest.onBeforeSendHeaders(
        { urls: ["https://accounts.google.com/*", "https://accounts.youtube.com/*"] },
        (details, callback) => {
          const headers = { ...details.requestHeaders };
          const ua = headers["User-Agent"];
          if (typeof ua === "string") {
            headers["User-Agent"] = ua.replace(/\s(Electron|StarknetChat)\/\S+/g, "");
          }
          callback({ requestHeaders: headers });
        },
      );
    }

    contents.on("did-create-window", (popup, details) => {
      if (!isGoogleLoginUrl(details.url)) return;
      const id = popup.webContents.id;
      googlePopups.add(id);
      popup.on("closed", () => googlePopups.delete(id));
      // Google rechaza el inicio de sesion si el agente de usuario delata
      // que es una app embebida: se presenta como un Chrome normal.
      popup.webContents.setUserAgent(
        popup.webContents.getUserAgent().replace(/\s(Electron|StarknetChat)\/\S+/g, ""),
      );
    });
  });
} else {
  app.quit();
}
