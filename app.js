// ============================================================
// Mason's Book — app.js
// ============================================================

import {
  collection, addDoc, updateDoc, deleteDoc, doc, setDoc,
  onSnapshot, query, orderBy, where, serverTimestamp, getDocs, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import {
  signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  MONTH_NAMES, parseLocalDate, calcAge, formatDate, formatTripDateRange, computeBirthdayNumber,
  escapeHtml, getVal, isHeicFile, convertHeicIfNeeded, showToast,
  lockBodyScroll, unlockBodyScroll
} from "./utils.js";
import { openSlideshow, initSlideshow } from "./slideshow.js";
import { icon } from "./icons.js";
import { state } from "./state.js";
import { db, storage, auth } from "./firebase.js";
import {
  listenToTrips, tripsSummary, tripsSectionBodyHtml, tripChipsInnerHtml,
  bindTripChipEvents, createNewTripInline, renderTripCard, openTripDetail,
  renderTripDetail, openTripEditForm, saveTripEdit, confirmDeleteTrip, deleteTrip
} from "./trips.js";

// ---- Kids list (stored in Firestore /kids collection, managed from the
// "Manage kids" gear icon in edit mode — no code changes needed to add one) ----
let KIDS = [];

// ---- PIN config ----
// Simple client-side gate (not a security boundary — see README).
// Change this to whatever 4-6 digit PIN you and Rachel want.
const EDIT_PIN = "123456"; // ⚠️ CHANGE THIS before sharing the edit link with anyone
const DEVICE_AUTH_KEY = "masonsbook_device_authed";

// ---- Category definitions ----
const CATEGORIES = {
  photo:      { label: "Photo",        emoji: "📷", tagLabel: "Photo" },
  funnything: { label: "Quotes",  emoji: "😂", tagLabel: "Said" },
  milestone:  { label: "Milestone",    emoji: "⭐", tagLabel: "Milestone" },
  stat:       { label: "Stat",         emoji: "📏", tagLabel: "Stat" },
  birthday:   { label: "Birthday",     emoji: "🎂", tagLabel: "Birthday" },
  letter:     { label: "Letter",       emoji: "✉️", tagLabel: "Letter" },
  pregnancy:  { label: "Pregnancy",    emoji: "🤰", tagLabel: "Pregnancy" },
  birth:      { label: "Birth Day",    emoji: "👶", tagLabel: "Birth Day" },
  thennow:    { label: "Then vs. Now", emoji: "↔️", tagLabel: "Then vs. Now" },
  firstyear:  { label: "First Year",   emoji: "🎞️", tagLabel: "First Year" },
  sonogram:   { label: "Sonogram",     emoji: "🩻", tagLabel: "Sonogram" }
};

const MILESTONE_SUGGESTIONS = [
  "First smile", "First laugh", "Rolled over", "Sat up", "First tooth",
  "Crawled", "First steps", "First word", "Slept through the night", "First haircut"
];

const PREGNANCY_SUBTYPES = {
  update:  { label: "Update",  emoji: "📝" },
  craving: { label: "Craving", emoji: "🍽️" },
  symptom: { label: "Symptom", emoji: "💭" },
  scan:    { label: "Scan",    emoji: "🩻" },
  bump:    { label: "Bump Progression", emoji: "📈" }
};

// Fixed 13-checkpoint timeline for the First Year photo progression — unlike
// Bump Progression's open-ended weekly log, this is a bounded set you fill
// in over the year, so the form shows all 13 slots up front.
const FIRST_YEAR_MONTHS = [
  { idx: 0, label: "Birth" },
  { idx: 1, label: "1 Month" },
  { idx: 2, label: "2 Months" },
  { idx: 3, label: "3 Months" },
  { idx: 4, label: "4 Months" },
  { idx: 5, label: "5 Months" },
  { idx: 6, label: "6 Months" },
  { idx: 7, label: "7 Months" },
  { idx: 8, label: "8 Months" },
  { idx: 9, label: "9 Months" },
  { idx: 10, label: "10 Months" },
  { idx: 11, label: "11 Months" },
  { idx: 12, label: "12 Months" }
];

// ---- State ----
let activeKidFilter = "all";
let activeCategoryFilter = "all";
let activeYearFilter = "all";
let activeMonthFilter = "all";
let TAGS = []; // user-created tags, shared via Firestore, e.g. "Doctor Visit", "Grandma's House"
let activeTagFilters = []; // multi-select: entry matches if it has ANY of these tags
let expandedFilterSections = { people: false, type: false, dates: false };
let selectedType = null;
let pendingPhotos = []; // File objects staged for upload in the add sheet
let editingEntryId = null; // if set, add sheet is in "edit existing" mode
let editingPhotos = []; // existing photos on the entry currently being added/edited (removable)
let removedPhotoPaths = []; // storage paths to actually delete once the save succeeds
let newUploadPathsThisSave = []; // paths uploaded during the current save attempt — cleaned up if the save fails partway through
let pendingPhotoMeta = []; // {location, people} kept index-aligned with pendingPhotos
let thenNowPending = { then: null, now: null }; // staged Files for the Then/Now slider, keyed by side
let thenNowExisting = { then: null, now: null }; // already-uploaded {url, path} photos when editing
let thenNowFocal = { then: { x: 50, y: 50 }, now: { x: 50, y: 50 } }; // object-position focal point per side, as percentages
let firstYearPending = {}; // { [monthIdx]: File } staged photos not yet uploaded
let firstYearExisting = {}; // { [monthIdx]: {url, path} } already-uploaded photos when editing
let bumpWeekRows = []; // [{week, date, existingPhoto, pendingFile}] for the Bump Progression pregnancy sub-type
let taggingPhotoRef = null; // { source: 'existing'|'pending', index } — which photo the tag editor is open on
let hiddenCategoryIds = [];  // categories toggled off from the add-moment grid, shared via Firestore

// ============================================================
// INIT
// ============================================================

// ============================================================
// BODY SCROLL LOCK
// ============================================================
// While any overlay/sheet is open, the background page must not scroll —
// if it can, touch gestures become ambiguous between "scroll the page"
// and "tap something in the modal," which can make taps silently fail to
// register. Reference-counted so nested overlays (e.g. the photo tag
// editor opening on top of the entry form) don't unlock prematurely.
function init() {
  updateHeaderSub();
  updateFiltersButtonBadge();
  checkEditRoute();
  listenToKids();
  listenToCategoryConfig();
  listenToTags();
  listenToTrips();
  listenToEntries();
  registerServiceWorker();
  bindGlobalEvents();
  initSlideshow(getFilteredEntries);
}

function listenToTags() {
  const tagsCol = collection(db, "tags");
  // Seed the reserved "Private" tag once, if it doesn't exist yet. Its id is
  // fixed ("private") so the Firestore rule can reliably key off it.
  getDoc(doc(tagsCol, "private")).then(snap => {
    if (!snap.exists()) {
      setDoc(doc(tagsCol, "private"), { name: "Private", isPrivate: true })
        .catch(err => console.warn("Private tag seed skipped:", err));
    }
  });
  const q = query(tagsCol, orderBy("name", "asc"));
  onSnapshot(q, (snapshot) => {
    TAGS = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderFeed(); // tag pills on cards depend on TAGS being loaded
  }, (err) => console.error("Tags listen error:", err));
}

function listenToCategoryConfig() {
  onSnapshot(doc(db, "settings", "categoryConfig"), (snap) => {
    const data = snap.exists() ? snap.data() : {};
    hiddenCategoryIds = data.hidden || [];
    renderFeed();
  }, (err) => console.error("Category config listen error:", err));
}

async function listenToKids() {
  const kidsCol = collection(db, "kids");
  // One-time seed: if no kids exist yet, create Mason so existing entries
  // tagged "mason" keep working. Safe to run every load — it no-ops once seeded.
  const snap = await getDocs(kidsCol);
  if (snap.empty) {
    await setDoc(doc(db, "kids", "mason"), {
      name: "Mason", birthdate: "2026-11-24", order: 0
    }).catch(err => console.warn("Seed skipped (likely no write access yet):", err));
  }
  const q = query(kidsCol, orderBy("order", "asc"));
  onSnapshot(q, (snapshot) => {
    KIDS = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    updateHeaderSub();
    renderFeed();
  }, (err) => console.error("Kids listen error:", err));
}

function checkEditRoute() {
  bindWordmarkEditTrigger();

  const deviceAuthed = localStorage.getItem(DEVICE_AUTH_KEY) === "true";
  const isInstalledApp = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

  // Auto-elevating into edit mode without needing a URL only applies to the
  // installed home-screen app — that's specifically YOUR device staying
  // logged in, like a native app would. A regular browser tab — including
  // the plain shareable link — should always start in view mode, even on a
  // device that's proven the PIN before, so that link keeps working as the
  // "view as a guest" experience it's meant to be.
  if (isInstalledApp && deviceAuthed) {
    enterEditMode();
    return;
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get("edit") === "1") {
    if (deviceAuthed) {
      enterEditMode();
    } else {
      openPinScreen();
    }
  }
}

// Installed/standalone PWAs hide the address bar, so there's no way to type
// ?edit=1 once the app is on the home screen. Tapping the wordmark 5 times
// within 2 seconds gets you the same PIN screen (or straight into edit mode
// if this device is already remembered) without needing a URL at all.
let wordmarkTapCount = 0;
let wordmarkTapTimer = null;
function bindWordmarkEditTrigger() {
  document.getElementById("wordmark").addEventListener("click", () => {
    if (state.isEditMode) return; // already in
    wordmarkTapCount++;
    clearTimeout(wordmarkTapTimer);
    wordmarkTapTimer = setTimeout(() => { wordmarkTapCount = 0; }, 2000);
    if (wordmarkTapCount >= 5) {
      wordmarkTapCount = 0;
      const deviceAuthed = localStorage.getItem(DEVICE_AUTH_KEY) === "true";
      if (deviceAuthed) {
        enterEditMode();
      } else {
        openPinScreen();
      }
    }
  });
}

function enterEditMode() {
  state.isEditMode = true;
  document.getElementById("modeBadge").textContent = "Edit mode";
  document.getElementById("modeBadge").classList.add("edit");
  document.getElementById("fabAddMini").style.display = "flex";
  document.getElementById("manageKidsBtn").style.display = "flex";
  document.getElementById("backupBtn").style.display = "flex";
  signInAnonymously(auth)
    .then(() => {
      // Only now is request.auth actually populated server-side, so only
      // now can we safely re-subscribe with the unrestricted query.
      listenToEntries();
      migrateLegacyPrivacyField();
    })
    .catch(err => console.error("Auth error:", err));
  checkBackupReminder();
  renderFeed();
}

async function migrateLegacyPrivacyField() {
  // One-time backfill: entries created before the Private-tag feature existed
  // have no isPrivate field at all, which means they won't match the
  // view-mode query's `where("isPrivate", "==", false)` filter and would
  // silently vanish from the public feed. This fills that field in so they
  // keep showing up. Safe to run repeatedly — it's a no-op once done.
  try {
    const snap = await getDocs(collection(db, "entries"));
    const updates = [];
    snap.forEach(d => {
      if (!("isPrivate" in d.data())) {
        updates.push(updateDoc(doc(db, "entries", d.id), { isPrivate: false }));
      }
    });
    if (updates.length > 0) {
      await Promise.all(updates);
      console.log(`Backfilled isPrivate on ${updates.length} legacy entries.`);
    }
  } catch (err) {
    console.warn("Legacy privacy migration skipped:", err);
  }
}

// ============================================================
// FIRESTORE LISTENERS
// ============================================================

let unsubscribeEntriesListener = null;

function listenToEntries() {
  // Unsubscribe any existing listener first — this gets called again once
  // edit mode unlocks, so we can switch from the restricted public query to
  // the full one without needing a page reload.
  if (unsubscribeEntriesListener) {
    unsubscribeEntriesListener();
    unsubscribeEntriesListener = null;
  }

  const entriesCol = collection(db, "entries");
  // Edit mode (signed in) sees everything. View mode only gets entries
  // explicitly marked isPrivate == false — this is a real query filter,
  // not just a rule condition, which is what lets Firestore's security
  // rules actually enforce it (rules can't silently filter a query's
  // results; the query itself has to be provably restricted).
  const q = state.isEditMode
    ? query(entriesCol, orderBy("date", "desc"))
    : query(entriesCol, where("isPrivate", "==", false), orderBy("date", "desc"));

  unsubscribeEntriesListener = onSnapshot(q, (snapshot) => {
    state.entries = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    updateFiltersButtonBadge();
    renderFeed();
  }, (err) => {
    console.error("Firestore listen error:", err);
    document.getElementById("feed").innerHTML =
      `<div class="feed-empty">Couldn't load entries. Check your connection.</div>`;
  });
}

// ============================================================
// TABS + FILTER PILLS
// ============================================================

function updateHeaderSub() {
  const sub = document.getElementById("headerSub");
  if (activeKidFilter === "all") {
    sub.textContent = "Family Feed";
  } else {
    const kid = KIDS.find(k => k.id === activeKidFilter);
    sub.textContent = kid ? `${kid.name}'s Book` : "Feed";
  }
  renderCountdownBanner();
  renderActiveFilterBar();
}

// Small pill above the feed summarizing any active filter(s), with a one-tap
// clear — so tapping a hashtag (which applies a filter) doesn't strand the
// person without an easy way back to the full feed.
function renderActiveFilterBar() {
  const bar = document.getElementById("activeFilterBar");
  if (!bar) return;
  const parts = [];
  if (activeKidFilter !== "all") parts.push(peopleSummary());
  if (activeCategoryFilter !== "all") parts.push(typeSummary());
  if (activeYearFilter !== "all") parts.push(datesSummary());
  if (activeTagFilters.length > 0) parts.push(tagsSummary());

  if (parts.length === 0) {
    bar.style.display = "none";
    bar.innerHTML = "";
    return;
  }

  bar.innerHTML = `
    <button type="button" class="active-filter-summary" id="activeFilterOpenBtn">🔎 ${escapeHtml(parts.join(" · "))}</button>
    <button type="button" class="active-filter-clear" id="activeFilterClearBtn" aria-label="Clear filters" title="Clear filters">✕</button>`;
  bar.style.display = "flex";

  document.getElementById("activeFilterOpenBtn").addEventListener("click", () => {
    expandedFilterSections.tags = activeTagFilters.length > 0;
    openFiltersSheet();
  });
  document.getElementById("activeFilterClearBtn").addEventListener("click", () => {
    clearAllFilters();
  });
}

// ---- Countdown banner: weeks until arrival, flipping to age after birth ----
// Like On This Day, this belongs to the unfiltered family view — a per-kid
// filtered feed is a deliberate narrow slice.
function renderCountdownBanner() {
  const el = document.getElementById("countdownBanner");
  if (!el) return;
  // Same rule as On This Day: the countdown only belongs on the fully
  // unfiltered family view. Any active filter (kid, category, date, or tag —
  // e.g. tapping a hashtag) means the person is deliberately looking at a
  // narrow slice, and the arrival countdown has no bearing on that slice.
  const anyFilterActive = activeKidFilter !== "all" || activeCategoryFilter !== "all" ||
    activeYearFilter !== "all" || activeMonthFilter !== "all" || activeTagFilters.length > 0;
  if (anyFilterActive || KIDS.length === 0) {
    el.style.display = "none";
    return;
  }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const lines = [];
  for (const k of KIDS) {
    if (!k.birthdate) continue;
    const due = parseLocalDate(k.birthdate);
    if (isNaN(due)) continue;
    const days = Math.round((due - today) / 86400000);
    if (days > 1) {
      const main = days <= 13
        ? `${k.name} arrives in ${days} days!`
        : `${k.name} arrives in ~${Math.round(days / 7)} weeks`;
      lines.push({ emoji: "🍼", main, sub: `Due ${formatDate(k.birthdate)}` });
    } else if (days === 1) {
      lines.push({ emoji: "🎉", main: `${k.name} arrives tomorrow!`, sub: `Due ${formatDate(k.birthdate)}` });
    } else if (days === 0) {
      lines.push({ emoji: "🎉", main: `${k.name} is due today!`, sub: "Any moment now…" });
    } else if (days >= -84) {
      // First ~12 weeks after the birth, the banner flips to celebrating his age.
      lines.push({ emoji: "👶", main: `${k.name} is ${calcAge(k.birthdate, todayStr)}`, sub: `Born ${formatDate(k.birthdate)}` });
    }
  }
  if (lines.length === 0) {
    el.style.display = "none";
    return;
  }
  el.innerHTML = lines.map(l => `
    <div class="countdown-row">
      <span class="countdown-emoji">${l.emoji}</span>
      <span class="countdown-lines">
        <span class="countdown-main">${escapeHtml(l.main)}</span>
        <span class="countdown-sub">${escapeHtml(l.sub)}</span>
      </span>
    </div>`).join("");
  el.style.display = "flex";
}


function getEntryYears() {
  return Array.from(new Set(
    state.entries.map(e => parseLocalDate(e.date).getFullYear()).filter(y => !isNaN(y))
  )).sort((a, b) => b - a);
}

function updateFiltersButtonBadge() {
  const badge = document.getElementById("fabBadge");
  if (!badge) return;
  const activeCount = [activeKidFilter !== "all", activeCategoryFilter !== "all", activeYearFilter !== "all", activeTagFilters.length > 0].filter(Boolean).length;
  if (activeCount > 0) {
    badge.textContent = activeCount;
    badge.style.display = "flex";
  } else {
    badge.style.display = "none";
  }
}

function openFiltersSheet() {
  renderFiltersSheet();
  document.getElementById("addSheetOverlay").classList.add("open");
  lockBodyScroll();
}

function filterByTag(tagId) {
  activeKidFilter = "all";
  activeCategoryFilter = "all";
  activeYearFilter = "all";
  activeMonthFilter = "all";
  activeTagFilters = [tagId];
  expandedFilterSections.tags = true;
  updateHeaderSub();
  updateFiltersButtonBadge();
  renderFeed();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function peopleSummary() {
  if (activeKidFilter === "all") return "Family";
  const k = KIDS.find(k => k.id === activeKidFilter);
  return k ? k.name : "Family";
}

function typeSummary() {
  if (activeCategoryFilter === "all") return "All";
  return CATEGORIES[activeCategoryFilter]?.label || "All";
}

function datesSummary() {
  if (activeYearFilter === "all") return "All dates";
  if (activeMonthFilter === "all") return `${activeYearFilter}`;
  return `${MONTH_NAMES[activeMonthFilter]} ${activeYearFilter}`;
}

function tagsSummary() {
  if (activeTagFilters.length === 0) return "All tags";
  if (activeTagFilters.length === 1) {
    const t = TAGS.find(t => t.id === activeTagFilters[0]);
    return t ? tagLabel(t) : "All tags";
  }
  return `${activeTagFilters.length} tags`;
}

function filterSectionHtml(id, title, summary, bodyHtml) {
  const expanded = !!expandedFilterSections[id];
  return `
    <div class="filter-section">
      <button type="button" class="filter-section-header" data-toggle-section="${id}">
        <span class="filter-section-title">${title}</span>
        <span class="filter-section-right">
          <span class="filter-section-summary">${summary}</span>
          <span class="filter-chevron ${expanded ? 'open' : ''}">▾</span>
        </span>
      </button>
      <div class="filter-section-body" id="section-${id}" style="display:${expanded ? 'block' : 'none'};">
        ${bodyHtml}
      </div>
    </div>`;
}

function peopleSectionBodyHtml() {
  const options = [{ id: "all", name: "Family" }, ...KIDS];
  return `<div class="chip-select">${options.map(o =>
    `<div class="chip ${activeKidFilter === o.id ? 'selected' : ''}" data-people-chip="${o.id}">${escapeHtml(o.name)}</div>`
  ).join("")}</div>`;
}

function typeSectionBodyHtml() {
  const options = [{ id: "all", label: "All" }, ...Object.entries(CATEGORIES).map(([id, c]) => ({ id, label: c.label }))];
  return `<div class="chip-select">${options.map(o =>
    `<div class="chip ${activeCategoryFilter === o.id ? 'selected' : ''}" data-type-chip="${o.id}">${escapeHtml(o.label)}</div>`
  ).join("")}</div>`;
}

function datesSectionBodyHtml() {
  const years = getEntryYears();
  if (years.length === 0) {
    return `<div style="font-size:13px; color:var(--ink-soft);">No entries yet.</div>`;
  }
  let html = `
    <div class="filter-subtle-label">Year</div>
    <div class="chip-select">
      <div class="chip ${activeYearFilter === "all" ? "selected" : ""}" data-year-chip="all">All years</div>
      ${years.map(y => `<div class="chip ${activeYearFilter === y ? "selected" : ""}" data-year-chip="${y}">${y}</div>`).join("")}
    </div>`;
  if (activeYearFilter !== "all") {
    const monthsWithEntries = Array.from(new Set(
      state.entries
        .map(e => parseLocalDate(e.date))
        .filter(d => !isNaN(d) && d.getFullYear() === activeYearFilter)
        .map(d => d.getMonth())
    )).sort((a, b) => a - b);
    html += `
      <div class="filter-subtle-label" style="margin-top:12px;">Month</div>
      <div class="chip-select">
        <div class="chip ${activeMonthFilter === "all" ? "selected" : ""}" data-month-chip="all">All months</div>
        ${monthsWithEntries.map(m => `<div class="chip ${activeMonthFilter === m ? "selected" : ""}" data-month-chip="${m}">${MONTH_NAMES[m]}</div>`).join("")}
      </div>`;
  }
  return html;
}

function tagsSectionBodyHtml() {
  if (TAGS.length === 0) {
    return `<div style="font-size:13px; color:var(--ink-soft);">No tags created yet — add one from the entry form when creating or editing a moment.</div>`;
  }
  return `<div class="chip-select">${TAGS.map(t =>
    `<div class="chip ${activeTagFilters.includes(t.id) ? 'selected' : ''}" data-tag-filter-chip="${t.id}">${escapeHtml(tagLabel(t))}</div>`
  ).join("")}</div>`;
}

function renderFiltersSheet() {
  const content = document.getElementById("addSheetContent");
  content.innerHTML = `
    <div class="sheet-title">Filters</div>
    ${filterSectionHtml("people", "👪 People", peopleSummary(), peopleSectionBodyHtml())}
    ${filterSectionHtml("type", "🏷️ Type of events", typeSummary(), typeSectionBodyHtml())}
    ${filterSectionHtml("dates", "📅 Dates", datesSummary(), datesSectionBodyHtml())}
    ${filterSectionHtml("tags", "🔖 Tags", tagsSummary(), tagsSectionBodyHtml())}
    ${filterSectionHtml("trips", "🧳 Trips", tripsSummary(), tripsSectionBodyHtml())}
    <button class="btn-primary" id="applyFiltersBtn" style="margin-top:10px;">Show results</button>
    <button class="btn-secondary" id="clearAllFiltersBtn">Clear all filters</button>
  `;
  bindFilterSectionEvents();
}

function bindFilterSectionEvents() {
  const content = document.getElementById("addSheetContent");

  content.querySelectorAll("[data-toggle-section]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.toggleSection;
      expandedFilterSections[id] = !expandedFilterSections[id];
      renderFiltersSheet();
    });
  });
  content.querySelectorAll("[data-people-chip]").forEach(chip => {
    chip.addEventListener("click", () => {
      activeKidFilter = chip.dataset.peopleChip;
      renderFiltersSheet();
    });
  });
  content.querySelectorAll("[data-type-chip]").forEach(chip => {
    chip.addEventListener("click", () => {
      activeCategoryFilter = chip.dataset.typeChip;
      renderFiltersSheet();
    });
  });
  content.querySelectorAll("[data-year-chip]").forEach(chip => {
    chip.addEventListener("click", () => {
      const val = chip.dataset.yearChip;
      activeYearFilter = val === "all" ? "all" : parseInt(val, 10);
      activeMonthFilter = "all";
      renderFiltersSheet();
    });
  });
  content.querySelectorAll("[data-month-chip]").forEach(chip => {
    chip.addEventListener("click", () => {
      const val = chip.dataset.monthChip;
      activeMonthFilter = val === "all" ? "all" : parseInt(val, 10);
      renderFiltersSheet();
    });
  });
  content.querySelectorAll("[data-tag-filter-chip]").forEach(chip => {
    chip.addEventListener("click", () => {
      const id = chip.dataset.tagFilterChip;
      activeTagFilters = activeTagFilters.includes(id)
        ? activeTagFilters.filter(t => t !== id)
        : [...activeTagFilters, id];
      renderFiltersSheet();
    });
  });
  content.querySelectorAll("[data-trip-filter-chip]").forEach(chip => {
    chip.addEventListener("click", () => {
      renderTripDetail(chip.dataset.tripFilterChip); // sheet is already open; just swap its content
    });
  });

  document.getElementById("applyFiltersBtn").addEventListener("click", () => {
    updateHeaderSub();
    updateFiltersButtonBadge();
    renderFeed();
    closeAddSheet();
  });
  document.getElementById("clearAllFiltersBtn").addEventListener("click", () => {
    clearAllFilters();
    closeAddSheet();
  });
}

