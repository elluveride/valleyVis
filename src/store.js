// App state: the routine library (each routine with its own undo/redo), settings, UI selection, and derived
// results (resolved geometry, timeline, collisions) recomputed only when inputs change.

import { checkCollisions } from './collision.js';
import { cloneDeep, DEFAULT_SETTINGS, emptyProject } from './defaults.js';
import { lintProject } from './lint.js';
import { resolveProject } from './resolve.js';
import { normalizeProject, normalizeSettings } from './schema.js';
import { simulate } from './simulate.js';
import { debounce, safeStorage } from './util.js';

const LEGACY_PROJECT_KEY = 'valleyvis.project.v1'; // single routine, before the library existed
const LIBRARY_KEY = 'valleyvis.library.v1';
const SETTINGS_KEY = 'valleyvis.settings.v1';
const UI_KEY = 'valleyvis.ui.v1';
const HISTORY_MAX = 200;

let idCounter = 0;
function routineId() {
  idCounter += 1;
  return `r-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/** Saved routines from storage, repaired; migrates the old single-routine key. */
function loadLibrary(storage) {
  const raw = storage.get(LIBRARY_KEY);
  const routines = [];
  if (raw && typeof raw === 'object' && Array.isArray(raw.routines)) {
    const seen = new Set();
    for (const r of raw.routines) {
      if (!r || typeof r !== 'object' || !r.project) continue;
      const id = typeof r.id === 'string' && r.id && !seen.has(r.id) ? r.id : routineId();
      seen.add(id);
      routines.push({ id, project: normalizeProject(r.project) });
    }
  }
  let fresh = false;
  let unsaved = false; // built here rather than read from the library key: needs a first save
  if (!routines.length) {
    const legacy = storage.get(LEGACY_PROJECT_KEY);
    fresh = !legacy;
    unsaved = true;
    routines.push({ id: routineId(), project: legacy ? normalizeProject(legacy) : emptyProject() });
  }
  const currentId = routines.some((r) => r.id === raw?.currentId) ? raw.currentId : routines[0].id;
  return { routines, currentId, fresh, unsaved };
}

export function createStore() {
  const storage = safeStorage();
  const rawUi = storage.get(UI_KEY);
  const savedUi = rawUi && typeof rawUi === 'object' && !Array.isArray(rawUi) ? rawUi : {};
  const library = loadLibrary(storage);
  const state = {
    project: library.routines.find((r) => r.id === library.currentId).project,
    settings: normalizeSettings(storage.get(SETTINGS_KEY)),
    ui: {
      alliance: savedUi.alliance === 'red' ? 'red' : 'blue',
      tab: ['routine', 'zones', 'problems'].includes(savedUi.tab) ? savedUi.tab : 'routine',
      view: {
        footprints: savedUi.view?.footprints === true,
        park: savedUi.view?.park !== false,
        labels: savedUi.view?.labels !== false,
      },
      selectedStepId: null,
      selectedZoneId: null,
      tool: 'select',
    },
  };
  const playback = { playing: false, time: 0, speed: 1, loop: false };
  const histories = new Map(); // routine id -> { undo, redo }, kept for this browser session
  const history = () => {
    if (!histories.has(library.currentId)) histories.set(library.currentId, { undo: [], redo: [] });
    return histories.get(library.currentId);
  };
  let pending = null; // snapshot taken at beginEdit()
  let rev = 0;
  let derivedCache = null;
  const listeners = new Set();
  let storageWarned = false;

  function save(key, value) {
    if (storage.set(key, value)) return;
    if (!storageWarned && typeof store.onStorageError === 'function') {
      storageWarned = true;
      store.onStorageError(key);
    }
  }
  const entry = () => library.routines.find((r) => r.id === library.currentId);

  // Other tabs share the same storage. Each tab remembers which routines it changed ("dirty")
  // or deleted, and merges with what is on disk before writing, so tabs never erase each other.
  const dirty = new Set(library.unsaved ? [library.currentId] : []);
  const removed = new Set();
  const markDirty = () => dirty.add(library.currentId);

  /** Fold in what other tabs saved. Returns true if the routine on screen was replaced. */
  function mergeWithDisk() {
    const raw = storage.get(LIBRARY_KEY);
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.routines)) return false;
    const disk = new Map();
    for (const r of raw.routines) if (r && typeof r.id === 'string' && r.project) disk.set(r.id, r.project);
    const before = entry().project;
    const merged = [];
    const mine = new Set();
    for (const r of library.routines) {
      mine.add(r.id);
      if (dirty.has(r.id)) merged.push(r); // changed here: ours wins
      else if (disk.has(r.id)) merged.push({ id: r.id, project: normalizeProject(disk.get(r.id)) }); // maybe changed elsewhere
      else if (r.id === library.currentId) { dirty.add(r.id); merged.push(r); } // deleted elsewhere while open here: keep it
      // otherwise it was deleted in another tab
    }
    for (const [id, project] of disk) {
      if (!mine.has(id) && !removed.has(id)) merged.push({ id, project: normalizeProject(project) }); // created elsewhere
    }
    library.routines.splice(0, library.routines.length, ...merged);
    const current = entry().project;
    const changed = JSON.stringify(current) !== JSON.stringify(before);
    // keep the same object when nothing changed, so in-flight edits stay attached
    if (!changed) entry().project = before;
    state.project = entry().project;
    return changed;
  }

  function writeLibrary() {
    mergeWithDisk();
    save(LIBRARY_KEY, { currentId: library.currentId, routines: library.routines });
    dirty.clear();
    removed.clear();
  }
  const persistProject = debounce(writeLibrary, 300);
  let settingsDirty = false;
  const writeSettings = debounce(() => {
    save(SETTINGS_KEY, state.settings);
    settingsDirty = false;
  }, 300);
  const persistSettings = () => {
    settingsDirty = true;
    writeSettings();
  };
  const persistUi = debounce(() => save(UI_KEY, { alliance: state.ui.alliance, tab: state.ui.tab, view: state.ui.view }), 300);

  /** Point the current library entry at a new project object and make it the live one. */
  function setProject(project) {
    entry().project = project;
    state.project = project;
    markDirty();
    rev += 1;
  }

  function uniqueName(name) {
    const taken = new Set(library.routines.map((r) => r.project.name));
    if (!taken.has(name)) return name;
    const base = name.replace(/ \(\d+\)$/, '');
    let n = 2;
    while (taken.has(`${base} (${n})`)) n += 1;
    return `${base} (${n})`;
  }

  function resetView() {
    state.ui.selectedStepId = null;
    state.ui.selectedZoneId = null;
    state.ui.tool = 'select';
    playback.time = 0;
    playback.playing = false;
  }

  function emit(kind, opts = {}) {
    for (const l of listeners) l(kind, opts);
  }

  function snapshot() {
    return JSON.stringify(state.project);
  }

  function pushUndo(snap) {
    if (snap === snapshot()) return;
    const h = history();
    h.undo.push(snap);
    if (h.undo.length > HISTORY_MAX) h.undo.shift();
    h.redo.length = 0;
  }

  const store = {
    state,
    playback,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Start a continuous edit (drag, typing); one undo entry until commit(). */
    beginEdit() {
      if (pending === null) pending = snapshot();
    },
    commit() {
      if (pending !== null) {
        pushUndo(pending);
        pending = null;
        emit('history');
      }
    },
    /** Mutate the project. opts.history (default true) records an undo step; opts.source tags the change. */
    update(fn, opts = {}) {
      const history = opts.history !== false && pending === null;
      const before = history ? snapshot() : null;
      fn(state.project);
      markDirty();
      rev += 1;
      if (history) pushUndo(before);
      persistProject();
      emit('project', opts);
    },
    /** Replace the current routine's contents (undoable). */
    replaceProject(project, opts = {}) {
      store.commit();
      const before = snapshot();
      setProject(normalizeProject(project));
      if (opts.history !== false) pushUndo(before);
      resetView();
      persistProject();
      emit('project', { ...opts, replaced: true });
    },

    /* ----- routine library ----- */
    /** True when nothing was saved in this browser before (first visit). */
    fresh: library.fresh,
    routines: () => library.routines.map((r) => ({ id: r.id, name: r.project.name, steps: r.project.steps.length, current: r.id === library.currentId })),
    currentRoutineId: () => library.currentId,
    /** Add a routine to the library and open it. Nothing is overwritten. */
    addRoutine(project, opts = {}) {
      store.commit();
      const normalized = normalizeProject(project);
      normalized.name = uniqueName(normalized.name);
      const id = routineId();
      library.routines.push({ id, project: normalized });
      dirty.add(id);
      if (opts.select !== false) store.switchRoutine(id);
      else persistProject();
      return id;
    },
    switchRoutine(id) {
      if (!library.routines.some((r) => r.id === id)) return;
      store.commit();
      library.currentId = id;
      state.project = entry().project;
      rev += 1;
      resetView();
      persistProject();
      emit('project', { replaced: true, switched: true });
    },
    duplicateRoutine(id = library.currentId) {
      const src = library.routines.find((r) => r.id === id);
      if (!src) return null;
      const copy = cloneDeep(src.project);
      copy.name = `${src.project.name} copy`;
      return store.addRoutine(copy);
    },
    deleteRoutine(id = library.currentId) {
      const idx = library.routines.findIndex((r) => r.id === id);
      if (idx < 0) return;
      store.commit();
      library.routines.splice(idx, 1);
      histories.delete(id);
      dirty.delete(id);
      removed.add(id);
      if (!library.routines.length) {
        const fresh = { id: routineId(), project: emptyProject() };
        library.routines.push(fresh);
        dirty.add(fresh.id);
      }
      if (library.currentId === id) store.switchRoutine(library.routines[Math.min(idx, library.routines.length - 1)].id);
      else persistProject();
    },

    updateSettings(fn, opts = {}) {
      fn(state.settings);
      rev += 1;
      persistSettings();
      emit('settings', opts);
    },
    /** Replace all settings (import); anything malformed falls back to defaults. */
    replaceSettings(raw) {
      state.settings = normalizeSettings(raw);
      rev += 1;
      persistSettings();
      emit('settings', {});
    },
    resetSettings() {
      state.settings = cloneDeep(DEFAULT_SETTINGS);
      rev += 1;
      persistSettings();
      emit('settings', {});
    },
    setUi(patch, opts = {}) {
      const allianceChanged = patch.alliance && patch.alliance !== state.ui.alliance;
      Object.assign(state.ui, patch);
      if (allianceChanged) rev += 1;
      persistUi();
      emit('ui', { ...opts, patch });
    },
    /** Another tab saved something (a 'storage' event): fold it in. */
    adoptExternal(key) {
      if (key === LIBRARY_KEY) {
        if (pending !== null) return; // mid-drag or mid-typing here: our next save merges anyway
        const before = library.routines.length;
        const replaced = mergeWithDisk();
        if (replaced) {
          rev += 1;
          resetView();
          histories.delete(library.currentId);
          emit('project', { replaced: true, external: true });
        } else if (library.routines.length !== before) {
          emit('library', {});
        }
      } else if (key === SETTINGS_KEY && !settingsDirty) {
        state.settings = normalizeSettings(storage.get(SETTINGS_KEY));
        rev += 1;
        emit('settings', { external: true });
      }
    },
    /** Write everything to storage now (called when the page is being hidden). */
    flush() {
      store.commit();
      if (dirty.size || removed.size) writeLibrary();
      if (settingsDirty) {
        save(SETTINGS_KEY, state.settings);
        settingsDirty = false;
      }
    },
    canUndo: () => history().undo.length > 0,
    canRedo: () => history().redo.length > 0,
    undo() {
      store.commit();
      const h = history();
      if (!h.undo.length) return;
      h.redo.push(snapshot());
      setProject(JSON.parse(h.undo.pop()));
      persistProject();
      emit('project', { undo: true });
    },
    redo() {
      const h = history();
      if (!h.redo.length) return;
      h.undo.push(snapshot());
      setProject(JSON.parse(h.redo.pop()));
      persistProject();
      emit('project', { redo: true });
    },
    derived() {
      if (derivedCache && derivedCache.rev === rev) return derivedCache;
      const resolved = resolveProject(state.project, state.settings, state.ui.alliance);
      const sim = simulate(resolved, state.settings);
      const collisions = checkCollisions(sim, resolved, state.settings);
      const issues = [...resolved.issues, ...sim.issues, ...collisions.issues, ...lintProject(state.project, resolved)];
      derivedCache = { rev, resolved, sim, collisions, issues };
      return derivedCache;
    },
    /** Blue-frame resolve, used by the Java export for marker segment maths. */
    resolvedBlue() {
      return resolveProject(state.project, state.settings, 'blue');
    },
  };
  return store;
}

export function findStep(project, id) {
  return (project.steps || []).find((s) => s.id === id) || null;
}
