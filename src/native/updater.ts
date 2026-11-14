import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  BrowserWindow,
  Notification,
  app,
  autoUpdater,
  ipcMain,
  shell,
} from "electron";

/**
 * Actualizador propio (estilo Discord) para la version instalada FUERA de la
 * Microsoft Store (instalador Squirrel). Descarga las versiones nuevas de
 * nuestro servidor, sin pasar por la certificacion de la Store.
 *
 * - La version de la Store (MSIX) NUNCA se autoactualiza: la Store no lo
 *   permite y Squirrel ni siquiera existe ahi. Se desactiva sola.
 * - Solo Windows con instalacion Squirrel (existe Update.exe junto a la app).
 * - Alimentacion: carpeta estatica con `RELEASES` + `*.nupkg` (la genera
 *   `npm run make`). Ver UPDATES.md.
 */
export const UPDATE_FEED_URL =
  process.env.STARKNET_UPDATE_URL ??
  "https://starknet-chat.tech/desktop-updates/win32/x64";

const CHECK_EVERY_MS = 15 * 60 * 1000; // 15 minutos (el fichero RELEASES pesa ~80 bytes)
const FIRST_CHECK_DELAY_MS = 10 * 1000; // no frenar el arranque
const MANUAL_CHECK_TIMEOUT_MS = 30 * 1000;

/** true si esta instalacion puede autoactualizarse */
export function canSelfUpdate() {
  if (process.platform !== "win32") return false;
  if (!app.isPackaged) return false;
  // MSIX / Microsoft Store
  if ((process as NodeJS.Process & { windowsStore?: boolean }).windowsStore)
    return false;
  // instalacion Squirrel: ...\StarknetChat\app-X.Y.Z\app.exe y ...\StarknetChat\Update.exe
  const updateExe = resolve(dirname(process.execPath), "..", "Update.exe");
  return existsSync(updateExe);
}

let started = false;
let downloaded = false;
let checking = false;
let downloading = false;

export type UpdateStatus =
  | "unsupported" // version de la Store u otra instalacion sin Squirrel
  | "up-to-date"
  | "downloading"
  | "ready"
  | "error";

/**
 * Busca actualizaciones ahora (boton "Buscar actualizaciones").
 * Devuelve en cuanto se sabe si hay algo; si hay version nueva sigue
 * descargando en segundo plano y avisa cuando esta lista.
 */
export function checkNow(): Promise<UpdateStatus> {
  if (!canSelfUpdate() || !started) return Promise.resolve("unsupported");
  if (downloaded) return Promise.resolve("ready");
  if (downloading || checking) return Promise.resolve("downloading");

  return new Promise<UpdateStatus>((resolve) => {
    checking = true;
    let done = false;
    const finish = (status: UpdateStatus) => {
      if (done) return;
      done = true;
      checking = false;
      clearTimeout(timer);
      autoUpdater.removeListener("update-not-available", onNone);
      autoUpdater.removeListener("update-available", onAvailable);
      autoUpdater.removeListener("update-downloaded", onReady);
      autoUpdater.removeListener("error", onError);
      resolve(status);
    };
    const onNone = () => finish("up-to-date");
    const onAvailable = () => {
      // no esperamos a que termine la descarga: seguira en segundo plano
      checking = false;
      finish("downloading");
    };
    const onReady = () => finish("ready");
    const onError = () => finish("error");
    const timer = setTimeout(() => finish("error"), MANUAL_CHECK_TIMEOUT_MS);

    autoUpdater.once("update-not-available", onNone);
    autoUpdater.once("update-available", onAvailable);
    autoUpdater.once("update-downloaded", onReady);
    autoUpdater.once("error", onError);
    try {
      autoUpdater.checkForUpdates();
    } catch {
      finish("error");
    }
  });
}

function registerIpc() {
  ipcMain.handle("checkForUpdates", () => checkNow());
  ipcMain.on("installUpdate", () => {
    if (downloaded) autoUpdater.quitAndInstall();
  });
}