function clearAllFilters() {
  activeKidFilter = "all";
  activeCategoryFilter = "all";
  activeYearFilter = "all";
  activeMonthFilter = "all";
  activeTagFilters = [];
  updateHeaderSub();
  updateFiltersButtonBadge();
  renderFeed();
}

// ============================================================
// FEED RENDERING
// ============================================================

function kidsLabel(kidIds) {
  if (!kidIds || kidIds.length === 0) return "";
  return kidIds.map(id => {
    const k = KIDS.find(k => k.id === id);
    return k ? k.name : id;
  }).join(" & ");
}

let onThisDayPool = [];        // today's month/day matches from past years, recomputed each render
let onThisDayShownIds = new Set(); // ids already surfaced this session, so "Show another" cycles instead of repeating
let onThisDayCurrentId = null; // the entry currently displayed in the widget

function getFilteredEntries() {
  return state.entries.filter(e => {
    const kidMatch = activeKidFilter === "all" || (e.kids || []).includes(activeKidFilter);
    const catMatch = activeCategoryFilter === "all" || e.category === activeCategoryFilter;
    const entryDate = parseLocalDate(e.date);
    const yearMatch = activeYearFilter === "all" || (!isNaN(entryDate) && entryDate.getFullYear() === activeYearFilter);
    const monthMatch = activeMonthFilter === "all" || (!isNaN(entryDate) && entryDate.getMonth() === activeMonthFilter);
    const tagMatch = activeTagFilters.length === 0 || (e.tags || []).some(t => activeTagFilters.includes(t));
    return kidMatch && catMatch && yearMatch && monthMatch && tagMatch;
  });
}

export function renderFeed() {
  const feedEl = document.getElementById("feed");
  let filtered = getFilteredEntries();

  // On This Day only makes sense on the completely unfiltered view — any
  // active filter (kid, category, year/month, or tags) means the person is
  // deliberately looking at a narrowed slice, and resurfacing an unrelated
  // memory there would feel like a non-sequitur.
  let onThisDayHtml = "";
  const noFiltersActive = activeKidFilter === "all" && activeCategoryFilter === "all" &&
    activeYearFilter === "all" && activeMonthFilter === "all" && activeTagFilters.length === 0;
  if (noFiltersActive) {
    onThisDayPool = computeOnThisDayPool();
    if (onThisDayPool.length > 0) {
      let currentEntry = onThisDayPool.find(e => e.id === onThisDayCurrentId);
      if (!currentEntry) currentEntry = pickOnThisDayEntry(onThisDayPool);
      onThisDayHtml = renderOnThisDayWidgetHtml(currentEntry, onThisDayPool.length);
    } else {
      onThisDayCurrentId = null;
    }
  }

  if (filtered.length === 0) {
    feedEl.innerHTML = onThisDayHtml + `
      <div class="feed-empty">
        <div class="feed-empty-emoji">🌱</div>
        <div class="feed-empty-title">Nothing here yet</div>
        <div class="feed-empty-sub">${state.isEditMode
          ? "Tap + to add the first moment — a photo, a note, or a letter to the future."
          : "The first memories will show up here soon."}</div>
      </div>`;
    bindCardEvents(feedEl);
    return;
  }

  // Entries that belong to a trip don't render individually — they collapse
  // into one Trip card (at the position of the trip's most recent matching
  // entry, since `filtered` is already sorted newest-first). Birthday entries
  // get the same treatment, grouped per kid into one scrubbable timeline.
  const seenTrips = new Set();
  const seenBirthdayKids = new Set();
  const cardsHtml = [];
  for (const e of filtered) {
    if (e.tripId) {
      if (seenTrips.has(e.tripId)) continue;
      seenTrips.add(e.tripId);
      cardsHtml.push(renderTripCard(e.tripId));
    } else if (e.category === "birthday" && e.kids && e.kids.length) {
      const kidId = e.kids[0];
      if (seenBirthdayKids.has(kidId)) continue;
      seenBirthdayKids.add(kidId);
      cardsHtml.push(renderBirthdayScrubberCard(kidId));
    } else {
      cardsHtml.push(renderCard(e));
    }
  }

  feedEl.innerHTML = onThisDayHtml + cardsHtml.join("");
  bindCardEvents(feedEl);
}

function renderBirthdayScrubberCard(kidId) {
  const kid = KIDS.find(k => k.id === kidId);
  const birthdayEntries = state.entries
    .filter(e => e.category === "birthday" && e.kids && e.kids[0] === kidId)
    .sort((a, b) => (parseInt(a.birthdayNum, 10) || 0) - (parseInt(b.birthdayNum, 10) || 0));
  if (birthdayEntries.length === 0) return "";

  return `
    <div class="card birthday-card">
      <div class="card-body">
        <div class="card-title">🎂 ${escapeHtml(kid ? kid.name : "")}'s Birthdays</div>
        <div class="birthday-scrubber" data-birthday-kid="${kidId}">
          <div class="birthday-stage">
            <img class="birthday-img" id="birthdayImgA-${kidId}" alt="">
            <img class="birthday-img" id="birthdayImgB-${kidId}" alt="">
            <div class="birthday-tap-zone left" id="birthdayTapPrev-${kidId}"></div>
            <div class="birthday-tap-zone center" id="birthdayTapView-${kidId}"></div>
            <div class="birthday-tap-zone right" id="birthdayTapNext-${kidId}"></div>
            ${state.isEditMode ? `
              <div class="card-edit-controls birthday-edit-controls">
                <button class="icon-btn" id="birthdayEditBtn-${kidId}" data-edit="" aria-label="Edit birthday">${icon("pencil")}</button>
                <button class="icon-btn danger" id="birthdayDeleteBtn-${kidId}" data-delete="" aria-label="Delete birthday">${icon("trash")}</button>
              </div>` : ""}
          </div>
          <div class="birthday-caption" id="birthdayCaption-${kidId}"></div>
          <div class="birthday-track" id="birthdayTrack-${kidId}">
            ${birthdayEntries.map(e => `<div class="birthday-tick has-photo" data-tick-num="${e.birthdayNum || ''}" title="Birthday #${e.birthdayNum || '?'}"></div>`).join("")}
          </div>
        </div>
      </div>
    </div>`;
}

// ---- On This Day: resurfaces a random past-years entry from today's date ----

function computeOnThisDayPool() {
  const today = new Date();
  return state.entries.filter(e => {
    const d = parseLocalDate(e.date);
    if (isNaN(d)) return false;
    if (d.getMonth() !== today.getMonth() || d.getDate() !== today.getDate()) return false;
    if (d.getFullYear() === today.getFullYear()) return false; // must be a past year, not today itself
    // Letters that haven't hit their unlock date yet shouldn't resurface early.
    if (e.category === "letter" && e.unlockDate) {
      const unlock = parseLocalDate(e.unlockDate);
      if (!isNaN(unlock) && unlock > today) return false;
    }
    const kidMatch = activeKidFilter === "all" || (e.kids || []).includes(activeKidFilter);
    return kidMatch;
  });
}

function pickOnThisDayEntry(pool) {
  const unseen = pool.filter(e => !onThisDayShownIds.has(e.id));
  // Once every match has been shown this session, reset so the cycle can repeat.
  const choices = unseen.length > 0 ? unseen : (onThisDayShownIds.clear(), pool);
  const picked = choices[Math.floor(Math.random() * choices.length)];
  onThisDayShownIds.add(picked.id);
  onThisDayCurrentId = picked.id;
  return picked;
}

function renderOnThisDayWidgetHtml(entry, poolSize) {
  const entryYear = parseLocalDate(entry.date).getFullYear();
  const yearsAgo = new Date().getFullYear() - entryYear;
  return `
    <div class="on-this-day-wrap" id="onThisDayWrap">
      <div class="on-this-day-header">
        <div class="on-this-day-title-group">
          <span class="on-this-day-clock" aria-hidden="true">🕰️</span>
          <div>
            <div class="on-this-day-ribbon">On This Day</div>
            <div class="on-this-day-sub">${yearsAgo} year${yearsAgo === 1 ? "" : "s"} ago today · ${formatDate(entry.date)}</div>
          </div>
        </div>
        ${poolSize > 1 ? `<button class="on-this-day-shuffle" id="onThisDayShuffleBtn" title="Show another">${icon("shuffle")}<span>Another</span></button>` : ""}
      </div>
      ${renderCard(entry)}
    </div>`;
}

export function renderCard(e) {
  const cat = CATEGORIES[e.category] || CATEGORIES.photo;
  const kidsTxt = kidsLabel(e.kids);
  const editControls = state.isEditMode ? `
    <div class="card-edit-controls">
      <button class="icon-btn" data-edit="${e.id}" aria-label="Edit entry">${icon("pencil")}</button>
      <button class="icon-btn danger" data-delete="${e.id}" aria-label="Delete entry">${icon("trash")}</button>
    </div>` : "";

  let photosHtml = "";
  if (e.category === "sonogram" && e.photos && e.photos.length) {
    // Sonograms are wide, labeled images — cropping them (the way .photo-hero
    // does) would cut off the clinic text along the edges, so they get their
    // own "film viewer" frame that always shows the full image on near-black.
    photosHtml = `<div class="sonogram-frame" data-lightbox="${e.id}" data-idx="0">
      <img src="${e.photos[0].url}" alt="Sonogram">
      ${e.weeks ? `<span class="sonogram-frame-badge">WK ${escapeHtml(String(e.weeks))}</span>` : ""}
    </div>`;
    if (e.photos.length > 1) {
      // Thumbnails promote into the spotlight on tap (data-sonogram-thumb)
      // rather than opening the lightbox — only the main frame goes fullscreen.
      photosHtml += `<div class="photo-strip">${e.photos.slice(1).map((p, i) =>
        `<div class="photo-strip-thumb" data-sonogram-thumb="${e.id}" data-idx="${i + 1}"><img src="${p.url}" alt=""></div>`
      ).join("")}</div>`;
    }
  } else if (e.photos && e.photos.length === 1) {
    photosHtml = `<div class="photo-hero" data-lightbox="${e.id}" data-idx="0"><img src="${e.photos[0].url}" alt=""></div>`;
  } else if (e.photos && e.photos.length > 1) {
    photosHtml = `<div class="photo-strip">${e.photos.map((p, i) =>
      `<div class="photo-strip-thumb" data-lightbox="${e.id}" data-idx="${i}"><img src="${p.url}" alt=""></div>`
    ).join("")}</div>`;
  }

  let ageTxt = "";
  const kidForAge = (e.kids && e.kids[0]) ? KIDS.find(k => k.id === e.kids[0]) : null;
  if (kidForAge) ageTxt = calcAge(kidForAge.birthdate, e.date);

  let body = "";
  switch (e.category) {
    case "birth":
      body = `<div class="card-title">Welcome, ${escapeHtml(e.babyName || kidsTxt || "")}</div>
              ${e.caption ? `<p class="photo-caption" style="color:rgba(246,241,231,0.85);">${escapeHtml(e.caption)}</p>` : ""}
              <div class="stat-grid">
                ${e.weight ? `<div class="stat"><span class="stat-num">${escapeHtml(e.weight)}</span><span class="stat-label">Weight</span></div>` : ""}
                ${e.length ? `<div class="stat"><span class="stat-num">${escapeHtml(e.length)}</span><span class="stat-label">Length</span></div>` : ""}
                ${e.time ? `<div class="stat"><span class="stat-num">${escapeHtml(e.time)}</span><span class="stat-label">Time</span></div>` : ""}
              </div>`;
      break;
    case "milestone":
      body = `<div class="card-title">${escapeHtml(e.title || "")}</div>
              ${e.note ? `<p class="card-text">${escapeHtml(e.note)}</p>` : ""}
              ${ageTxt ? `<span class="card-age">${ageTxt}</span>` : ""}`;
      break;
    case "funnything":
      if (e.lines && e.lines.length) {
        body = `<span class="quote-mark">"</span>
                <div class="quote-dialogue">
                  ${e.lines.map(l => `
                    <div class="quote-line">
                      <span class="quote-speaker">${escapeHtml(l.speaker || "")}:</span>
                      <span class="quote-line-text">“${escapeHtml(l.text || "")}”</span>
                    </div>`).join("")}
                </div>
                ${e.context ? `<p class="card-context">${escapeHtml(e.context)}</p>` : ""}`;
      } else {
        // Fallback for entries created before the dialogue format existed.
        body = `<span class="quote-mark">"</span>
                <div class="card-title">${escapeHtml(e.quote || "")}</div>
                ${e.context ? `<p class="card-context">${escapeHtml(e.context)}</p>` : ""}`;
      }
      break;
    case "stat":
      body = `<div class="card-title">Growth check-in</div>
              <div class="stat-grid">
                ${e.height ? `<div class="stat"><span class="stat-num">${escapeHtml(e.height)}</span><span class="stat-label">Height</span></div>` : ""}
                ${e.weight ? `<div class="stat"><span class="stat-num">${escapeHtml(e.weight)}</span><span class="stat-label">Weight</span></div>` : ""}
                ${e.headCirc ? `<div class="stat"><span class="stat-num">${escapeHtml(e.headCirc)}</span><span class="stat-label">Head</span></div>` : ""}
              </div>`;
      break;
    case "birthday":
      body = `<div class="card-title">${e.birthdayNum ? `🎉 Turned ${escapeHtml(e.birthdayNum)}` : "🎂 Birthday"}${e.theme ? ` · ${escapeHtml(e.theme)}` : ""}</div>
              ${e.note ? `<p class="card-text">${escapeHtml(e.note)}</p>` : ""}`;
      break;
    case "letter":
      body = `<div class="card-title">A letter${e.to ? ` to ${escapeHtml(kidsLabel([e.to]) || e.to)}` : ""}</div>
              ${e.from ? `<div class="card-context" style="margin-bottom:6px;">— ${escapeHtml(e.from)}</div>` : ""}
              <p class="card-text">${escapeHtml(e.text || "")}</p>
              ${e.unlockDate ? `<span class="card-age">Unlocks ${formatDate(e.unlockDate)}</span>` : ""}`;
      break;
    case "pregnancy":
      if (e.subtype === "craving" && e.cravings && e.cravings.length) {
        body = `<div class="card-title">Rachel's Cravings</div>
                <ul class="craving-bullets">
                  ${e.cravings.map(c => `<li>${escapeHtml(c)}</li>`).join("")}
                </ul>`;
      } else if (e.subtype === "bump" && e.weeks && e.weeks.length) {
        const sortedWeeks = [...e.weeks].sort((a, b) => a.week - b.week);
        const isExpanded = expandedBumpEntries.has(e.id);
        // With 2+ weeks the card leads with an autoplaying timelapse that
        // crossfades week → week (reuses the First Year scrubber styles).
        // The redundant "N updates · latest: week X" line is gone — the week
        // count lives in the toggle button instead.
        const morphHtml = sortedWeeks.length >= 2 ? `
                <div class="bump-morph" data-bumpmorph-entry="${e.id}">
                  <div class="firstyear-stage">
                    <img class="firstyear-img" id="bumpMorphImgA-${e.id}" alt="">
                    <img class="firstyear-img" id="bumpMorphImgB-${e.id}" alt="">
                    <div class="firstyear-tap-zone left" id="bumpMorphTapPrev-${e.id}"></div>
                    <div class="firstyear-tap-zone center" id="bumpMorphTapView-${e.id}"></div>
                    <div class="firstyear-tap-zone right" id="bumpMorphTapNext-${e.id}"></div>
                  </div>
                  <div class="firstyear-caption bump-morph-caption" id="bumpMorphCaption-${e.id}"></div>
                  <div class="firstyear-track" id="bumpMorphTrack-${e.id}">
                    ${sortedWeeks.map((w, i) => `<div class="firstyear-tick" data-tick-pos="${i}" title="Week ${w.week}"></div>`).join("")}
                  </div>
                </div>` : "";
        body = `<div class="card-title">Bump Progression</div>
                ${morphHtml}
                <div class="bump-strip ${isExpanded ? "expanded" : ""}" id="bumpStrip-${e.id}">
                  ${sortedWeeks.map((w, i) => `
                    <div class="bump-week-thumb" data-bump-entry="${e.id}" data-bump-idx="${i}">
                      <img src="${w.photo.url}">
                      <span class="bump-week-badge">Wk ${w.week}</span>
                    </div>`).join("")}
                </div>
                <button class="bump-toggle-btn" data-bump-toggle="${e.id}">${isExpanded ? "▴ Show as scroll" : `▾ Show all ${sortedWeeks.length} weeks`}</button>`;
      } else {
        body = `<div class="card-title">${escapeHtml(e.title || "Pregnancy update")}</div>
                ${e.caption ? `<p class="photo-caption" style="color:rgba(246,241,231,0.85);">${escapeHtml(e.caption)}</p>` : ""}`;
      }
      break;
    case "sonogram":
      body = `<div class="card-title">${escapeHtml(e.title || "Sonogram")}</div>
              ${e.caption ? `<p class="photo-caption" style="color:rgba(246,241,231,0.85);">${escapeHtml(e.caption)}</p>` : ""}`;
      break;
    case "thennow": {
      const tf = e.thenFocal || { x: 50, y: 50 };
      const nf = e.nowFocal || { x: 50, y: 50 };
      body = `<div class="card-title">${escapeHtml(e.title || "Then vs. Now")}</div>
              <div class="thennow-slider" data-thennow-entry="${e.id}">
                <img class="thennow-img thennow-now" src="${e.nowPhoto.url}" style="object-position:${nf.x}% ${nf.y}%;">
                <div class="thennow-clip">
                  <img class="thennow-img thennow-then" src="${e.thenPhoto.url}" style="object-position:${tf.x}% ${tf.y}%;">
                </div>
                <div class="thennow-handle">
                  <span class="thennow-handle-grip">⇔</span>
                </div>
                ${e.thenLabel ? `<span class="thennow-tag thennow-tag-left">${escapeHtml(e.thenLabel)}</span>` : ""}
                ${e.nowLabel ? `<span class="thennow-tag thennow-tag-right">${escapeHtml(e.nowLabel)}</span>` : ""}
              </div>
              ${e.caption ? `<p class="card-text">${escapeHtml(e.caption)}</p>` : ""}`;
      break;
    }
    case "firstyear": {
      body = `<div class="card-title">${escapeHtml(e.title || "First Year")}</div>
              <div class="firstyear-scrubber" data-firstyear-entry="${e.id}">
                <div class="firstyear-stage">
                  <img class="firstyear-img" id="firstyearImgA-${e.id}" alt="">
                  <img class="firstyear-img" id="firstyearImgB-${e.id}" alt="">
                  <div class="firstyear-tap-zone left" id="firstyearTapPrev-${e.id}"></div>
                  <div class="firstyear-tap-zone center" id="firstyearTapView-${e.id}"></div>
                  <div class="firstyear-tap-zone right" id="firstyearTapNext-${e.id}"></div>
                </div>
                <div class="firstyear-caption" id="firstyearCaption-${e.id}"></div>
                <div class="firstyear-track" id="firstyearTrack-${e.id}">
                  ${FIRST_YEAR_MONTHS.map(m => `<div class="firstyear-tick" data-tick-idx="${m.idx}" title="${m.label}"></div>`).join("")}
                </div>
              </div>`;
      break;
    }
    default: // photo
      body = `${e.caption ? `<p class="photo-caption">${escapeHtml(e.caption)}</p>` : ""}
              ${ageTxt ? `<span class="card-age">${ageTxt}</span>` : ""}`;
  }

  return `
    <div class="card ${e.category}" data-entry="${e.id}">
      <div class="card-meta">
        <span class="card-date">${formatDate(e.date)}</span>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="card-tag">${(e.category === "pregnancy" && e.subtype && PREGNANCY_SUBTYPES[e.subtype]) ? PREGNANCY_SUBTYPES[e.subtype].label : cat.tagLabel}</span>
          ${editControls}
        </div>
      </div>
      ${photosHtml}
      <div class="card-body">
        ${body}
        ${kidsTxt ? `<div class="card-kids" style="margin-top:8px;">${escapeHtml(kidsTxt)}</div>` : ""}
        ${(e.tags && e.tags.length) ? `<div class="entry-tags">${e.tags.map(tid => {
          const t = TAGS.find(x => x.id === tid);
          return t ? `<button type="button" class="entry-tag-pill" data-filter-tag="${t.id}">${t.isPrivate ? "🔒" : "#"}${escapeHtml(t.name)}</button>` : "";
        }).join("")}</div>` : ""}
      </div>
    </div>`;
}

