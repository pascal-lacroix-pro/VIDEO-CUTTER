import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const ffmpeg = require("@ffmpeg-installer/ffmpeg");
import os from "os";
import fs from "fs";

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

ipcMain.handle(
  "export-clip",
  async (
    event,
    {
      source,
      start,
      end,
      pitchSemis = 0,
      bpmTarget = null,
      bars = null,
      beatsPerBar = 4,
      keepPitch = true,
    }
  ) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: "Enregistrer l’extrait",
      defaultPath: path.basename(source).replace(/\.[^.]+$/, "_clip.mp4"),
      filters: [{ name: "Vidéos", extensions: ["mp4"] }],
    });
    if (canceled || !filePath)
      return { success: false, error: "Export annulé" };

    const duration = Math.max(0.01, end - start);

    // --- Vitesse (option BPM — laissez r=1 si vous n’utilisez pas encore cette partie)
    let r = 1;
    if (bpmTarget && bars && beatsPerBar) {
      const desired = (bars * beatsPerBar * 60) / bpmTarget;
      r = duration / desired; // >1 accélère, <1 ralentit
    }

    // --- Pitch
    const semis = keepPitch ? Number(pitchSemis) || 0 : 0;
    const sr = 48000; // sample rate cible raisonnable
    const pitchRate = Math.pow(2, semis / 12); // change la hauteur
    const tempoComp = Math.pow(2, -semis / 12); // compense le tempo
    const totalTempo = tempoComp * r; // combine pitch + BPM

    // atempo est limité à [0.5;2.0] → on chaîne si besoin
    const atempoChain = (t) => {
      const parts = [];
      let rem = t;
      while (rem < 0.5 || rem > 2.0) {
        if (rem > 2.0) {
          parts.push("atempo=2.0");
          rem /= 2.0;
        } else {
          parts.push("atempo=0.5");
          rem /= 0.5;
        }
      }
      parts.push(`atempo=${rem.toFixed(6)}`);
      return parts.join(",");
    };

    // Filtres
    const needVideoSpeed = r !== 1;
    const needAudioProc = semis !== 0 || r !== 1;

    const vFilter = needVideoSpeed ? `setpts=${(1 / r).toFixed(9)}*PTS` : null;
    const aFilter = keepPitch
      ? semis !== 0
        ? [
            `asetrate=${sr * pitchRate}`,
            `aresample=${sr}`,
            atempoChain(totalTempo),
          ].join(",")
        : r !== 1
        ? atempoChain(r)
        : null
      : r !== 1
      ? [`asetrate=${sr * r}`, `aresample=${sr}`].join(",")
      : null;

    return new Promise((resolve) => {
      const args = [
        "-hide_banner",
        "-ss",
        start.toFixed(3),
        "-i",
        source,
        "-t",
        duration.toFixed(3),
        // Filtres seulement si nécessaires
        ...(vFilter ? ["-vf", vFilter] : []),
        ...(aFilter ? ["-af", aFilter] : []),
        // Codecs: si filtres → ré-encodage requis
        ...(vFilter
          ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"]
          : ["-c:v", "copy"]),
        ...(aFilter ? ["-c:a", "aac", "-b:a", "192k"] : ["-c:a", "copy"]),
        "-movflags",
        "+faststart",
        filePath,
      ];

      const ff = spawn(ffmpegPath, args, { windowsHide: true });
      ff.on("error", (err) => resolve({ success: false, error: err.message }));
      ff.stderr.on("data", (d) => console.log("[ffmpeg export]", String(d)));
      ff.on("close", (code) => {
        resolve(
          code === 0
            ? { success: true, output: filePath }
            : { success: false, error: `FFmpeg code ${code}` }
        );
      });
    });
  }
);

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ➜ Aperçu audio pitché pour la loop (génère un .wav temporaire)
ipcMain.handle(
  "render-audio-preview",
  async (
    event,
    {
      source,
      start,
      end,
      pitchSemis = 0,
      bpmTarget = null,
      bars = null,
      beatsPerBar = 4,
      keepPitch = true,
    }
  ) => {
    try {
      const duration = Math.max(0.01, end - start);

      // (Option BPM — pour plus tard si vous l’activez côté UI)
      let r = 1;
      if (bpmTarget && bars && beatsPerBar) {
        const desired = (bars * beatsPerBar * 60) / bpmTarget;
        r = duration / desired;
      }

      const sr = 48000; // sample rate cible
      const semis = keepPitch ? Number(pitchSemis) || 0 : 0;
      const pitchRate = Math.pow(2, semis / 12); // facteur de hauteur
      const tempoComp = Math.pow(2, -semis / 12); // compense le tempo
      const totalTempo = tempoComp * r;

      // atempo n’autorise que 0.5..2.0 → chaînez si besoin
      const atempoChain = (t) => {
        const parts = [];
        let rem = t;
        while (rem < 0.5 || rem > 2.0) {
          if (rem > 2.0) {
            parts.push("atempo=2.0");
            rem /= 2.0;
          } else {
            parts.push("atempo=0.5");
            rem /= 0.5;
          }
        }
        parts.push(`atempo=${rem.toFixed(6)}`);
        return parts.join(",");
      };

      const aFilter = keepPitch
        ? semis !== 0
          ? [
              `asetrate=${sr * pitchRate}`,
              `aresample=${sr}`,
              atempoChain(totalTempo),
            ].join(",")
          : r !== 1
          ? atempoChain(r)
          : "anull"
        : r !== 1
        ? [`asetrate=${sr * r}`, `aresample=${sr}`].join(",")
        : "anull";

      const outPath = path.join(os.tmpdir(), `vc_preview_${Date.now()}.wav`);

      const args = [
        "-hide_banner",
        "-ss",
        start.toFixed(3),
        "-i",
        source,
        "-t",
        duration.toFixed(3),
        "-vn", // audio only
        "-af",
        aFilter,
        "-ar",
        String(sr),
        "-ac",
        "2",
        "-f",
        "wav",
        outPath,
      ];

      const ff = spawn(ffmpegPath, args, { windowsHide: true });
      return await new Promise((resolve) => {
        ff.on("error", (err) =>
          resolve({ success: false, error: err.message })
        );
        ff.stderr.on("data", (d) => console.log("[ffmpeg preview]", String(d)));
        ff.on("close", (code) => {
          if (code === 0) resolve({ success: true, path: outPath });
          else resolve({ success: false, error: `FFmpeg code ${code}` });
        });
      });
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
);

// (Optionnel) nettoyage simple des previews à la fermeture
app.on("quit", () => {
  try {
    const files = fs
      .readdirSync(os.tmpdir())
      .filter((f) => f.startsWith("vc_preview_") && f.endsWith(".wav"));
    for (const f of files) fs.unlinkSync(path.join(os.tmpdir(), f));
  } catch {}
});