export function initUpdater() {
  // los mensajes IPC existen siempre; en la version de la Store responden "unsupported"
  registerIpc();
  if (started || !canSelfUpdate()) return;
  started = true;

  try {
    autoUpdater.setFeedURL({ url: UPDATE_FEED_URL });
  } catch (err) {
    console.error("[updater] no se pudo configurar el feed:", err);
    return;
  }

  autoUpdater.on("error", (err) => {
    // sin red, servidor caido, etc: silencioso, se reintenta en 15 min
    downloading = false;
    console.warn("[updater] error:", err?.message ?? err);
  });

  autoUpdater.on("update-available", () => {
    downloading = true;
    console.log("[updater] descargando actualizacion...");
  });

  autoUpdater.on("update-downloaded", (_event, _notes, releaseName) => {
    if (downloaded) return;
    downloaded = true;
    downloading = false;
    console.log("[updater] lista:", releaseName);

    // Si no se pulsa, Squirrel la aplica igualmente en el siguiente arranque.
    const notification = new Notification({
      title: "Actualización lista",
      body: "Se instalará al reiniciar. Pulse aquí para reiniciar ahora.",
      silent: true,
    });
    notification.on("click", () => autoUpdater.quitAndInstall());
    notification.show();

    // avisar a la web (por si el usuario esta en Ajustes > Escritorio)
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("updateReady", releaseName ?? "");
    }
  });

  const check = () => {
    if (downloaded || downloading || checking) return;
    try {
      autoUpdater.checkForUpdates();
    } catch (err) {
      console.warn("[updater] checkForUpdates fallo:", err);
    }
  };

  setTimeout(check, FIRST_CHECK_DELAY_MS);
  setInterval(check, CHECK_EVERY_MS);
}

// ---------------------------------------------------------------------------
// Aviso de version nueva para la version de la Microsoft Store.
// La Store se actualiza sola, pero muchos usuarios no lo notan. Consultamos un
// fichero pequeno que publicamos nosotros cuando la Store ya tiene la version
// nueva, y avisamos con un boton que abre la ficha de la Store.
// ---------------------------------------------------------------------------
const STORE_LATEST_URL =
  process.env.STARKNET_STORE_LATEST_URL ??
  "https://starknet-chat.tech/desktop-updates/store-latest.json";
const STORE_PRODUCT_URL = "ms-windows-store://pdp/?productid=9NMQ1VS1JQKN";
const STORE_CHECK_EVERY_MS = 60 * 60 * 1000; // 1 hora

function isNewer(remote: string, local: string) {
  const a = remote.split(".").map((n) => parseInt(n, 10) || 0);
  const b = local.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return false;
}

export function isStoreBuild() {
  return (
    process.platform === "win32" &&
    !!(process as NodeJS.Process & { windowsStore?: boolean }).windowsStore
  );
}

let storeNotifiedFor: string | undefined;

export function initStoreNotifier() {
  if (!isStoreBuild()) return;

  const check = async () => {
    try {
      const res = await fetch(STORE_LATEST_URL, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { version?: unknown };
      const latest = typeof data.version === "string" ? data.version : "";
      if (!/^\d+(\.\d+){1,3}$/.test(latest)) return;
      if (!isNewer(latest, app.getVersion())) return;
      if (storeNotifiedFor === latest) return;
      storeNotifiedFor = latest;

      const notification = new Notification({
        title: "Hay una versión nueva",
        body: `StarkNetChat ${latest} está disponible en la Microsoft Store. Pulse aquí para abrirla.`,
        silent: true,
      });
      notification.on("click", () => void shell.openExternal(STORE_PRODUCT_URL));
      notification.show();
    } catch {
      // sin red o fichero ausente: silencioso
    }
  };

  setTimeout(check, FIRST_CHECK_DELAY_MS);
  setInterval(check, STORE_CHECK_EVERY_MS);
}
