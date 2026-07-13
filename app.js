// ============================================================
// Mason's Book — app.js
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
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

// ---- Config: kids (add new kids here as they arrive) ----
const KIDS = [
  { id: "mason", name: "Mason", birthdate: "2026-11-24" }
];

// ---- PIN config ----
// Simple client-side gate (not a security boundary — see README).
// Change this to whatever 4-6 digit PIN you and Rachel want.
const EDIT_PIN = "1998"; // ⚠️ CHANGE THIS before sharing the edit link with anyone
const DEVICE_AUTH_KEY = "masonsbook_device_authed";

// ---- Category definitions ----
const CATEGORIES = {
  photo:      { label: "Photo",        emoji: "📷", tagLabel: "Photo" },
  funnything: { label: "Funny Thing",  emoji: "😂", tagLabel: "Said" },
  milestone:  { label: "Milestone",    emoji: "⭐", tagLabel: "Milestone" },
  stat:       { label: "Stat",         emoji: "📏", tagLabel: "Stat" },
  birthday:   { label: "Birthday",     emoji: "🎂", tagLabel: "Birthday" },
  letter:     { label: "Letter",       emoji: "✉️", tagLabel: "Letter" },
  pregnancy:  { label: "Pregnancy",    emoji: "🤰", tagLabel: "Pregnancy" }
};

const MILESTONE_SUGGESTIONS = [
  "First smile", "First laugh", "Rolled over", "Sat up", "First tooth",
  "Crawled", "First steps", "First word", "Slept through the night", "First haircut"
];

// ---- State ----
let entries = [];
let isEditMode = false;
let activeKidFilter = "all";
let activeCategoryFilter = "all";
let selectedType = null;
let pendingPhotos = []; // File objects staged for upload in the add sheet
let editingEntryId = null; // if set, add sheet is in "edit existing" mode

// ============================================================
// INIT
// ============================================================

function init() {
  renderTabs();
  renderPills();
  checkEditRoute();
  listenToEntries();
  registerServiceWorker();
  bindGlobalEvents();
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
  document.getElementById("fab").style.display = "flex";
  signInAnonymously(auth).catch(err => console.error("Auth error:", err));
  renderFeed();
}

// ============================================================
// FIRESTORE LISTENERS
// ============================================================

