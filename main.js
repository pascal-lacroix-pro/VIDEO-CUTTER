import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const ffmpeg = require("@ffmpeg-installer/ffmpeg");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ⚠️ Dans les apps packagées, Electron met les binaires dans app.asar.unpacked
const ffmpegPath = ffmpeg.path.replace("app.asar", "app.asar.unpacked");

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"), // <-- important
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox: false, // (optionnel) laissez par défaut
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

// Handler pour le dialog d’ouverture
ipcMain.handle("select-video-file", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [
      { name: "Vidéos", extensions: ["mp4", "mkv", "mov", "avi", "webm"] },
    ],
  });
  if (canceled || filePaths.length === 0) return null;
  return filePaths[0];
});

ipcMain.handle("export-clip", async (event, { source, start, end }) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "Enregistrer l’extrait",
    defaultPath: path.basename(source).replace(/\.[^.]+$/, "_clip.mp4"),
    filters: [{ name: "Vidéos", extensions: ["mp4"] }],
  });
  if (canceled || !filePath) {
    return { success: false, error: "Export annulé" };
  }

  // Durée = end - start (sécurisée)
  const duration = Math.max(0.01, end - start); // évite 0

  return new Promise((resolve) => {
    const args = [
      "-hide_banner",
      "-ss",
      start.toFixed(3), // seek rapide avant l’entrée
      "-i",
      source, // fichier source
      "-t",
      duration.toFixed(3), // durée voulue (PAS -to)
      "-c",
      "copy", // sans ré-encodage
      "-movflags",
      "+faststart", // option sûre pour mp4
      filePath,
    ];

    const ff = spawn(ffmpegPath, args, { windowsHide: true });

    ff.on("error", (err) => resolve({ success: false, error: err.message }));
    ff.on("close", (code) => {
      resolve(
        code === 0
          ? { success: true, output: filePath }
          : { success: false, error: `FFmpeg code ${code}` }
      );
    });
  });
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