function renderTagOverlay(photo) {
  if (!photo) return "";
  let html = "";
  if (photo.people && photo.people.length) {
    html += photo.people.map(p => `
      <div class="photo-tag-pin" style="left:${p.x}%; top:${p.y}%;">
        <span class="photo-tag-dot"></span>
        <span class="photo-tag-label">
          <span class="name">${escapeHtml(p.name)}</span>
          ${p.relationship ? `<span class="relationship">${escapeHtml(p.relationship)}</span>` : ""}
        </span>
      </div>`).join("");
  }
  if (photo.location) {
    html += `<div class="photo-location-pill">📍 ${escapeHtml(photo.location)}</div>`;
  }
  return html;
}

export function bindCardEvents(root) {
  root.querySelectorAll("[data-lightbox]").forEach(img => {
    img.addEventListener("click", () => {
      const entryId = img.dataset.lightbox;
      const idx = parseInt(img.dataset.idx, 10);
      const entry = state.entries.find(e => e.id === entryId);
      openLightbox(entry.photos, idx, entry.caption || "");
    });
  });
  // Sonogram gallery: tapping a thumbnail swaps it into the main "spotlight"
  // frame (and vice versa — the old main photo takes the thumb's place).
  // The frame's data-idx tracks which photo it currently shows, so tapping
  // the spotlight still opens the lightbox on the right image.
  root.querySelectorAll("[data-sonogram-thumb]").forEach(thumb => {
    thumb.addEventListener("click", () => {
      const frame = thumb.closest(".card").querySelector(".sonogram-frame");
      if (!frame) return;
      const frameImg = frame.querySelector("img");
      const thumbImg = thumb.querySelector("img");
      [frameImg.src, thumbImg.src] = [thumbImg.src, frameImg.src];
      [frame.dataset.idx, thumb.dataset.idx] = [thumb.dataset.idx, frame.dataset.idx];
      frame.classList.remove("sonogram-swap-flash");
      void frame.offsetWidth; // restart the CSS animation on every swap
      frame.classList.add("sonogram-swap-flash");
    });
  });
  // Single-photo heroes: portrait photos get a taller 4:5 frame so
  // faces aren't beheaded by the default 4:3 landscape crop.
  root.querySelectorAll(".photo-hero img").forEach(img => {
    const fitFrame = () => {
      if (img.naturalHeight > img.naturalWidth) img.closest(".photo-hero").classList.add("portrait");
    };
    if (img.complete && img.naturalWidth) fitFrame();
    else img.addEventListener("load", fitFrame, { once: true });
  });
  root.querySelectorAll("[data-bump-entry]").forEach(thumb => {
    thumb.addEventListener("click", () => {
      const entryId = thumb.dataset.bumpEntry;
      const idx = parseInt(thumb.dataset.bumpIdx, 10);
      const entry = state.entries.find(e => e.id === entryId);
      const sortedWeeks = [...entry.weeks].sort((a, b) => a.week - b.week);
      const photosWithCaptions = sortedWeeks.map(w => ({ ...w.photo, caption: `Week ${w.week}` }));
      openLightbox(photosWithCaptions, idx, "");
    });
  });
  root.querySelectorAll("[data-bump-toggle]").forEach(btn => {
    btn.addEventListener("click", () => {
      const entryId = btn.dataset.bumpToggle;
      const strip = document.getElementById(`bumpStrip-${entryId}`);
      const isNowExpanded = strip.classList.toggle("expanded");
      if (isNowExpanded) expandedBumpEntries.add(entryId); else expandedBumpEntries.delete(entryId);
      const weekCount = strip.querySelectorAll(".bump-week-thumb").length;
      btn.textContent = isNowExpanded ? "▴ Show as scroll" : `▾ Show all ${weekCount} weeks`;
    });
  });
  root.querySelectorAll("[data-trip-open]").forEach(card => {
    card.addEventListener("click", () => openTripDetail(card.dataset.tripOpen));
  });
  root.querySelectorAll("[data-filter-tag]").forEach(pill => {
    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      filterByTag(pill.dataset.filterTag);
    });
  });
  initThenNowSliders(root);
  initFirstYearScrubbers(root);
  initBirthdayScrubbers(root);
  initBumpMorphs(root);
  const shuffleBtn = root.querySelector("#onThisDayShuffleBtn");
  if (shuffleBtn) {
    shuffleBtn.addEventListener("click", () => {
      const entry = pickOnThisDayEntry(onThisDayPool);
      const wrap = document.getElementById("onThisDayWrap");
      wrap.outerHTML = renderOnThisDayWidgetHtml(entry, onThisDayPool.length);
      bindCardEvents(document.getElementById("onThisDayWrap"));
    });
  }
  if (state.isEditMode) {
    root.querySelectorAll("[data-edit]").forEach(btn => {
      btn.addEventListener("click", () => openEditSheet(btn.dataset.edit));
    });
    root.querySelectorAll("[data-delete]").forEach(btn => {
      btn.addEventListener("click", () => confirmDelete(btn.dataset.delete));
    });
  }
}

function initThenNowSliders(root) {
  root.querySelectorAll(".thennow-slider").forEach(slider => {
    const clip = slider.querySelector(".thennow-clip");
    const thenImg = clip.querySelector(".thennow-img");
    const handle = slider.querySelector(".thennow-handle");
    let dragging = false;

    function sizeThenImage() {
      const rect = slider.getBoundingClientRect();
      thenImg.style.width = `${rect.width}px`;
      thenImg.style.height = `${rect.height}px`;
    }
    sizeThenImage();
    window.addEventListener("resize", sizeThenImage);

    function setPosition(clientX) {
      const rect = slider.getBoundingClientRect();
      const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
      clip.style.width = `${pct}%`;
      handle.style.left = `${pct}%`;
    }

    handle.addEventListener("pointerdown", (e) => {
      dragging = true;
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      setPosition(e.clientX);
    });
    handle.addEventListener("pointerup", (e) => {
      dragging = false;
      handle.releasePointerCapture(e.pointerId);
    });
    handle.addEventListener("pointercancel", () => { dragging = false; });

    // Tapping anywhere else on the image jumps the divider straight there.
    slider.addEventListener("click", (e) => {
      if (e.target.closest(".thennow-handle")) return;
      setPosition(e.clientX);
    });
  });
}

function initFirstYearScrubbers(root) {
  root.querySelectorAll(".firstyear-scrubber").forEach(scrubber => {
    const entryId = scrubber.dataset.firstyearEntry;
    const entry = state.entries.find(en => en.id === entryId);
    const months = entry && entry.months ? [...entry.months].sort((a, b) => a.monthIndex - b.monthIndex) : [];
    if (months.length === 0) return;

    const imgA = document.getElementById(`firstyearImgA-${entryId}`);
    const imgB = document.getElementById(`firstyearImgB-${entryId}`);
    const captionEl = document.getElementById(`firstyearCaption-${entryId}`);
    const track = document.getElementById(`firstyearTrack-${entryId}`);

    // Ticks for months without a photo yet stay dim and unclickable — only
    // real checkpoints can be landed on.
    track.querySelectorAll(".firstyear-tick").forEach(tick => {
      const idx = parseInt(tick.dataset.tickIdx, 10);
      if (months.some(m => m.monthIndex === idx)) tick.classList.add("has-photo");
    });

    let activeLayer = "a";
    let pos = 0; // index into `months`

    function showMonth(newPos) {
      pos = newPos;
      const monthData = months[pos];
      const showEl = activeLayer === "a" ? imgB : imgA;
      const hideEl = activeLayer === "a" ? imgA : imgB;
      showEl.src = monthData.photo.url;
      showEl.classList.add("active");
      hideEl.classList.remove("active");
      activeLayer = activeLayer === "a" ? "b" : "a";
      captionEl.textContent = monthData.label;
      track.querySelectorAll(".firstyear-tick").forEach(t => {
        t.classList.toggle("current", parseInt(t.dataset.tickIdx, 10) === monthData.monthIndex);
      });
    }

    function snapToClientX(clientX) {
      const rect = track.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const nearestMonthIdx = Math.round(pct * 12);
      let best = months[0];
      let bestDist = Infinity;
      months.forEach(m => {
        const d = Math.abs(m.monthIndex - nearestMonthIdx);
        if (d < bestDist) { bestDist = d; best = m; }
      });
      const newPos = months.indexOf(best);
      if (newPos !== pos) showMonth(newPos);
    }

    let dragging = false;
    track.addEventListener("pointerdown", (ev) => {
      dragging = true;
      track.setPointerCapture(ev.pointerId);
      snapToClientX(ev.clientX);
      ev.stopPropagation();
    });
    track.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      snapToClientX(ev.clientX);
    });
    track.addEventListener("pointerup", (ev) => {
      dragging = false;
      track.releasePointerCapture(ev.pointerId);
    });
    track.addEventListener("pointercancel", () => { dragging = false; });

    // Tap the left/right edges of the photo to step to the adjacent
    // available month (clamped at the ends — Birth and 12 Months are firm
    // boundaries, not a loop). Tap the center to open it full-screen with
    // the usual lightbox controls, including download.
    document.getElementById(`firstyearTapPrev-${entryId}`).addEventListener("click", () => {
      if (pos > 0) showMonth(pos - 1);
    });
    document.getElementById(`firstyearTapNext-${entryId}`).addEventListener("click", () => {
      if (pos < months.length - 1) showMonth(pos + 1);
    });
    document.getElementById(`firstyearTapView-${entryId}`).addEventListener("click", () => {
      const photosForLightbox = months.map(m => ({ ...m.photo, caption: m.label }));
      openLightbox(photosForLightbox, pos, "");
    });

    showMonth(0);
  });
}

// Bump Progression timelapse: same crossfade-scrubber mechanics as the First
// Year card, plus an autoplay loop so the belly "grows" on its own while the
// card is on screen. Any manual interaction (scrub or tap) pauses the
// autoplay for a few seconds so the two never fight over the stage.
function initBumpMorphs(root) {
  root.querySelectorAll(".bump-morph").forEach(morph => {
    const entryId = morph.dataset.bumpmorphEntry;
    const entry = state.entries.find(en => en.id === entryId);
    const weeks = entry && entry.weeks ? [...entry.weeks].sort((a, b) => a.week - b.week) : [];
    if (weeks.length < 2) return;

    const imgA = document.getElementById(`bumpMorphImgA-${entryId}`);
    const imgB = document.getElementById(`bumpMorphImgB-${entryId}`);
    const captionEl = document.getElementById(`bumpMorphCaption-${entryId}`);
    const track = document.getElementById(`bumpMorphTrack-${entryId}`);

    // Preload every frame so the crossfade never flashes a half-loaded image.
    weeks.forEach(w => { const pre = new Image(); pre.src = w.photo.url; });

    let activeLayer = "a";
    let pos = 0;

    function showWeek(newPos) {
      pos = newPos;
      const showEl = activeLayer === "a" ? imgB : imgA;
      const hideEl = activeLayer === "a" ? imgA : imgB;
      showEl.src = weeks[pos].photo.url;
      showEl.classList.add("active");
      hideEl.classList.remove("active");
      activeLayer = activeLayer === "a" ? "b" : "a";
      captionEl.textContent = `Week ${weeks[pos].week}`;
      track.querySelectorAll(".firstyear-tick").forEach(t => {
        t.classList.toggle("current", parseInt(t.dataset.tickPos, 10) === pos);
      });
    }

    // ---- Autoplay: advance ~1.6s per frame, looping, only while visible ----
    const AUTOPLAY_MS = 1600;
    let timer = null;
    let paused = false;
    let resumeTimeout = null;

    function startAutoplay() {
      if (timer || paused) return;
      timer = setInterval(() => showWeek((pos + 1) % weeks.length), AUTOPLAY_MS);
    }
    function stopAutoplay() {
      clearInterval(timer);
      timer = null;
    }
    function userInteracted() {
      paused = true;
      stopAutoplay();
      clearTimeout(resumeTimeout);
      resumeTimeout = setTimeout(() => { paused = false; startAutoplay(); }, 8000);
    }

    if ("IntersectionObserver" in window) {
      new IntersectionObserver((entries) => {
        entries.forEach(en => en.isIntersecting ? startAutoplay() : stopAutoplay());
      }, { threshold: 0.4 }).observe(morph);
    } else {
      startAutoplay();
    }

    // ---- Manual scrubbing on the tick track ----
    function snapToClientX(clientX) {
      const rect = track.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const newPos = Math.round(pct * (weeks.length - 1));
      if (newPos !== pos) showWeek(newPos);
    }

    let dragging = false;
    track.addEventListener("pointerdown", (ev) => {
      dragging = true;
      track.setPointerCapture(ev.pointerId);
      snapToClientX(ev.clientX);
      userInteracted();
      ev.stopPropagation();
    });
    track.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      snapToClientX(ev.clientX);
    });
    track.addEventListener("pointerup", (ev) => {
      dragging = false;
      track.releasePointerCapture(ev.pointerId);
    });
    track.addEventListener("pointercancel", () => { dragging = false; });

    // ---- Tap zones: step at the edges, fullscreen in the center ----
    document.getElementById(`bumpMorphTapPrev-${entryId}`).addEventListener("click", () => {
      userInteracted();
      if (pos > 0) showWeek(pos - 1);
    });
    document.getElementById(`bumpMorphTapNext-${entryId}`).addEventListener("click", () => {
      userInteracted();
      if (pos < weeks.length - 1) showWeek(pos + 1);
    });
    document.getElementById(`bumpMorphTapView-${entryId}`).addEventListener("click", () => {
      const photosWithCaptions = weeks.map(w => ({ ...w.photo, caption: `Week ${w.week}` }));
      openLightbox(photosWithCaptions, pos, "");
    });

    showWeek(0);
  });
}

function initBirthdayScrubbers(root) {
  root.querySelectorAll(".birthday-scrubber").forEach(scrubber => {
    const kidId = scrubber.dataset.birthdayKid;
    const birthdayEntries = state.entries
      .filter(e => e.category === "birthday" && e.kids && e.kids[0] === kidId)
      .sort((a, b) => (parseInt(a.birthdayNum, 10) || 0) - (parseInt(b.birthdayNum, 10) || 0));
    if (birthdayEntries.length === 0) return;

    const imgA = document.getElementById(`birthdayImgA-${kidId}`);
    const imgB = document.getElementById(`birthdayImgB-${kidId}`);
    const captionEl = document.getElementById(`birthdayCaption-${kidId}`);
    const track = document.getElementById(`birthdayTrack-${kidId}`);
    const editBtn = document.getElementById(`birthdayEditBtn-${kidId}`);
    const deleteBtn = document.getElementById(`birthdayDeleteBtn-${kidId}`);

    let activeLayer = "a";
    let pos = 0; // index into birthdayEntries

    function showBirthday(newPos) {
      pos = newPos;
      const entry = birthdayEntries[pos];
      const coverUrl = entry.photos && entry.photos.length ? entry.photos[0].url : "";
      const showEl = activeLayer === "a" ? imgB : imgA;
      const hideEl = activeLayer === "a" ? imgA : imgB;
      if (coverUrl) {
        showEl.src = coverUrl;
        showEl.classList.add("active");
      }
      hideEl.classList.remove("active");
      activeLayer = activeLayer === "a" ? "b" : "a";

      const turnedTxt = entry.birthdayNum ? `🎉 Turned ${entry.birthdayNum}` : "🎉 Birthday";
      captionEl.textContent = entry.theme ? `${turnedTxt} · ${entry.theme}` : turnedTxt;

      track.querySelectorAll(".birthday-tick").forEach(t => {
        t.classList.toggle("current", t.dataset.tickNum === String(entry.birthdayNum || ""));
      });
      // Edit/delete always act on whichever birthday is currently displayed.
      if (editBtn) editBtn.dataset.edit = entry.id;
      if (deleteBtn) deleteBtn.dataset.delete = entry.id;
    }

    function snapToClientX(clientX) {
      const rect = track.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const newPos = Math.min(birthdayEntries.length - 1, Math.round(pct * (birthdayEntries.length - 1)));
      if (newPos !== pos) showBirthday(newPos);
    }

    let dragging = false;
    track.addEventListener("pointerdown", (ev) => {
      dragging = true;
      track.setPointerCapture(ev.pointerId);
      snapToClientX(ev.clientX);
      ev.stopPropagation();
    });
    track.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      snapToClientX(ev.clientX);
    });
    track.addEventListener("pointerup", (ev) => {
      dragging = false;
      track.releasePointerCapture(ev.pointerId);
    });
    track.addEventListener("pointercancel", () => { dragging = false; });

    // Tap left/right to step to the adjacent birthday (clamped, not looping).
    // Tap center to open every photo from that birthday in the lightbox.
    document.getElementById(`birthdayTapPrev-${kidId}`).addEventListener("click", () => {
      if (pos > 0) showBirthday(pos - 1);
    });
    document.getElementById(`birthdayTapNext-${kidId}`).addEventListener("click", () => {
      if (pos < birthdayEntries.length - 1) showBirthday(pos + 1);
    });
    document.getElementById(`birthdayTapView-${kidId}`).addEventListener("click", () => {
      const entry = birthdayEntries[pos];
      openBirthdayRecap(kidId, entry.birthdayNum);
    });

    showBirthday(0);
  });
}

// ---- Birthday Recap: the immersive, one-birthday-at-a-time detail view ----

function openBirthdayRecap(kidId, birthdayNum) {
  renderBirthdayRecap(kidId, birthdayNum);
  document.getElementById("birthdayRecapOverlay").classList.add("open");
  lockBodyScroll();
}

