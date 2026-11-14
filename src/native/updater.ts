import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { Notification, app, autoUpdater } from "electron";

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

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000; // 4 horas
const FIRST_CHECK_DELAY_MS = 30 * 1000; // no frenar el arranque

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

export function initUpdater() {
  if (started || !canSelfUpdate()) return;
  started = true;

  try {
    autoUpdater.setFeedURL({ url: UPDATE_FEED_URL });
  } catch (err) {
    console.error("[updater] no se pudo configurar el feed:", err);
    return;
  }

  autoUpdater.on("error", (err) => {
    // sin red, servidor caido, etc: silencioso, se reintenta en 4 h
    console.warn("[updater] error:", err?.message ?? err);
  });

  autoUpdater.on("update-available", () => {
    console.log("[updater] descargando actualizacion...");
  });

  autoUpdater.on("update-downloaded", (_event, _notes, releaseName) => {
    if (downloaded) return;
    downloaded = true;
    console.log("[updater] lista:", releaseName);

    // Si no se pulsa, Squirrel la aplica igualmente en el siguiente arranque.
    const notification = new Notification({
      title: "Actualización lista",
      body: "Se instalará al reiniciar. Pulse aquí para reiniciar ahora.",
      silent: true,
    });
    notification.on("click", () => autoUpdater.quitAndInstall());
    notification.show();
  });

  const check = () => {
    if (downloaded) return;
    try {
      autoUpdater.checkForUpdates();
    } catch (err) {
      console.warn("[updater] checkForUpdates fallo:", err);
    }
  };

  setTimeout(check, FIRST_CHECK_DELAY_MS);
  setInterval(check, CHECK_EVERY_MS);
}
