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
  if (!routines.length) {
    const legacy = storage.get(LEGACY_PROJECT_KEY);
    fresh = !legacy;
    routines.push({ id: routineId(), project: legacy ? normalizeProject(legacy) : emptyProject() });
  }
  const currentId = routines.some((r) => r.id === raw?.currentId) ? raw.currentId : routines[0].id;
  return { routines, currentId, fresh };
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
  const persistProject = debounce(() => save(LIBRARY_KEY, { currentId: library.currentId, routines: library.routines }), 300);
  const persistSettings = debounce(() => save(SETTINGS_KEY, state.settings), 300);
  const persistUi = debounce(() => save(UI_KEY, { alliance: state.ui.alliance, tab: state.ui.tab, view: state.ui.view }), 300);

  /** Point the current library entry at a new project object and make it the live one. */
  function setProject(project) {
    entry().project = project;
    state.project = project;
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
      if (!library.routines.length) library.routines.push({ id: routineId(), project: emptyProject() });
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
    /** Write everything to storage now (called when the page is being hidden). */
    flush() {
      store.commit();
      save(LIBRARY_KEY, { currentId: library.currentId, routines: library.routines });
      save(SETTINGS_KEY, state.settings);
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