function closeBirthdayRecap() {
  document.getElementById("birthdayRecapOverlay").classList.remove("open");
  unlockBodyScroll();
}

function renderBirthdayRecap(kidId, birthdayNum) {
  const content = document.getElementById("birthdayRecapScroll");
  const kid = KIDS.find(k => k.id === kidId);
  const birthdayEntries = state.entries
    .filter(e => e.category === "birthday" && e.kids && e.kids[0] === kidId)
    .sort((a, b) => (parseInt(a.birthdayNum, 10) || 0) - (parseInt(b.birthdayNum, 10) || 0));
  const idx = birthdayEntries.findIndex(e => String(e.birthdayNum) === String(birthdayNum));
  const safeIdx = idx >= 0 ? idx : 0;
  const entry = birthdayEntries[safeIdx];
  if (!entry) { closeBirthdayRecap(); return; }

  const photos = entry.photos || [];
  const coverUrl = photos.length ? photos[0].url : "";
  const hasPrev = safeIdx > 0;
  const hasNext = safeIdx < birthdayEntries.length - 1;

  content.innerHTML = `
    <div class="birthday-recap-full">
      <div class="birthday-recap-hero ${coverUrl ? "" : "birthday-recap-hero-empty"}" ${coverUrl ? `style="background-image:url('${coverUrl}')"` : ""}>
        ${coverUrl ? "" : `<div class="birthday-recap-hero-emoji">🎂</div>`}
        ${birthdayEntries.length > 1 ? `<div class="birthday-recap-counter">${safeIdx + 1} of ${birthdayEntries.length}</div>` : ""}
        ${hasPrev ? `<button class="birthday-recap-hero-nav prev" id="recapPrevBtn" aria-label="Previous birthday">‹</button>` : ""}
        ${hasNext ? `<button class="birthday-recap-hero-nav next" id="recapNextBtn" aria-label="Next birthday">›</button>` : ""}
        ${state.isEditMode ? `
          <div class="birthday-recap-hero-actions">
            <button class="birthday-recap-hero-action" id="recapEditBtn" aria-label="Edit birthday">${icon("pencil")}</button>
            <button class="birthday-recap-hero-action" id="recapDeleteBtn" aria-label="Delete birthday">${icon("trash")}</button>
          </div>` : ""}
        <div class="birthday-recap-hero-content">
          <div class="birthday-recap-title">🎉 ${escapeHtml(kid ? kid.name : "")} turned ${escapeHtml(entry.birthdayNum || "?")}!</div>
          <div class="birthday-recap-hero-meta">
            ${entry.theme ? `<span class="birthday-recap-theme">${escapeHtml(entry.theme)}</span>` : ""}
            <span class="birthday-recap-meta">${formatDate(entry.date)}</span>
            ${entry.location ? `<span class="birthday-recap-meta">📍 ${escapeHtml(entry.location)}</span>` : ""}
          </div>
        </div>
      </div>
      <div class="birthday-recap-body">
        ${entry.note ? `<p class="birthday-recap-note">${escapeHtml(entry.note)}</p>` : ""}
        ${entry.attendees && entry.attendees.length ? `
          <div class="birthday-recap-section">
            <div class="birthday-recap-section-title">Who was there</div>
            <div class="chip-pills-display">${entry.attendees.map(a => `<span class="chip-pill-display">${escapeHtml(a)}</span>`).join("")}</div>
          </div>` : ""}
        ${entry.gifts && entry.gifts.length ? `
          <div class="birthday-recap-section">
            <div class="birthday-recap-section-title">🎁 Favorite gifts</div>
            <div class="chip-pills-display">${entry.gifts.map(g => `<span class="chip-pill-display">${escapeHtml(g)}</span>`).join("")}</div>
          </div>` : ""}
        ${photos.length ? `
          <div class="birthday-recap-section">
            <div class="birthday-recap-section-title">Photos</div>
            <div class="birthday-recap-gallery ${photos.length >= 3 ? "mosaic" : ""}">
              ${photos.map((p, i) => `<div class="birthday-recap-gallery-tile" data-lightbox="${entry.id}" data-idx="${i}"><img src="${p.url}" alt=""></div>`).join("")}
            </div>
          </div>` : ""}
      </div>
    </div>
  `;
  content.scrollTop = 0; // switching birthdays always lands back at the hero

  bindCardEvents(content); // wires up the [data-lightbox] gallery tiles
  if (hasPrev) {
    document.getElementById("recapPrevBtn").addEventListener("click", () => {
      renderBirthdayRecap(kidId, birthdayEntries[safeIdx - 1].birthdayNum);
    });
  }
  if (hasNext) {
    document.getElementById("recapNextBtn").addEventListener("click", () => {
      renderBirthdayRecap(kidId, birthdayEntries[safeIdx + 1].birthdayNum);
    });
  }
  if (state.isEditMode) {
    // The entry form opens in the shared sheet, which sits *below* this
    // overlay — so leave full-screen mode first or the form would be hidden.
    document.getElementById("recapEditBtn").addEventListener("click", () => { closeBirthdayRecap(); openEditSheet(entry.id); });
    document.getElementById("recapDeleteBtn").addEventListener("click", () => { closeBirthdayRecap(); confirmDelete(entry.id); });
  }
}


let expandedBumpEntries = new Set(); // entry IDs currently showing the full grid instead of the scroll strip
let lightboxPhotos = [];
let lightboxIdx = 0;
let lightboxCaption = "";
let lightboxTagsVisible = false;

function openLightbox(photos, idx, caption) {
  lightboxPhotos = photos;
  lightboxIdx = idx;
  lightboxCaption = caption;
  lightboxTagsVisible = false; // always start hidden — deliberate tap required to reveal
  updateLightbox();
  document.getElementById("lightbox").classList.add("open");
  lockBodyScroll();
}
function updateLightbox() {
  const photo = lightboxPhotos[lightboxIdx];
  document.getElementById("lightboxImg").src = photo.url;
  document.getElementById("lightboxTagLayer").innerHTML = lightboxTagsVisible ? renderTagOverlay(photo) : "";
  const hasTags = (photo.people && photo.people.length > 0) || photo.location;
  const tagsBtn = document.getElementById("lightboxTagsBtn");
  tagsBtn.style.display = hasTags ? "flex" : "none";
  tagsBtn.innerHTML = `${icon("tag")}<span>${lightboxTagsVisible ? "Hide" : "Show"} tags</span>`;
  const cap = photo.caption || lightboxCaption || "";
  document.getElementById("lightboxCaption").textContent = cap;
  const showNav = lightboxPhotos.length > 1;
  document.getElementById("lightboxPrev").style.display = showNav ? "block" : "none";
  document.getElementById("lightboxNext").style.display = showNav ? "block" : "none";
}
function closeLightbox() {
  document.getElementById("lightbox").classList.remove("open");
  unlockBodyScroll();
}

function lightboxGoPrev() {
  if (lightboxPhotos.length <= 1) return;
  lightboxIdx = (lightboxIdx - 1 + lightboxPhotos.length) % lightboxPhotos.length;
  updateLightbox();
}
function lightboxGoNext() {
  if (lightboxPhotos.length <= 1) return;
  lightboxIdx = (lightboxIdx + 1) % lightboxPhotos.length;
  updateLightbox();
}

