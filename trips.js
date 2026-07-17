// ============================================================
// TRIPS — groups entries into a container you browse separately
// from the main feed. Needs a few things back from app.js (rendering
// a normal entry card, binding its interactions, closing the shared
// sheet) — that's a circular import, which ES modules support fine
// as long as those functions are only called later, not at load time.
// ============================================================

import {
  collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { state } from "./state.js";
import { escapeHtml, getVal, showToast, parseLocalDate, formatTripDateRange, lockBodyScroll } from "./utils.js";
import { openSlideshow } from "./slideshow.js";
import { icon } from "./icons.js";
import { renderCard, bindCardEvents, closeAddSheet, renderFeed } from "./app.js";

export function listenToTrips() {
  const tripsCol = collection(db, "trips");
  const q = query(tripsCol, orderBy("startDate", "desc"));
  onSnapshot(q, (snapshot) => {
    state.TRIPS = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderFeed(); // trip cards & the trip picker in the entry form depend on state.TRIPS
  }, (err) => console.error("Trips listen error:", err));
}

export function tripsSummary() {
  return state.TRIPS.length === 0 ? "None yet" : `${state.TRIPS.length} trip${state.TRIPS.length === 1 ? "" : "s"}`;
}

export function tripsSectionBodyHtml() {
  if (state.TRIPS.length === 0) {
    return `<div style="font-size:13px; color:var(--ink-soft);">No trips yet — create one from the entry form when adding a moment.</div>`;
  }
  // state.TRIPS already arrives sorted most-recent-first from Firestore, so group
  // consecutively by year rather than re-sorting.
  const groups = [];
  let currentYear = null;
  for (const t of state.TRIPS) {
    const d = parseLocalDate(t.startDate);
    const year = isNaN(d) ? "Unknown date" : d.getFullYear();
    if (year !== currentYear) {
      groups.push({ year, trips: [] });
      currentYear = year;
    }
    groups[groups.length - 1].trips.push(t);
  }
  return groups.map((g, i) => `
    <div class="filter-subtle-label" style="margin-top:${i === 0 ? '0' : '14px'};">${g.year}</div>
    <div class="trip-filter-list">
      ${g.trips.map(t => `
        <div class="trip-filter-row" data-trip-filter-chip="${t.id}">
          <span class="trip-filter-row-title">🧳 ${escapeHtml(t.title)}</span>
          <span class="trip-filter-row-dates">${escapeHtml(formatTripDateRange(t.startDate, t.endDate))}</span>
        </div>`).join("")}
    </div>`).join("");
}

export function renderTripCard(tripId) {
  const trip = state.TRIPS.find(t => t.id === tripId);
  const tripEntries = state.entries.filter(e => e.tripId === tripId);
  const sorted = [...tripEntries].sort((a, b) => parseLocalDate(b.date) - parseLocalDate(a.date));

  const collagePhotos = [];
  for (const e of sorted) {
    if (collagePhotos.length >= 4) break;
    let url = null;
    if (e.photos && e.photos.length) url = e.photos[0].url;
    else if (e.category === "thennow" && e.nowPhoto) url = e.nowPhoto.url;
    else if (e.category === "pregnancy" && e.subtype === "bump" && e.weeks && e.weeks.length) {
      url = [...e.weeks].sort((a, b) => b.week - a.week)[0].photo?.url || null;
    }
    if (url) collagePhotos.push(url);
  }

  const dateRangeTxt = trip ? formatTripDateRange(trip.startDate, trip.endDate) : "";
  return `
    <div class="card trip-card" data-trip-open="${tripId}">
      <div class="trip-collage trip-collage-${Math.min(collagePhotos.length, 4)}">
        ${collagePhotos.map(url => `<div class="trip-collage-tile" style="background-image:url('${url}')"></div>`).join("")}
        ${collagePhotos.length === 0 ? `<div class="trip-collage-empty">🧳</div>` : ""}
      </div>
      <div class="trip-card-body">
        <div class="trip-card-title">🧳 ${escapeHtml(trip ? trip.title : "Trip")}</div>
        ${trip && trip.location ? `<div class="trip-card-location">📍 ${escapeHtml(trip.location)}</div>` : ""}
        <div class="trip-card-meta">${dateRangeTxt}${dateRangeTxt ? " · " : ""}${tripEntries.length} moment${tripEntries.length === 1 ? "" : "s"}</div>
      </div>
    </div>`;
}

export function tripChipsInnerHtml(selectedTripId, expanded) {
  // Auto-expand if the entry being edited is tagged to a trip that wouldn't
  // otherwise be visible in the collapsed (2-most-recent) view.
  const shouldExpand = expanded || (selectedTripId && !state.TRIPS.slice(0, 2).some(t => t.id === selectedTripId));
  const visibleTrips = shouldExpand ? state.TRIPS : state.TRIPS.slice(0, 2);
  const hiddenCount = state.TRIPS.length - visibleTrips.length;
  return `
    ${visibleTrips.map(t => `<div class="chip ${selectedTripId === t.id ? 'selected' : ''}" data-trip="${t.id}">🧳 ${escapeHtml(t.title)}</div>`).join("")}
    ${hiddenCount > 0 ? `<div class="chip" id="showMoreTripsChip">Show ${hiddenCount} more…</div>` : ""}
    <div class="chip" id="newTripChip">+ New Trip</div>`;
}

export function bindTripChipEvents() {
  const container = document.getElementById("tripChips");
  container.querySelectorAll(".chip[data-trip]").forEach(chip => {
    chip.addEventListener("click", () => {
      // Single-select: picking one deselects the rest; tapping the already-
      // selected one again unassigns the entry from any trip.
      const wasSelected = chip.classList.contains("selected");
      container.querySelectorAll(".chip[data-trip]").forEach(c => c.classList.remove("selected"));
      if (!wasSelected) chip.classList.add("selected");
    });
  });
  const showMoreChip = document.getElementById("showMoreTripsChip");
  if (showMoreChip) {
    showMoreChip.addEventListener("click", () => {
      const currentlySelected = container.querySelector(".chip.selected[data-trip]");
      container.innerHTML = tripChipsInnerHtml(currentlySelected ? currentlySelected.dataset.trip : null, true);
      bindTripChipEvents();
    });
  }
  const newTripChip = document.getElementById("newTripChip");
  newTripChip.addEventListener("click", () => {
    const formEl = document.getElementById("newTripForm");
    formEl.style.display = formEl.style.display === "none" ? "block" : "none";
  });
}

export async function createNewTripInline() {
  const title = getVal("fNewTripTitle").trim();
  if (!title) { showToast("Enter a trip title first"); return; }
  const location = getVal("fNewTripLocation").trim();
  const startDate = getVal("fNewTripStart");
  if (!startDate) { showToast("Pick a start date first"); return; }
  const endDate = getVal("fNewTripEnd");

  const btn = document.getElementById("createTripBtn");
  btn.disabled = true;
  btn.textContent = "Creating...";
  try {
    const docRef = await addDoc(collection(db, "trips"), {
      title, location: location || null, startDate, endDate: endDate || null, createdAt: serverTimestamp()
    });
    state.TRIPS.unshift({ id: docRef.id, title, location: location || null, startDate, endDate: endDate || null });
    document.getElementById("tripChips").innerHTML = tripChipsInnerHtml(docRef.id, true);
    bindTripChipEvents();
    document.getElementById("newTripForm").style.display = "none";
    showToast(`"${title}" created`);
  } catch (err) {
    console.error("Create trip error:", err);
    showToast("Couldn't create trip — try again");
  } finally {
    btn.disabled = false;
    btn.textContent = "Create trip";
  }
}

export function openTripDetail(tripId) {
  renderTripDetail(tripId);
  document.getElementById("addSheetOverlay").classList.add("open");
  lockBodyScroll();
}

export function renderTripDetail(tripId) {
  const content = document.getElementById("addSheetContent");
  const trip = state.TRIPS.find(t => t.id === tripId);
  // Oldest-first here (unlike the main feed) — reads like a proper recap:
  // arrived, then this happened, then that, rather than newest-first.
  const tripEntries = state.entries.filter(e => e.tripId === tripId)
    .sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date));
  const dateRangeTxt = trip ? formatTripDateRange(trip.startDate, trip.endDate) : "";

  content.innerHTML = `
    <div class="trip-detail-header">
      <div class="trip-detail-title-row">
        <div class="sheet-title" style="margin-bottom:2px;">🧳 ${escapeHtml(trip ? trip.title : "Trip")}</div>
        ${state.isEditMode ? `
          <div class="card-edit-controls">
            <button class="icon-btn" id="editTripBtn" aria-label="Edit trip" title="Edit trip">${icon("pencil")}</button>
            <button class="icon-btn danger" id="deleteTripBtn" aria-label="Delete trip" title="Delete trip">${icon("trash")}</button>
          </div>` : ""}
      </div>
      ${trip && trip.location ? `<div class="trip-detail-location">📍 ${escapeHtml(trip.location)}</div>` : ""}
      <div class="trip-detail-meta">${dateRangeTxt}${dateRangeTxt ? " · " : ""}${tripEntries.length} moment${tripEntries.length === 1 ? "" : "s"}</div>
      <button type="button" class="btn-primary" id="playTripSlideshowBtn">▶ Play this trip</button>
    </div>
    <div class="trip-detail-feed">
      ${tripEntries.length ? tripEntries.map(e => renderCard(e)).join("") : `<div class="feed-empty">No moments in this trip yet.</div>`}
    </div>
    <button class="btn-secondary" id="closeTripDetailBtn">Close</button>
  `;

  bindCardEvents(content); // lightbox / bump / thennow / edit / delete all work the same in here
  document.getElementById("closeTripDetailBtn").addEventListener("click", closeAddSheet);
  document.getElementById("playTripSlideshowBtn").addEventListener("click", () => openSlideshow(tripEntries));
  if (state.isEditMode) {
    document.getElementById("editTripBtn").addEventListener("click", () => openTripEditForm(tripId));
    document.getElementById("deleteTripBtn").addEventListener("click", () => confirmDeleteTrip(tripId));
  }
}

