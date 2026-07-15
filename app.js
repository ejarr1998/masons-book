// ============================================================
// Mason's Book — app.js
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, setDoc,
  onSnapshot, query, orderBy, where, serverTimestamp, getDocs, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ---- Firebase config ----
const firebaseConfig = {
  apiKey: "AIzaSyCQEgZO95OgLJdwk04LSj-uC3eSa0Dbv0I",
  authDomain: "masons-book.firebaseapp.com",
  projectId: "masons-book",
  storageBucket: "masons-book.firebasestorage.app",
  messagingSenderId: "837372077507",
  appId: "1:837372077507:web:a1e473926d0b0701c2c976"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);
const auth = getAuth(app);

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
  thennow:    { label: "Then vs. Now", emoji: "↔️", tagLabel: "Then vs. Now" }
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

// ---- State ----
let entries = [];
let isEditMode = false;
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
let pendingPhotoMeta = []; // {location, people} kept index-aligned with pendingPhotos
let thenNowPending = { then: null, now: null }; // staged Files for the Then/Now slider, keyed by side
let thenNowExisting = { then: null, now: null }; // already-uploaded {url, path} photos when editing
let thenNowFocal = { then: { x: 50, y: 50 }, now: { x: 50, y: 50 } }; // object-position focal point per side, as percentages
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
let modalOpenCount = 0;
function lockBodyScroll() {
  modalOpenCount++;
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
}
function unlockBodyScroll() {
  modalOpenCount = Math.max(0, modalOpenCount - 1);
  if (modalOpenCount === 0) {
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
  }
}

function init() {
  updateHeaderSub();
  updateFiltersButtonBadge();
  checkEditRoute();
  listenToKids();
  listenToCategoryConfig();
  listenToTags();
  listenToEntries();
  registerServiceWorker();
  bindGlobalEvents();
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
  const params = new URLSearchParams(window.location.search);
  const wantsEdit = params.get("edit") === "1";
  if (!wantsEdit) return;

  const deviceAuthed = localStorage.getItem(DEVICE_AUTH_KEY) === "true";
  if (deviceAuthed) {
    enterEditMode();
  } else {
    openPinScreen();
  }
}

