// Wires the store, canvas, sidebar, timeline and dialogs together.

import { emptyProject } from './defaults.js';
import { evalValue } from './expr.js';
import { displayDeg } from './geometry.js';
import { attachInteractions, hoverText } from './interact.js';
import { PRESETS } from './presets.js';
import { makeView, render } from './render.js';
import { symbolTable } from './resolve.js';
import { looksLikeProject } from './schema.js';
import { decodeShare, encodeShare } from './share.js';
import { createStore } from './store.js';
import { createExportDialog } from './ui/export.js';
import { createHelp } from './ui/help.js';
import { closeMenu, menuIsOpen, openMenu } from './ui/menu.js';
import { preserveFocus } from './ui/fields.js';
import { problemCounts, renderProblemsTab } from './ui/problems.js';
import { renderRoutineTab, stepTitle } from './ui/routine.js';
import { createSettingsPage } from './ui/settings.js';
import { createTimeline } from './ui/timeline.js';
import { renderZonesTab, toolHint } from './ui/zones.js';
import { copyText, download, h, toast } from './util.js';

const $ = (id) => document.getElementById(id);

const store = createStore();
if (store.fresh) store.replaceProject(PRESETS[0].make(), { history: false });
store.onStorageError = () => toast('Could not save to this browser (storage is full or blocked). Use Routines → Save as a file.');
window.addEventListener('pagehide', () => store.flush());
window.addEventListener('storage', (e) => { if (e.key) store.adoptExternal(e.key); }); // another tab saved

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
  updateNow();
}

/** Bottom-right readout: the step the playhead is on and the commands running right then. */
let nowSignature = '';
function updateNow() {
  const el = $('nowReadout');
  const { sim } = store.derived();
  const active = sim.activeAt(store.playback.time);
  let what = '';
  if (active.phase === 'park') what = store.state.settings.park.edited ? 'Park route (edited)' : 'AutoBase park route';
  else if (active.phase === 'done') what = sim.items.length ? 'Auto finished' : '';
  else {
    const step = store.state.project.steps.find((st) => st.id === active.item.stepId);
    what = step ? `Step ${active.item.index + 1} · ${stepTitle(step)}` : '';
  }
  const signature = `${what}|${active.spans.map((sp) => sp.name + sp.color).join(',')}`;
  if (signature === nowSignature) return;
  nowSignature = signature;
  el.replaceChildren(
    ...(what ? [h('span.what', { text: what })] : []),
    ...active.spans.map((sp) => h('span.state', { text: sp.name, style: { background: sp.color } })),
  );
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
const help = createHelp($('helpOverlay'));
app.openExport = (tab) => exportDialog.open(tab);
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
  updateBadge();
}
function updateBadge() {
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

/* ----- routines menu: library, examples, files ----- */
const fileInput = $('fileInput');
fileInput.addEventListener('change', async () => {
  const f = fileInput.files[0];
  fileInput.value = '';
  if (!f) return;
  try {
    const parsed = JSON.parse(await f.text());
    const project = parsed && parsed.kind === 'valleyvis-project' ? parsed.project : parsed;
    if (!looksLikeProject(project)) throw new Error('not a ValleyVis routine');
    store.addRoutine(project);
    toast(`Added "${store.state.project.name}" to your routines`);
  } catch (e) {
    toast(`Could not open: ${e.message}`);
  }
});

function saveRoutineFile() {
  const p = store.state.project;
  const slug = (p.name || 'routine').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'routine';
  download(`${slug}.vvis.json`, JSON.stringify({ kind: 'valleyvis-project', version: 1, project: p }, null, 2));
}

$('btnRoutines').addEventListener('click', () => {
  const routines = store.routines();
  openMenu($('btnRoutines'), [
    { title: 'Your routines · saved in this browser as you edit' },
    ...routines.map((r) => ({
      id: `routine-${r.id}`,
      label: r.name || 'Untitled',
      hint: `${r.steps} step${r.steps === 1 ? '' : 's'}`,
      current: r.current,
      onClick: () => store.switchRoutine(r.id),
      actions: [
        { id: `dup-${r.id}`, label: '⧉', title: 'Duplicate', onClick: () => { store.duplicateRoutine(r.id); toast('Duplicated'); } },
        { id: `del-${r.id}`, label: '✕', title: 'Delete', onClick: () => { if (confirm(`Delete "${r.name}"? This cannot be undone.`)) store.deleteRoutine(r.id); } },
      ],
    })),
    { separator: true },
    { id: 'new', label: '+ New empty routine', onClick: () => store.addRoutine(emptyProject()) },
    { title: 'Add an example' },
    ...PRESETS.map((p) => ({ id: `example-${p.id}`, label: p.label, onClick: () => { store.addRoutine(p.make()); toast(`Added "${store.state.project.name}"`); } })),
    { separator: true },
    { id: 'import', label: 'Open a routine file…', hint: '.vvis.json', onClick: () => fileInput.click() },
    { id: 'save-file', label: 'Save this routine as a file', hint: 'for the repo', onClick: saveRoutineFile },
  ]);
});

/* ----- share links ----- */
async function copyShareLink(withSettings) {
  const payload = { project: store.state.project };
  if (withSettings) payload.settings = { ...store.state.settings, field: { ...store.state.settings.field, customImage: null } };
  const hash = await encodeShare(payload);
  const url = `${location.origin}${location.pathname}#${hash}`;
  const ok = await copyText(url);
  toast(ok ? `Link copied (${url.length} characters)` : 'Could not copy the link');
  return url;
}

$('btnShare').addEventListener('click', () => {
  openMenu($('btnShare'), [
    { title: 'The link holds the routine itself. Nothing is uploaded.' },
    { id: 'share-routine', label: 'Copy link to this routine', onClick: () => copyShareLink(false) },
    { id: 'share-all', label: 'Copy link with robot settings too', hint: 'size, speeds, commands', onClick: () => copyShareLink(true) },
  ]);
});

async function importFromHash() {
  if (!location.hash.startsWith('#r=')) return;
  const hash = location.hash;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const payload = await decodeShare(hash);
    if (!payload || !looksLikeProject(payload.project)) throw new Error('the link has no routine in it');
    store.addRoutine(payload.project);
    let note = `Opened "${store.state.project.name}" from the link`;
    if (payload.settings && confirm('This link also carries robot settings (size, speeds, command library, Java names).\n\nReplace your settings with them?')) {
      store.replaceSettings(payload.settings);
      note += ' with its settings';
    }
    toast(note);
  } catch (e) {
    toast(`Could not open the shared link: ${e.message}`);
  }
}
window.addEventListener('hashchange', importFromHash);

