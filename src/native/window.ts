import { release } from "node:os";
import { join } from "node:path";

import {
  BrowserWindow,
  Menu,
  MenuItem,
  app,
  desktopCapturer,
  ipcMain,
  nativeImage,
  session,
} from "electron";

import windowIconAsset from "../../assets/desktop/icon.png?asset";

import { config } from "./config";
import { updateTrayMenu } from "./tray";

// global reference to main window
export let mainWindow: BrowserWindow;

// currently in-use build
export const BUILD_URL = new URL(
  app.commandLine.hasSwitch("force-server")
    ? app.commandLine.getSwitchValue("force-server")
    : /*MAIN_WINDOW_VITE_DEV_SERVER_URL ??*/ "https://starknet-chat.tech/app",
);

/**
 * Audio mode for screen-share capture. "loopbackWithoutChrome" removes this
 * app's own output (call voices, soundboard…) from the captured system audio
 * so viewers don't hear themselves / the sharer through the stream. Needs
 * Windows 11 (build 22000+); older systems fall back to plain loopback.
 */
const LOOPBACK_MODE: "loopback" | "loopbackWithoutChrome" =
  process.platform === "win32" &&
  parseInt(release().split(".")[2] ?? "0", 10) >= 22000
    ? "loopbackWithoutChrome"
    : "loopback";

// internal window state
let shouldQuit = false;

// load the window icon
const windowIcon = nativeImage.createFromDataURL(windowIconAsset);

// windowIcon.setTemplateImage(true);

/**
 * Create the main application window
 */
