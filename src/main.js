// Wires the store, canvas, sidebar, timeline and dialogs together.

import { emptyProject } from './defaults.js';
import { evalValue } from './expr.js';
import { displayDeg } from './geometry.js';
import { attachInteractions, hoverText } from './interact.js';
import { PRESETS } from './presets.js';
import { makeView, render } from './render.js';
import { symbolTable } from './resolve.js';
import { looksLikeProject } from './schema.js';
import { createStore } from './store.js';
import { createExportDialog } from './ui/export.js';
import { preserveFocus } from './ui/fields.js';
import { problemCounts, renderProblemsTab } from './ui/problems.js';
import { renderRoutineTab } from './ui/routine.js';
import { createSettingsPage } from './ui/settings.js';
import { createTimeline } from './ui/timeline.js';
import { renderZonesTab, toolHint } from './ui/zones.js';
import { download, h, toast } from './util.js';

const $ = (id) => document.getElementById(id);

const store = createStore();
function hasSavedProject() {
  try {
    return localStorage.getItem('valleyvis.project.v1') !== null;
  } catch {
    return false;
  }
}
if (!hasSavedProject() && !store.state.project.steps.length) {
  store.replaceProject(PRESETS[0].make(), { history: false });
}

const canvas = $('field');
const ctx = canvas.getContext('2d');
const fieldArea = $('fieldArea');
let view = makeView(600, store.state.settings.field.plusX);
let lastRender = { handles: [], pathPolys: [] };
let renderQueued = false;
let interactions = null;

const images = new Map();
const imageCache = {
  get(src) {
    if (!src) return null;
    let img = images.get(src);
    if (!img) {
      img = new Image();
      img.onload = () => requestRender();
      img.src = src;
      images.set(src, img);
    }
    return img;
  },
};

function draw() {
  renderQueued = false;
  const dpr = window.devicePixelRatio || 1;
  if (view.plusX !== store.state.settings.field.plusX) view = makeView(view.size, store.state.settings.field.plusX);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  lastRender = render(ctx, view, store, imageCache, { draft: interactions?.getDraft() });
  timeline.tick();
}

function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(draw);
}

function resize() {
  const r = fieldArea.getBoundingClientRect();
  const size = Math.max(240, Math.floor(Math.min(r.width - 20, r.height - 20)));
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  view = makeView(size, store.state.settings.field.plusX);
  requestRender();
}

/* ---------- playback ---------- */
let lastTs = null;
function playLoop(ts) {
  const pb = store.playback;
  if (!pb.playing) return;
  if (lastTs !== null) {
    pb.time += ((ts - lastTs) / 1000) * pb.speed;
    const end = store.derived().sim.end;
    if (pb.time >= end) {
      if (pb.loop) pb.time = 0;
      else {
        pb.time = end;
        pb.playing = false;
      }
    }
  }
  lastTs = ts;
  draw();
  if (pb.playing) requestAnimationFrame(playLoop);
}

const app = {
  store,
  view: () => view,
  lastRender: () => lastRender,
  requestRender,
  setHover(real) {
    $('coordReadout').textContent = hoverText(real, store);
  },
  togglePlay() {
    const pb = store.playback;
    const end = store.derived().sim.end;
    if (!pb.playing && pb.time >= end - 1e-6) pb.time = 0;
    pb.playing = !pb.playing;
    lastTs = null;
    if (pb.playing) requestAnimationFrame(playLoop);
    else requestRender();
  },
  seek(t) {
    const end = store.derived().sim.end;
    store.playback.time = Math.max(0, Math.min(end, t));
    requestRender();
  },
  numVal(v) {
    try {
      return evalValue(v, symbolTable(store.state.settings).values);
    } catch {
      return 0;
    }
  },
  /** Blue-frame pose after the first `index` steps (where a new step inserted there would start). */
  poseAt(index) {
    const r = store.resolvedBlue();
    const pose = index <= 0 ? r.start : (() => {
      const s = r.steps[Math.min(index, r.steps.length) - 1];
      return s.type === 'path' || s.type === 'turn' ? s.end : s.pose;
    })();
    return { x: pose.x, y: pose.y, hDeg: displayDeg(pose.h) };
  },
  poseBefore(stepId) {
    const idx = store.state.project.steps.findIndex((s) => s.id === stepId);
    return app.poseAt(idx);
  },
  refreshPanels() {
    renderSidebar();
    if (settingsPage.isOpen()) settingsPage.rerender();
    if (exportDialog.isOpen()) exportDialog.render();
  },
};

const timeline = createTimeline($('playback'), app);
const settingsPage = createSettingsPage($('settingsOverlay'), app);
const exportDialog = createExportDialog($('exportOverlay'), app);
interactions = attachInteractions(canvas, app);