$('btnUndo').addEventListener('click', () => store.undo());
$('btnRedo').addEventListener('click', () => store.redo());
$('btnExport').addEventListener('click', () => exportDialog.open());
$('btnSettings').addEventListener('click', () => settingsPage.open());
$('btnHelp').addEventListener('click', () => help.open());

/* ---------- view toggles ---------- */
const viewToggles = $('viewToggles');
function renderViewToggles() {
  const v = store.state.ui.view;
  const items = [['footprints', 'Footprints'], ['park', 'Park route'], ['labels', 'Labels']];
  const measuring = store.state.ui.tool === 'measure';
  viewToggles.replaceChildren(
    h(`button${measuring ? '.on' : ''}`, { text: 'Ruler', title: 'Measure a distance on the field', 'data-view': 'ruler', onclick: () => { interactions.cancelDraft(); store.setUi({ tool: measuring ? 'select' : 'measure' }); } }),
    ...items.map(([k, label]) => h(`button${v[k] ? '.on' : ''}`, { text: label, 'data-view': k, onclick: () => store.setUi({ view: { ...v, [k]: !v[k] } }) })),
  );
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
  if (kind === 'history' || kind === 'library') {
    syncHeader();
    return;
  }
  if (kind !== 'ui' || opts.patch?.alliance || opts.patch?.selectedStepId !== undefined) timeline.rebuild();
  if (opts.source !== 'sidebar' && opts.source !== 'header') renderSidebar();
  else updateBadge(); // keep the problem count honest while typing
  if (kind === 'settings' && settingsPage.isOpen() && opts.source !== 'settings') settingsPage.rerender();
  if (exportDialog.isOpen() && (kind === 'project' || kind === 'settings')) exportDialog.render();
  if (kind === 'ui') renderViewToggles();
  syncHeader();
  requestRender();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (settingsPage.isOpen()) settingsPage.close();
    if (exportDialog.isOpen()) exportDialog.close();
    if (help.isOpen()) help.close();
  }
  const tag = (e.target?.tagName || '').toLowerCase();
  if (e.key === '?' && !['input', 'textarea', 'select'].includes(tag) && !e.ctrlKey && !e.metaKey) {
    closeMenu();
    if (help.isOpen()) help.close(); else help.open();
  }
});
/** True while a dialog or menu is in front of the editor (editor shortcuts are off). */
app.blocked = () => settingsPage.isOpen() || exportDialog.isOpen() || help.isOpen() || menuIsOpen();

new ResizeObserver(resize).observe(fieldArea);
renderViewToggles();
renderSidebar();
timeline.rebuild();
syncHeader();
resize();

/** Current ruler reading in the blue frame, or null. */
app.measure = () => {
  const d = interactions.getDraft();
  if (!d || d.kind !== 'measure' || !d.a || !d.b) return null;
  const fr = store.derived().resolved.frame;
  const a = fr.point(d.a.x, d.a.y);
  const b = fr.point(d.b.x, d.b.y);
  return { dist: Math.hypot(b.x - a.x, b.y - a.y), dx: b.x - a.x, dy: b.y - a.y };
};

importFromHash();

// offline support: after one visit the app loads without a connection
if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

window.valleyVis = app; // handy for debugging from the console