async function downloadCurrentPhoto() {
  const btn = document.getElementById("lightboxDownload");
  const originalHtml = btn.innerHTML;
  const url = lightboxPhotos[lightboxIdx].url;
  btn.textContent = "Saving...";
  btn.disabled = true;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Fetch failed");
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = `jarrett-book-${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    console.warn("Direct download failed (likely CORS), falling back to opening the image:", err);
    // Fallback: open the photo in a new tab so the person can press-and-hold to save it.
    window.open(url, "_blank");
    showToast("Opened photo — press & hold to save it");
  } finally {
    btn.innerHTML = originalHtml;
    btn.disabled = false;
  }
}

// ============================================================
// PIN SCREEN
// ============================================================

let pinInput = "";

function openPinScreen() {
  pinInput = "";
  renderPinDots();
  document.getElementById("pinError").textContent = "";
  const keypad = document.getElementById("pinKeypad");
  const keys = ["1","2","3","4","5","6","7","8","9","","0","⌫"];
  keypad.innerHTML = keys.map(k => {
    if (!k) return `<div></div>`;
    const label = k === "⌫" ? icon("backspace") : k;
    return `<button class="pin-key" data-key="${k}" aria-label="${k === "⌫" ? "Backspace" : k}">${label}</button>`;
  }).join("");
  keypad.querySelectorAll(".pin-key").forEach(btn => {
    btn.addEventListener("click", () => handlePinKey(btn.dataset.key));
  });
  document.getElementById("pinOverlay").classList.add("open");
  lockBodyScroll();
}

function handlePinKey(key) {
  if (key === "⌫") {
    pinInput = pinInput.slice(0, -1);
  } else if (pinInput.length < EDIT_PIN.length) {
    pinInput += key;
  }
  renderPinDots();
  if (pinInput.length === EDIT_PIN.length) {
    if (pinInput === EDIT_PIN) {
      localStorage.setItem(DEVICE_AUTH_KEY, "true");
      document.getElementById("pinOverlay").classList.remove("open");
      unlockBodyScroll();
      enterEditMode();
    } else {
      document.getElementById("pinError").textContent = "Incorrect PIN, try again";
      pinInput = "";
      setTimeout(renderPinDots, 300);
    }
  }
}

function renderPinDots() {
  const dotsEl = document.getElementById("pinDots");
  dotsEl.innerHTML = "";
  for (let i = 0; i < EDIT_PIN.length; i++) {
    const filled = i < pinInput.length;
    dotsEl.innerHTML += `<div class="pin-dot ${filled ? 'filled' : ''}"></div>`;
  }
}

// ============================================================
// ADD / EDIT ENTRY SHEET
// ============================================================

function openAddSheet() {
  editingEntryId = null;
  selectedType = null;
  pendingPhotos = [];
  pendingPhotoMeta = [];
  editingPhotos = [];
  removedPhotoPaths = [];
  thenNowPending = { then: null, now: null };
  thenNowExisting = { then: null, now: null };
  thenNowFocal = { then: { x: 50, y: 50 }, now: { x: 50, y: 50 } };
  firstYearPending = {};
  firstYearExisting = {};
  renderTypePicker();
  document.getElementById("addSheetOverlay").classList.add("open");
  lockBodyScroll();
}

function openEditSheet(entryId) {
  const entry = state.entries.find(e => e.id === entryId);
  if (!entry) return;
  editingEntryId = entryId;
  selectedType = entry.category;
  pendingPhotos = [];
  pendingPhotoMeta = [];
  // Deep-copy photos (including nested people arrays) so in-progress tag
  // edits don't mutate the live entry until Save is actually pressed.
  editingPhotos = entry.photos ? entry.photos.map(p => ({
    ...p,
    people: (p.people || []).map(person => ({ ...person }))
  })) : [];
  removedPhotoPaths = [];
  thenNowPending = { then: null, now: null };
  thenNowExisting = { then: entry.thenPhoto || null, now: entry.nowPhoto || null };
  thenNowFocal = { then: entry.thenFocal || { x: 50, y: 50 }, now: entry.nowFocal || { x: 50, y: 50 } };
  firstYearPending = {};
  firstYearExisting = {};
  (entry.months || []).forEach(m => { firstYearExisting[m.monthIndex] = m.photo; });
  renderEntryForm(entry);
  document.getElementById("addSheetOverlay").classList.add("open");
  lockBodyScroll();
}

export function closeAddSheet() {
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  // If a sonogram crop editor is still open, tear it down with the sheet —
  // the photos it referenced are about to be discarded anyway.
  if (cropSession) { cropQueue = []; closeCropEditor(); }
  document.getElementById("addSheetOverlay").classList.remove("open");
  unlockBodyScroll();
}

const CATEGORY_ORDER_KEY = "masonsbook_category_order";

function getCategoryOrder() {
  const defaultOrder = Object.keys(CATEGORIES);
  const stored = localStorage.getItem(CATEGORY_ORDER_KEY);
  if (!stored) return defaultOrder;
  try {
    const saved = JSON.parse(stored).filter(id => CATEGORIES[id]);
    const missing = defaultOrder.filter(id => !saved.includes(id));
    return [...saved, ...missing];
  } catch {
    return defaultOrder;
  }
}

function saveCategoryOrder(order) {
  localStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(order));
}

function renderTypePicker() {
  const content = document.getElementById("addSheetContent");
  const all = CATEGORIES;
  const order = getCategoryOrder().filter(id => !hiddenCategoryIds.includes(id) && all[id]);
  content.innerHTML = `
    <div class="sheet-title">Add a moment</div>
    <div class="type-grid" id="typeGrid">
      ${order.map(id => {
        const c = all[id];
        return `
        <div class="type-btn" data-type="${id}">
          <span class="emoji">${c.emoji}</span>
          <span>${c.label}</span>
        </div>`;
      }).join("")}
    </div>
    <button class="collapse-toggle" id="manageTypesLink" style="margin-top:6px;">${icon("settings")}<span>Manage entry types</span></button>
  `;
  content.querySelectorAll(".type-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedType = btn.dataset.type;
      renderEntryForm();
    });
  });
  document.getElementById("manageTypesLink").addEventListener("click", () => renderManageCategories());
}

function tagLabel(t) {
  return t.isPrivate ? `🔒 ${t.name}` : t.name;
}

async function addNewTagInline() {
  const input = document.getElementById("newTagInput");
  const name = input.value.trim();
  if (!name) return;
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || ("tag" + Date.now());

  const container = document.getElementById("tagChips");
  const existingChip = container.querySelector(`[data-tag="${id}"]`);
  if (existingChip) {
    // Tag already exists — just select it rather than creating a duplicate.
    existingChip.classList.add("selected");
    input.value = "";
    return;
  }

  // Optimistic UI: show the chip immediately, selected, before the write completes.
  if (!TAGS.find(t => t.id === id)) TAGS.push({ id, name });
  const chip = document.createElement("div");
  chip.className = "chip selected";
  chip.dataset.tag = id;
  chip.textContent = name;
  chip.addEventListener("click", () => chip.classList.toggle("selected"));
  container.appendChild(chip);
  input.value = "";

  try {
    await setDoc(doc(db, "tags", id), { name });
  } catch (err) {
    console.error("Add tag error:", err);
    showToast("Couldn't save tag — try again");
  }
}

function lastUsedKids() {
  const stored = localStorage.getItem("masonsbook_last_kids");
  if (stored) return JSON.parse(stored);
  return KIDS.length ? [KIDS[0].id] : [];
}

function renderEntryForm(existing) {
  const content = document.getElementById("addSheetContent");
  const cat = CATEGORIES[selectedType];
  const defaultKids = existing ? (existing.kids || []) : lastUsedKids();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const kidChips = `
    <div class="field">
      <label>Who's this about</label>
      <div class="chip-select" id="kidChips">
        ${KIDS.map(k => `<div class="chip ${defaultKids.includes(k.id) ? 'selected' : ''}" data-kid="${k.id}">${k.name}</div>`).join("")}
      </div>
    </div>`;

  const defaultTags = existing ? (existing.tags || []) : [];
  const tagChips = `
    <div class="field">
      <label>Tags (optional)</label>
      <div class="chip-select" id="tagChips">
        ${TAGS.map(t => `<div class="chip ${defaultTags.includes(t.id) ? 'selected' : ''}" data-tag="${t.id}">${escapeHtml(tagLabel(t))}</div>`).join("")}
      </div>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <input type="text" id="newTagInput" placeholder="Create a new tag..." style="flex:1;">
        <button type="button" class="btn-secondary" id="addNewTagBtn" style="width:auto; margin-top:0; padding:9px 16px; white-space:nowrap;">Add</button>
      </div>
    </div>`;

  const selectedTripId = existing ? (existing.tripId || null) : null;
  const tripChips = `
    <div class="field">
      <label>Part of a trip? (optional)</label>
      <div class="chip-select" id="tripChips">
        ${tripChipsInnerHtml(selectedTripId)}
      </div>
      <div id="newTripForm" style="display:none; margin-top:10px;">
        <div class="field"><label>Trip title</label><input type="text" id="fNewTripTitle" placeholder="e.g. Hilton Head 2026"></div>
        <div class="field"><label>Location (optional)</label><input type="text" id="fNewTripLocation" placeholder="e.g. Hilton Head Island, SC"></div>
        <div class="field-row">
          <div class="field"><label>Start date</label><input type="date" id="fNewTripStart" value="${today}"></div>
          <div class="field"><label>End date (optional)</label><input type="date" id="fNewTripEnd"></div>
        </div>
        <button type="button" class="btn-secondary" id="createTripBtn" style="width:auto; padding:9px 16px; margin-top:0;">Create trip</button>
      </div>
    </div>`;

  const dateField = `
    <div class="field">
      <label>Date</label>
      <input type="date" id="fDate" value="${existing ? existing.date : today}">
    </div>`;

  let typeFields = "";
  switch (selectedType) {
    case "birth":
      typeFields = `
        <div class="field"><label>Time of birth</label><input type="text" id="fTime" placeholder="e.g. 3:41am" value="${existing ? existing.time || "" : ""}"></div>
        <div class="field-row">
          <div class="field"><label>Weight</label><input type="text" id="fWeight" placeholder="e.g. 7lb 6oz" value="${existing ? existing.weight || "" : ""}"></div>
          <div class="field"><label>Length</label><input type="text" id="fLength" placeholder="e.g. 20in" value="${existing ? existing.length || "" : ""}"></div>
        </div>
        <div class="field"><label>Caption</label><textarea id="fCaption" placeholder="The moment we became...">${existing ? existing.caption || "" : ""}</textarea></div>
        ${photoPickerHtml(existing)}`;
      break;
    case "photo":
      typeFields = `
        ${photoPickerHtml(existing)}
        <div class="field"><label>Caption</label><textarea id="fCaption" placeholder="What's happening here?">${existing ? existing.caption || "" : ""}</textarea></div>`;
      break;
    case "funnything":
      typeFields = `
        <div class="field">
          <label>Who's talking</label>
          <div class="chip-select" id="speakerChips">
            ${KIDS.map(k => `<div class="chip" data-speaker-chip="${escapeHtml(k.name)}">${escapeHtml(k.name)}</div>`).join("")}
            <div class="chip" data-speaker-chip="Mom">Mom</div>
            <div class="chip" data-speaker-chip="Dad">Dad</div>
          </div>
        </div>
        <div id="quoteLines" class="quote-lines-editor"></div>
        <button type="button" class="collapse-toggle" id="addSpeakerLineBtn">+ Add new speaker</button>
        <button type="button" class="collapse-toggle" id="toggleContext">+ Add context</button>
        <div class="field" id="contextField" style="display:${existing && existing.context ? 'block' : 'none'};">
          <label>Context (optional)</label>
          <textarea id="fContext" placeholder="Where, when, what prompted it...">${existing ? existing.context || "" : ""}</textarea>
        </div>
        ${photoPickerHtml(existing)}`;
      break;
    case "milestone":
      typeFields = `
        <div class="field">
          <label>Milestone</label>
          <div class="milestone-suggest">
            ${MILESTONE_SUGGESTIONS.map(m => `<div class="chip" data-milestone="${escapeHtml(m)}">${m}</div>`).join("")}
          </div>
          <input type="text" id="fTitle" placeholder="Or type your own..." value="${existing ? escapeHtml(existing.title || "") : ""}">
        </div>
        <div class="field"><label>Note (optional)</label><textarea id="fNote" placeholder="Any details worth remembering...">${existing ? existing.note || "" : ""}</textarea></div>
        ${photoPickerHtml(existing)}`;
      break;
    case "stat":
      typeFields = `
        <div class="field-row">
          <div class="field"><label>Height</label><input type="text" id="fHeight" placeholder="e.g. 29in" value="${existing ? existing.height || "" : ""}"></div>
          <div class="field"><label>Weight</label><input type="text" id="fWeight" placeholder="e.g. 22lb" value="${existing ? existing.weight || "" : ""}"></div>
        </div>
        <div class="field"><label>Head circumference (optional)</label><input type="text" id="fHeadCirc" placeholder="e.g. 18in" value="${existing ? existing.headCirc || "" : ""}"></div>`;
      break;
    case "birthday":
      typeFields = `
        <div class="field-row">
          <div class="field"><label>Birthday #</label><input type="number" id="fBirthdayNum" min="1" max="18" placeholder="Auto" value="${existing ? existing.birthdayNum || "" : ""}"></div>
          <div class="field"><label>Theme</label><input type="text" id="fTheme" placeholder="e.g. Dinosaurs" value="${existing ? escapeHtml(existing.theme || "") : ""}"></div>
        </div>
        <div class="field"><label>Location (optional)</label><input type="text" id="fBirthdayLocation" placeholder="e.g. Grandma's backyard" value="${existing ? escapeHtml(existing.location || "") : ""}"></div>
        <div class="field">
          <label>Who was there (optional)</label>
          <div class="chip-pills" id="attendeesPills"></div>
          <input type="text" id="attendeesInput" placeholder="Type a name, press Enter">
        </div>
        <div class="field">
          <label>Favorite gifts (optional)</label>
          <div class="chip-pills" id="giftsPills"></div>
          <input type="text" id="giftsInput" placeholder="Type a gift, press Enter">
        </div>
        <div class="field"><label>Note / story (optional)</label><textarea id="fNote" placeholder="How the day went...">${existing ? existing.note || "" : ""}</textarea></div>
        ${photoPickerHtml(existing)}`;
      break;
    case "letter":
      typeFields = `
        <div class="field"><label>From</label><input type="text" id="fFrom" placeholder="Dad / Mom" value="${existing ? escapeHtml(existing.from || "") : ""}"></div>
        <div class="field"><label>Your letter</label><textarea id="fText" style="min-height:160px;" placeholder="Write from the heart...">${existing ? existing.text || "" : ""}</textarea></div>
        <div class="field"><label>Unlock date (optional)</label><input type="date" id="fUnlockDate" value="${existing ? existing.unlockDate || "" : ""}"></div>`;
      break;
    case "thennow":
      typeFields = `
        <div class="field"><label>Title (optional)</label><input type="text" id="fTitle" placeholder="e.g. Newborn vs. 1 Year" value="${existing ? escapeHtml(existing.title || "") : ""}"></div>
        <div class="thennow-slots">
          <div class="thennow-slot-wrap">
            <div class="thennow-slot-label">Then</div>
            <div class="thennow-form-frame" id="thenPhotoFrame">
              <img class="thennow-form-preview" id="thenPreviewImg" src="${thenNowExisting.then ? thenNowExisting.then.url : ''}" style="${thenNowExisting.then ? '' : 'display:none;'} object-position:${thenNowFocal.then.x}% ${thenNowFocal.then.y}%;">
              <div class="thennow-form-empty" id="thenPhotoEmpty" style="${thenNowExisting.then ? 'display:none;' : ''}">Tap 📷 to add a photo</div>
              <div class="thennow-form-hint" id="thenPhotoHint" style="${thenNowExisting.then ? '' : 'display:none;'}">↔ Drag to reposition</div>
              <label class="thennow-form-change-btn" title="Change photo">
                ${icon("camera")}
                <input type="file" accept="image/*" id="fThenPhoto" style="display:none;">
              </label>
            </div>
            <input type="text" id="fThenLabel" placeholder="e.g. Newborn" value="${existing ? escapeHtml(existing.thenLabel || "") : ""}">
          </div>
          <div class="thennow-slot-wrap">
            <div class="thennow-slot-label">Now</div>
            <div class="thennow-form-frame" id="nowPhotoFrame">
              <img class="thennow-form-preview" id="nowPreviewImg" src="${thenNowExisting.now ? thenNowExisting.now.url : ''}" style="${thenNowExisting.now ? '' : 'display:none;'} object-position:${thenNowFocal.now.x}% ${thenNowFocal.now.y}%;">
              <div class="thennow-form-empty" id="nowPhotoEmpty" style="${thenNowExisting.now ? 'display:none;' : ''}">Tap 📷 to add a photo</div>
              <div class="thennow-form-hint" id="nowPhotoHint" style="${thenNowExisting.now ? '' : 'display:none;'}">↔ Drag to reposition</div>
              <label class="thennow-form-change-btn" title="Change photo">
                ${icon("camera")}
                <input type="file" accept="image/*" id="fNowPhoto" style="display:none;">
              </label>
            </div>
            <input type="text" id="fNowLabel" placeholder="e.g. 1 Year Old" value="${existing ? escapeHtml(existing.nowLabel || "") : ""}">
          </div>
        </div>
        <div class="field"><label>Caption (optional)</label><textarea id="fCaption" placeholder="What's changed...">${existing ? existing.caption || "" : ""}</textarea></div>`;
      break;
    case "firstyear":
      typeFields = `
        <div class="field"><label>Title (optional)</label><input type="text" id="fTitle" placeholder="e.g. Mason's First Year" value="${existing ? escapeHtml(existing.title || "") : ""}"></div>
        <div class="type-hint">Fill these in as they happen — you don't need all 13 at once.</div>
        <div class="firstyear-form-rows">
          ${FIRST_YEAR_MONTHS.map(m => {
            const existingPhoto = firstYearExisting[m.idx];
            return `
            <div class="firstyear-form-row">
              <div class="bump-week-photo-slot firstyear-form-slot" id="firstYearSlot${m.idx}">
                <img class="bumpRowPreviewImg" id="firstYearPreview${m.idx}" src="${existingPhoto ? existingPhoto.url : ''}" style="${existingPhoto ? '' : 'display:none;'}">
                <label class="bump-week-photo-btn">
                  ${icon("camera")}
                  <input type="file" accept="image/*" id="firstYearFile${m.idx}" style="display:none;">
                </label>
              </div>
              <div class="firstyear-form-row-label">${m.label}</div>
            </div>`;
          }).join("")}
        </div>`;
      break;
    case "sonogram":
      // The sonogram photo is the whole point of this entry, so instead of the
      // generic file input the form leads with a drop zone: drag the image
      // straight onto the frame (or tap it to browse). Files land in the same
      // pendingPhotos pipeline as every other photo picker, so previews,
      // tagging, HEIC conversion, and upload all work unchanged.
      typeFields = `
        <div class="field"><label>Title</label><input type="text" id="fTitle" placeholder="e.g. 20-week anatomy scan" value="${existing ? escapeHtml(existing.title || "") : ""}"></div>
        <div class="field"><label>Week (optional)</label><input type="number" id="fWeeks" min="4" max="42" placeholder="e.g. 20" value="${existing ? existing.weeks || "" : ""}"></div>
        <div class="field">
          <label>Sonogram photo</label>
          <div class="sonogram-dropzone" id="sonogramDropzone">
            <div class="sonogram-dropzone-hint">
              ${icon("camera")}
              <span>Drop the sonogram photo here</span>
              <em>or tap to browse</em>
            </div>
          </div>
          <input type="file" id="fPhotos" accept="image/*" multiple style="display:none;">
          <div class="photo-input-preview" id="photoPreview"></div>
          <div id="sonogramReorderHint" style="font-size:11.5px; color:var(--ink-soft); margin-bottom:12px; display:none;">
            Use ‹ › to reorder — the one marked ★ Cover is the enlarged photo up top.
          </div>
        </div>
        <div class="field"><label>Caption (optional)</label><textarea id="fCaption" placeholder="What did we see...">${existing ? existing.caption || "" : ""}</textarea></div>`;
      break;
    case "pregnancy":
      typeFields = `
        <div class="field">
          <label>Type</label>
          <div class="chip-select" id="pregnancySubtypeChips">
            ${Object.entries(PREGNANCY_SUBTYPES).map(([id, s]) => `
              <div class="chip ${(existing?.subtype || 'update') === id ? 'selected' : ''}" data-subtype="${id}">${s.emoji} ${s.label}</div>
            `).join("")}
          </div>
        </div>
        <div id="pregnancyFields"></div>`;
      break;
    default: // custom user-created types
      typeFields = `
        ${photoPickerHtml(existing)}
        <div class="field"><label>Caption</label><textarea id="fCaption" placeholder="What's happening here?">${existing ? existing.caption || "" : ""}</textarea></div>`;
  }

  content.innerHTML = `
    <div class="sheet-title">${cat.emoji} ${existing ? "Edit" : "New"} ${cat.label}</div>
    ${dateField}
    ${typeFields}
    ${kidChips}
    ${tagChips}
    ${tripChips}
    <button class="btn-primary" id="saveEntryBtn">Save</button>
    <button class="btn-secondary" id="cancelEntryBtn">Cancel</button>
  `;

  // Kid chip toggling
  content.querySelectorAll("#kidChips .chip").forEach(chip => {
    chip.addEventListener("click", () => chip.classList.toggle("selected"));
  });

  // Birthday #: auto-suggest from the kid's stored birthdate + this entry's
  // date, so it's not manual guesswork — but never overwrite a value that's
  // already there (existing entry, or something the person already typed).
  if (selectedType === "birthday") {
    const numInput = document.getElementById("fBirthdayNum");
    const suggestBirthdayNumber = () => {
      if (numInput.value.trim() !== "") return;
      const kidId = document.querySelector("#kidChips .chip.selected")?.dataset.kid;
      const kid = KIDS.find(k => k.id === kidId);
      if (!kid || !kid.birthdate) return;
      const suggested = computeBirthdayNumber(kid.birthdate, document.getElementById("fDate").value);
      if (suggested) numInput.value = suggested;
    };
    content.querySelectorAll("#kidChips .chip").forEach(chip => {
      chip.addEventListener("click", suggestBirthdayNumber);
    });
    document.getElementById("fDate").addEventListener("change", suggestBirthdayNumber);
    suggestBirthdayNumber(); // covers the case where a kid is already pre-selected
  }

  // Tag chip toggling + inline new-tag creation
  content.querySelectorAll("#tagChips .chip").forEach(chip => {
    chip.addEventListener("click", () => chip.classList.toggle("selected"));
  });
  document.getElementById("addNewTagBtn").addEventListener("click", addNewTagInline);
  document.getElementById("newTagInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addNewTagInline(); }
  });

  // Trip chip toggling (single-select) + inline new-trip creation
  bindTripChipEvents();
  document.getElementById("createTripBtn").addEventListener("click", createNewTripInline);

  // Milestone suggestion chips
  content.querySelectorAll("[data-milestone]").forEach(chip => {
    chip.addEventListener("click", () => {
      document.getElementById("fTitle").value = chip.dataset.milestone;
    });
  });

  // Quote dialogue editor (Funny Thing)
  if (selectedType === "funnything") {
    initQuoteLinesEditor(existing);
  }

  // Pregnancy sub-type fields (Update / Craving / Symptom / Scan)
  if (selectedType === "pregnancy") {
    initPregnancySubtypeFields(existing);
  }

  // Then vs. Now photo slots
  if (selectedType === "thennow") {
    initThenNowFields();
  }

  // First Year: 13 fixed photo slots
  if (selectedType === "firstyear") {
    initFirstYearFields();
  }

  // Sonogram: drag-and-drop photo drop zone
  if (selectedType === "sonogram") {
    initSonogramDropzone();
  }

  // Birthday: attendees/gifts chip inputs
  if (selectedType === "birthday") {
    initChipInput("attendeesPills", "attendeesInput", existing ? existing.attendees : []);
    initChipInput("giftsPills", "giftsInput", existing ? existing.gifts : []);
  }

  // Context toggle for funny thing
  const toggleBtn = document.getElementById("toggleContext");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const f = document.getElementById("contextField");
      f.style.display = f.style.display === "none" ? "block" : "none";
    });
  }

  // Photo input handling
  const photoInput = document.getElementById("fPhotos");
  if (photoInput) {
    renderPhotoPreview();
    photoInput.addEventListener("change", (e) => {
      pendingPhotos = pendingPhotos.concat(Array.from(e.target.files));
      renderPhotoPreview();
      e.target.value = ""; // allow re-selecting the same file again later
    });
  }

  document.getElementById("cancelEntryBtn").addEventListener("click", closeAddSheet);
  document.getElementById("saveEntryBtn").addEventListener("click", saveEntry);
}

function initPregnancySubtypeFields(existing) {
  const startSubtype = existing?.subtype || "update";
  renderPregnancyFields(startSubtype, existing);

  document.getElementById("pregnancySubtypeChips").querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#pregnancySubtypeChips .chip").forEach(c => c.classList.remove("selected"));
      chip.classList.add("selected");
      renderPregnancyFields(chip.dataset.subtype, existing);
    });
  });
}

function renderPregnancyFields(subtype, existing) {
  const container = document.getElementById("pregnancyFields");
  const sameSubtypeAsExisting = existing && (existing.subtype || "update") === subtype;

  if (subtype === "craving") {
    container.innerHTML = `
      <div id="cravingList" class="quote-lines-editor"></div>
      <button type="button" class="collapse-toggle" id="addCravingBtn">+ Add craving</button>
    `;
    const seed = (sameSubtypeAsExisting && existing.cravings) ? existing.cravings : [];
    if (seed.length) {
      seed.forEach(c => addCravingRow(c));
    } else {
      addCravingRow("");
    }
    document.getElementById("addCravingBtn").addEventListener("click", () => {
      addCravingRow("");
      const rows = document.querySelectorAll("#cravingList .craving-row");
      rows[rows.length - 1].querySelector("input").focus();
    });
  } else if (subtype === "bump") {
    container.innerHTML = `
      <div id="bumpWeeksList" class="bump-weeks-editor"></div>
      <button type="button" class="collapse-toggle" id="addBumpWeekBtn">+ Add another week</button>
    `;
    bumpWeekRows = [];
    const seed = (sameSubtypeAsExisting && existing.weeks) ? existing.weeks : [];
    if (seed.length) {
      seed.forEach(w => addBumpWeekRow(w.week, w.date, w.photo));
    } else {
      addBumpWeekRow("", document.getElementById("fDate") ? document.getElementById("fDate").value : "", null);
    }
    document.getElementById("addBumpWeekBtn").addEventListener("click", () => {
      addBumpWeekRow("", "", null);
    });
  } else {
    const title = sameSubtypeAsExisting ? (existing.title || "") : "";
    const caption = sameSubtypeAsExisting ? (existing.caption || "") : "";
    container.innerHTML = `
      <div class="field"><label>Title</label><input type="text" id="fTitle" placeholder="e.g. Anatomy scan day" value="${escapeHtml(title)}"></div>
      <div class="field"><label>Caption</label><textarea id="fCaption">${escapeHtml(caption)}</textarea></div>
      ${photoPickerHtml()}
    `;
    const photoInput = document.getElementById("fPhotos");
    if (photoInput) {
      renderPhotoPreview();
      photoInput.addEventListener("change", (e) => {
        pendingPhotos = pendingPhotos.concat(Array.from(e.target.files));
        renderPhotoPreview();
        e.target.value = "";
      });
    }
  }
}

// Generic "type + Enter to add a pill" input — used for birthday attendees
// and gifts, but reusable anywhere a short freeform list is needed.
function initChipInput(pillsId, inputId, seed) {
  const pillsEl = document.getElementById(pillsId);
  const inputEl = document.getElementById(inputId);
  function addPill(text) {
    text = text.trim();
    if (!text) return;
    const pill = document.createElement("span");
    pill.className = "chip-pill";
    pill.dataset.name = text;
    pill.innerHTML = `${escapeHtml(text)} <button type="button" class="chip-pill-remove">×</button>`;
    pill.querySelector(".chip-pill-remove").addEventListener("click", () => pill.remove());
    pillsEl.appendChild(pill);
  }
  (seed || []).forEach(addPill);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addPill(inputEl.value);
      inputEl.value = "";
    }
  });
  inputEl.addEventListener("blur", () => {
    if (inputEl.value.trim()) {
      addPill(inputEl.value);
      inputEl.value = "";
    }
  });
}

function collectChipPills(pillsId) {
  return Array.from(document.getElementById(pillsId).querySelectorAll(".chip-pill")).map(p => p.dataset.name);
}

function addCravingRow(text) {
  const container = document.getElementById("cravingList");
  const row = document.createElement("div");
  row.className = "craving-row";
  row.innerHTML = `
    <input type="text" class="fCraving" placeholder="e.g. Pickles and ice cream" value="${escapeHtml(text || "")}">
    <button type="button" class="quote-line-remove" title="Remove">×</button>
  `;
  container.appendChild(row);
  row.querySelector(".quote-line-remove").addEventListener("click", () => {
    if (container.querySelectorAll(".craving-row").length > 1) {
      row.remove();
    } else {
      row.querySelector("input").value = "";
    }
  });
}

function collectCravings() {
  const rows = document.querySelectorAll("#cravingList .craving-row input");
  return Array.from(rows).map(i => i.value.trim()).filter(Boolean);
}

function addBumpWeekRow(week, date, existingPhoto) {
  const container = document.getElementById("bumpWeeksList");
  const rowData = { week: week || "", date: date || "", existingPhoto: existingPhoto || null, pendingFile: null };
  bumpWeekRows.push(rowData);
  const rowIndex = bumpWeekRows.length - 1;

  const row = document.createElement("div");
  row.className = "bump-week-row";
  row.dataset.rowIndex = rowIndex;
  row.innerHTML = `
    <div class="bump-week-photo-slot">
      <img class="bumpRowPreviewImg" src="${existingPhoto ? existingPhoto.url : ''}" style="${existingPhoto ? '' : 'display:none;'}">
      <label class="bump-week-photo-btn">
        ${icon("camera")}
        <input type="file" accept="image/*" class="bumpRowFileInput" style="display:none;">
      </label>
    </div>
    <div class="bump-week-fields">
      <div class="field-row">
        <div class="field"><label>Week</label><input type="number" min="1" max="42" class="bumpRowWeek" placeholder="e.g. 20" value="${escapeHtml(String(week || ""))}"></div>
        <div class="field"><label>Date</label><input type="date" class="bumpRowDate" value="${escapeHtml(date || "")}"></div>
      </div>
    </div>
    <button type="button" class="quote-line-remove bump-week-remove" title="Remove">×</button>
  `;
  container.appendChild(row);

  const fileInput = row.querySelector(".bumpRowFileInput");
  const previewImg = row.querySelector(".bumpRowPreviewImg");
  const photoSlot = row.querySelector(".bump-week-photo-slot");
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // A new file supersedes whatever existing photo was here — queue the old
    // Storage file for cleanup once the save actually succeeds.
    if (rowData.existingPhoto && rowData.existingPhoto.path) {
      removedPhotoPaths.push(rowData.existingPhoto.path);
      rowData.existingPhoto = null;
    }
    rowData.pendingFile = file;
    photoSlot.classList.remove("photo-selected-no-preview");
    previewImg.onerror = () => {
      // Fallback for anything that still can't render (rare, once HEIC is
      // handled) — the photo itself is still fine and will upload normally.
      previewImg.style.display = "none";
      photoSlot.classList.add("photo-selected-no-preview");
    };
    if (isHeicFile(file)) {
      convertHeicIfNeeded(file).then(converted => {
        previewImg.src = URL.createObjectURL(converted);
        previewImg.style.display = "block";
      });
    } else {
      previewImg.src = URL.createObjectURL(file);
      previewImg.style.display = "block";
    }
  });

  row.querySelector(".bump-week-remove").addEventListener("click", () => {
    if (container.querySelectorAll(".bump-week-row").length > 1) {
      if (rowData.existingPhoto && rowData.existingPhoto.path) removedPhotoPaths.push(rowData.existingPhoto.path);
      row.remove();
      bumpWeekRows[rowIndex] = null; // keep indices stable; filtered out on collect
    } else {
      if (rowData.existingPhoto && rowData.existingPhoto.path) removedPhotoPaths.push(rowData.existingPhoto.path);
      row.querySelector(".bumpRowWeek").value = "";
      row.querySelector(".bumpRowDate").value = "";
      rowData.week = ""; rowData.date = ""; rowData.existingPhoto = null; rowData.pendingFile = null;
      previewImg.style.display = "none";
    }
  });
}

async function collectBumpWeeks() {
  const rows = document.querySelectorAll("#bumpWeeksList .bump-week-row");
  const results = [];
  for (const row of rows) {
    const idx = parseInt(row.dataset.rowIndex, 10);
    const rowData = bumpWeekRows[idx];
    if (!rowData) continue;
    const week = row.querySelector(".bumpRowWeek").value.trim();
    const date = row.querySelector(".bumpRowDate").value;
    if (!week) continue; // skip incomplete rows rather than fail the whole save
    let photo = rowData.existingPhoto;
    if (rowData.pendingFile) {
      const uploaded = await uploadPhotos([rowData.pendingFile]);
      photo = uploaded[0];
    }
    if (!photo) continue; // no photo yet for this week — skip until one's added
    results.push({ week: parseInt(week, 10), date, photo });
  }
  return results.sort((a, b) => a.week - b.week);
}

function initThenNowFields() {
  bindThenNowSlot("then");
  bindThenNowSlot("now");
}

function bindThenNowSlot(side) {
  const fileInput = document.getElementById(side === "then" ? "fThenPhoto" : "fNowPhoto");
  const previewImg = document.getElementById(side === "then" ? "thenPreviewImg" : "nowPreviewImg");
  const emptyEl = document.getElementById(side === "then" ? "thenPhotoEmpty" : "nowPhotoEmpty");
  const hintEl = document.getElementById(side === "then" ? "thenPhotoHint" : "nowPhotoHint");
  const frame = document.getElementById(side === "then" ? "thenPhotoFrame" : "nowPhotoFrame");

  function applyFocal() {
    const f = thenNowFocal[side];
    previewImg.style.objectPosition = `${f.x}% ${f.y}%`;
  }

  function showPhoto(src) {
    previewImg.src = src;
    previewImg.style.display = "block";
    emptyEl.style.display = "none";
    hintEl.style.display = "block";
    applyFocal();
  }

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (thenNowExisting[side] && thenNowExisting[side].path) {
      removedPhotoPaths.push(thenNowExisting[side].path);
      thenNowExisting[side] = null;
    }
    thenNowPending[side] = file;
    thenNowFocal[side] = { x: 50, y: 50 }; // a new photo resets any prior repositioning
    previewImg.onerror = () => {
      previewImg.style.display = "none";
      emptyEl.style.display = "block";
      emptyEl.textContent = "Couldn't load that photo — try another";
    };
    if (isHeicFile(file)) {
      convertHeicIfNeeded(file).then(converted => showPhoto(URL.createObjectURL(converted)));
    } else {
      showPhoto(URL.createObjectURL(file));
    }
  });

  // Drag-to-reposition: lets you pick which part of the photo shows through
  // the crop, since most photos aren't framed with the subject dead-center.
  let dragging = false;
  let lastX, lastY;
  frame.addEventListener("pointerdown", (e) => {
    if (previewImg.style.display === "none") return; // nothing to reposition yet
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    frame.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  frame.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const rect = frame.getBoundingClientRect();
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    const f = thenNowFocal[side];
    f.x = Math.max(0, Math.min(100, f.x - (dx / rect.width) * 100));
    f.y = Math.max(0, Math.min(100, f.y - (dy / rect.height) * 100));
    applyFocal();
  });
  frame.addEventListener("pointerup", (e) => {
    dragging = false;
    frame.releasePointerCapture(e.pointerId);
  });
  frame.addEventListener("pointercancel", () => { dragging = false; });
}

function initFirstYearFields() {
  FIRST_YEAR_MONTHS.forEach(m => {
    const fileInput = document.getElementById(`firstYearFile${m.idx}`);
    const previewImg = document.getElementById(`firstYearPreview${m.idx}`);
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (firstYearExisting[m.idx] && firstYearExisting[m.idx].path) {
        removedPhotoPaths.push(firstYearExisting[m.idx].path);
        firstYearExisting[m.idx] = null;
      }
      firstYearPending[m.idx] = file;
      previewImg.onerror = () => { previewImg.style.display = "none"; };
      if (isHeicFile(file)) {
        convertHeicIfNeeded(file).then(converted => {
          previewImg.src = URL.createObjectURL(converted);
          previewImg.style.display = "block";
        });
      } else {
        previewImg.src = URL.createObjectURL(file);
        previewImg.style.display = "block";
      }
    });
  });
}

let lastFocusedSpeakerRow = null;

function initQuoteLinesEditor(existing) {
  const container = document.getElementById("quoteLines");
  lastFocusedSpeakerRow = null;

  // Seed initial rows: existing dialogue, existing old-format single quote, or one blank row.
  if (existing && existing.lines && existing.lines.length) {
    existing.lines.forEach(l => addQuoteLineRow(l.speaker, l.text));
  } else if (existing && existing.quote) {
    addQuoteLineRow("", existing.quote);
  } else {
    addQuoteLineRow(KIDS[0] ? KIDS[0].name : "", "");
  }

  document.getElementById("addSpeakerLineBtn").addEventListener("click", () => {
    addQuoteLineRow("", "");
    const rows = container.querySelectorAll(".quote-line-row");
    rows[rows.length - 1].querySelector(".fSpeaker").focus();
  });

  document.getElementById("speakerChips").querySelectorAll("[data-speaker-chip]").forEach(chip => {
    chip.addEventListener("click", () => {
      const target = lastFocusedSpeakerRow || container.querySelector(".quote-line-row:last-child");
      if (target) {
        target.querySelector(".fSpeaker").value = chip.dataset.speakerChip;
      }
    });
  });
}

function addQuoteLineRow(speaker, text) {
  const container = document.getElementById("quoteLines");
  const row = document.createElement("div");
  row.className = "quote-line-row";
  row.innerHTML = `
    <input type="text" class="fSpeaker" placeholder="Speaker" value="${escapeHtml(speaker || "")}">
    <textarea class="fLineText" placeholder="What did they say?">${escapeHtml(text || "")}</textarea>
    <button type="button" class="quote-line-remove" title="Remove">×</button>
  `;
  container.appendChild(row);

  row.querySelector(".fSpeaker").addEventListener("focus", () => { lastFocusedSpeakerRow = row; });
  row.querySelector(".quote-line-remove").addEventListener("click", () => {
    // Always keep at least one row so the form never disappears entirely.
    if (container.querySelectorAll(".quote-line-row").length > 1) {
      row.remove();
    } else {
      row.querySelector(".fSpeaker").value = "";
      row.querySelector(".fLineText").value = "";
    }
  });
}

function collectQuoteLines() {
  const rows = document.querySelectorAll("#quoteLines .quote-line-row");
  const lines = [];
  rows.forEach(row => {
    const speaker = row.querySelector(".fSpeaker").value.trim();
    const text = row.querySelector(".fLineText").value.trim();
    if (text) lines.push({ speaker, text });
  });
  return lines;
}

function photoPickerHtml() {
  return `
    <div class="field">
      <label>Photos (optional)</label>
      <input type="file" id="fPhotos" accept="image/*" multiple>
      <div class="photo-input-preview" id="photoPreview"></div>
    </div>`;
}

function renderPhotoPreview() {
  const preview = document.getElementById("photoPreview");
  if (!preview) return;
  preview.innerHTML = "";

  // Sonograms spotlight photos[0] as the enlarged frame (see renderTagOverlay/
  // the card renderer), so for this type the order genuinely matters — give
  // each thumb ‹ › buttons to move it, plus a badge marking whichever one is
  // currently first. Reordering only happens within each of editingPhotos/
  // pendingPhotos (existing photos always save before newly-added ones), so
  // the "Cover" badge only applies to a pending photo when there are no
  // existing photos ahead of it.
  const isSonogram = selectedType === "sonogram";

  editingPhotos.forEach((p, i) => {
    if (!p.people) p.people = [];
    const isCover = isSonogram && i === 0;
    const reorderHtml = isSonogram ? `
      <div class="sono-reorder-row">
        <button type="button" class="sono-reorder-btn" data-move-existing="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} title="Move earlier">‹</button>
        <span class="sono-reorder-label">${isCover ? "★ Cover" : ""}</span>
        <button type="button" class="sono-reorder-btn" data-move-existing="${i}" data-dir="1" ${i === editingPhotos.length - 1 ? "disabled" : ""} title="Move later">›</button>
      </div>` : "";
    preview.innerHTML += `
      <div class="photo-thumb-wrap">
        <div class="photo-thumb ${isCover ? "photo-thumb-cover" : ""}">
          <img src="${p.url}">
          <button type="button" class="photo-thumb-remove" data-remove-existing="${i}" title="Remove photo">×</button>
          <button type="button" class="photo-thumb-tag-btn" data-tag-existing="${i}" title="Tag people">${icon("tag")}</button>
        </div>
        ${reorderHtml}
      </div>`;
  });
  pendingPhotos.forEach((file, i) => {
    if (!pendingPhotoMeta[i]) pendingPhotoMeta[i] = { location: "", people: [] };
    const isCover = isSonogram && editingPhotos.length === 0 && i === 0;
    const reorderHtml = isSonogram ? `
      <div class="sono-reorder-row">
        <button type="button" class="sono-reorder-btn" data-move-pending="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} title="Move earlier">‹</button>
        <span class="sono-reorder-label">${isCover ? "★ Cover" : ""}</span>
        <button type="button" class="sono-reorder-btn" data-move-pending="${i}" data-dir="1" ${i === pendingPhotos.length - 1 ? "disabled" : ""} title="Move later">›</button>
      </div>` : "";
    preview.innerHTML += `
      <div class="photo-thumb-wrap">
        <div class="photo-thumb ${isCover ? "photo-thumb-cover" : ""}">
          <img id="pendingPreviewImg${i}" src="" alt="">
          <button type="button" class="photo-thumb-remove" data-remove-pending="${i}" title="Remove photo">×</button>
          <button type="button" class="photo-thumb-tag-btn" data-tag-pending="${i}" title="Tag people">${icon("tag")}</button>
          ${selectedType === "sonogram" ? `<button type="button" class="photo-thumb-crop-btn" data-crop-pending="${i}" title="Crop photo">${icon("crop")}</button>` : ""}
        </div>
        ${reorderHtml}
      </div>`;
  });
  // Set preview sources after the elements exist — HEIC files (common when a
  // photo's been shared from an iPhone) need async conversion first, since
  // the browser can't render them directly even as a preview.
  pendingPhotos.forEach((file, i) => {
    const imgEl = document.getElementById(`pendingPreviewImg${i}`);
    if (!imgEl) return;
    if (isHeicFile(file)) {
      convertHeicIfNeeded(file).then(converted => { imgEl.src = URL.createObjectURL(converted); });
    } else {
      imgEl.src = URL.createObjectURL(file);
    }
  });

  preview.querySelectorAll("[data-remove-existing]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.removeExisting, 10);
      const removed = editingPhotos[idx];
      if (removed && removed.path) removedPhotoPaths.push(removed.path);
      editingPhotos.splice(idx, 1);
      renderPhotoPreview();
    });
  });
  preview.querySelectorAll("[data-remove-pending]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.removePending, 10);
      pendingPhotos.splice(idx, 1);
      pendingPhotoMeta.splice(idx, 1);
      renderPhotoPreview();
    });
  });
  preview.querySelectorAll("[data-tag-existing]").forEach(btn => {
    btn.addEventListener("click", () => openTagEditor("existing", parseInt(btn.dataset.tagExisting, 10)));
  });
  preview.querySelectorAll("[data-tag-pending]").forEach(btn => {
    btn.addEventListener("click", () => openTagEditor("pending", parseInt(btn.dataset.tagPending, 10)));
  });
  preview.querySelectorAll("[data-crop-pending]").forEach(btn => {
    btn.addEventListener("click", () => {
      cropQueue = [parseInt(btn.dataset.cropPending, 10)];
      if (!cropSession) openNextCrop();
    });
  });
  preview.querySelectorAll("[data-move-existing]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.moveExisting, 10);
      const swapIdx = idx + parseInt(btn.dataset.dir, 10);
      if (swapIdx < 0 || swapIdx >= editingPhotos.length) return;
      [editingPhotos[idx], editingPhotos[swapIdx]] = [editingPhotos[swapIdx], editingPhotos[idx]];
      renderPhotoPreview();
    });
  });
  preview.querySelectorAll("[data-move-pending]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.movePending, 10);
      const swapIdx = idx + parseInt(btn.dataset.dir, 10);
      if (swapIdx < 0 || swapIdx >= pendingPhotos.length) return;
      [pendingPhotos[idx], pendingPhotos[swapIdx]] = [pendingPhotos[swapIdx], pendingPhotos[idx]];
      [pendingPhotoMeta[idx], pendingPhotoMeta[swapIdx]] = [pendingPhotoMeta[swapIdx], pendingPhotoMeta[idx]];
      renderPhotoPreview();
    });
  });

  const reorderHintEl = document.getElementById("sonogramReorderHint");
  if (reorderHintEl) {
    reorderHintEl.style.display = (isSonogram && (editingPhotos.length + pendingPhotos.length) > 1) ? "block" : "none";
  }
}

// Sonogram drop zone: dropped image files join pendingPhotos just like files
// chosen through the hidden input, so the standard preview/tag/upload flow
// takes over from there. Tapping the zone opens the file picker instead.
function initSonogramDropzone() {
  const zone = document.getElementById("sonogramDropzone");
  const photoInput = document.getElementById("fPhotos");
  if (!zone || !photoInput) return;

  zone.addEventListener("click", () => photoInput.click());

  ["dragenter", "dragover"].forEach(evt => zone.addEventListener(evt, (e) => {
    // preventDefault is what allows a drop to happen at all — without it the
    // browser refuses every drop.
    e.preventDefault();
    zone.classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach(evt => zone.addEventListener(evt, (e) => {
    e.preventDefault();
    zone.classList.remove("dragover");
  }));
  zone.addEventListener("drop", (e) => {
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/") || isHeicFile(f));
    if (!files.length) {
      showToast("Drop an image file");
      return;
    }
    const firstNewIndex = pendingPhotos.length;
    pendingPhotos = pendingPhotos.concat(files);
    renderPhotoPreview();
    queueSonogramCrops(firstNewIndex, files.length);
  });

  // Photos chosen via "tap to browse" flow through the generic change handler
  // bound later in renderEntryForm, so defer a tick to let pendingPhotos update
  // before figuring out which ones are new.
  photoInput.addEventListener("change", () => {
    const before = pendingPhotos.length;
    setTimeout(() => {
      if (pendingPhotos.length > before) queueSonogramCrops(before, pendingPhotos.length - before);
    }, 0);
  });
}

// ============================================================
// SONOGRAM PHOTO CROPPING
// ============================================================
// Dropping a sonogram photo opens a crop editor so the black borders and
// clinic UI around the actual scan can be trimmed before saving. Cropping
// happens client-side on a canvas at full resolution; the resulting File
// simply replaces the original in pendingPhotos, so upload/tagging are
// untouched. If several photos are added at once, they're cropped one after
// another via cropQueue.

let cropQueue = [];    // pendingPhotos indexes waiting to be cropped
let cropSession = null; // active editor: { index, img, url, box:{x,y,w,h} } — box in image-display px

function queueSonogramCrops(startIndex, count) {
  for (let i = startIndex; i < startIndex + count; i++) cropQueue.push(i);
  if (!cropSession) openNextCrop();
}

function openNextCrop() {
  const index = cropQueue.shift();
  if (index === undefined) return;
  const file = pendingPhotos[index];
  if (!file) { openNextCrop(); return; } // photo was removed while queued — skip
  const open = (blob) => openCropEditor(index, blob);
  if (isHeicFile(file)) convertHeicIfNeeded(file).then(open);
  else open(file);
}

function openCropEditor(index, blob) {
  const url = URL.createObjectURL(blob);
  const overlay = document.createElement("div");
  overlay.className = "crop-overlay";
  overlay.id = "cropOverlay";
  overlay.innerHTML = `
    <div class="crop-title">Crop the sonogram</div>
    <div class="crop-stage" id="cropStage">
      <div class="crop-img-wrap">
        <img id="cropImg" src="${url}" alt="">
        <div class="crop-box" id="cropBox" style="display:none;">
          <div class="crop-handle" data-handle="nw"></div>
          <div class="crop-handle" data-handle="ne"></div>
          <div class="crop-handle" data-handle="sw"></div>
          <div class="crop-handle" data-handle="se"></div>
        </div>
      </div>
    </div>
    <div class="crop-actions">
      <button type="button" class="crop-btn-secondary" id="cropKeepBtn">Keep full photo</button>
      <button type="button" class="crop-btn-secondary" id="cropResetBtn">Reset</button>
      <button type="button" class="crop-btn-primary" id="cropConfirmBtn">Crop</button>
    </div>`;
  document.body.appendChild(overlay);
  lockBodyScroll();

  const img = overlay.querySelector("#cropImg");
  const box = overlay.querySelector("#cropBox");
  cropSession = { index, url, overlay, img, box, rect: { x: 0, y: 0, w: 0, h: 0 } };

  img.addEventListener("load", () => {
    resetCropBox();
    box.style.display = "block";
  });

  overlay.querySelector("#cropConfirmBtn").addEventListener("click", applyCrop);
  overlay.querySelector("#cropKeepBtn").addEventListener("click", () => closeCropEditor());
  overlay.querySelector("#cropResetBtn").addEventListener("click", resetCropBox);

  bindCropPointerEvents(overlay);
}

// Box geometry is tracked in pixels relative to the displayed <img>, so the
// final crop just multiplies by (naturalWidth / clientWidth).
function resetCropBox() {
  if (!cropSession) return;
  const { img, box, rect } = cropSession;
  rect.x = 0; rect.y = 0; rect.w = img.clientWidth; rect.h = img.clientHeight;
  paintCropBox();
}

function paintCropBox() {
  const { box, rect } = cropSession;
  box.style.left = rect.x + "px";
  box.style.top = rect.y + "px";
  box.style.width = rect.w + "px";
  box.style.height = rect.h + "px";
}

function bindCropPointerEvents(overlay) {
  const stage = overlay.querySelector("#cropStage");
  const MIN = 32; // px — smallest sensible crop
  let gesture = null; // { mode: 'move'|'nw'|'ne'|'sw'|'se', startX, startY, orig }

  stage.addEventListener("pointerdown", (e) => {
    if (!cropSession || !cropSession.rect.w) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    const mode = e.target.dataset.handle || (e.target.id === "cropBox" || e.target.closest("#cropBox") ? "move" : null);
    if (!mode) return;
    gesture = { mode, startX: e.clientX, startY: e.clientY, orig: { ...cropSession.rect } };
  });

  stage.addEventListener("pointermove", (e) => {
    if (!gesture || !cropSession) return;
    const { img, rect } = cropSession;
    const maxW = img.clientWidth, maxH = img.clientHeight;
    const dx = e.clientX - gesture.startX, dy = e.clientY - gesture.startY;
    const o = gesture.orig;

    if (gesture.mode === "move") {
      rect.x = Math.min(Math.max(0, o.x + dx), maxW - o.w);
      rect.y = Math.min(Math.max(0, o.y + dy), maxH - o.h);
    } else {
      // Corner resize: each handle anchors the opposite corner.
      let { x, y, w, h } = o;
      if (gesture.mode.includes("e")) w = o.w + dx;
      if (gesture.mode.includes("s")) h = o.h + dy;
      if (gesture.mode.includes("w")) { x = o.x + dx; w = o.w - dx; }
      if (gesture.mode.includes("n")) { y = o.y + dy; h = o.h - dy; }
      if (w < MIN) { if (gesture.mode.includes("w")) x = o.x + o.w - MIN; w = MIN; }
      if (h < MIN) { if (gesture.mode.includes("n")) y = o.y + o.h - MIN; h = MIN; }
      x = Math.max(0, x); y = Math.max(0, y);
      w = Math.min(w, maxW - x); h = Math.min(h, maxH - y);
      rect.x = x; rect.y = y; rect.w = w; rect.h = h;
    }
    paintCropBox();
  });

  ["pointerup", "pointercancel"].forEach(evt => stage.addEventListener(evt, () => { gesture = null; }));
}

async function applyCrop() {
  if (!cropSession) return;
  const { index, img, rect } = cropSession;
  const scale = img.naturalWidth / img.clientWidth;
  const sx = Math.round(rect.x * scale), sy = Math.round(rect.y * scale);
  const sw = Math.round(rect.w * scale), sh = Math.round(rect.h * scale);

  // A full-image selection is a no-op — keep the original file untouched.
  if (sx <= 0 && sy <= 0 && sw >= img.naturalWidth && sh >= img.naturalHeight) {
    closeCropEditor();
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = sw; canvas.height = sh;
  canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.92));
  if (blob) {
    const original = pendingPhotos[index];
    const name = (original && original.name ? original.name.replace(/\.\w+$/, "") : "sonogram") + "-crop.jpg";
    pendingPhotos[index] = new File([blob], name, { type: "image/jpeg" });
    renderPhotoPreview();
  } else {
    showToast("Couldn't crop that photo — kept the original");
  }
  closeCropEditor();
}

function closeCropEditor() {
  if (!cropSession) return;
  URL.revokeObjectURL(cropSession.url);
  cropSession.overlay.remove();
  cropSession = null;
  unlockBodyScroll();
  openNextCrop(); // next queued photo, if any
}

// ============================================================
// PHOTO PEOPLE-TAGGING
// ============================================================

function getTaggingPhotoData() {
  if (!taggingPhotoRef) return null;
  if (taggingPhotoRef.source === "existing") {
    return editingPhotos[taggingPhotoRef.index];
  }
  return pendingPhotoMeta[taggingPhotoRef.index];
}

function openTagEditor(source, index) {
  taggingPhotoRef = { source, index };
  const photoData = getTaggingPhotoData();
  if (!photoData) {
    console.warn("openTagEditor: no photo data found for", source, index);
    showToast("Couldn't open that photo — try re-selecting it");
    taggingPhotoRef = null;
    return;
  }
  if (!photoData.people) photoData.people = [];

  const img = document.getElementById("tagEditorImg");
  img.src = source === "existing" ? editingPhotos[index].url : URL.createObjectURL(pendingPhotos[index]);
  document.getElementById("tagEditorLocation").value = photoData.location || "";

  renderTagEditorPins();
  document.getElementById("tagEditorOverlay").classList.add("open");
  lockBodyScroll();
}

function closeTagEditor() {
  commitMiniForm(); // auto-save whatever's currently typed, so nothing gets lost by forgetting a separate Save tap
  // Persist whatever location text is currently in the field.
  const photoData = getTaggingPhotoData();
  if (photoData) photoData.location = document.getElementById("tagEditorLocation").value.trim();
  taggingPhotoRef = null;

  // Blur any focused text field before hiding the overlay, so the on-screen
  // keyboard (if any) starts collapsing before the overlay disappears.
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

  document.getElementById("tagEditorOverlay").classList.remove("open");
  removeTagMiniForm();
  unlockBodyScroll();
}

function commitMiniForm() {
  const form = document.getElementById("tagMiniForm");
  if (!form) return;
  const name = document.getElementById("miniName").value.trim();
  if (!name) return; // nothing entered — nothing to commit
  const relationship = document.getElementById("miniRelationship").value.trim();
  const x = parseFloat(form.dataset.x);
  const y = parseFloat(form.dataset.y);
  const personIndex = form.dataset.personIndex;
  const photoData = getTaggingPhotoData();
  if (!photoData) return;
  if (personIndex !== "") {
    photoData.people[parseInt(personIndex, 10)] = { name, relationship, x, y };
  } else {
    photoData.people.push({ name, relationship, x, y });
  }
}

function renderTagEditorPins() {
  removeTagMiniForm(); // clean up any leftover popup before redrawing, or it can linger and block clicks
  const layer = document.getElementById("tagEditorLayer");
  const photoData = getTaggingPhotoData();
  layer.className = "tag-layer editable";
  layer.innerHTML = "";

  (photoData.people || []).forEach((person, i) => {
    const pin = document.createElement("div");
    pin.className = "photo-tag-pin";
    pin.style.left = person.x + "%";
    pin.style.top = person.y + "%";
    pin.innerHTML = `<span class="photo-tag-dot"></span><span class="photo-tag-label"><span class="name">${escapeHtml(person.name)}</span>${person.relationship ? `<span class="relationship">${escapeHtml(person.relationship)}</span>` : ""}</span>`;
    bindPinDragOrTap(pin, person, i, layer);
    layer.appendChild(pin);
  });

  // Tapping empty space on the photo starts a new pin.
  layer.onclick = (e) => {
    if (e.target !== layer) return; // ignore taps that landed on an existing pin
    const rect = layer.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    showTagMiniForm(x, y, null);
  };
}

function bindPinDragOrTap(pin, person, index, layer) {
  const MOVE_THRESHOLD = 6; // px — below this, treat it as a tap, not a drag
  pin.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    pin.setPointerCapture(e.pointerId);
    removeTagMiniForm(); // dragging an existing pin while another's popup is open shouldn't leave it stranded
    const startX = e.clientX, startY = e.clientY;
    let moved = false;

    const onMove = (moveEvent) => {
      if (!moved && (Math.abs(moveEvent.clientX - startX) > MOVE_THRESHOLD || Math.abs(moveEvent.clientY - startY) > MOVE_THRESHOLD)) {
        moved = true;
      }
      if (moved) {
        const rect = layer.getBoundingClientRect();
        let x = ((moveEvent.clientX - rect.left) / rect.width) * 100;
        let y = ((moveEvent.clientY - rect.top) / rect.height) * 100;
        x = Math.max(0, Math.min(100, x));
        y = Math.max(0, Math.min(100, y));
        pin.style.left = x + "%";
        pin.style.top = y + "%";
        person.x = x;
        person.y = y;
      }
    };
    const onUp = () => {
      pin.removeEventListener("pointermove", onMove);
      pin.removeEventListener("pointerup", onUp);
      pin.removeEventListener("pointercancel", onUp);
      if (!moved) {
        showTagMiniForm(person.x, person.y, index); // it was a tap, not a drag — open the edit popup
      }
    };
    pin.addEventListener("pointermove", onMove);
    pin.addEventListener("pointerup", onUp);
    pin.addEventListener("pointercancel", onUp);
  });
}

function removeTagMiniForm() {
  const existing = document.getElementById("tagMiniForm");
  if (existing) existing.remove();
}

function showTagMiniForm(x, y, personIndex) {
  removeTagMiniForm();
  const photoData = getTaggingPhotoData();
  const isEditing = personIndex !== null;
  const person = isEditing ? photoData.people[personIndex] : { name: "", relationship: "" };

  const wrap = document.getElementById("tagEditorImgWrap");
  const form = document.createElement("div");
  form.className = "tag-mini-form";
  form.id = "tagMiniForm";
  form.style.left = x + "%";
  form.style.top = y + "%";
  // Stash context on the element so closeTagEditor() can auto-commit
  // whatever's currently typed, even if Save was never explicitly clicked.
  form.dataset.x = x;
  form.dataset.y = y;
  form.dataset.personIndex = isEditing ? personIndex : "";
  form.innerHTML = `
    <input type="text" id="miniName" placeholder="Name" value="${escapeHtml(person.name)}">
    <input type="text" id="miniRelationship" placeholder="Relationship (e.g. Grandmother)" value="${escapeHtml(person.relationship)}">
    <div class="tag-mini-form-actions">
      ${isEditing ? `<button type="button" class="tag-mini-delete" id="miniDeleteBtn">Delete</button>` : `<button type="button" class="tag-mini-cancel" id="miniCancelBtn">Cancel</button>`}
      <button type="button" class="tag-mini-save" id="miniSaveBtn">Save</button>
    </div>
  `;
  wrap.appendChild(form);
  document.getElementById("miniName").focus();

  document.getElementById("miniSaveBtn").addEventListener("click", () => {
    if (!document.getElementById("miniName").value.trim()) { showToast("Enter a name first"); return; }
    commitMiniForm();
    renderTagEditorPins();
  });
  const cancelBtn = document.getElementById("miniCancelBtn");
  if (cancelBtn) cancelBtn.addEventListener("click", removeTagMiniForm);
  const deleteBtn = document.getElementById("miniDeleteBtn");
  if (deleteBtn) deleteBtn.addEventListener("click", () => {
    photoData.people.splice(personIndex, 1);
    renderTagEditorPins();
  });
}

// ---- Save (create or update) ----

async function saveEntry() {
  if (selectedType === "funnything" && collectQuoteLines().length === 0) {
    showToast("Add at least one line first");
    return;
  }
  if (selectedType === "pregnancy" && document.querySelector("#pregnancySubtypeChips .chip.selected")?.dataset.subtype === "craving" && collectCravings().length === 0) {
    showToast("Add at least one craving first");
    return;
  }
  if (selectedType === "thennow" && !(thenNowPending.then || thenNowExisting.then) ) {
    showToast("Add a \"Then\" photo first");
    return;
  }
  if (selectedType === "thennow" && !(thenNowPending.now || thenNowExisting.now) ) {
    showToast("Add a \"Now\" photo first");
    return;
  }
  if (selectedType === "firstyear" && !FIRST_YEAR_MONTHS.some(m => firstYearPending[m.idx] || firstYearExisting[m.idx])) {
    showToast("Add at least one photo first");
    return;
  }
  if (selectedType === "sonogram" && pendingPhotos.length === 0 && editingPhotos.length === 0) {
    showToast("Drop in the sonogram photo first");
    return;
  }

  const btn = document.getElementById("saveEntryBtn");
  btn.disabled = true;
  btn.textContent = "Saving...";
  newUploadPathsThisSave = [];

  try {
    const selectedKids = Array.from(document.querySelectorAll("#kidChips .chip.selected")).map(c => c.dataset.kid);
    localStorage.setItem("masonsbook_last_kids", JSON.stringify(selectedKids));
    const selectedTags = Array.from(document.querySelectorAll("#tagChips .chip.selected")).map(c => c.dataset.tag);
    const selectedTripChip = document.querySelector("#tripChips .chip.selected[data-trip]");

    const date = document.getElementById("fDate").value;
    const data = {
      category: selectedType, kids: selectedKids, tags: selectedTags,
      isPrivate: selectedTags.includes("private"), // real field the view-mode query filters on
      tripId: selectedTripChip ? selectedTripChip.dataset.trip : null,
      date, updatedAt: serverTimestamp()
    };

    switch (selectedType) {
      case "birth":
        data.time = getVal("fTime");
        data.weight = getVal("fWeight");
        data.length = getVal("fLength");
        data.caption = getVal("fCaption");
        data.babyName = selectedKids.length ? kidsLabel(selectedKids) : "";
        break;
      case "photo":
        data.caption = getVal("fCaption"); break;
      case "funnything":
        data.lines = collectQuoteLines();
        data.context = getVal("fContext");
        break;
      case "milestone":
        data.title = getVal("fTitle");
        data.note = getVal("fNote");
        break;
      case "stat":
        data.height = getVal("fHeight");
        data.weight = getVal("fWeight");
        data.headCirc = getVal("fHeadCirc");
        break;
      case "birthday":
        data.birthdayNum = getVal("fBirthdayNum");
        data.theme = getVal("fTheme");
        data.location = getVal("fBirthdayLocation");
        data.attendees = collectChipPills("attendeesPills");
        data.gifts = collectChipPills("giftsPills");
        data.note = getVal("fNote");
        break;
      case "letter":
        data.from = getVal("fFrom");
        data.to = selectedKids[0] || "";
        data.text = getVal("fText");
        data.unlockDate = getVal("fUnlockDate");
        break;
      case "pregnancy": {
        const subtype = document.querySelector("#pregnancySubtypeChips .chip.selected")?.dataset.subtype || "update";
        data.subtype = subtype;
        if (subtype === "craving") {
          data.cravings = collectCravings();
        } else if (subtype === "bump") {
          data.weeks = await collectBumpWeeks();
        } else {
          data.title = getVal("fTitle");
          data.caption = getVal("fCaption");
        }
        break;
      }
      case "sonogram":
        // photos are picked up by the generic fPhotos block below
        data.title = getVal("fTitle");
        data.weeks = getVal("fWeeks");
        data.caption = getVal("fCaption");
        break;
      case "thennow": {
        data.title = getVal("fTitle");
        data.caption = getVal("fCaption");
        data.thenLabel = getVal("fThenLabel");
        data.nowLabel = getVal("fNowLabel");
        data.thenPhoto = thenNowPending.then ? (await uploadPhotos([thenNowPending.then]))[0] : thenNowExisting.then;
        data.nowPhoto = thenNowPending.now ? (await uploadPhotos([thenNowPending.now]))[0] : thenNowExisting.now;
        data.thenFocal = thenNowFocal.then;
        data.nowFocal = thenNowFocal.now;
        break;
      }
      case "firstyear": {
        data.title = getVal("fTitle");
        const months = [];
        for (const m of FIRST_YEAR_MONTHS) {
          let photo = firstYearExisting[m.idx] || null;
          if (firstYearPending[m.idx]) {
            photo = (await uploadPhotos([firstYearPending[m.idx]]))[0];
          }
          if (photo) months.push({ monthIndex: m.idx, label: m.label, photo });
        }
        data.months = months;
        break;
      }
      default: // custom user-created types
        data.caption = getVal("fCaption");
    }

    // Photos: combine whatever's left in editingPhotos (after any removals)
    // with newly uploaded ones (carrying over their tagged people/location).
    // Only applies to forms that had a photo picker.
    if (document.getElementById("fPhotos")) {
      const uploaded = pendingPhotos.length > 0 ? await uploadPhotos(pendingPhotos) : [];
      const uploadedWithMeta = uploaded.map((photo, i) => ({
        ...photo,
        location: (pendingPhotoMeta[i] && pendingPhotoMeta[i].location) || "",
        people: (pendingPhotoMeta[i] && pendingPhotoMeta[i].people) || []
      }));
      data.photos = [...editingPhotos, ...uploadedWithMeta];
    }

    if (editingEntryId) {
      await updateDoc(doc(db, "entries", editingEntryId), data);
      showToast("Entry updated");
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, "entries"), data);
      showToast("Added to the book");
    }

    // Best-effort cleanup: actually delete removed photos from Storage now
    // that the save succeeded. Failures here are non-critical (orphaned
    // file, no broken references) so they're logged, not surfaced.
    if (removedPhotoPaths.length > 0) {
      await Promise.all(removedPhotoPaths.map(path =>
        deleteObject(ref(storage, path)).catch(err => console.warn("Storage cleanup skipped for", path, err))
      ));
      removedPhotoPaths = [];
    }

    closeAddSheet();
  } catch (err) {
    console.error("Save error:", err);
    showToast("Something went wrong — try again");
    // If photos made it to Storage this attempt but the entry itself never
    // saved (or a later step in the switch threw), those files are orphaned
    // — nothing in Firestore will ever reference them. Clean them up rather
    // than leaving dead weight in the bucket.
    if (newUploadPathsThisSave.length > 0) {
      Promise.all(newUploadPathsThisSave.map(path =>
        deleteObject(ref(storage, path)).catch(e => console.warn("Storage cleanup skipped for", path, e))
      ));
      newUploadPathsThisSave = [];
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "Save";
  }
}

async function uploadPhotos(files) {
  const results = [];
  for (const rawFile of files) {
    const file = await convertHeicIfNeeded(rawFile);
    const compressed = await compressImage(file);
    const filename = `entries/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const storageRef = ref(storage, filename);
    await uploadBytes(storageRef, compressed);
    const url = await getDownloadURL(storageRef);
    // Tracked here (not just by the caller) so that if a later file in this
    // same batch fails, or the entry save itself fails afterward, files that
    // did make it to Storage still get cleaned up instead of orphaned.
    newUploadPathsThisSave.push(filename);
    results.push({ url, path: filename });
  }
  return results;
}

