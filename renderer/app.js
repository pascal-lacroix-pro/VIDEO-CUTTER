if (!window.electronAPI?.selectVideoFile) {
  console.error("electronAPI manquant → vérifiez preload.cjs et main.js");
} else {
  console.log("[renderer] electronAPI OK");
}
document.addEventListener("DOMContentLoaded", () => {
  // Utilitaires DOM
  const $ = (sel) => document.querySelector(sel);

  // Éléments UI
  const video = $("#video");
  const timeEl = $("#time");
  const fpsEl = $("#fps");
  const rateSel = $("#rate");
  const openBtn = $("#openFile");

  let startPoint = null;
  let endPoint = null;
  const startDisp = $("#startDisplay");
  const endDisp = $("#endDisplay");

  const exportBtn = $("#exportClip");
  const exportStatus = $("#exportStatus");

  const seek = $("#seek");
  const posDisplay = $("#posDisplay");
  const durDisplay = $("#durDisplay");

  const loopBtn = $("#loopToggle");
  let loopEnabled = false;

  const EPS = 0.02;

  if (!seek) {
    console.error("⚠️ Élément #seek introuvable (ID mal orthographié ?).");
    return;
  }

  function updateTime() {
    console.log("test");
    timeEl.textContent = formatTime(video.currentTime);
    seek.value = video.currentTime.toFixed(3);
    posDisplay.textContent = formatTime(video.currentTime);

    // --- Boucle A→B si activée ---
    if (!loopEnabled) return;
    if (!video.duration || startPoint === null || endPoint === null) return;

    const t = video.currentTime;
    if (t >= endPoint - EPS) {
      video.currentTime = Math.max(0, startPoint);
      if (video.paused) video.play();
    }
  }

  function updateSeekbarBackground() {
    const dur = video.duration || 0;
    if (!dur || startPoint === null || endPoint === null) {
      // enlevez la var CSS pour revenir au fond par défaut
      seek.style.removeProperty("--seek-bg");
      return;
    }
    const a = Math.max(0, Math.min(100, (startPoint / dur) * 100));
    const b = Math.max(0, Math.min(100, (endPoint / dur) * 100));

    const grad = `linear-gradient(90deg,
    #e5e7eb 0%,
    #e5e7eb ${a}%,
    #bfdbfe ${a}%,
    #bfdbfe ${b}%,
    #e5e7eb ${b}%,
    #e5e7eb 100%)`;

    seek.style.setProperty("--seek-bg", grad);
  }

  loopBtn.addEventListener("click", () => {
    if (startPoint == null || endPoint == null) {
      alert("Définissez d’abord un IN et un OUT.");
      return;
    }
    loopEnabled = !loopEnabled;
    loopBtn.textContent = loopEnabled ? "Loop: ON" : "Loop: OFF";

    if (loopEnabled) {
      // Exigence : démarrer au IN quand on active la boucle
      video.currentTime = Math.max(0, startPoint);
      video.play();
    }
  });

  video.addEventListener("loadedmetadata", () => {
    seek.min = "0";
    seek.max = (video.duration || 0).toFixed(3);
    seek.step = "0.001";
    seek.value = (video.currentTime || 0).toFixed(3);
    durDisplay.textContent = formatTime(video.duration || 0);
    posDisplay.textContent = formatTime(video.currentTime || 0);
    updateSeekbarBackground(); // votre fonction existante
  });

  video.addEventListener("timeupdate", updateTime);
  video.addEventListener("loadedmetadata", updateTime);

  $("#setStart").addEventListener("click", () => {
    startPoint = video.currentTime;
    startDisp.textContent = formatTime(startPoint);
    // Si endPoint existe et est < start, on le réinitialise
    if (endPoint !== null && endPoint <= startPoint) {
      endPoint = null;
      endDisp.textContent = "--:--:--.---";
    }
    updateSeekbarBackground();
  });

  $("#setEnd").addEventListener("click", () => {
    if (startPoint === null) {
      alert("Veuillez d’abord définir un point de départ (Start).");
      return;
    }
    const cur = video.currentTime;
    if (cur <= startPoint) {
      alert("Le point de fin doit être après le point de départ.");
      return;
    }
    endPoint = cur;
    endDisp.textContent = formatTime(endPoint);
    updateSeekbarBackground();
  });

  exportBtn.addEventListener("click", async () => {
    if (startPoint === null || endPoint === null) {
      alert("Veuillez définir un Start et un End.");
      return;
    }
    const filePath = decodeURI(video.src.replace("file://", "")); // ✅ correction
    const result = await window.electronAPI.exportClip({
      source: filePath,
      start: startPoint,
      end: endPoint,
    });

    if (result.success) {
      exportStatus.textContent = `✅ Extrait exporté : ${result.output}`;
    } else {
      exportStatus.textContent = `❌ Erreur : ${result.error}`;
    }
  });

  // État FPS / frame stepping
  let estimatedFps = 30; // fallback
  let frameDuration = 1 / estimatedFps;
  let measured = false;

  // --- Ouvrir un fichier vidéo via le dialog Electron (préload expose window.electronAPI.selectVideoFile)
  openBtn.addEventListener("click", async () => {
    const filePath = await window.electronAPI?.selectVideoFile?.();
    if (!filePath) return;
    loadVideoFromPath(filePath);
  });

  function loadVideoFromPath(filePath) {
    // Construire une URL file://… sûre
    // Remplacer les espaces etc. (encodeURI gère les caractères spéciaux)
    const url = `file://${encodeURI(filePath)}`;
    video.src = url;
    video.playbackRate = Number(rateSel.value) || 1;
    measured = false;
    fpsEl.textContent = "fps ≈ n/a";
    // Petite lecture automatique pour initialiser l’affichage si souhaité
    // video.play().catch(() => {/* silencieux si bloqué */});
  }

  // --- Contrôles
  $("#play").addEventListener("click", () => video.play());
  $("#pause").addEventListener("click", () => video.pause());
  $("#back05").addEventListener("click", () => nudge(-0.5));
  $("#fwd05").addEventListener("click", () => nudge(+0.5));
  rateSel.addEventListener(
    "change",
    (e) => (video.playbackRate = Number(e.target.value) || 1)
  );

  $("#prevFrame").addEventListener("click", () => stepFrame(-1));
  $("#nextFrame").addEventListener("click", () => stepFrame(+1));

  // --- Affichage timecode
  video.addEventListener("timeupdate", updateTime);
  video.addEventListener("loadedmetadata", updateTime);

  // --- Mesure FPS via requestVideoFrameCallback (si dispo)
  let lastDisplayTime = null;
  let sampleCount = 0;
  let acc = 0;

  if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
    const cb = (now, metadata) => {
      // On échantillonne pendant la lecture
      if (video.readyState >= 2 && !video.paused) {
        const t = metadata?.mediaTime ?? video.currentTime;
        if (lastDisplayTime != null) {
          const dt = t - lastDisplayTime;
          // On ignore les gros sauts (seek, buffering)
          if (dt > 0 && dt < 1) {
            acc += dt;
            sampleCount++;
            if (sampleCount >= 20 && !measured) {
              const avg = acc / sampleCount;
              if (avg > 0) {
                frameDuration = avg;
                estimatedFps = Math.round(1 / avg);
                fpsEl.textContent = `fps ≈ ${estimatedFps}`;
                measured = true;
              }
            }
          }
        }
        lastDisplayTime = t;
      }
      video.requestVideoFrameCallback(cb);
    };
    video.requestVideoFrameCallback(cb);
  } else {
    fpsEl.textContent = "fps ≈ ~30 (approx)";
  }

  // --- Frame-by-frame
  function stepFrame(direction = +1) {
    // Pour la précision, on met en pause, puis on seek d’une durée frame mesurée
    video.pause();
    const step = frameDuration || 1 / estimatedFps || 1 / 30;
    video.currentTime = clamp(
      video.currentTime + direction * step,
      0,
      video.duration || Infinity
    );
  }

  function nudge(seconds) {
    video.currentTime = clamp(
      video.currentTime + seconds,
      0,
      video.duration || Infinity
    );
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function formatTime(sec) {
    if (!isFinite(sec)) sec = 0;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec - Math.floor(sec)) * 1000);
    const hh = String(h).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    const mss = String(ms).padStart(3, "0");
    return `${hh}:${mm}:${ss}.${mss}`;
  }

  // --- Raccourcis clavier
  window.addEventListener("keydown", (e) => {
    // éviter les conflits si un input est focus
    if (
      ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)
    )
      return;

    switch (e.key) {
      case " ": // Espace
        e.preventDefault();
        if (video.paused) video.play();
        else video.pause();
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (video.paused) stepFrame(-1);
        else nudge(-0.5);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (video.paused) stepFrame(+1);
        else nudge(+0.5);
        break;
      case ",":
        e.preventDefault();
        stepFrame(-1);
        break;
      case ".":
        e.preventDefault();
        stepFrame(+1);
        break;
      case "ArrowUp":
        e.preventDefault();
        bumpRate(+1);
        break;
      case "ArrowDown":
        e.preventDefault();
        bumpRate(-1);
        break;
    }
  });

  const rates = [0.25, 0.5, 1, 1.25, 1.5, 2, 4];
  function bumpRate(dir) {
    const cur = Number(rateSel.value) || 1;
    const idx = Math.max(
      0,
      Math.min(rates.length - 1, rates.indexOf(cur) + dir)
    );
    rateSel.value = String(rates[idx]);
    video.playbackRate = rates[idx];
  }

  let wasPlaying = false;
  let isScrubbing = false;

  seek.addEventListener("pointerdown", () => {
    isScrubbing = true;
    wasPlaying = !video.paused;
    video.pause(); // on fige l’image pendant le drag
  });

  seek.addEventListener("input", () => {
    // pendant le drag : on met à jour la position affichée et la vidéo
    const t = Number(seek.value);
    if (!Number.isFinite(t)) return;
    video.currentTime = t;
    posDisplay.textContent = formatTime(t);
  });

  seek.addEventListener("change", () => {
    const t = Number(seek.value);
    if (!Number.isFinite(t)) return;
    video.currentTime = t;
    posDisplay.textContent = formatTime(t);
  });

  const endScrub = () => {
    if (!isScrubbing) return;
    isScrubbing = false;
    const t = Number(seek.value);
    if (Number.isFinite(t)) video.currentTime = t;
    if (wasPlaying || loopEnabled) video.play();
  };
  seek.addEventListener("pointerup", endScrub);
  seek.addEventListener("pointercancel", endScrub);
  seek.addEventListener("pointerleave", () => isScrubbing && endScrub());
});