function enterEditMode() {
  isEditMode = true;
  document.getElementById("modeBadge").textContent = "Edit mode";
  document.getElementById("modeBadge").classList.add("edit");
  document.getElementById("fabAddMini").style.display = "flex";
  document.getElementById("manageKidsBtn").style.display = "flex";
  signInAnonymously(auth)
    .then(() => {
      // Only now is request.auth actually populated server-side, so only
      // now can we safely re-subscribe with the unrestricted query.
      listenToEntries();
      migrateLegacyPrivacyField();
    })
    .catch(err => console.error("Auth error:", err));
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
  const q = isEditMode
    ? query(entriesCol, orderBy("date", "desc"))
    : query(entriesCol, where("isPrivate", "==", false), orderBy("date", "desc"));

  unsubscribeEntriesListener = onSnapshot(q, (snapshot) => {
    entries = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
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
}

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function getEntryYears() {
  return Array.from(new Set(
    entries.map(e => parseLocalDate(e.date).getFullYear()).filter(y => !isNaN(y))
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
      entries
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

  document.getElementById("applyFiltersBtn").addEventListener("click", () => {
    updateHeaderSub();
    updateFiltersButtonBadge();
    renderFeed();
    closeAddSheet();
  });
  document.getElementById("clearAllFiltersBtn").addEventListener("click", () => {
    activeKidFilter = "all";
    activeCategoryFilter = "all";
    activeYearFilter = "all";
    activeMonthFilter = "all";
    activeTagFilters = [];
    updateHeaderSub();
    updateFiltersButtonBadge();
    renderFeed();
    closeAddSheet();
  });
}

// ============================================================
// FEED RENDERING
// ============================================================

// Parses a "YYYY-MM-DD" string as a LOCAL date, not UTC — avoids the classic
// off-by-one bug where new Date("2026-11-24") shifts back a day in US timezones.
function parseLocalDate(dateStr) {
  if (!dateStr) return new Date(NaN);
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function calcAge(birthdateStr, atDateStr) {
  if (!birthdateStr) return "";
  const birth = parseLocalDate(birthdateStr);
  const at = parseLocalDate(atDateStr);
  if (isNaN(birth) || isNaN(at)) return "";
  let months = (at.getFullYear() - birth.getFullYear()) * 12 + (at.getMonth() - birth.getMonth());
  if (at.getDate() < birth.getDate()) months--;
  if (months < 0) return "";
  if (months < 1) {
    const days = Math.floor((at - birth) / (1000 * 60 * 60 * 24));
    return `${days} day${days === 1 ? '' : 's'} old`;
  }
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  if (years === 0) return `${remMonths} month${remMonths === 1 ? '' : 's'} old`;
  return `${years} yr${years === 1 ? '' : 's'}${remMonths ? ', ' + remMonths + ' mo' : ''} old`;
}

function formatDate(dateStr) {
  const d = parseLocalDate(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

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

function renderFeed() {
  const feedEl = document.getElementById("feed");
  let filtered = entries.filter(e => {
    const kidMatch = activeKidFilter === "all" || (e.kids || []).includes(activeKidFilter);
    const catMatch = activeCategoryFilter === "all" || e.category === activeCategoryFilter;
    const entryDate = parseLocalDate(e.date);
    const yearMatch = activeYearFilter === "all" || (!isNaN(entryDate) && entryDate.getFullYear() === activeYearFilter);
    const monthMatch = activeMonthFilter === "all" || (!isNaN(entryDate) && entryDate.getMonth() === activeMonthFilter);
    const tagMatch = activeTagFilters.length === 0 || (e.tags || []).some(t => activeTagFilters.includes(t));
    return kidMatch && catMatch && yearMatch && monthMatch && tagMatch;
  });

  // On This Day only makes sense on the all-time view — a specific year/month
  // filter already IS a trip back in time, so the widget would be redundant.
  let onThisDayHtml = "";
  if (activeYearFilter === "all" && activeMonthFilter === "all") {
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
    feedEl.innerHTML = onThisDayHtml + `<div class="feed-empty">Nothing here yet.${isEditMode ? ' Tap + to add the first moment.' : ''}</div>`;
    bindCardEvents(feedEl);
    return;
  }

  feedEl.innerHTML = onThisDayHtml + filtered.map(e => renderCard(e)).join("");
  bindCardEvents(feedEl);
}

// ---- On This Day: resurfaces a random past-years entry from today's date ----

function computeOnThisDayPool() {
  const today = new Date();
  return entries.filter(e => {
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
        <span class="on-this-day-ribbon">🕰️ On This Day — ${yearsAgo} year${yearsAgo === 1 ? "" : "s"} ago</span>
        ${poolSize > 1 ? `<button class="on-this-day-shuffle" id="onThisDayShuffleBtn" title="Show another">🔀 Another</button>` : ""}
      </div>
      ${renderCard(entry)}
    </div>`;
}

function renderCard(e) {
  const cat = CATEGORIES[e.category] || CATEGORIES.photo;
  const kidsTxt = kidsLabel(e.kids);
  const editControls = isEditMode ? `
    <div class="card-edit-controls">
      <button class="icon-btn" data-edit="${e.id}">✎</button>
      <button class="icon-btn danger" data-delete="${e.id}">🗑</button>
    </div>` : "";

  let photosHtml = "";
  if (e.photos && e.photos.length === 1) {
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
      body = `<div class="card-title">${e.birthdayNum ? `Birthday #${escapeHtml(e.birthdayNum)}` : "Birthday"}${e.theme ? `: ${escapeHtml(e.theme)}` : ""}</div>
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
        const latest = sortedWeeks[sortedWeeks.length - 1];
        const isExpanded = expandedBumpEntries.has(e.id);
        body = `<div class="card-title">Bump Progression</div>
                <div class="bump-progress-sub">${sortedWeeks.length} update${sortedWeeks.length === 1 ? "" : "s"} so far · latest: week ${latest.week}</div>
                <div class="bump-strip ${isExpanded ? "expanded" : ""}" id="bumpStrip-${e.id}">
                  ${sortedWeeks.map((w, i) => `
                    <div class="bump-week-thumb" data-bump-entry="${e.id}" data-bump-idx="${i}">
                      <img src="${w.photo.url}">
                      <span class="bump-week-badge">Wk ${w.week}</span>
                    </div>`).join("")}
                </div>
                <button class="bump-toggle-btn" data-bump-toggle="${e.id}">${isExpanded ? "▴ Show as scroll" : "▾ Show all weeks"}</button>`;
      } else {
        body = `<div class="card-title">${escapeHtml(e.title || "Pregnancy update")}</div>
                ${e.caption ? `<p class="photo-caption" style="color:rgba(246,241,231,0.85);">${escapeHtml(e.caption)}</p>` : ""}`;
      }
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
          return t ? `<span class="entry-tag-pill">${t.isPrivate ? "🔒" : "#"}${escapeHtml(t.name)}</span>` : "";
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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function bindCardEvents(root) {
  root.querySelectorAll("[data-lightbox]").forEach(img => {
    img.addEventListener("click", () => {
      const entryId = img.dataset.lightbox;
      const idx = parseInt(img.dataset.idx, 10);
      const entry = entries.find(e => e.id === entryId);
      openLightbox(entry.photos, idx, entry.caption || "");
    });
  });
  root.querySelectorAll("[data-bump-entry]").forEach(thumb => {
    thumb.addEventListener("click", () => {
      const entryId = thumb.dataset.bumpEntry;
      const idx = parseInt(thumb.dataset.bumpIdx, 10);
      const entry = entries.find(e => e.id === entryId);
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
      btn.textContent = isNowExpanded ? "▴ Show as scroll" : "▾ Show all weeks";
    });
  });
  initThenNowSliders(root);
  const shuffleBtn = root.querySelector("#onThisDayShuffleBtn");
  if (shuffleBtn) {
    shuffleBtn.addEventListener("click", () => {
      const entry = pickOnThisDayEntry(onThisDayPool);
      const wrap = document.getElementById("onThisDayWrap");
      wrap.outerHTML = renderOnThisDayWidgetHtml(entry, onThisDayPool.length);
      bindCardEvents(document.getElementById("onThisDayWrap"));
    });
  }
  if (isEditMode) {
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
  tagsBtn.textContent = lightboxTagsVisible ? "🏷️ Hide tags" : "🏷️ Show tags";
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
  const originalText = btn.textContent;
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
    btn.textContent = originalText;
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
  keypad.innerHTML = keys.map(k => k ? `<button class="pin-key" data-key="${k}">${k}</button>` : `<div></div>`).join("");
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
  renderTypePicker();
  document.getElementById("addSheetOverlay").classList.add("open");
  lockBodyScroll();
}

function openEditSheet(entryId) {
  const entry = entries.find(e => e.id === entryId);
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
  renderEntryForm(entry);
  document.getElementById("addSheetOverlay").classList.add("open");
  lockBodyScroll();
}

function closeAddSheet() {
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
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
    <button class="collapse-toggle" id="manageTypesLink" style="margin-top:6px;">⚙ Manage entry types</button>
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
          <div class="field"><label>Birthday #</label><input type="number" id="fBirthdayNum" min="1" max="18" value="${existing ? existing.birthdayNum || "" : ""}"></div>
          <div class="field"><label>Theme</label><input type="text" id="fTheme" placeholder="e.g. Dinosaurs" value="${existing ? escapeHtml(existing.theme || "") : ""}"></div>
        </div>
        <div class="field"><label>Note (optional)</label><textarea id="fNote">${existing ? existing.note || "" : ""}</textarea></div>
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
                📷
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
                📷
                <input type="file" accept="image/*" id="fNowPhoto" style="display:none;">
              </label>
            </div>
            <input type="text" id="fNowLabel" placeholder="e.g. 1 Year Old" value="${existing ? escapeHtml(existing.nowLabel || "") : ""}">
          </div>
        </div>
        <div class="field"><label>Caption (optional)</label><textarea id="fCaption" placeholder="What's changed...">${existing ? existing.caption || "" : ""}</textarea></div>`;
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
    <button class="btn-primary" id="saveEntryBtn">Save</button>
    <button class="btn-secondary" id="cancelEntryBtn">Cancel</button>
  `;

  // Kid chip toggling
  content.querySelectorAll("#kidChips .chip").forEach(chip => {
    chip.addEventListener("click", () => chip.classList.toggle("selected"));
  });

  // Tag chip toggling + inline new-tag creation
  content.querySelectorAll("#tagChips .chip").forEach(chip => {
    chip.addEventListener("click", () => chip.classList.toggle("selected"));
  });
  document.getElementById("addNewTagBtn").addEventListener("click", addNewTagInline);
  document.getElementById("newTagInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addNewTagInline(); }
  });

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
        📷
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
      row.remove();
      bumpWeekRows[rowIndex] = null; // keep indices stable; filtered out on collect
    } else {
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

  editingPhotos.forEach((p, i) => {
    if (!p.people) p.people = [];
    preview.innerHTML += `
      <div class="photo-thumb">
        <img src="${p.url}">
        <button type="button" class="photo-thumb-remove" data-remove-existing="${i}" title="Remove photo">×</button>
        <button type="button" class="photo-thumb-tag-btn" data-tag-existing="${i}" title="Tag people">🏷️</button>
      </div>`;
  });
  pendingPhotos.forEach((file, i) => {
    if (!pendingPhotoMeta[i]) pendingPhotoMeta[i] = { location: "", people: [] };
    preview.innerHTML += `
      <div class="photo-thumb">
        <img id="pendingPreviewImg${i}" src="" alt="">
        <button type="button" class="photo-thumb-remove" data-remove-pending="${i}" title="Remove photo">×</button>
        <button type="button" class="photo-thumb-tag-btn" data-tag-pending="${i}" title="Tag people">🏷️</button>
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

  const btn = document.getElementById("saveEntryBtn");
  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    const selectedKids = Array.from(document.querySelectorAll("#kidChips .chip.selected")).map(c => c.dataset.kid);
    localStorage.setItem("masonsbook_last_kids", JSON.stringify(selectedKids));
    const selectedTags = Array.from(document.querySelectorAll("#tagChips .chip.selected")).map(c => c.dataset.tag);

    const date = document.getElementById("fDate").value;
    const data = {
      category: selectedType, kids: selectedKids, tags: selectedTags,
      isPrivate: selectedTags.includes("private"), // real field the view-mode query filters on
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
  } finally {
    btn.disabled = false;
    btn.textContent = "Save";
  }
}

function getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

function isHeicFile(file) {
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  // Many Android browsers don't set file.type correctly for HEIC files
  // picked via the native picker, so the filename extension is checked too.
  return type.includes("heic") || type.includes("heif") || name.endsWith(".heic") || name.endsWith(".heif");
}

async function convertHeicIfNeeded(file) {
  if (!isHeicFile(file)) return file;
  if (typeof heic2any !== "function") {
    console.warn("heic2any not loaded — uploading HEIC file as-is, it may not display correctly.");
    return file;
  }
  try {
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
    // heic2any resolves to a single Blob, or an array of Blobs for multi-image HEIC files (e.g. Live Photos) — use the first.
    return Array.isArray(converted) ? converted[0] : converted;
  } catch (err) {
    console.warn("HEIC conversion failed, uploading original file:", err);
    return file;
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

function confirmDelete(entryId) {
  if (confirm("Delete this entry? This can't be undone.")) {
    deleteDoc(doc(db, "entries", entryId))
      .then(() => showToast("Deleted"))
      .catch(err => { console.error(err); showToast("Couldn't delete — try again"); });
  }
}

// ============================================================
// TOAST
// ============================================================

let toastTimer;
function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

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
    <div class="sheet-title">⚙ Manage entry types</div>
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

function closeFabCluster() {
  document.getElementById("fabCluster").classList.remove("open");
}

function bindGlobalEvents() {
  document.getElementById("fab").addEventListener("click", () => {
    // Viewers (not in edit mode) only ever have one option — Filters — so
    // skip the menu entirely and jump straight there. The speed-dial menu
    // only makes sense once there's a second option (Add Entry) to choose from.
    if (!isEditMode) {
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
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(err => console.warn("SW registration failed:", err));
  }
}

// ============================================================
init();