function compressImage(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve) => {
    // Best-effort compression: if the browser can't decode this file (this
    // happens with some HEIC photos from iPhones when opened on Android,
    // for example), fall back to uploading the original file rather than
    // failing the whole save. A slightly bigger upload beats a lost photo.
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    reader.onerror = () => resolve(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) { height *= maxDim / width; width = maxDim; }
      else if (height > maxDim) { width *= maxDim / height; height = maxDim; }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => resolve(blob || file), "image/jpeg", quality);
    };
    img.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

// Entries can carry photos in several different shapes depending on type:
// a flat `photos` array (photo/milestone/birthday/etc.), `weeks` (bump
// progression), `months` (first year), or `thenPhoto`/`nowPhoto` (then-vs-now).
// This walks all of them so a full entry delete can clean up every file it owns.
function collectEntryPhotoPaths(entry) {
  const paths = [];
  (entry.photos || []).forEach(p => { if (p && p.path) paths.push(p.path); });
  (entry.weeks || []).forEach(w => { if (w.photo && w.photo.path) paths.push(w.photo.path); });
  (entry.months || []).forEach(m => { if (m.photo && m.photo.path) paths.push(m.photo.path); });
  if (entry.thenPhoto && entry.thenPhoto.path) paths.push(entry.thenPhoto.path);
  if (entry.nowPhoto && entry.nowPhoto.path) paths.push(entry.nowPhoto.path);
  return paths;
}

