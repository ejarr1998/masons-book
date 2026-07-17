// ============================================================
// SLIDESHOW — fully self-contained: owns all its own state, only
// needs a list of entries handed to it (openSlideshow) or a
// callback that produces one (initSlideshow, for the header button).
// ============================================================

import { parseLocalDate, showToast, lockBodyScroll, unlockBodyScroll } from "./utils.js";
import { icon } from "./icons.js";

let slideshowPhotos = []; // master list, chronological — never reordered, even in shuffle mode
let slideshowSourceEntries = [];
let slideshowIndex = 0; // position in slideshowPhotos, used when NOT shuffled
let slideshowShuffleHistory = []; // sequence of indices actually shown, used when shuffled
let slideshowHistoryPos = -1; // pointer into slideshowShuffleHistory
let slideshowTimer = null;
let slideshowPaused = false;
let slideshowShuffled = false;
let slideshowActiveLayer = "a";
const SLIDESHOW_INTERVAL_MS = 4000;

function collectSlideshowPhotos(sourceEntries) {
  const photos = [];
  const sorted = [...sourceEntries].sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date));
  for (const e of sorted) {
    if (e.photos && e.photos.length) {
      e.photos.forEach(p => photos.push({ url: p.url, caption: e.caption || e.title || "" }));
    } else if (e.category === "thennow") {
      if (e.thenPhoto) photos.push({ url: e.thenPhoto.url, caption: e.thenLabel || "Then" });
      if (e.nowPhoto) photos.push({ url: e.nowPhoto.url, caption: e.nowLabel || "Now" });
    } else if (e.category === "pregnancy" && e.subtype === "bump" && e.weeks && e.weeks.length) {
      [...e.weeks].sort((a, b) => a.week - b.week).forEach(w => {
        if (w.photo) photos.push({ url: w.photo.url, caption: `Week ${w.week}` });
      });
    } else if (e.category === "firstyear" && e.months && e.months.length) {
      [...e.months].sort((a, b) => a.monthIndex - b.monthIndex).forEach(m => {
        if (m.photo) photos.push({ url: m.photo.url, caption: m.label });
      });
    }
  }
  return photos;
}

function currentSlideshowPhotoIndex() {
  return slideshowShuffled ? slideshowShuffleHistory[slideshowHistoryPos] : slideshowIndex;
}

export function openSlideshow(sourceEntries) {
  const photos = collectSlideshowPhotos(sourceEntries);
  if (photos.length === 0) {
    showToast("No photos to show yet");
    return;
  }
  slideshowSourceEntries = sourceEntries;
  slideshowPhotos = photos;
  slideshowIndex = 0;
  slideshowShuffleHistory = [];
  slideshowHistoryPos = -1;
  slideshowPaused = false;
  slideshowShuffled = false;
  slideshowActiveLayer = "a";
  document.getElementById("slideshowImgA").classList.remove("active");
  document.getElementById("slideshowImgB").classList.remove("active");
  document.getElementById("slideshowShuffleBtn").classList.remove("active");
  document.getElementById("slideshowPauseBtn").innerHTML = icon("pause");

  document.getElementById("slideshowOverlay").classList.remove("minimal");
  document.getElementById("slideshowOverlay").classList.add("open");
  lockBodyScroll();
  enterSlideshowFullscreenAndUnlockRotation();
  renderSlideshowFrame();
  startSlideshowTimer();
}

function closeSlideshow() {
  clearInterval(slideshowTimer);
  document.getElementById("slideshowOverlay").classList.remove("open");
  unlockBodyScroll();
  exitSlideshowFullscreen();
}

function enterSlideshowFullscreenAndUnlockRotation() {
  const el = document.getElementById("slideshowOverlay");
  const req = el.requestFullscreen ? el.requestFullscreen.bind(el) : (el.webkitRequestFullscreen ? el.webkitRequestFullscreen.bind(el) : null);
  if (!req) return; // Fullscreen API unsupported here — slideshow still plays, just stays portrait-locked
  req().then(() => {
    if (screen.orientation && screen.orientation.unlock) {
      try { screen.orientation.unlock(); } catch (e) { /* non-fatal */ }
    }
  }).catch(() => { /* permission denied or blocked — non-fatal */ });
}

function exitSlideshowFullscreen() {
  if (document.fullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  }
}