export function openTripEditForm(tripId) {
  const trip = state.TRIPS.find(t => t.id === tripId);
  if (!trip) return;
  const content = document.getElementById("addSheetContent");
  content.innerHTML = `
    <div class="sheet-title">✎ Edit trip</div>
    <div class="field"><label>Trip title</label><input type="text" id="fEditTripTitle" value="${escapeHtml(trip.title || "")}"></div>
    <div class="field"><label>Location (optional)</label><input type="text" id="fEditTripLocation" value="${escapeHtml(trip.location || "")}"></div>
    <div class="field-row">
      <div class="field"><label>Start date</label><input type="date" id="fEditTripStart" value="${trip.startDate || ""}"></div>
      <div class="field"><label>End date (optional)</label><input type="date" id="fEditTripEnd" value="${trip.endDate || ""}"></div>
    </div>
    <button class="btn-primary" id="saveTripEditBtn">Save</button>
    <button class="btn-secondary" id="cancelTripEditBtn">Cancel</button>
  `;
  document.getElementById("saveTripEditBtn").addEventListener("click", () => saveTripEdit(tripId));
  document.getElementById("cancelTripEditBtn").addEventListener("click", () => renderTripDetail(tripId));
}

export async function saveTripEdit(tripId) {
  const title = getVal("fEditTripTitle").trim();
  if (!title) { showToast("Enter a trip title first"); return; }
  const location = getVal("fEditTripLocation").trim();
  const startDate = getVal("fEditTripStart");
  if (!startDate) { showToast("Pick a start date first"); return; }
  const endDate = getVal("fEditTripEnd");

  const btn = document.getElementById("saveTripEditBtn");
  btn.disabled = true;
  btn.textContent = "Saving...";
  try {
    await updateDoc(doc(db, "trips", tripId), { title, location: location || null, startDate, endDate: endDate || null });
    showToast("Trip updated");
    renderTripDetail(tripId);
  } catch (err) {
    console.error("Edit trip error:", err);
    showToast("Couldn't save — try again");
    btn.disabled = false;
    btn.textContent = "Save";
  }
}

export function confirmDeleteTrip(tripId) {
  const trip = state.TRIPS.find(t => t.id === tripId);
  if (confirm(`Delete "${trip ? trip.title : 'this trip'}"? Its entries are kept — they'll just no longer be grouped together.`)) {
    deleteTrip(tripId);
  }
}

export async function deleteTrip(tripId) {
  try {
    const tripEntries = state.entries.filter(e => e.tripId === tripId);
    await Promise.all(tripEntries.map(e => updateDoc(doc(db, "entries", e.id), { tripId: null })));
    await deleteDoc(doc(db, "trips", tripId));
    showToast("Trip deleted");
    closeAddSheet();
  } catch (err) {
    console.error("Delete trip error:", err);
    showToast("Couldn't delete — try again");
  }
}