function confirmDelete(entryId) {
  const entry = state.entries.find(e => e.id === entryId);
  if (confirm("Delete this entry? This can't be undone.")) {
    const photoPaths = entry ? collectEntryPhotoPaths(entry) : [];
    deleteDoc(doc(db, "entries", entryId))
      .then(() => {
        showToast("Deleted");
        // Best-effort Storage cleanup, same as the photo-removal path above —
        // failures here just mean an orphaned file, never a broken reference.
        if (photoPaths.length > 0) {
          Promise.all(photoPaths.map(path =>
            deleteObject(ref(storage, path)).catch(err => console.warn("Storage cleanup skipped for", path, err))
          ));
        }
      })
      .catch(err => { console.error(err); showToast("Couldn't delete — try again"); });
  }
}

// ============================================================
// TOAST
// ============================================================

// ============================================================
// GLOBAL EVENTS
// ============================================================

// ============================================================
// MANAGE ENTRY TYPES SHEET
// ============================================================

function renderManageCategories() {
  const content = document.getElementById("addSheetContent");
  const order = getCategoryOrder().filter(id => CATEGORIES[id]);

  content.innerHTML = `
    <div class="sheet-title" style="display:flex; align-items:center; gap:8px;">${icon("settings")}<span>Manage entry types</span></div>
    <div class="type-hint">Use ↑ ↓ to reorder · tap Visible/Hidden to toggle</div>
    <div id="catList" style="display:flex; flex-direction:column; gap:8px; margin-bottom:16px;">
      ${order.map((id, i) => renderCatRow(id, i, order.length)).join("")}
    </div>
    <button class="btn-secondary" id="backToPickerBtn">Back</button>
  `;

  bindCatRowEvents();
  document.getElementById("backToPickerBtn").addEventListener("click", renderTypePicker);
}

function renderCatRow(id, index, total) {
  const c = CATEGORIES[id];
  const hidden = hiddenCategoryIds.includes(id);
  return `
    <div class="cat-row" data-cat-row="${id}" style="${hidden ? 'opacity:0.5;' : ''}">
      <div class="cat-move-btns">
        <button class="cat-move-btn" data-move="up" data-id="${id}" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button class="cat-move-btn" data-move="down" data-id="${id}" ${index === total - 1 ? 'disabled' : ''}>↓</button>
      </div>
      <span style="font-size:18px;">${c.emoji}</span>
      <span style="font-weight:700; font-size:14px; flex:1;">${escapeHtml(c.label)}</span>
      <button class="chip ${hidden ? '' : 'selected'}" data-toggle-cat="${id}" style="padding:6px 12px; font-size:11.5px;">${hidden ? 'Hidden' : 'Visible'}</button>
    </div>`;
}

function bindCatRowEvents() {
  const list = document.getElementById("catList");

  list.querySelectorAll("[data-toggle-cat]").forEach(btn => {
    btn.addEventListener("click", () => toggleCategoryHidden(btn.dataset.toggleCat));
  });

  list.querySelectorAll("[data-move]").forEach(btn => {
    btn.addEventListener("click", () => moveCategory(btn.dataset.id, btn.dataset.move));
  });
}

function moveCategory(id, direction) {
  const order = getCategoryOrder().filter(cid => CATEGORIES[cid]);
  const idx = order.indexOf(id);
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= order.length) return;
  [order[idx], order[swapWith]] = [order[swapWith], order[idx]];
  saveCategoryOrder(order);
  renderManageCategories(); // re-render for instant, guaranteed-consistent feedback
}

async function toggleCategoryHidden(id) {
  // Instant feedback: update locally and re-render immediately, then persist.
  hiddenCategoryIds = hiddenCategoryIds.includes(id)
    ? hiddenCategoryIds.filter(x => x !== id)
    : [...hiddenCategoryIds, id];
  const row = document.querySelector(`[data-cat-row="${id}"]`);
  if (row) {
    const nowHidden = hiddenCategoryIds.includes(id);
    row.style.opacity = nowHidden ? "0.5" : "1";
    const btn = row.querySelector("[data-toggle-cat]");
    btn.textContent = nowHidden ? "Hidden" : "Visible";
    btn.classList.toggle("selected", !nowHidden);
  }
  try {
    await setDoc(doc(db, "settings", "categoryConfig"), { hidden: hiddenCategoryIds }, { merge: true });
  } catch (err) {
    console.error("Toggle category error:", err);
    showToast("Couldn't save — try again");
  }
}

function openManageKidsSheet() {
  renderManageKids();
  document.getElementById("addSheetOverlay").classList.add("open");
  lockBodyScroll();
}

function renderManageKids(showAddForm) {
  const content = document.getElementById("addSheetContent");
  content.innerHTML = `
    <div class="sheet-title">👶 Manage kids</div>
    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:16px;">
      ${KIDS.map(k => `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; background:var(--white); border:1px solid var(--taupe); border-radius:12px;">
          <div>
            <div style="font-weight:700; font-size:14px;">${escapeHtml(k.name)}</div>
            <div style="font-size:12px; color:var(--ink-soft);">${k.birthdate ? formatDate(k.birthdate) : "No birthdate set"}</div>
          </div>
          <button type="button" class="icon-btn danger" data-delete-kid="${k.id}" aria-label="Delete ${escapeHtml(k.name)}" title="Delete child">${icon("trash")}</button>
        </div>`).join("")}
    </div>
    ${showAddForm ? `
      <div class="field"><label>Name</label><input type="text" id="fKidName" placeholder="Child's name"></div>
      <div class="field"><label>Birthdate</label><input type="date" id="fKidBirthdate"></div>
      <button class="btn-primary" id="saveKidBtn">Save child</button>
      <button class="btn-secondary" id="cancelAddKidBtn">Cancel</button>
    ` : `
      <button class="btn-primary" id="showAddKidFormBtn">+ Add a child</button>
      <button class="btn-secondary" id="closeManageKidsBtn">Close</button>
    `}
  `;

  content.querySelectorAll("[data-delete-kid]").forEach(btn => {
    btn.addEventListener("click", () => renderDeleteKidStep1(btn.dataset.deleteKid));
  });

  if (showAddForm) {
    document.getElementById("saveKidBtn").addEventListener("click", saveNewKid);
    document.getElementById("cancelAddKidBtn").addEventListener("click", () => renderManageKids(false));
  } else {
    document.getElementById("showAddKidFormBtn").addEventListener("click", () => renderManageKids(true));
    document.getElementById("closeManageKidsBtn").addEventListener("click", closeAddSheet);
  }
}

async function saveNewKid() {
  const name = getVal("fKidName").trim();
  const birthdate = getVal("fKidBirthdate");
  if (!name) { showToast("Enter a name first"); return; }

  const btn = document.getElementById("saveKidBtn");
  btn.disabled = true;
  btn.textContent = "Saving...";
  try {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "") || `kid${Date.now()}`;
    await setDoc(doc(db, "kids", id), { name, birthdate, order: KIDS.length });
    showToast(`${name} added`);
    renderManageKids(false);
  } catch (err) {
    console.error("Add kid error:", err);
    showToast("Couldn't save — try again");
  } finally {
    btn.disabled = false;
    btn.textContent = "Save child";
  }
}