function renderSlideshowFrame() {
  const idx = currentSlideshowPhotoIndex();
  const photo = slideshowPhotos[idx];
  const showLayer = slideshowActiveLayer === "a" ? "b" : "a";
  const imgShow = document.getElementById(`slideshowImg${showLayer.toUpperCase()}`);
  const imgHide = document.getElementById(`slideshowImg${slideshowActiveLayer.toUpperCase()}`);
  imgShow.src = photo.url;
  imgShow.classList.add("active");
  imgHide.classList.remove("active");
  slideshowActiveLayer = showLayer;

  document.getElementById("slideshowCaption").textContent = photo.caption || "";
  // In shuffle mode, "position in the original order" isn't meaningful — a
  // random walk can revisit the deck indefinitely — so the counter/progress
  // wrap around the deck size instead of trying to represent absolute progress.
  const posForDisplay = slideshowShuffled ? (slideshowHistoryPos % slideshowPhotos.length) : idx;
  document.getElementById("slideshowCounter").textContent = `${posForDisplay + 1} / ${slideshowPhotos.length}`;
  const pct = slideshowPhotos.length > 1 ? (posForDisplay / (slideshowPhotos.length - 1)) * 100 : 100;
  document.getElementById("slideshowProgressFill").style.width = `${pct}%`;
}

function slideshowNext() {
  if (slideshowShuffled) {
    if (slideshowHistoryPos < slideshowShuffleHistory.length - 1) {
      // Stepping forward into a spot we've already visited (because the
      // person went back earlier) — replay it rather than re-randomizing.
      slideshowHistoryPos++;
    } else {
      let nextIdx = slideshowPhotos.length;
      do {
        nextIdx = Math.floor(Math.random() * slideshowPhotos.length);
      } while (nextIdx === slideshowShuffleHistory[slideshowHistoryPos] && slideshowPhotos.length > 1);
      slideshowShuffleHistory.push(nextIdx);
      slideshowHistoryPos++;
    }
  } else {
    slideshowIndex = (slideshowIndex + 1) % slideshowPhotos.length;
  }
  renderSlideshowFrame();
}

function slideshowPrev() {
  if (slideshowShuffled) {
    if (slideshowHistoryPos > 0) slideshowHistoryPos--; // step back through actual shuffle history, no wraparound
  } else {
    slideshowIndex = (slideshowIndex - 1 + slideshowPhotos.length) % slideshowPhotos.length;
  }
  renderSlideshowFrame();
}

function startSlideshowTimer() {
  clearInterval(slideshowTimer);
  if (slideshowPaused) return;
  slideshowTimer = setInterval(slideshowNext, SLIDESHOW_INTERVAL_MS);
}

function toggleSlideshowPause() {
  slideshowPaused = !slideshowPaused;
  document.getElementById("slideshowPauseBtn").innerHTML = slideshowPaused ? icon("play") : icon("pause");
  startSlideshowTimer();
}

function toggleSlideshowShuffle() {
  const currentIdx = currentSlideshowPhotoIndex();
  slideshowShuffled = !slideshowShuffled;
  document.getElementById("slideshowShuffleBtn").classList.toggle("active", slideshowShuffled);
  if (slideshowShuffled) {
    // Start a fresh random walk, jumping immediately to a new photo so it's
    // obvious shuffle actually took effect rather than reordering silently.
    let startIdx = currentIdx;
    if (slideshowPhotos.length > 1) {
      do {
        startIdx = Math.floor(Math.random() * slideshowPhotos.length);
      } while (startIdx === currentIdx);
    }
    slideshowShuffleHistory = [startIdx];
    slideshowHistoryPos = 0;
  } else {
    // Drop back into chronological order at wherever this photo actually
    // sits, so turning shuffle off doesn't itself cause a jump.
    slideshowIndex = currentIdx;
  }
  renderSlideshowFrame();
  startSlideshowTimer();
}

// getEntriesFn: a callback returning "whatever entries should populate the
// slideshow when the header ▶ button is tapped" (i.e. app.js's
// getFilteredEntries) — the only piece of outside app state this module needs.
export function initSlideshow(getEntriesFn) {
  document.getElementById("slideshowBtn").addEventListener("click", () => openSlideshow(getEntriesFn()));
  document.getElementById("slideshowClose").addEventListener("click", closeSlideshow);
  document.getElementById("slideshowMinimalClose").addEventListener("click", closeSlideshow);
  document.getElementById("slideshowMinimalToggle").addEventListener("click", () => {
    document.getElementById("slideshowOverlay").classList.toggle("minimal");
  });
  document.getElementById("slideshowPauseBtn").addEventListener("click", toggleSlideshowPause);
  document.getElementById("slideshowShuffleBtn").addEventListener("click", toggleSlideshowShuffle);
  document.getElementById("slideshowTapPrev").addEventListener("click", () => { slideshowPrev(); startSlideshowTimer(); });
  document.getElementById("slideshowTapNext").addEventListener("click", () => { slideshowNext(); startSlideshowTimer(); });
  document.getElementById("slideshowTapPause").addEventListener("click", toggleSlideshowPause);
  // Exiting native fullscreen (e.g. via the OS back gesture) should behave
  // the same as tapping the close button, not leave the overlay stranded.
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && document.getElementById("slideshowOverlay").classList.contains("open")) {
      closeSlideshow();
    }
  });
}
