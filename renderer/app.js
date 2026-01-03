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
  const startInput = $("#startInput");
  const endInput = $("#endInput");

  const exportBtn = $("#exportClip");
  const exportStatus = $("#exportStatus");

  const seek = $("#seek");
  const posDisplay = $("#posDisplay");
  const durDisplay = $("#durDisplay");

  const timeline = $("#timeline");
  const tlRange = $("#tlRange");
  const tlStartHandle = $("#tlStartHandle");
  const tlEndHandle = $("#tlEndHandle");
  const tlPlayhead = $("#tlPlayhead");
  const tlZoom = $("#tlZoom");
  const tlZoomVal = $("#tlZoomVal");
  const tlWindow = $("#tlWindow");

  const loopBtn = $("#loopToggle");
  let loopEnabled = false;

  const barsInput = $("#bars");
  const beatsPerBarSel = $("#beatsPerBar");
  const loopLenEl = $("#loopLen");
  const bpmComputedEl = $("#bpmComputed");
  const bpmTargetInput = $("#bpmTarget");
  const keepPitchInput = $("#keepPitch");

  const EPS = 0.02;

  if (!seek) {
    console.error("⚠️ Élément #seek introuvable (ID mal orthographié ?).");
    return;
  }

  // Références pitch
  const pitchSemis = document.getElementById("pitchSemis");
  const pitchSemisVal = document.getElementById("pitchSemisVal");
  pitchSemis?.addEventListener("input", () => {
    pitchSemisVal.textContent = String(pitchSemis.value || 0);
    schedulePreviewRender(); // re-render si loop ON
  });

  keepPitchInput?.addEventListener("change", () => {
    const keep = Boolean(keepPitchInput.checked);
    if (!keep) {
      if (pitchSemis) pitchSemis.value = "0";
      if (pitchSemisVal) pitchSemisVal.textContent = "0";
    }
    if (pitchSemis) pitchSemis.disabled = !keep;
    schedulePreviewRender();
  });

  if (keepPitchInput && pitchSemis) {
    pitchSemis.disabled = !keepPitchInput.checked;
  }

  function getBars() {
    const v = parseInt(barsInput?.value || "1", 10);
    return Number.isFinite(v) && v > 0 ? v : 1;
  }

  function getBeatsPerBar() {
    const v = parseInt(beatsPerBarSel?.value || "4", 10);
    return Number.isFinite(v) && v > 0 ? v : 4;
  }

  function getBpmTarget() {
    const v = Number(bpmTargetInput?.value);
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  function getLoopDuration() {
    if (startPoint == null || endPoint == null) return null;
    return Math.max(0.01, endPoint - startPoint);
  }

  function updateBpmDisplay() {
    const dur = getLoopDuration();
    if (!dur) {
      if (loopLenEl) loopLenEl.textContent = "--:--:--.---";
      if (bpmComputedEl) bpmComputedEl.textContent = "--";
      return;
    }
    if (loopLenEl) loopLenEl.textContent = formatTime(dur);
    const bars = getBars();
    const beats = getBeatsPerBar();
    const bpm = (bars * beats * 60) / dur;
    if (bpmComputedEl) bpmComputedEl.textContent = bpm.toFixed(2);
  }

  function updateStartEndInputs() {
    if (startInput) {
      startInput.value =
        startPoint == null ? "" : startPoint.toFixed(3).toString();
    }
    if (endInput) {
      endInput.value = endPoint == null ? "" : endPoint.toFixed(3).toString();
    }
  }

  barsInput?.addEventListener("input", () => {
    updateBpmDisplay();
    schedulePreviewRender();
  });
  beatsPerBarSel?.addEventListener("change", () => {
    updateBpmDisplay();
    schedulePreviewRender();
  });
  bpmTargetInput?.addEventListener("input", () => {
    schedulePreviewRender();
  });

  // État preview
  let previewAudio = null;
  let previewPending = false;
  let previewTimer = null;

  function schedulePreviewRender() {
    if (!loopEnabled) return;
    if (startPoint == null || endPoint == null) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderAudioPreview, 250);
  }

  async function renderAudioPreview() {
    if (startPoint == null || endPoint == null) return;
    if (!video.src) return;
    const filePath = decodeURI(video.src.replace("file://", ""));

    previewPending = true;
    const res = await window.electronAPI.renderAudioPreview({
      source: filePath,
      start: startPoint,
      end: endPoint,
      pitchSemis: keepPitchInput?.checked
        ? Number(pitchSemis?.value || 0)
        : 0,
      bpmTarget: getBpmTarget(),
      bars: getBars(),
      beatsPerBar: getBeatsPerBar(),
      keepPitch: Boolean(keepPitchInput?.checked),
    });
    previewPending = false;
    if (!res?.success) {
      console.warn("Preview error:", res?.error);
      return;
    }

    try {
      previewAudio?.pause();
    } catch {}
    previewAudio = new Audio(`file://${encodeURI(res.path)}`);
    previewAudio.loop = true;
    video.muted = true; // on écoute la version pitchée

    // Démarre image + audio alignés sur IN
    video.currentTime = startPoint;
    try {
      await Promise.allSettled([video.play(), previewAudio.play()]);
      if (video.paused && previewAudio) {
        previewAudio.pause(); // garde l’état cohérent
      }
    } catch {}
  }

  function updateTime() {
    const t = video.currentTime || 0;
    timeEl.textContent = formatTime(t);
    seek.value = t.toFixed(3);
    posDisplay.textContent = formatTime(t);
    updateTimeline();

    if (!loopEnabled || startPoint == null || endPoint == null) return;
    if (t >= endPoint - EPS) {
      video.currentTime = startPoint;
      // remet l’audio de preview au début pour rester synchro
      if (previewAudio) {
        try {
          previewAudio.currentTime = 0;
          if (previewAudio.paused) previewAudio.play();
        } catch {}
      }
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

  function getTimelineWindow() {
    const dur = video.duration || 0;
    if (!dur || !isFinite(dur)) return null;
    const zoom = Number(tlZoom?.value || 1);
    const windowDur = Math.max(0.01, dur / Math.max(1, zoom));
    const center =
      startPoint != null && endPoint != null
        ? (startPoint + endPoint) / 2
        : video.currentTime || 0;
    let start = center - windowDur / 2;
    let end = center + windowDur / 2;
    if (start < 0) {
      end -= start;
      start = 0;
    }
    if (end > dur) {
      start -= end - dur;
      end = dur;
      if (start < 0) start = 0;
    }
    return { start, end, dur };
  }

  function updateTimeline() {
    if (!timeline || !tlPlayhead) return;
    const win = getTimelineWindow();
    if (!win) return;
    const rect = timeline.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const map = (t) =>
      ((t - win.start) / Math.max(0.0001, win.end - win.start)) * width;

    const playX = clamp(map(video.currentTime || 0), 0, width);
    tlPlayhead.style.left = `${playX}px`;

    if (startPoint != null && endPoint != null && tlRange) {
      const x1 = clamp(map(startPoint), 0, width);
      const x2 = clamp(map(endPoint), 0, width);
      const left = Math.min(x1, x2);
      const right = Math.max(x1, x2);
      tlRange.hidden = false;
      tlRange.style.left = `${left}px`;
      tlRange.style.width = `${Math.max(2, right - left)}px`;
      if (tlStartHandle) {
        tlStartHandle.hidden = false;
        tlStartHandle.style.left = `${left}px`;
      }
      if (tlEndHandle) {
        tlEndHandle.hidden = false;
        tlEndHandle.style.left = `${right}px`;
      }
    } else {
      if (tlRange) tlRange.hidden = true;
      if (tlStartHandle) tlStartHandle.hidden = true;
      if (tlEndHandle) tlEndHandle.hidden = true;
    }

    if (tlZoomVal && tlZoom) {
      tlZoomVal.textContent = `${Number(tlZoom.value || 1).toFixed(1)}x`;
    }
    if (tlWindow) {
      tlWindow.textContent = `${formatTime(win.start)} – ${formatTime(
        win.end
      )}`;
    }
  }

  function pausePlayback() {
    video.pause();
    if (previewAudio && !previewAudio.paused) {
      previewAudio.pause();
    }
  }

  function xToTime(clientX) {
    if (!timeline) return null;
    const win = getTimelineWindow();
    if (!win) return null;
    const rect = timeline.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width);
    const t =
      win.start + (x / Math.max(1, rect.width)) * (win.end - win.start);
    return clamp(t, 0, win.dur);
  }

  let dragMode = null;
  let dragOffset = 0;

  tlStartHandle?.addEventListener("pointerdown", (e) => {
    dragMode = "start";
    pausePlayback();
    timeline?.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  tlEndHandle?.addEventListener("pointerdown", (e) => {
    dragMode = "end";
    pausePlayback();
    timeline?.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  tlRange?.addEventListener("pointerdown", (e) => {
    if (startPoint == null || endPoint == null) return;
    const t = xToTime(e.clientX);
    if (t == null) return;
    dragMode = "range";
    dragOffset = t - startPoint;
    pausePlayback();
    timeline?.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  timeline?.addEventListener("pointerdown", (e) => {
    if (
      e.target === tlStartHandle ||
      e.target === tlEndHandle ||
      e.target === tlRange
    ) {
      pausePlayback();
      return;
    }
    const t = xToTime(e.clientX);
    if (t == null) return;
    video.currentTime = t;
    updateTimeline();
  });

  timeline?.addEventListener("pointermove", (e) => {
    if (!dragMode) return;
    pausePlayback();
    const t = xToTime(e.clientX);
    if (t == null) return;

    if (dragMode === "start" && endPoint != null) {
      startPoint = clamp(t, 0, endPoint - EPS);
      video.currentTime = startPoint;
    } else if (dragMode === "end" && startPoint != null) {
      endPoint = clamp(t, startPoint + EPS, video.duration || Infinity);
      video.currentTime = endPoint;
    } else if (
      dragMode === "range" &&
      startPoint != null &&
      endPoint != null
    ) {
      const dur = Math.max(EPS, endPoint - startPoint);
      let newStart = clamp(t - dragOffset, 0, (video.duration || 0) - dur);
      let newEnd = newStart + dur;
      if (video.duration && newEnd > video.duration) {
        newEnd = video.duration;
        newStart = newEnd - dur;
      }
      startPoint = newStart;
      endPoint = newEnd;
      video.currentTime = clamp(t, startPoint, endPoint);
    }
    updateStartEndInputs();
    updateSeekbarBackground();
    updateBpmDisplay();
    updateTimeline();
    schedulePreviewRender();
  });

  const endDrag = () => {
    dragMode = null;
  };
  timeline?.addEventListener("pointerup", endDrag);
  timeline?.addEventListener("pointercancel", endDrag);

  tlZoom?.addEventListener("input", () => {
    updateTimeline();
  });

  window.addEventListener("resize", () => {
    updateTimeline();
  });

  loopBtn.addEventListener("click", async () => {
    if (startPoint == null || endPoint == null) {
      alert("Définissez d’abord un IN et un OUT.");
      return;
    }
    loopEnabled = !loopEnabled;
    loopBtn.textContent = loopEnabled ? "Loop: ON" : "Loop: OFF";

    if (loopEnabled) {
      await renderAudioPreview();
    } else {
      try {
        previewAudio?.pause();
      } catch {}
      previewAudio = null;
      video.muted = false;
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
    updateBpmDisplay();
    updateTimeline();
  });

  video.addEventListener("timeupdate", updateTime);
  video.addEventListener("loadedmetadata", updateTime);

  $("#setStart").addEventListener("click", () => {
    startPoint = video.currentTime;
    // Si endPoint existe et est < start, on le réinitialise
    if (endPoint !== null && endPoint <= startPoint) {
      endPoint = null;
    }
    updateStartEndInputs();
    updateSeekbarBackground();
    updateBpmDisplay();
    updateTimeline();
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
    updateStartEndInputs();
    updateSeekbarBackground();
    updateBpmDisplay();
    updateTimeline();
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
      pitchSemis: keepPitchInput?.checked
        ? Number(document.getElementById("pitchSemis")?.value || 0)
        : 0,
      bpmTarget: getBpmTarget(),
      bars: getBars(),
      beatsPerBar: getBeatsPerBar(),
      keepPitch: Boolean(keepPitchInput?.checked),
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
    updateStartEndInputs();
    updateBpmDisplay();
    updateTimeline();
    // Petite lecture automatique pour initialiser l’affichage si souhaité
    // video.play().catch(() => {/* silencieux si bloqué */});
  }

  // --- Contrôles
  const playToggleBtn = $("#playToggle");
  const updatePlayToggle = () => {
    if (!playToggleBtn) return;
    playToggleBtn.textContent = video.paused ? "▶︎ Play" : "⏸ Pause";
  };
  playToggleBtn?.addEventListener("click", () => {
    if (video.paused) video.play();
    else video.pause();
  });
  updatePlayToggle();
  $("#back05")?.addEventListener("click", () => nudge(-0.5));
  $("#fwd05")?.addEventListener("click", () => nudge(+0.5));
  rateSel.addEventListener(
    "change",
    (e) => (video.playbackRate = Number(e.target.value) || 1)
  );

  $("#prevFrame")?.addEventListener("click", () => stepFrame(-1));
  $("#nextFrame")?.addEventListener("click", () => stepFrame(+1));

  // --- Affichage timecode
  video.addEventListener("timeupdate", updateTime);
  video.addEventListener("loadedmetadata", updateTime);

  // Synchroniser lecture/pause entre vidéo et audio de preview
  video.addEventListener("play", () => {
    updatePlayToggle();
    if (loopEnabled && previewAudio && previewAudio.paused) {
      previewAudio.play().catch(() => {});
    }
  });

  video.addEventListener("pause", () => {
    updatePlayToggle();
    if (previewAudio && !previewAudio.paused) {
      previewAudio.pause();
    }
  });

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

  function applyStartFromInput() {
    const v = Number(startInput?.value);
    if (!Number.isFinite(v)) return;
    const max = endPoint != null ? endPoint - EPS : video.duration || Infinity;
    startPoint = clamp(v, 0, max);
    if (endPoint != null && endPoint <= startPoint) {
      endPoint = null;
    }
    updateStartEndInputs();
    updateSeekbarBackground();
    updateBpmDisplay();
    updateTimeline();
    schedulePreviewRender();
  }

  function applyEndFromInput() {
    if (startPoint == null) {
      alert("Veuillez d’abord définir un point de départ (Start).");
      return;
    }
    const v = Number(endInput?.value);
    if (!Number.isFinite(v)) return;
    endPoint = clamp(v, startPoint + EPS, video.duration || Infinity);
    updateStartEndInputs();
    updateSeekbarBackground();
    updateBpmDisplay();
    updateTimeline();
    schedulePreviewRender();
  }

  // --- Raccourcis clavier
  window.addEventListener("keydown", (e) => {
    switch (e.key) {
      case " ": // Espace
        e.preventDefault();
        if (video.paused) video.play();
        else video.pause();
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (e.shiftKey) stepFrame(-10);
        else if (video.paused) stepFrame(-1);
        else nudge(-0.5);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (e.shiftKey) stepFrame(+10);
        else if (video.paused) stepFrame(+1);
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
    updateTimeline();
  });

  seek.addEventListener("change", () => {
    const t = Number(seek.value);
    if (!Number.isFinite(t)) return;
    video.currentTime = t;
    posDisplay.textContent = formatTime(t);
    updateTimeline();
  });

  // Scrubbing — si loop ON, réalignez l’audio
  const endScrub = () => {
    if (!isScrubbing) return;
    isScrubbing = false;
    const t = Number(seek.value) || 0;
    video.currentTime = t;
    if (loopEnabled) {
      try {
        // Si vous voulez 1:1 strict, forcez à 0 — ici on garde l’offset dans la loop
        const offset = Math.max(0, t - startPoint);
        if (previewAudio) {
          previewAudio.pause();
          previewAudio.currentTime =
            offset % Math.max(0.01, endPoint - startPoint);
          previewAudio.play();
        }
      } catch {}
      video.play();
    } else if (wasPlaying) {
      video.play();
    }
    updateTimeline();
  };
  seek.addEventListener("pointerup", endScrub);
  seek.addEventListener("pointercancel", endScrub);
  seek.addEventListener("pointerleave", () => isScrubbing && endScrub());

  startInput?.addEventListener("change", applyStartFromInput);
  endInput?.addEventListener("change", applyEndFromInput);
});
