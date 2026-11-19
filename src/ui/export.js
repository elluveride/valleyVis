// Export dialog: the generated Java (and the point array), with copy and download buttons.

import { generateJava } from '../codegen.js';
import { POINT_DEFAULTS, pointArray } from '../points.js';
import { copyText, download, h, safeStorage, toast } from '../util.js';

// the ones the team uses first; the rest stay available under "Other formats"
const TABS = [
  ['routineClass', 'Routine class', 'A full abstract routine class with the poses and paths inside it.'],
  ['blueOpMode', 'Blue OpMode', '@Autonomous class that picks the blue alliance and target().'],
  ['redOpMode', 'Red OpMode', '@Autonomous class that picks the red alliance and target().'],
  ['parkRoute', 'Park route (AutoPaths)', 'Paste into AutoPaths.java in place of park(f) and routeToPark(f, from, alliance). It is shared by every auto, because AutoBase drives it after each routine.'],
  ['points', 'Point array', 'The routine as plain (x, y, heading) points: the poses you placed, or points sampled along the drive with the time each is reached.'],
];
const MORE_TABS = [
  ['methods', 'Paste-in methods', 'startingPose() + routine() for any class that extends AutoBase.'],
  ['geometryClass', 'Geometry class', 'Team layout, file 1 of 2: static poses and paths, like UpGeometry. Goes in the geometries package.'],
  ['teamRoutineClass', 'Routine (uses Geometry)', 'Team layout, file 2 of 2: the routine that follows the Geometry paths, like UpRoutine. Use this instead of "Routine class".'],
];
const ALL_TABS = [...TABS, ...MORE_TABS];
const POINTS_KEY = 'valleyvis.points.v1';

export function createExportDialog(overlay, app) {
  const { store } = app;
  const storage = safeStorage();
  let tab = 'routineClass';
  let result = null;
  const saved = storage.get(POINTS_KEY);
  const pointOpts = { ...POINT_DEFAULTS, ...(saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}) };
  let pointResult = null;
  const pointsBar = h('div.row.points-opts');
  const pre = h('pre.code');
  const tabsEl = h('div.code-tabs');
  const desc = h('p.hint');
  const notes = h('div');
  const fileName = () => {
    if (!result) return 'Routine.java';
    if (tab === 'routineClass' || tab === 'teamRoutineClass') return `${result.className}.java`;
    if (tab === 'geometryClass') return `${result.geometryName}.java`;
    if (tab === 'parkRoute') return 'AutoPaths-park.java';
    if (tab === 'points') return `${result.className}-points.${pointResult?.ext || 'java'}`;
    if (tab === 'blueOpMode') return `${(result.blueOpMode.match(/public class (\w+)/) || [])[1] || 'BlueAuto'}.java`;
    if (tab === 'redOpMode') return `${(result.redOpMode.match(/public class (\w+)/) || [])[1] || 'RedAuto'}.java`;
    return `${result.className}-methods.java`;
  };
  const modal = h('div.modal', { role: 'dialog', 'aria-label': 'Export' }, [
    h('header', {}, [
      h('h2', { text: 'Export' }),
      h('button.primary', { text: 'Copy', onclick: async () => { if (result) toast((await copyText(current())) ? 'Copied to clipboard' : 'Copy failed'); } }),
      h('button', { text: 'Download', onclick: () => result && download(fileName(), current(), mimeType()) }),
      h('button', { text: 'Close', onclick: () => close() }),
    ]),
    h('div.content', {}, [tabsEl, desc, pointsBar, notes, pre]),
  ]);
  overlay.append(modal);
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });

  const current = () => (tab === 'points' ? pointResult?.text ?? '' : result?.[tab] ?? '');
  const mimeType = () => (tab !== 'points' || pointResult?.ext === 'java' ? 'text/x-java' : pointResult.ext === 'csv' ? 'text/csv' : 'application/json');

  function setPointOpt(key, value) {
    pointOpts[key] = value;
    storage.set(POINTS_KEY, pointOpts);
    render();
  }

  function renderPointsBar() {
    if (tab !== 'points') {
      pointsBar.replaceChildren();
      pointsBar.hidden = true;
      return;
    }
    pointsBar.hidden = false;
    const select = (key, label, options, disabled) => {
      const el = h('select', { 'data-key': `points.${key}`, disabled });
      for (const [v, text] of options) el.append(h('option', { value: v, text }));
      el.value = pointOpts[key];
      el.addEventListener('change', () => setPointOpt(key, el.value));
      return h('label.fld', {}, [h('span', { text: label }), el]);
    };
    const spacing = h('input', { type: 'number', min: 0.25, step: 0.5, value: pointOpts.spacing, 'data-key': 'points.spacing' });
    spacing.addEventListener('change', () => { const v = Number(spacing.value); if (v > 0) setPointOpt('spacing', v); });
    const park = h('input', { type: 'checkbox', checked: !!pointOpts.park, 'data-key': 'points.park' });
    park.addEventListener('change', () => setPointOpt('park', park.checked));
    pointsBar.replaceChildren(...[
      select('content', 'Points', [['waypoints', 'Poses you placed'], ['controls', 'Poses + curve control points'], ['sampled', 'Sampled along the drive']]),
      pointOpts.content === 'sampled' ? h('label.fld', {}, [h('span', { text: 'Every (in)' }), spacing]) : null,
      select('format', 'Format', [['java', 'Java double[][]'], ['pose', 'Java Pose[] (f.of)'], ['csv', 'CSV'], ['json', 'JSON']]),
      select('alliance', 'Coordinates', [['blue', 'Blue frame (as entered)'], ['red', 'Red alliance']], pointOpts.format === 'pose'),
      h('label.row', { title: 'Add the AutoBase park route after the routine' }, [park, h('span', { text: 'include park route' })]),
    ].filter(Boolean));
  }

  function render() {
    const { project, settings } = store.state;
    result = generateJava(project, settings, store.resolvedBlue());
    pointResult = tab === 'points' ? pointArray(project, settings, pointOpts) : null;
    const button = ([id, label]) => h(`button${id === tab ? '.on' : ''}`, { 'data-tab': id, text: label, onclick: () => { tab = id; render(); } });
    tabsEl.replaceChildren(...TABS.map(button), h('span.more-label', { text: 'Other formats:' }), ...MORE_TABS.map((t) => { const b = button(t); b.classList.add('more'); return b; }));
    desc.textContent = ALL_TABS.find((t) => t[0] === tab)[2];
    renderPointsBar();
    const d = store.derived();
    const errors = d.issues.filter((i) => i.level === 'error');
    const msgs = tab === 'points' ? [] : [...result.warnings];
    if (errors.length) msgs.unshift(`${errors.length} error(s) in the Problems tab (keep-out hits, never-ending actions, bad expressions). The code still compiles, but check them before running.`);
    notes.replaceChildren(...(msgs.length ? [h('div.warnbox', {}, msgs.map((m) => h('div', { text: `• ${m}` })))] : []));
    pre.textContent = current();
  }

  function open(which) {
    if (which && ALL_TABS.some((t) => t[0] === which)) tab = which;
    overlay.hidden = false;
    render();
  }
  function close() {
    overlay.hidden = true;
  }
  return { open, close, render, isOpen: () => !overlay.hidden };
}