function listenToEntries() {
  const q = query(collection(db, "entries"), orderBy("date", "desc"));
  onSnapshot(q, (snapshot) => {
    entries = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
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

function renderTabs() {
  const tabsEl = document.getElementById("tabs");
  const tabs = [{ id: "all", name: "Family" }, ...KIDS];
  tabsEl.innerHTML = tabs.map(t =>
    `<div class="tab ${activeKidFilter === t.id ? 'active' : ''}" data-kid="${t.id}">${t.name}</div>`
  ).join("");
  tabsEl.querySelectorAll(".tab").forEach(el => {
    el.addEventListener("click", () => {
      activeKidFilter = el.dataset.kid;
      renderTabs();
      updateHeaderSub();
      renderFeed();
    });
  });
  updateHeaderSub();
}

function updateHeaderSub() {
  const sub = document.getElementById("headerSub");
  if (activeKidFilter === "all") {
    sub.textContent = "Family Feed";
  } else {
    const kid = KIDS.find(k => k.id === activeKidFilter);
    sub.textContent = kid ? `${kid.name}'s Book` : "Feed";
  }
}

function renderPills() {
  const pillsEl = document.getElementById("pills");
  const cats = [{ id: "all", label: "All" }, ...Object.entries(CATEGORIES).map(([id, c]) => ({ id, label: c.label }))];
  pillsEl.innerHTML = cats.map(c =>
    `<div class="pill ${activeCategoryFilter === c.id ? 'active' : ''}" data-cat="${c.id}">${c.label}</div>`
  ).join("");
  pillsEl.querySelectorAll(".pill").forEach(el => {
    el.addEventListener("click", () => {
      activeCategoryFilter = el.dataset.cat;
      renderPills();
      renderFeed();
    });
  });
}

// ============================================================
// FEED RENDERING
// ============================================================

function calcAge(birthdateStr, atDateStr) {
  if (!birthdateStr) return "";
  const birth = new Date(birthdateStr);
  const at = new Date(atDateStr);
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
  const d = new Date(dateStr);
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

function renderFeed() {
  const feedEl = document.getElementById("feed");
  let filtered = entries.filter(e => {
    const kidMatch = activeKidFilter === "all" || (e.kids || []).includes(activeKidFilter);
    const catMatch = activeCategoryFilter === "all" || e.category === activeCategoryFilter;
    return kidMatch && catMatch;
  });

  if (filtered.length === 0) {
    feedEl.innerHTML = `<div class="feed-empty">Nothing here yet.${isEditMode ? ' Tap + to add the first moment.' : ''}</div>`;
    return;
  }

  feedEl.innerHTML = filtered.map(e => renderCard(e)).join("");
  bindCardEvents(filtered);
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
    photosHtml = `<div class="photo-hero"><img src="${e.photos[0].url}" data-lightbox="${e.id}" data-idx="0" alt=""></div>`;
  } else if (e.photos && e.photos.length > 1) {
    photosHtml = `<div class="photo-strip">${e.photos.map((p, i) =>
      `<img src="${p.url}" data-lightbox="${e.id}" data-idx="${i}" alt="">`
    ).join("")}</div>`;
  }

  let ageTxt = "";
  const kidForAge = (e.kids && e.kids[0]) ? KIDS.find(k => k.id === e.kids[0]) : null;
  if (kidForAge) ageTxt = calcAge(kidForAge.birthdate, e.date);

  let body = "";
  switch (e.category) {
    case "milestone":
      body = `<div class="card-title">${escapeHtml(e.title || "")}</div>
              ${e.note ? `<p class="card-text">${escapeHtml(e.note)}</p>` : ""}
              ${ageTxt ? `<span class="card-age">${ageTxt}</span>` : ""}`;
      break;
    case "funnything":
      body = `<span class="quote-mark">"</span>
              <div class="card-title">${escapeHtml(e.quote || "")}</div>
              ${e.context ? `<p class="card-context">${escapeHtml(e.context)}</p>` : ""}`;
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
      body = `<div class="card-title">${escapeHtml(e.title || "Pregnancy update")}</div>
              ${e.caption ? `<p class="card-text">${escapeHtml(e.caption)}</p>` : ""}`;
      break;
    default: // photo
      body = `${e.caption ? `<p class="card-text">${escapeHtml(e.caption)}</p>` : ""}
              ${ageTxt ? `<span class="card-age">${ageTxt}</span>` : ""}`;
  }

  return `
    <div class="card ${e.category}" data-entry="${e.id}">
      ${editControls}
      <div class="card-meta">
        <span class="card-date">${formatDate(e.date)}</span>
        <span class="card-tag">${cat.tagLabel}</span>
      </div>
      ${photosHtml}
      <div class="card-body">
        ${body}
        ${kidsTxt ? `<div class="card-kids" style="margin-top:8px;">${escapeHtml(kidsTxt)}</div>` : ""}
      </div>
    </div>`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function bindCardEvents(filtered) {
  document.querySelectorAll("[data-lightbox]").forEach(img => {
    img.addEventListener("click", () => {
      const entryId = img.dataset.lightbox;
      const idx = parseInt(img.dataset.idx, 10);
      const entry = filtered.find(e => e.id === entryId);
      openLightbox(entry.photos, idx, entry.caption || "");
    });
  });
  if (isEditMode) {
    document.querySelectorAll("[data-edit]").forEach(btn => {
      btn.addEventListener("click", () => openEditSheet(btn.dataset.edit));
    });
    document.querySelectorAll("[data-delete]").forEach(btn => {
      btn.addEventListener("click", () => confirmDelete(btn.dataset.delete));
    });
  }
}

// ============================================================
// LIGHTBOX
// ============================================================

let lightboxPhotos = [];
let lightboxIdx = 0;
let lightboxCaption = "";

function openLightbox(photos, idx, caption) {
  lightboxPhotos = photos;
  lightboxIdx = idx;
  lightboxCaption = caption;
  updateLightbox();
  document.getElementById("lightbox").classList.add("open");
}
function updateLightbox() {
  const photo = lightboxPhotos[lightboxIdx];
  document.getElementById("lightboxImg").src = photo.url;
  const cap = photo.caption || lightboxCaption || "";
  document.getElementById("lightboxCaption").textContent = cap;
  const showNav = lightboxPhotos.length > 1;
  document.getElementById("lightboxPrev").style.display = showNav ? "block" : "none";
  document.getElementById("lightboxNext").style.display = showNav ? "block" : "none";
}
function closeLightbox() {
  document.getElementById("lightbox").classList.remove("open");
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
  renderTypePicker();
  document.getElementById("addSheetOverlay").classList.add("open");
}

function openEditSheet(entryId) {
  const entry = entries.find(e => e.id === entryId);
  if (!entry) return;
  editingEntryId = entryId;
  selectedType = entry.category;
  pendingPhotos = [];
  renderEntryForm(entry);
  document.getElementById("addSheetOverlay").classList.add("open");
}

function closeAddSheet() {
  document.getElementById("addSheetOverlay").classList.remove("open");
}

function renderTypePicker() {
  const content = document.getElementById("addSheetContent");
  content.innerHTML = `
    <div class="sheet-title">Add a moment</div>
    <div class="type-grid">
      ${Object.entries(CATEGORIES).map(([id, c]) => `
        <div class="type-btn" data-type="${id}">
          <span class="emoji">${c.emoji}</span>
          <span>${c.label}</span>
        </div>`).join("")}
    </div>
  `;
  content.querySelectorAll(".type-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedType = btn.dataset.type;
      renderEntryForm();
    });
  });
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
  const today = new Date().toISOString().slice(0, 10);

  const kidChips = `
    <div class="field">
      <label>Who's this about</label>
      <div class="chip-select" id="kidChips">
        ${KIDS.map(k => `<div class="chip ${defaultKids.includes(k.id) ? 'selected' : ''}" data-kid="${k.id}">${k.name}</div>`).join("")}
      </div>
    </div>`;

  const dateField = `
    <div class="field">
      <label>Date</label>
      <input type="date" id="fDate" value="${existing ? existing.date : today}">
    </div>`;

  let typeFields = "";
  switch (selectedType) {
    case "photo":
      typeFields = `
        ${photoPickerHtml(existing)}
        <div class="field"><label>Caption</label><textarea id="fCaption" placeholder="What's happening here?">${existing ? existing.caption || "" : ""}</textarea></div>`;
      break;
    case "funnything":
      typeFields = `
        <div class="field"><label>What did they say?</label><textarea id="fQuote" placeholder="The exact words..." autofocus>${existing ? existing.quote || "" : ""}</textarea></div>
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
    case "pregnancy":
      typeFields = `
        <div class="field"><label>Title</label><input type="text" id="fTitle" placeholder="e.g. Anatomy scan day" value="${existing ? escapeHtml(existing.title || "") : ""}"></div>
        <div class="field"><label>Caption</label><textarea id="fCaption">${existing ? existing.caption || "" : ""}</textarea></div>
        ${photoPickerHtml(existing)}`;
      break;
  }

  content.innerHTML = `
    <div class="sheet-title">${cat.emoji} ${existing ? "Edit" : "New"} ${cat.label}</div>
    ${dateField}
    ${typeFields}
    ${kidChips}
    <button class="btn-primary" id="saveEntryBtn">Save</button>
    <button class="btn-secondary" id="cancelEntryBtn">Cancel</button>
  `;

  // Kid chip toggling
  content.querySelectorAll("#kidChips .chip").forEach(chip => {
    chip.addEventListener("click", () => chip.classList.toggle("selected"));
  });

  // Milestone suggestion chips
  content.querySelectorAll("[data-milestone]").forEach(chip => {
    chip.addEventListener("click", () => {
      document.getElementById("fTitle").value = chip.dataset.milestone;
    });
  });

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
    photoInput.addEventListener("change", (e) => {
      pendingPhotos = Array.from(e.target.files);
      renderPhotoPreview();
    });
  }

  document.getElementById("cancelEntryBtn").addEventListener("click", closeAddSheet);
  document.getElementById("saveEntryBtn").addEventListener("click", saveEntry);
}

function photoPickerHtml(existing) {
  return `
    <div class="field">
      <label>Photos (optional)</label>
      <input type="file" id="fPhotos" accept="image/*" multiple>
      <div class="photo-input-preview" id="photoPreview">
        ${existing && existing.photos ? existing.photos.map(p => `<img src="${p.url}">`).join("") : ""}
      </div>
    </div>`;
}

function renderPhotoPreview() {
  const preview = document.getElementById("photoPreview");
  if (!preview) return;
  preview.innerHTML = "";
  pendingPhotos.forEach(file => {
    const url = URL.createObjectURL(file);
    preview.innerHTML += `<img src="${url}">`;
  });
}

// ---- Save (create or update) ----

async function saveEntry() {
  const btn = document.getElementById("saveEntryBtn");
  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    const selectedKids = Array.from(document.querySelectorAll("#kidChips .chip.selected")).map(c => c.dataset.kid);
    localStorage.setItem("masonsbook_last_kids", JSON.stringify(selectedKids));

    const date = document.getElementById("fDate").value;
    const data = { category: selectedType, kids: selectedKids, date, updatedAt: serverTimestamp() };

    switch (selectedType) {
      case "photo":
        data.caption = getVal("fCaption"); break;
      case "funnything":
        data.quote = getVal("fQuote");
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
      case "pregnancy":
        data.title = getVal("fTitle");
        data.caption = getVal("fCaption");
        break;
    }

    // Upload any new photos
    if (pendingPhotos.length > 0) {
      const uploaded = await uploadPhotos(pendingPhotos);
      const existing = editingEntryId ? (entries.find(e => e.id === editingEntryId)?.photos || []) : [];
      data.photos = [...existing, ...uploaded];
    }

    if (editingEntryId) {
      await updateDoc(doc(db, "entries", editingEntryId), data);
      showToast("Entry updated");
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, "entries"), data);
      showToast("Added to the book");
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

async function uploadPhotos(files) {
  const results = [];
  for (const file of files) {
    const compressed = await compressImage(file);
    const filename = `entries/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const storageRef = ref(storage, filename);
    await uploadBytes(storageRef, compressed);
    const url = await getDownloadURL(storageRef);
    results.push({ url });
  }
  return results;
}

function compressImage(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) { height *= maxDim / width; width = maxDim; }
      else if (height > maxDim) { width *= maxDim / height; height = maxDim; }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => resolve(blob), "image/jpeg", quality);
    };
    img.onerror = reject;
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

function bindGlobalEvents() {
  document.getElementById("fab").addEventListener("click", openAddSheet);
  document.getElementById("addSheetOverlay").addEventListener("click", (e) => {
    if (e.target.id === "addSheetOverlay") closeAddSheet();
  });
  document.getElementById("pinCancel").addEventListener("click", () => {
    document.getElementById("pinOverlay").classList.remove("open");
    // strip ?edit=1 from URL
    window.history.replaceState({}, "", window.location.pathname);
  });
  document.getElementById("lightboxClose").addEventListener("click", closeLightbox);
  document.getElementById("lightbox").addEventListener("click", (e) => {
    if (e.target.id === "lightbox") closeLightbox();
  });
  document.getElementById("lightboxPrev").addEventListener("click", () => {
    lightboxIdx = (lightboxIdx - 1 + lightboxPhotos.length) % lightboxPhotos.length;
    updateLightbox();
  });
  document.getElementById("lightboxNext").addEventListener("click", () => {
    lightboxIdx = (lightboxIdx + 1) % lightboxPhotos.length;
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