export function createMainWindow() {
  // (CLI arg --hidden or config)
  const startHidden =
    app.commandLine.hasSwitch("hidden") || config.startMinimisedToTray;
  const isMacOS = process.platform === "darwin";

  // create the window
  mainWindow = new BrowserWindow({
    minWidth: 300,
    minHeight: 300,
    width: 1280,
    height: 720,
    backgroundColor: "#191919",
    frame: isMacOS ? true : !config.customFrame,
    titleBarStyle: isMacOS ? "hidden" : "default",
    trafficLightPosition: isMacOS ? { x: 8, y: 8 } : undefined,
    icon: windowIcon,
    show: false,
    webPreferences: {
      // relative to `.vite/build`
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  // show and force to foreground once content is actually ready to paint,
  // instead of relying solely on the `show` constructor flag (unreliable
  // on Windows for freshly-launched/unsigned processes)
  mainWindow.once("ready-to-show", () => {
    if (!startHidden) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // hide the options
  mainWindow.setMenu(null);

  // restore last position if it was moved previously
  if (config.windowState.x > 0 || config.windowState.y > 0) {
    mainWindow.setPosition(
      config.windowState.x ?? 0,
      config.windowState.y ?? 0,
    );
  }

  // restore last size if it was resized previously
  if (config.windowState.width > 0 && config.windowState.height > 0) {
    mainWindow.setSize(
      config.windowState.width ?? 1280,
      config.windowState.height ?? 720,
    );
  }

  // maximise the window if it was maximised before
  if (config.windowState.isMaximised && !startHidden) {
    mainWindow.maximize();
  }

  // load the entrypoint
  mainWindow
    .loadURL(BUILD_URL.toString())
    .then(() => mainWindow.webContents.reload());

  // minimise window to tray
  mainWindow.on("close", (event) => {
    if (!shouldQuit && config.minimiseToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // update tray menu when window is shown/hidden
  mainWindow.on("show", updateTrayMenu);
  mainWindow.on("hide", updateTrayMenu);

  // keep track of window state
  function generateState() {
    config.windowState = {
      x: mainWindow.getPosition()[0],
      y: mainWindow.getPosition()[1],
      width: mainWindow.getSize()[0],
      height: mainWindow.getSize()[1],
      isMaximised: mainWindow.isMaximized(),
    };
  }

  mainWindow.on("maximize", generateState);
  mainWindow.on("unmaximize", generateState);
  mainWindow.on("moved", generateState);
  mainWindow.on("resized", generateState);

  // rebind zoom controls to be more sensible
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.control && (input.key === "=" || input.key === "+")) {
      // zoom in (+)
      event.preventDefault();
      mainWindow.webContents.setZoomLevel(
        mainWindow.webContents.getZoomLevel() + 1,
      );
    } else if (input.control && input.key === "-") {
      // zoom out (-)
      event.preventDefault();
      mainWindow.webContents.setZoomLevel(
        mainWindow.webContents.getZoomLevel() - 1,
      );
    } else if (input.control && input.key === "0") {
      // reset zoom to default.
      event.preventDefault();
      mainWindow.webContents.setZoomLevel(0);
    } else if (
      input.key === "F5" ||
      ((input.control || input.meta) && input.key.toLowerCase() === "r")
    ) {
      event.preventDefault();
      mainWindow.webContents.reload();
    }
  });

  // send the config as early as possible (dom-ready fires before
  // did-finish-load) to minimise the race window with the renderer's
  // startup script, plus again once fully loaded as a safety net
  mainWindow.webContents.on("dom-ready", () => config.sync());
  mainWindow.webContents.on("did-finish-load", () => {
    config.sync();
    // Tras una recarga la página puede quedar sin foco de teclado/mando, y
    // Chromium solo expone los mandos a la página con foco.
    if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
      mainWindow.webContents.focus();
    }
  });
  mainWindow.on("focus", () => mainWindow.webContents.focus());

  // configure spellchecker context menu
  mainWindow.webContents.on("context-menu", (_, params) => {
    const menu = new Menu();

    // add all suggestions
    for (const suggestion of params.dictionarySuggestions) {
      menu.append(
        new MenuItem({
          label: suggestion,
          click: () => mainWindow.webContents.replaceMisspelling(suggestion),
        }),
      );
    }

    // allow users to add the misspelled word to the dictionary
    if (params.misspelledWord) {
      menu.append(
        new MenuItem({
          label: "Add to dictionary",
          click: () =>
            mainWindow.webContents.session.addWordToSpellCheckerDictionary(
              params.misspelledWord,
            ),
        }),
      );
    }

    // add an option to toggle spellchecker
    menu.append(
      new MenuItem({
        label: "Toggle spellcheck",
        click() {
          config.spellchecker = !config.spellchecker;
        },
      }),
    );

    // show menu if we've generated enough entries
    if (menu.items.length > 0) {
      menu.popup();
    }
  });

  // Create display media request handler
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      desktopCapturer
        .getSources({ types: ["screen", "window"], fetchWindowIcons: true })
        .then((sources) => {
          // Shortcut for linux wayland.
          if (sources.length == 1) {
            request.audioRequested
              ? callback({
                  video: sources[0],
                  audio: LOOPBACK_MODE,
                })
              : callback({
                  video: sources[0],
                });
            return;
          }
          ipcMain.once(
            "screenPickerCallback",
            (_, idx: number, audio: boolean) => {
              if (idx < 0 || idx > sources.length) {
                callback({});
              } else {
                audio
                  ? callback({
                      video: sources[idx],
                      audio: LOOPBACK_MODE,
                    })
                  : callback({
                      video: sources[idx],
                    });
              }
            },
          );
          mainWindow.webContents.send(
            "screenPicker",
            sources.map((source, idx) => {
              const image = source.appIcon;
              if (image) {
                if (image.getAspectRatio() > 1) {
                  image.resize({ width: 256 });
                } else {
                  image.resize({ height: 256 });
                }
              }
              return {
                idx: idx,
                name: source.name,
                isFullScreen: source.id.startsWith("screen"),
                image: image?.toDataURL(),
              };
            }),
          );
        });
    },
    { useSystemPicker: true },
  );

  // push world events to the window
  ipcMain.on("minimise", () => mainWindow.minimize());
  ipcMain.on("maximise", () =>
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(),
  );
  ipcMain.on("close", () => mainWindow.close());

  // Reinicio completo de la aplicación (lo usa el actualizador automático,
  // como hace Discord): un proceso nuevo evita estados rotos tras recargar.
  ipcMain.on("relaunch", () => {
    shouldQuit = true;
    app.releaseSingleInstanceLock();
    app.relaunch();
    app.exit(0);
  });

  // mainWindow.webContents.openDevTools();

  // let i = 0;
  // setInterval(() => setBadgeCount((++i % 30) + 1), 1000);
}

/**
 * Quit the entire app
 */
export function quitApp() {
  shouldQuit = true;
  mainWindow.close();
}

// Ensure global app quit works properly
app.on("before-quit", () => {
  shouldQuit = true;
});