// ============================================================
// DELETE A CHILD — a rare but real need (a miscarriage, a name change
// before birth, a corrected sex-of-baby guess). Because this is permanent
// and emotionally loaded, it's gated behind three distinct steps rather
// than a single confirm() dialog, ending with typing the child's name.
// ============================================================

// Entries that mention this kid alongside others (shared family photos,
// group moments) — this kid's tag is removed but the entry and its photos
// stay, since the memory itself still belongs to the sibling(s) in it.
function kidSharedEntries(kidId) {
  return state.entries.filter(e => (e.kids || []).includes(kidId) && e.kids.length > 1);
}

// Entries that exist only because of this kid (their birthdays, first year,
// bump progression tied to this pregnancy, letters addressed to them, solo
// photos, etc.) — these are deleted entirely, photos included.
function kidExclusiveEntries(kidId) {
  return state.entries.filter(e => (e.kids || []).length === 1 && e.kids[0] === kidId);
}

function renderDeleteKidStep1(kidId) {
  const kid = KIDS.find(k => k.id === kidId);
  if (!kid) return;
  const content = document.getElementById("addSheetContent");
  content.innerHTML = `
    <div class="sheet-title">Delete ${escapeHtml(kid.name)}?</div>
    <p style="font-size:13.5px; line-height:1.6; color:var(--ink-soft); margin-bottom:18px;">
      This permanently removes ${escapeHtml(kid.name)} from The Jarrett Book — their profile, birthdate,
      and every entry created just for them (birthdays, milestones, letters, photos). This can't be
      undone once it's done. If this is a hard moment, take your time — there's no rush.
    </p>
    <button class="btn-secondary danger" id="deleteKidNextBtn">Continue</button>
    <button class="btn-secondary" id="deleteKidCancelBtn">Cancel</button>
  `;
  document.getElementById("deleteKidNextBtn").addEventListener("click", () => renderDeleteKidStep2(kidId));
  document.getElementById("deleteKidCancelBtn").addEventListener("click", () => renderManageKids(false));
}

function renderDeleteKidStep2(kidId) {
  const kid = KIDS.find(k => k.id === kidId);
  if (!kid) return;
  const exclusive = kidExclusiveEntries(kidId);
  const shared = kidSharedEntries(kidId);
  const photoCount = exclusive.reduce((sum, e) => sum + collectEntryPhotoPaths(e).length, 0);
  const content = document.getElementById("addSheetContent");
  content.innerHTML = `
    <div class="sheet-title">Here's exactly what goes</div>
    <p style="font-size:13.5px; line-height:1.6; color:var(--ink-soft); margin-bottom:10px;">
      <strong>Permanently deleted:</strong> ${exclusive.length} ${exclusive.length === 1 ? "entry" : "entries"}
      belonging only to ${escapeHtml(kid.name)}${photoCount > 0 ? `, including ${photoCount} ${photoCount === 1 ? "photo" : "photos"}` : ""}.
    </p>
    ${shared.length > 0 ? `
      <p style="font-size:13.5px; line-height:1.6; color:var(--ink-soft); margin-bottom:18px;">
        <strong>Kept, but unlinked:</strong> ${shared.length} shared ${shared.length === 1 ? "entry" : "entries"}
        (like family photos with siblings) will stay in the book — ${escapeHtml(kid.name)}'s name is just removed from them.
      </p>
    ` : `<p style="font-size:13.5px; line-height:1.6; color:var(--ink-soft); margin-bottom:18px;">There are no shared entries with other kids to worry about.</p>`}
    <p style="font-size:13px; font-weight:700; color:var(--danger); margin-bottom:14px;">
      There is no way to undo this or recover the deleted entries and photos afterward.
    </p>
    <button class="btn-secondary danger" id="deleteKidNextBtn">I understand, continue</button>
    <button class="btn-secondary" id="deleteKidBackBtn">Go back</button>
  `;
  document.getElementById("deleteKidNextBtn").addEventListener("click", () => renderDeleteKidStep3(kidId));
  document.getElementById("deleteKidBackBtn").addEventListener("click", () => renderDeleteKidStep1(kidId));
}

function renderDeleteKidStep3(kidId) {
  const kid = KIDS.find(k => k.id === kidId);
  if (!kid) return;
  const content = document.getElementById("addSheetContent");
  content.innerHTML = `
    <div class="sheet-title">Last step</div>
    <p style="font-size:13.5px; line-height:1.6; color:var(--ink-soft); margin-bottom:14px;">
      To confirm, type <strong>${escapeHtml(kid.name)}</strong> exactly as shown below.
    </p>
    <div class="field"><input type="text" id="fDeleteKidConfirmName" placeholder="Type the name here" autocomplete="off"></div>
    <button class="btn-primary danger" id="deleteKidFinalBtn" disabled>Delete ${escapeHtml(kid.name)} forever</button>
    <button class="btn-secondary" id="deleteKidBackBtn">Go back</button>
  `;
  const input = document.getElementById("fDeleteKidConfirmName");
  const finalBtn = document.getElementById("deleteKidFinalBtn");
  input.addEventListener("input", () => {
    finalBtn.disabled = input.value !== kid.name;
  });
  finalBtn.addEventListener("click", async () => {
    if (input.value !== kid.name) return;
    finalBtn.disabled = true;
    finalBtn.textContent = "Deleting...";
    try {
      await deleteKidCascade(kidId);
      showToast(`${kid.name} has been removed`);
      renderManageKids(false);
      renderFeed();
    } catch (err) {
      console.error("Delete kid error:", err);
      showToast("Couldn't delete — try again");
      finalBtn.disabled = false;
      finalBtn.textContent = `Delete ${kid.name} forever`;
    }
  });
  document.getElementById("deleteKidBackBtn").addEventListener("click", () => renderDeleteKidStep2(kidId));
}

async function deleteKidCascade(kidId) {
  const exclusive = kidExclusiveEntries(kidId);
  const shared = kidSharedEntries(kidId);

  // Delete entries that existed only for this kid, photos included.
  for (const entry of exclusive) {
    const photoPaths = collectEntryPhotoPaths(entry);
    await deleteDoc(doc(db, "entries", entry.id));
    if (photoPaths.length > 0) {
      await Promise.all(photoPaths.map(path =>
        deleteObject(ref(storage, path)).catch(err => console.warn("Storage cleanup skipped for", path, err))
      ));
    }
  }

  // Unlink (not delete) shared entries — the memory still belongs to whoever else is in it.
  await Promise.all(shared.map(e =>
    updateDoc(doc(db, "entries", e.id), { kids: e.kids.filter(id => id !== kidId) })
  ));

  // Finally, remove the child's own profile doc.
  await deleteDoc(doc(db, "kids", kidId));

  // If the feed was filtered to this kid, that filter no longer means anything.
  if (activeKidFilter === kidId) {
    activeKidFilter = "all";
    updateHeaderSub();
    updateFiltersButtonBadge();
  }
}

// ============================================================
// BACKUP & EXPORT — a self-contained download the person can keep
// somewhere outside Firebase entirely (Google Drive, an external drive,
// wherever), so the family's memories don't live in exactly one place.
// Runs fully client-side: bundles the already-loaded data plus every
// photo into a single .zip via JSZip, no server component involved.
// ============================================================

let backupReminderShownThisSession = false;

// Plain local YYYY-MM-DD — toISOString().slice(0,10) would use UTC, which
// can show the wrong day depending on time of day and timezone.
function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function getBackupMeta() {
  try {
    const snap = await getDoc(doc(db, "settings", "backupMeta"));
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    console.warn("Backup meta read skipped:", err);
    return null;
  }
}

async function checkBackupReminder() {
  if (backupReminderShownThisSession) return;
  backupReminderShownThisSession = true;
  const meta = await getBackupMeta();
  const lastBackupAt = meta && meta.lastBackupAt ? meta.lastBackupAt.toDate() : null;
  const daysSince = lastBackupAt ? (Date.now() - lastBackupAt.getTime()) / 86400000 : Infinity;
  if (daysSince > 30) {
    showToast(lastBackupAt
      ? "It's been over a month since your last backup — tap the backup icon up top"
      : "You haven't backed up yet — tap the backup icon up top to get started");
  }
}

// Every {url, path} pair an entry owns, across all its possible shapes —
// same coverage as collectEntryPhotoPaths, but keeping the url too since
// that's what's actually fetchable.
// Turns arbitrary text into a filename-safe fragment: lowercase, hyphens
// instead of spaces/punctuation, no leading/trailing hyphens, capped length.
function slugify(str) {
  return (str || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// Builds a human-readable filename base like:
//   2026-03-15_sonogram_mason_20-week-scan
//   2025-08-20_pregnancy-update_week20
//   2025-11-24_birth_mason
// so a browsed photos/ folder actually means something, and — since it
// leads with the date — sorts chronologically for free.
function friendlyPhotoBaseName(entry, contextLabel) {
  const dateSlug = entry.date || "no-date";
  const catSlug = slugify(CATEGORIES[entry.category]?.label || entry.category || "entry");
  const kidSlug = (entry.kids && entry.kids.length) ? slugify(kidsLabel(entry.kids)) : "";
  const descSlugRaw = slugify(entry.title || entry.caption || entry.babyName || entry.theme || "");
  const descSlug = (descSlugRaw && descSlugRaw !== kidSlug) ? descSlugRaw : "";
  const parts = [dateSlug, catSlug, kidSlug, descSlug, contextLabel].filter(Boolean);
  return parts.join("_");
}

// Groups photos into <year>/<category> folders — year first, since browsing
// a family archive chronologically is the most natural lens, with category
// as the next-most-useful narrowing (e.g. 2026/sonogram, 2026/birthday).
function photoFolderPath(entry) {
  const year = entry.date && /^\d{4}/.test(entry.date) ? entry.date.slice(0, 4) : "no-date";
  const catSlug = slugify(CATEGORIES[entry.category]?.label || entry.category || "entry");
  return `${year}/${catSlug}`;
}

function collectEntryPhotoRefs(entry) {
  const refs = [];
  const folder = photoFolderPath(entry);
  const generalPhotos = entry.photos || [];
  generalPhotos.forEach((p, i) => {
    if (p && p.path && p.url) {
      const context = generalPhotos.length > 1 ? String(i + 1) : "";
      refs.push({ path: p.path, url: p.url, entryId: entry.id, folder, friendlyBase: friendlyPhotoBaseName(entry, context) });
    }
  });
  (entry.weeks || []).forEach(w => {
    if (w.photo && w.photo.path && w.photo.url) {
      refs.push({ path: w.photo.path, url: w.photo.url, entryId: entry.id, folder, friendlyBase: friendlyPhotoBaseName(entry, `week${w.week}`) });
    }
  });
  (entry.months || []).forEach(m => {
    if (m.photo && m.photo.path && m.photo.url) {
      refs.push({ path: m.photo.path, url: m.photo.url, entryId: entry.id, folder, friendlyBase: friendlyPhotoBaseName(entry, slugify(m.label) || `month${m.monthIndex}`) });
    }
  });
  if (entry.thenPhoto && entry.thenPhoto.path && entry.thenPhoto.url) {
    refs.push({ path: entry.thenPhoto.path, url: entry.thenPhoto.url, entryId: entry.id, folder, friendlyBase: friendlyPhotoBaseName(entry, "then") });
  }
  if (entry.nowPhoto && entry.nowPhoto.path && entry.nowPhoto.url) {
    refs.push({ path: entry.nowPhoto.path, url: entry.nowPhoto.url, entryId: entry.id, folder, friendlyBase: friendlyPhotoBaseName(entry, "now") });
  }
  return refs;
}

function collectAllPhotoRefs() {
  const seen = new Map(); // dedupe by path — a couple of shapes could theoretically repeat one
  state.entries.forEach(e => {
    collectEntryPhotoRefs(e).forEach(r => { if (!seen.has(r.path)) seen.set(r.path, r); });
  });
  return Array.from(seen.values());
}

// Firestore Timestamps don't survive JSON.stringify in a useful form on
// their own — this turns any of them, anywhere in the object tree, into a
// plain ISO date string so the exported data.json is actually readable.
function timestampReplacer(key, value) {
  if (value && typeof value.toDate === "function") {
    try { return value.toDate().toISOString(); } catch { return value; }
  }
  return value;
}

async function openBackupSheet() {
  await renderBackupSheet();
  document.getElementById("addSheetOverlay").classList.add("open");
  lockBodyScroll();
}

async function renderBackupSheet() {
  const content = document.getElementById("addSheetContent");
  const meta = await getBackupMeta();
  const lastBackupAt = meta && meta.lastBackupAt ? meta.lastBackupAt.toDate() : null;
  const photoCount = collectAllPhotoRefs().length;

  content.innerHTML = `
    <div class="sheet-title">🗄️ Backup &amp; export</div>
    <p style="font-size:13px; color:var(--ink-soft); margin-bottom:4px;">
      <strong>Last backup:</strong> ${lastBackupAt ? formatDate(localDateStr(lastBackupAt)) + ` at ${lastBackupAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Never"}
    </p>
    <p style="font-size:13px; color:var(--ink-soft); margin-bottom:18px;">
      ${state.entries.length} ${state.entries.length === 1 ? "entry" : "entries"} · ${photoCount} ${photoCount === 1 ? "photo" : "photos"}
    </p>
    <p style="font-size:13.5px; line-height:1.6; color:var(--ink-soft); margin-bottom:18px;">
      This downloads everything — every entry, kid profile, tag, trip, and photo — into a single .zip
      file, entirely separate from Firebase. Save it to Google Drive, an external drive, wherever feels
      safe. Photos are grouped into year/category folders (e.g. <em>2026/sonogram/</em>) and named by
      date, type, and who/what they're of (e.g. <em>2026-03-15_sonogram_mason_20-week-scan.jpg</em>)
      instead of a random ID, so the whole thing actually makes sense if you ever browse it directly.
      Nothing in the app changes; this only reads and packages what's already there.
    </p>
    <button class="btn-primary" id="fullBackupBtn">Download full backup (with photos)</button>
    <button class="btn-secondary" id="dataOnlyBackupBtn">Download data only (fast, no photos)</button>
    <div id="backupProgress" style="font-size:12.5px; color:var(--ink-soft); text-align:center; margin-top:10px; min-height:16px;"></div>
    <button class="btn-secondary" id="closeBackupBtn" style="margin-top:14px;">Close</button>
  `;

  document.getElementById("fullBackupBtn").addEventListener("click", () => runBackup(true));
  document.getElementById("dataOnlyBackupBtn").addEventListener("click", () => runBackup(false));
  document.getElementById("closeBackupBtn").addEventListener("click", closeAddSheet);
}

async function runBackup(includePhotos) {
  const fullBtn = document.getElementById("fullBackupBtn");
  const dataBtn = document.getElementById("dataOnlyBackupBtn");
  const progressEl = document.getElementById("backupProgress");
  fullBtn.disabled = true;
  dataBtn.disabled = true;
  progressEl.textContent = "Preparing...";

  try {
    if (typeof JSZip === "undefined") {
      throw new Error("JSZip didn't load — check your connection and try again");
    }

    const manifest = {
      exportedAt: new Date().toISOString(),
      source: "The Jarrett Book",
      kids: KIDS,
      tags: TAGS,
      trips: state.TRIPS,
      hiddenCategoryIds,
      entries: state.entries
    };

    const zip = new JSZip();

    if (includePhotos) {
      const refs = collectAllPhotoRefs();
      const usedNames = new Set();
      const photoIndex = [];
      for (let i = 0; i < refs.length; i++) {
        progressEl.textContent = `Downloading photo ${i + 1} of ${refs.length}...`;
        try {
          const resp = await fetch(refs[i].url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const blob = await resp.blob();
          // Descriptive filenames (date_category_kid_detail), grouped into
          // <year>/<category> folders, instead of a flat dump of raw Storage
          // paths — so browsing the zip actually means something. Since the
          // date leads each filename too, everything sorts chronologically
          // within its folder for free. De-dupe if two photos would
          // otherwise land on the exact same folder+name.
          const ext = (refs[i].path.split(".").pop() || "jpg").toLowerCase();
          const base = refs[i].friendlyBase || "photo";
          const folder = refs[i].folder || "misc";
          let filename = `${base}.${ext}`;
          let attempt = 2;
          while (usedNames.has(`${folder}/${filename}`)) {
            filename = `${base}-${attempt}.${ext}`;
            attempt++;
          }
          usedNames.add(`${folder}/${filename}`);
          zip.file(`photos/${folder}/${filename}`, blob);
          photoIndex.push({ filename: `${folder}/${filename}`, originalPath: refs[i].path, entryId: refs[i].entryId });
        } catch (err) {
          // A single missing/broken photo shouldn't sink the whole backup —
          // log it and keep going with everything else.
          console.warn("Skipped photo in backup:", refs[i].path, err);
        }
      }
      manifest.photoIndex = photoIndex;
    }

    const dataJson = JSON.stringify(manifest, timestampReplacer, 2);
    zip.file("data.json", dataJson);

    progressEl.textContent = "Zipping everything up...";
    const zipBlob = await zip.generateAsync({ type: "blob" }, (metadata) => {
      progressEl.textContent = `Zipping... ${Math.round(metadata.percent)}%`;
    });

    const dateStr = localDateStr(new Date());
    const filename = `masons-book-backup-${dateStr}${includePhotos ? "" : "-data-only"}.zip`;
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    await setDoc(doc(db, "settings", "backupMeta"), {
      lastBackupAt: serverTimestamp(),
      lastBackupType: includePhotos ? "full" : "data-only"
    }, { merge: true });

    showToast("Backup downloaded — save it somewhere safe!");
    await renderBackupSheet();
  } catch (err) {
    console.error("Backup error:", err);
    showToast("Backup failed — try again");
    fullBtn.disabled = false;
    dataBtn.disabled = false;
    progressEl.textContent = "";
  }
}

function closeFabCluster() {
  document.getElementById("fabCluster").classList.remove("open");
}

function bindGlobalEvents() {
  document.getElementById("fab").addEventListener("click", () => {
    // Viewers (not in edit mode) only ever have one option — Filters — so
    // skip the menu entirely and jump straight there. The speed-dial menu
    // only makes sense once there's a second option (Add Entry) to choose from.
    if (!state.isEditMode) {
      openFiltersSheet();
      return;
    }
    document.getElementById("fabCluster").classList.toggle("open");
  });
  document.getElementById("fabFilterMini").addEventListener("click", () => {
    closeFabCluster();
    openFiltersSheet();
  });
  document.getElementById("fabAddMini").addEventListener("click", () => {
    closeFabCluster();
    openAddSheet();
  });
  document.addEventListener("click", (e) => {
    const cluster = document.getElementById("fabCluster");
    if (cluster.classList.contains("open") && !cluster.contains(e.target)) {
      closeFabCluster();
    }
  });
  document.getElementById("manageKidsBtn").addEventListener("click", openManageKidsSheet);
  document.getElementById("backupBtn").addEventListener("click", openBackupSheet);
  document.getElementById("addSheetOverlay").addEventListener("click", (e) => {
    if (e.target.id === "addSheetOverlay") closeAddSheet();
  });
  document.getElementById("pinCancel").addEventListener("click", () => {
    document.getElementById("pinOverlay").classList.remove("open");
    unlockBodyScroll();
    // strip ?edit=1 from URL
    window.history.replaceState({}, "", window.location.pathname);
  });
  document.getElementById("lightboxClose").addEventListener("click", closeLightbox);
  document.getElementById("lightboxDownload").addEventListener("click", downloadCurrentPhoto);
  document.getElementById("lightbox").addEventListener("click", (e) => {
    if (e.target.id === "lightbox") closeLightbox();
  });
  document.getElementById("lightboxPrev").addEventListener("click", lightboxGoPrev);
  document.getElementById("lightboxNext").addEventListener("click", lightboxGoNext);
  document.getElementById("lightboxTapPrev").addEventListener("click", lightboxGoPrev);
  document.getElementById("lightboxTapNext").addEventListener("click", lightboxGoNext);

  document.getElementById("tagEditorClose").addEventListener("click", closeTagEditor);
  document.getElementById("tagEditorDoneBtn").addEventListener("click", closeTagEditor);
  document.getElementById("tagEditorOverlay").addEventListener("click", (e) => {
    if (e.target.id === "tagEditorOverlay") closeTagEditor();
  });

  document.getElementById("lightboxTagsBtn").addEventListener("click", () => {
    lightboxTagsVisible = !lightboxTagsVisible;
    updateLightbox();
  });

  document.getElementById("birthdayRecapClose").addEventListener("click", closeBirthdayRecap);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.getElementById("birthdayRecapOverlay").classList.contains("open")) {
      closeBirthdayRecap();
    }
  });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(err => console.warn("SW registration failed:", err));
  }
}

// ============================================================
init();
