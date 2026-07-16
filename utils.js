// ============================================================
// UTILS — pure helpers with no dependency on app state (entries,
// KIDS, TAGS, TRIPS, filters, etc.). Safe to reuse anywhere.
// ============================================================

export const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function parseLocalDate(dateStr) {
  if (!dateStr) return new Date(NaN);
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function calcAge(birthdateStr, atDateStr) {
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

export function formatDate(dateStr) {
  const d = parseLocalDate(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatTripDateRange(startDate, endDate) {
  if (!startDate) return "";
  const start = parseLocalDate(startDate);
  if (isNaN(start)) return "";
  const startTxt = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (!endDate) return startTxt;
  const end = parseLocalDate(endDate);
  if (isNaN(end)) return startTxt;
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${start.toLocaleDateString('en-US', { month: 'short' })} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`;
  }
  return `${startTxt} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

export function getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

export function isHeicFile(file) {
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  // Many Android browsers don't set file.type correctly for HEIC files
  // picked via the native picker, so the filename extension is checked too.
  return type.includes("heic") || type.includes("heif") || name.endsWith(".heic") || name.endsWith(".heif");
}

export async function convertHeicIfNeeded(file) {
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

let toastTimer;
export function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

let modalOpenCount = 0;
let savedScrollY = 0;
export function lockBodyScroll() {
  if (modalOpenCount === 0) {
    // Pinning the body via position:fixed (rather than just overflow:hidden)
    // is what actually prevents mobile Safari/Chrome from silently resetting
    // scroll to the top when a sheet/lightbox opens and closes.
    savedScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.position = "fixed";
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.documentElement.style.overflow = "hidden";
  }
  modalOpenCount++;
}
export function unlockBodyScroll() {
  modalOpenCount = Math.max(0, modalOpenCount - 1);
  if (modalOpenCount === 0) {
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.documentElement.style.overflow = "";
    window.scrollTo(0, savedScrollY);
  }
}
