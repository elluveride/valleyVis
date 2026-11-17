// Zones tab: draw and edit keep-out zones with a clearance distance from the robot's edge.

import { defaultZones } from '../defaults.js';
import { h } from '../util.js';
import { checkbox, exprInput, fld, numInput, textInput } from './fields.js';

const TOOLS = [
  ['select', 'Select', 'Click a zone to select it, drag its centre to move, drag corners to resize.'],
  ['rect', 'Rectangle', 'Drag on the field to draw a rectangle.'],
  ['circle', 'Circle', 'Drag from the centre outwards.'],
  ['poly', 'Polygon', 'Click to add corners; click the first corner, double-click or press Enter to finish. Esc cancels.'],
];

export function toolHint(tool) {
  if (tool === 'measure') return 'Ruler: drag between two spots to measure. Esc puts it away.';
  const t = TOOLS.find((x) => x[0] === tool);
  return tool === 'select' ? '' : t?.[2] || '';
}

function zoneFields(app, z) {
  const set = (fn, o) => app.store.update((pr) => {
    const zz = pr.zones.find((q) => q.id === z.id);
    if (zz) fn(zz);
  }, o);
  const key = `zone.${z.id}`;
  const rows = [
    h('div.grid2', {}, [
      fld('Name', textInput(app, `${key}.name`, z.name, (v, o) => set((q) => { q.name = v; }, o))),
      fld('Keep robot edge this far away (in)', numInput(app, `${key}.clr`, z.clearance, (v, o) => set((q) => { q.clearance = v; }, o), { step: 0.5, min: 0 })),
    ]),
    h('div.row', {}, [
      checkbox(`${key}.en`, 'Enabled', z.enabled !== false, (v) => set((q) => { q.enabled = v; })),
      checkbox(`${key}.mir`, 'Mirror for red', z.mirror, (v) => set((q) => { q.mirror = v; }), 'On: the zone is drawn in the blue frame and mirrored like your poses. Off: it stays put on the physical field (use for field elements).'),
    ]),
  ];
  if (z.shape === 'rect') {
    rows.push(h('div.grid2', {}, [
      fld('x (min)', exprInput(app, `${key}.x`, z.x, (v, o) => set((q) => { q.x = v; }, o))),
      fld('y (min)', exprInput(app, `${key}.y`, z.y, (v, o) => set((q) => { q.y = v; }, o))),
      fld('width (x)', exprInput(app, `${key}.w`, z.w, (v, o) => set((q) => { q.w = v; }, o))),
      fld('height (y)', exprInput(app, `${key}.h`, z.h, (v, o) => set((q) => { q.h = v; }, o))),
    ]));
  } else if (z.shape === 'circle') {
    rows.push(h('div.grid3', {}, [
      fld('centre x', exprInput(app, `${key}.cx`, z.cx, (v, o) => set((q) => { q.cx = v; }, o))),
      fld('centre y', exprInput(app, `${key}.cy`, z.cy, (v, o) => set((q) => { q.cy = v; }, o))),
      fld('radius', exprInput(app, `${key}.r`, z.r, (v, o) => set((q) => { q.r = v; }, o))),
    ]));
  } else {
    (z.points || []).forEach((p, i) => {
      rows.push(h('div.grid3', {}, [
        fld(`corner ${i + 1} x`, exprInput(app, `${key}.p${i}x`, p.x, (v, o) => set((q) => { q.points[i].x = v; }, o))),
        fld('y', exprInput(app, `${key}.p${i}y`, p.y, (v, o) => set((q) => { q.points[i].y = v; }, o))),
        h('div.fld', {}, [h('span', { text: ' ' }), z.points.length > 3 ? h('button.ghost', { text: '✕', onclick: () => set((q) => { q.points.splice(i, 1); }) }) : null]),
      ]));
    });
  }
  return rows;
}

export function renderZonesTab(container, app) {
  const { project, ui } = app.store.state;
  const d = app.store.derived();
  container.append(h('div.seg', { style: { alignSelf: 'flex-start' } }, TOOLS.map(([id, label]) => h(`button${ui.tool === id ? '.on' : ''}`, { text: label, onclick: () => app.store.setUi({ tool: id }) }))));
  container.append(h('div.hint', { text: 'Clearance is measured from the robot\'s edge (rotated L × W footprint), every inch along every path, plus the AutoBase park route. Violations show as red footprints.' }));
  for (const z of project.zones || []) {
    const sel = ui.selectedZoneId === z.id;
    const hits = d.collisions.violations.filter((v) => v.zoneId === z.id);
    const near = z.enabled === false ? null : d.collisions.closest[z.id];
    const nearStep = near ? project.steps.findIndex((st) => st.id === near.stepId) : -1;
    const nearWhere = !near ? '' : near.stepId === 'park' ? 'on the park route' : near.stepId === 'start' ? 'at the start pose' : nearStep >= 0 ? `on step ${nearStep + 1}` : '';
    const hd = h('div.hd', { onclick: () => app.store.setUi({ selectedZoneId: sel ? null : z.id, selectedStepId: null }) }, [
      h('span.chip', { style: { background: z.enabled === false ? '#475569' : '#fb7185' } }),
      h('span.title', { text: `${z.name} · ${z.shape} · ${z.clearance} in` }),
      near ? h(`span.dur${near.dist < z.clearance ? '.over' : ''}`, { title: `Closest the robot's edge gets to this zone, ${nearWhere}`, text: `closest ${near.dist.toFixed(1)} in` }) : null,
      hits.length ? h('span.dot.err', { title: `${hits.length} step(s) violate this zone` }) : null,
      h('button.ghost', { title: 'Delete zone', text: '✕', onclick: (e) => {
        e.stopPropagation();
        app.store.update((pr) => { pr.zones = pr.zones.filter((q) => q.id !== z.id); });
      } }),
    ]);
    const card = h(`div.card${sel ? '.sel' : ''}`, {}, [hd]);
    if (sel) {
      const body = h('div.bd', {}, zoneFields(app, z));
      if (near) {
        body.append(h('div.stat', { text: `Closest approach: ${near.dist.toFixed(1)} in ${nearWhere} (needs ${z.clearance} in).` }));
        if (nearStep >= 0) body.append(h('button.small', { text: `Show step ${nearStep + 1}`, onclick: () => app.store.setUi({ selectedStepId: near.stepId, selectedZoneId: null, tab: 'routine' }) }));
      }
      card.append(body);
    }
    container.append(card);
  }
  container.append(h('div.add-row', {}, [
    h('button', { text: 'Restore field obstacles', title: 'Re-add the hive frame legs if you deleted them', onclick: () => app.store.update((pr) => {
      pr.zones = pr.zones || [];
      for (const z of defaultZones()) if (!pr.zones.some((q) => q.id === z.id)) pr.zones.push(z);
    }) }),
  ]));
}