/* ---------- sidebar ---------- */
const tabBody = $('tabBody');
function renderSidebar() {
  const { ui } = store.state;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  preserveFocus(tabBody, () => {
    tabBody.replaceChildren();
    if (ui.tab === 'zones') renderZonesTab(tabBody, app);
    else if (ui.tab === 'problems') renderProblemsTab(tabBody, app);
    else renderRoutineTab(tabBody, app);
  });
  const counts = problemCounts(store.derived().issues);
  const badge = $('problemCount');
  badge.textContent = counts.error || counts.warn || '';
  badge.className = `badge ${counts.error ? 'err' : counts.warn ? 'warn' : ''}`;
}
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => store.setUi({ tab: b.dataset.tab, tool: 'select' })));

/* ---------- header ---------- */
const nameInput = $('projectName');
nameInput.addEventListener('focus', () => store.beginEdit());
nameInput.addEventListener('input', () => store.update((p) => { p.name = nameInput.value; }, { history: false, source: 'header' }));
nameInput.addEventListener('change', () => store.commit());

document.querySelectorAll('#allianceToggle button').forEach((b) => b.addEventListener('click', () => store.setUi({ alliance: b.dataset.alliance })));

const presetSelect = $('presetSelect');
for (const p of PRESETS) presetSelect.append(h('option', { value: p.id, text: p.label }));
presetSelect.addEventListener('change', () => {
  const p = PRESETS.find((x) => x.id === presetSelect.value);
  presetSelect.value = '';
  if (!p) return;
  store.replaceProject(p.make());
  toast(`Loaded "${p.label}" (Undo to go back)`);
});

$('btnNew').addEventListener('click', () => {
  if (store.state.project.steps.length && !confirm('Start a new routine? (Undo can bring this one back.)')) return;
  store.replaceProject(emptyProject());
});

const fileInput = $('fileInput');
$('btnOpen').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const f = fileInput.files[0];
  fileInput.value = '';
  if (!f) return;
  try {
    const parsed = JSON.parse(await f.text());
    const project = parsed.kind === 'valleyvis-project' ? parsed.project : parsed;
    if (!looksLikeProject(project)) throw new Error('not a ValleyVis routine');
    store.replaceProject(project);
    toast(`Opened "${store.state.project.name}"`);
  } catch (e) {
    toast(`Could not open: ${e.message}`);
  }
});

$('btnSave').addEventListener('click', () => {
  const p = store.state.project;
  const slug = (p.name || 'routine').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'routine';
  download(`${slug}.vvis.json`, JSON.stringify({ kind: 'valleyvis-project', version: 1, project: p }, null, 2));
});
$('btnUndo').addEventListener('click', () => store.undo());
$('btnRedo').addEventListener('click', () => store.redo());
$('btnExport').addEventListener('click', () => exportDialog.open());
$('btnSettings').addEventListener('click', () => settingsPage.open());

/* ---------- view toggles ---------- */
const viewToggles = $('viewToggles');
function renderViewToggles() {
  const v = store.state.ui.view;
  const items = [['footprints', 'Footprints'], ['park', 'Park route'], ['labels', 'Labels']];
  viewToggles.replaceChildren(...items.map(([k, label]) => h(`button${v[k] ? '.on' : ''}`, { text: label, onclick: () => store.setUi({ view: { ...v, [k]: !v[k] } }) })));
}

function syncHeader() {
  const { project, ui } = store.state;
  if (document.activeElement !== nameInput) nameInput.value = project.name || '';
  document.querySelectorAll('#allianceToggle button').forEach((b) => b.classList.toggle('on', b.dataset.alliance === ui.alliance));
  $('btnUndo').disabled = !store.canUndo();
  $('btnRedo').disabled = !store.canRedo();
  $('toolHint').textContent = toolHint(ui.tool);
  canvas.style.cursor = ui.tool === 'select' ? 'default' : 'crosshair';
}

store.subscribe((kind, opts = {}) => {
  if (kind === 'history') {
    syncHeader();
    return;
  }
  if (kind !== 'ui' || opts.patch?.alliance || opts.patch?.selectedStepId !== undefined) timeline.rebuild();
  if (opts.source !== 'sidebar' && opts.source !== 'header') renderSidebar();
  else {
    // keep the problem badge and step durations honest while typing
    const counts = problemCounts(store.derived().issues);
    $('problemCount').textContent = counts.error || counts.warn || '';
  }
  if (kind === 'settings' && settingsPage.isOpen() && opts.source !== 'settings') settingsPage.rerender();
  if (exportDialog.isOpen() && kind === 'project') exportDialog.render();
  if (kind === 'ui') renderViewToggles();
  if (kind === 'settings') resize();
  syncHeader();
  requestRender();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (settingsPage.isOpen()) settingsPage.close();
    if (exportDialog.isOpen()) exportDialog.close();
  }
});

new ResizeObserver(resize).observe(fieldArea);
renderViewToggles();
renderSidebar();
timeline.rebuild();
syncHeader();
resize();

window.valleyVis = app; // handy for debugging from the console
