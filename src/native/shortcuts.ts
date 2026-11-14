import { BrowserWindow, app, globalShortcut, ipcMain } from "electron";

/**
 * Atajos globales de voz (silenciarse / ensordecerse) que funcionan aunque la
 * aplicacion este en segundo plano. La web decide cuando registrarlos (solo
 * mientras hay una llamada activa) y nos manda las combinaciones.
 *
 * Nota: un atajo global es exclusivo mientras esta registrado: el resto de
 * aplicaciones no recibe esa combinacion. Por eso solo se registra en llamada.
 */

type Action = "mute" | "deafen";

// Control|Alt|Shift|Super + tecla (letra, digito, F1-F24 o teclas de navegacion)
const VALID =
  /^(?:(?:Control|Alt|Shift|Super)\+){0,4}(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Up|Down|Left|Right|Space|Return|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown)$/;

let registered: string[] = [];

function unregisterAll() {
  for (const accelerator of registered) {
    try {
      globalShortcut.unregister(accelerator);
    } catch {
      // ignorar
    }
  }
  registered = [];
}

function send(action: Action) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("voiceShortcut", action);
  }
}

export function initShortcuts() {
  ipcMain.handle("setVoiceShortcuts", (_event, map: unknown) => {
    unregisterAll();

    // true = correcto o sin asignar; false = no se pudo registrar
    const result: Record<Action, boolean> = { mute: true, deafen: true };
    if (!map || typeof map !== "object") return result;

    for (const action of ["mute", "deafen"] as const) {
      const accelerator = (map as Record<string, unknown>)[action];
      if (typeof accelerator !== "string" || accelerator === "") continue;
      if (!VALID.test(accelerator)) {
        result[action] = false;
        continue;
      }
      let ok = false;
      try {
        ok = globalShortcut.register(accelerator, () => send(action));
      } catch {
        ok = false;
      }
      if (ok) registered.push(accelerator);
      else result[action] = false;
    }
    return result;
  });

  app.on("will-quit", () => {
    unregisterAll();
    globalShortcut.unregisterAll();
  });
}
