const { app, BrowserWindow, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let updatesConfigured = false;

function configureAutomaticUpdates(window) {
  if (!app.isPackaged || updatesConfigured) return;
  updatesConfigured = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;

  autoUpdater.on("update-downloaded", async (info) => {
    const { response } = await dialog.showMessageBox(window, {
      type: "info",
      title: "Backstabber atualizado",
      message: `A versão ${info.version} está pronta.`,
      detail: "Reinicie agora para aplicar a atualização ou continue jogando e ela será instalada ao sair.",
      buttons: ["Reiniciar agora", "Depois"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });

    if (response === 0) autoUpdater.quitAndInstall(false, true);
  });

  autoUpdater.on("error", (error) => {
    console.warn("Atualização automática indisponível.", error.message);
  });

  const checkForUpdates = () =>
    autoUpdater.checkForUpdates().catch((error) => {
      console.warn("Não foi possível verificar atualizações.", error.message);
    });

  setTimeout(checkForUpdates, 4000);
  setInterval(checkForUpdates, 4 * 60 * 60 * 1000);
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    fullscreen: true,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#050510",
    icon: path.join(__dirname, "..", "images", "icon-512.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true,
      spellcheck: false,
    },
  });

  window.loadFile(path.join(__dirname, "..", "index.html"));
  window.once("ready-to-show", () => {
    window.show();
    configureAutomaticUpdates(window);
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file:")) event.preventDefault();
  });

  window.webContents.on("before-input-event", (event, input) => {
    const macFullscreen =
      process.platform === "darwin" &&
      input.meta &&
      input.control &&
      input.key.toLowerCase() === "f";
    if ((input.key === "F11" || macFullscreen) && input.type === "keyDown") {
      window.setFullScreen(!window.isFullScreen());
      event.preventDefault();
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
