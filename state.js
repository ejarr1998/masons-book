// ============================================================
// STATE — shared mutable data that more than one module needs to
// read. Exported as a single object so re-assignment (state.entries =
// newArray) is visible to every module that imported `state`, without
// needing setter functions or circular imports.
// ============================================================

export const state = {
  entries: [],
  TRIPS: [],
  isEditMode: false
};
