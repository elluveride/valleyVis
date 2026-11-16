// App state: the routine (with undo/redo), settings, UI selection, and derived
// results (resolved geometry, timeline, collisions) recomputed only when inputs change.

import { checkCollisions } from './collision.js';
import { cloneDeep, DEFAULT_SETTINGS, emptyProject } from './defaults.js';
import { lintProject } from './lint.js';
import { resolveProject } from './resolve.js';
import { normalizeProject, normalizeSettings } from './schema.js';
import { simulate } from './simulate.js';
import { debounce, safeStorage } from './util.js';

const PROJECT_KEY = 'valleyvis.project.v1';
const SETTINGS_KEY = 'valleyvis.settings.v1';
const UI_KEY = 'valleyvis.ui.v1';
const HISTORY_MAX = 200;

export function createStore() {
  const storage = safeStorage();
  const rawUi = storage.get(UI_KEY);
  const savedUi = rawUi && typeof rawUi === 'object' && !Array.isArray(rawUi) ? rawUi : {};
  const savedProject = storage.get(PROJECT_KEY);
  const state = {
    project: savedProject ? normalizeProject(savedProject) : emptyProject(),
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
  const undo = [];
  const redo = [];
  let pending = null; // snapshot taken at beginEdit()
  let rev = 0;
  let derivedCache = null;
  const listeners = new Set();

  const persistProject = debounce(() => storage.set(PROJECT_KEY, state.project), 300);
  const persistSettings = debounce(() => storage.set(SETTINGS_KEY, state.settings), 300);
  const persistUi = debounce(() => storage.set(UI_KEY, { alliance: state.ui.alliance, tab: state.ui.tab, view: state.ui.view }), 300);

  function emit(kind, opts = {}) {
    for (const l of listeners) l(kind, opts);
  }

  function snapshot() {
    return JSON.stringify(state.project);
  }

  function pushUndo(snap) {
    if (snap === snapshot()) return;
    undo.push(snap);
    if (undo.length > HISTORY_MAX) undo.shift();
    redo.length = 0;
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
    replaceProject(project, opts = {}) {
      const before = snapshot();
      state.project = normalizeProject(project);
      rev += 1;
      if (opts.history !== false) pushUndo(before);
      state.ui.selectedStepId = null;
      state.ui.selectedZoneId = null;
      playback.time = 0;
      persistProject();
      emit('project', { ...opts, replaced: true });
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
    canUndo: () => undo.length > 0,
    canRedo: () => redo.length > 0,
    undo() {
      store.commit();
      if (!undo.length) return;
      redo.push(snapshot());
      state.project = JSON.parse(undo.pop());
      rev += 1;
      persistProject();
      emit('project', { undo: true });
    },
    redo() {
      if (!redo.length) return;
      undo.push(snapshot());
      state.project = JSON.parse(redo.pop());
      rev += 1;
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
