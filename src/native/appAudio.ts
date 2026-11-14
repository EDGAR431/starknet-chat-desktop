import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";

import { BrowserWindow, app, ipcMain } from "electron";

/**
 * Audio por aplicación para compartir pantalla (solo Windows).
 *
 * Al compartir una VENTANA con audio, en vez de capturar todo el sonido del
 * sistema (que incluye las voces de la llamada, el eco...), se lanza el
 * ayudante nativo `proc-audio.exe`, que usa la API "process loopback" de
 * WASAPI para capturar únicamente el audio de ese proceso, como Discord.
 * El PCM (s16le, 48 kHz, estéreo) viaja por IPC hasta la web, que lo publica
 * como pista de audio de la retransmisión.
 */

const MIN_WINDOWS_BUILD = 19041; // Windows 10 2004: primera con process loopback

let helper: ChildProcess | undefined;
let leftover = Buffer.alloc(0);

function helperPath(): string | undefined {
  const candidates = [
    join(process.resourcesPath ?? "", "proc-audio.exe"),
    join(app.getAppPath(), "native", "proc-audio", "proc-audio.exe"),
    join(process.cwd(), "native", "proc-audio", "proc-audio.exe"),
  ];
  return candidates.find((p) => existsSync(p));
}

function log(msg: string) {
  try {
    appendFileSync(
      join(app.getPath("userData"), "app-audio.log"),
      `${new Date().toISOString()} ${msg}\n`,
    );
  } catch {
    /* ignorar */
  }
}

export function appAudioAvailable(): boolean {
  return (
    process.platform === "win32" &&
    parseInt(release().split(".")[2] ?? "0", 10) >= MIN_WINDOWS_BUILD &&
    !!helperPath()
  );
}

export function stopAppAudio() {
  if (helper) {
    log("stop");
    try {
      helper.stdin?.end();
      helper.kill();
    } catch {
      /* ignorar */
    }
    helper = undefined;
  }
  leftover = Buffer.alloc(0);
}

/**
 * Arranca la captura del audio de la ventana indicada.
 * @param sourceId id de desktopCapturer, p. ej. "window:132456:0"
 * @returns true si se ha lanzado el ayudante
 */
export function startAppAudio(sourceId: string, win: BrowserWindow): boolean {
  stopAppAudio();
  const exe = helperPath();
  const m = /^window:(\d+):/.exec(sourceId);
  if (!exe || !m || !appAudioAvailable()) return false;

  log(`start ${sourceId} (${exe})`);
  const child = spawn(exe, ["--hwnd", m[1]], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  helper = child;
  const startedAt = Date.now();

  child.stderr?.on("data", (d) => log(`helper: ${String(d).trim()}`));
  child.stdout?.on("data", (data: Buffer) => {
    if (win.isDestroyed()) return;
    // Mantener alineado a tramas de 4 bytes (2 canales x s16)
    let buf = leftover.length ? Buffer.concat([leftover, data]) : data;
    const usable = buf.length - (buf.length % 4);
    leftover = Buffer.from(buf.subarray(usable));
    buf = buf.subarray(0, usable);
    if (usable > 0) win.webContents.send("appAudioChunk", Uint8Array.from(buf));
  });
  child.on("error", (e) => {
    log(`error: ${String(e)}`);
    if (!win.isDestroyed()) win.webContents.send("appAudioEnded", "error");
  });
  child.on("exit", (code) => {
    log(`exit code=${code} tras ${Date.now() - startedAt} ms`);
    if (helper === child) helper = undefined;
    if (!win.isDestroyed()) {
      win.webContents.send(
        "appAudioEnded",
        Date.now() - startedAt < 2000 ? "failed" : "ended",
      );
    }
  });

  win.webContents.send("appAudioStart", { sampleRate: 48000, channels: 2 });
  return true;
}

export function initAppAudio() {
  ipcMain.on("stopAppAudio", () => stopAppAudio());
  app.on("before-quit", () => stopAppAudio());
}
