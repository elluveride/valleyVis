// Playback controls and the timeline strip (steps on top, parallel commands + park below).

import { PATH_COLORS } from '../render.js';
import { h } from '../util.js';
import { stepTitle } from './routine.js';

function stepColor(step, item, pathIdx) {
  if (step.type === 'path') return PATH_COLORS[pathIdx % PATH_COLORS.length];
  if (step.type === 'action') return item?.spans?.[0]?.color || '#ef4444';
  if (step.type === 'turn') return '#c084fc';
  if (step.type === 'wait') return '#64748b';
  return '#94a3b8';
}

export function createTimeline(container, app) {
  const { store } = app;
  const playBtn = h('button', { title: 'Play / pause (Space)', text: '▶', onclick: () => app.togglePlay() });
  const timeEl = h('span.time');
  const speedSel = h('select', { title: 'Playback speed' }, [0.25, 0.5, 1, 2, 4].map((s) => h('option', { value: s, text: `${s}×` })));
  speedSel.value = String(store.playback.speed);
  speedSel.addEventListener('change', () => { store.playback.speed = Number(speedSel.value); });
  const loop = h('input', { type: 'checkbox', title: 'Loop' });
  loop.addEventListener('change', () => { store.playback.loop = loop.checked; });
  const budget = h('span.budget');
  const controls = h('div.pb-controls', {}, [
    h('button', { title: 'Back to start', text: '⏮', onclick: () => app.seek(0) }),
    playBtn,
    h('button', { title: 'Jump to end', text: '⏭', onclick: () => app.seek(store.derived().sim.end) }),
    timeEl,
    speedSel,
    h('label.row', {}, [loop, h('span.muted', { text: 'loop' })]),
    budget,
  ]);
  const rowA = h('div.row.a');
  const rowB = h('div.row.b');
  const playhead = h('div.playhead');
  const strip = h('div.strip', { title: 'Click or drag to scrub; click a step to select it' }, [rowA, rowB, playhead]);
  container.append(controls, strip);

  let scale = 30;
  const pct = (t) => `${(t / scale) * 100}%`;

  function timeFromEvent(e) {
    const r = strip.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * scale;
  }
  let scrubbing = false;
  strip.addEventListener('pointerdown', (e) => {
    scrubbing = true;
    strip.setPointerCapture(e.pointerId);
    app.seek(timeFromEvent(e));
    const blk = e.target.closest('[data-step]');
    if (blk) store.setUi({ selectedStepId: blk.dataset.step, selectedZoneId: null, tab: 'routine' });
  });
  strip.addEventListener('pointermove', (e) => { if (scrubbing) app.seek(timeFromEvent(e)); });
  strip.addEventListener('pointerup', () => { scrubbing = false; });

  function rebuild() {
    const d = store.derived();
    const { settings, project, ui } = store.state;
    const { sim } = d;
    scale = Math.max(sim.routineTotal, sim.end, settings.match.autoLength) * 1.03 || 30;
    rowA.replaceChildren();
    rowB.replaceChildren();
    let pathIdx = 0;
    project.steps.forEach((step) => {
      const item = sim.items.find((i) => i.stepId === step.id);
      if (!item) return;
      const color = stepColor(step, item, pathIdx);
      if (step.type === 'path') pathIdx += 1;
      const w = item.t1 - item.t0;
      const cls = ['blk'];
      if (w < 0.05) cls.push('zero');
      if (ui.selectedStepId === step.id) cls.push('sel');
      if (settings.match.enforceTimeout !== false && item.t1 > sim.cutAt + 1e-6) cls.push('cut');
      rowA.append(h(`div.${cls.join('.')}`, {
        'data-step': step.id,
        title: `${stepTitle(step)} · ${item.t0.toFixed(2)}–${item.t1.toFixed(2)} s${item.forever ? ' (never ends!)' : ''}`,
        style: { left: pct(item.t0), width: pct(w), background: color },
      }, w > 0.6 ? stepTitle(step) : ''));
      for (const sp of item.spans || []) {
        if (sp.kind === 'action') continue;
        rowB.append(h('div.blk', {
          title: `${sp.name} · ${sp.t0.toFixed(2)}–${sp.t1.toFixed(2)} s${sp.kind === 'marker' ? ` (marker at ${Math.round(sp.at * 100)}%)` : ' (during path)'}`,
          style: { left: pct(sp.t0), width: pct(Math.max(0.02, sp.t1 - sp.t0)), background: sp.color },
        }, sp.t1 - sp.t0 > 0.8 ? sp.name : ''));
      }
    });
    if (sim.park) {
      rowB.append(h(`div.blk${ui.selectedStepId === '__park' ? '.sel' : ''}`, { 'data-step': '__park', title: `${sim.park.edited ? 'Park route (edited)' : 'AutoBase park route'} · ${sim.park.t0.toFixed(2)}–${sim.park.t1.toFixed(2)} s · click to edit`, style: { left: pct(sim.park.t0), width: pct(sim.park.t1 - sim.park.t0), background: sim.park.edited ? '#5eead4' : '#cbd5e1' } }, 'park'));
    }
    for (let s = 1; s < scale; s += 1) rowA.append(h('div.tick', { style: { left: pct(s), top: '-4px' } }));
    strip.querySelectorAll('.line').forEach((el) => el.remove());
    strip.append(
      h('div.line.timeout', { style: { left: pct(settings.match.routineTimeout) }, title: 'AutoBase routine timeout' }, [h('span.lbl', { text: `${settings.match.routineTimeout}s cut` })]),
      h('div.line.auto', { style: { left: pct(settings.match.autoLength) }, title: 'End of autonomous' }, [h('span.lbl', { text: `${settings.match.autoLength}s` })]),
    );
    strip.append(playhead);
    const over = sim.routineTotal > settings.match.routineTimeout;
    const late = sim.end > settings.match.autoLength;
    budget.replaceChildren(
      'routine ', h(`b${over ? '.over' : ''}`, { text: `${sim.routineTotal.toFixed(2)} s` }), ` / ${settings.match.routineTimeout} s · auto ends `,
      h(`b${late ? '.over' : ''}`, { text: `${sim.end.toFixed(2)} s` }), ` / ${settings.match.autoLength} s`,
    );
    tick();
  }

  function tick() {
    const { playback } = store;
    const end = store.derived().sim.end;
    playhead.style.left = pct(playback.time);
    timeEl.textContent = `${playback.time.toFixed(2)} / ${end.toFixed(2)} s`;
    playBtn.textContent = playback.playing ? '⏸' : '▶';
  }

  return { rebuild, tick };
}
