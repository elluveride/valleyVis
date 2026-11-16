// Canvas drawing for the field editor. Pure-ish: takes state + derived data, draws,
// and returns the interactive handles it drew so the pointer code can hit-test them.

import { robotCorners, itemPoses } from './collision.js';
import { completionAtTime } from './simulate.js';

export const PATH_COLORS = ['#facc15', '#22d3ee', '#a3e635', '#f472b6', '#c084fc', '#fb923c', '#34d399', '#f87171'];
const ALLIANCE = { blue: '#3b82f6', red: '#ef4444' };
const ORIENT_ANGLE = { right: 0, up: 90, left: 180, down: 270 }; // CCW degrees of +x on screen

/** Field inches <-> canvas CSS pixels for a given "+x points" orientation. */
export function makeView(size, plusX = 'up') {
  const k = size / 144;
  const fwd = {
    up: (x, y) => [144 - y, 144 - x],
    right: (x, y) => [x, 144 - y],
    down: (x, y) => [y, x],
    left: (x, y) => [144 - x, y],
  }[plusX] || ((x, y) => [144 - y, 144 - x]);
  const inv = {
    up: (u, v) => [144 - v, 144 - u],
    right: (u, v) => [u, 144 - v],
    down: (u, v) => [v, u],
    left: (u, v) => [144 - u, v],
  }[plusX] || ((u, v) => [144 - v, 144 - u]);
  const dirFn = {
    up: (dx, dy) => [-dy, -dx],
    right: (dx, dy) => [dx, -dy],
    down: (dx, dy) => [dy, dx],
    left: (dx, dy) => [-dx, dy],
  }[plusX] || ((dx, dy) => [-dy, -dx]);
  return {
    size,
    k,
    plusX,
    toScreen: (p) => {
      const [u, v] = fwd(p.x, p.y);
      return { x: u * k, y: v * k };
    },
    toField: (sx, sy) => {
      const [x, y] = inv(sx / k, sy / k);
      return { x, y };
    },
    /** screen-space unit vector for a field heading */
    headingVec: (h) => {
      const [dx, dy] = dirFn(Math.cos(h), Math.sin(h));
      return { x: dx, y: dy };
    },
  };
}

function poly(ctx, view, pts) {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const s = view.toScreen(p);
    if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
}

function drawImage(ctx, view, img, imagePlusX) {
  if (!img || !img.complete || !img.naturalWidth) return false;
  const rot = ((ORIENT_ANGLE[view.plusX] - ORIENT_ANGLE[imagePlusX || 'up']) * Math.PI) / 180;
  ctx.save();
  ctx.translate(view.size / 2, view.size / 2);
  ctx.rotate(-rot);
  ctx.drawImage(img, -view.size / 2, -view.size / 2, view.size, view.size);
  ctx.restore();
  return true;
}

function drawFallbackField(ctx, view) {
  ctx.fillStyle = '#161b22';
  ctx.fillRect(0, 0, view.size, view.size);
  ctx.strokeStyle = '#30363d';
  ctx.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    const a = view.toScreen({ x: i * 24, y: 0 });
    const b = view.toScreen({ x: i * 24, y: 144 });
    const c = view.toScreen({ x: 0, y: i * 24 });
    const d = view.toScreen({ x: 144, y: i * 24 });
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
  }
}

function drawGrid(ctx, view) {
  ctx.save();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
  ctx.lineWidth = 1;
  for (let i = 6; i < 144; i += 6) {
    const a = view.toScreen({ x: i, y: 0 });
    const b = view.toScreen({ x: i, y: 144 });
    const c = view.toScreen({ x: 0, y: i });
    const d = view.toScreen({ x: 144, y: i });
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
  }
  ctx.restore();
}

function drawAxes(ctx, view) {
  const o = view.toScreen({ x: 0, y: 0 });
  const len = 34;
  const ax = view.headingVec(0);
  const ay = view.headingVec(Math.PI / 2);
  const inward = { x: (ax.x + ay.x) * 10, y: (ax.y + ay.y) * 10 };
  const base = { x: o.x + inward.x, y: o.y + inward.y };
  ctx.save();
  ctx.lineWidth = 2;
  ctx.font = '600 11px system-ui, sans-serif';
  for (const [v, label, color] of [[ax, '+x', '#f87171'], [ay, '+y', '#4ade80']]) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(base.x + v.x * len, base.y + v.y * len);
    ctx.stroke();
    ctx.fillText(label, base.x + v.x * (len + 6) - 7, base.y + v.y * (len + 6) + 4);
  }
  ctx.fillStyle = '#e5e7eb';
  ctx.beginPath();
  ctx.arc(base.x, base.y, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function zonePath(ctx, view, z) {
  if (z.kind === 'circle') {
    const c = view.toScreen({ x: z.cx, y: z.cy });
    ctx.beginPath();
    ctx.arc(c.x, c.y, z.r * view.k, 0, Math.PI * 2);
  } else {
    poly(ctx, view, z.pts);
  }
}

function drawZones(ctx, view, zones, ui, handles) {
  for (const z of zones) {
    const sel = ui.selectedZoneId === z.id;
    ctx.save();
    ctx.globalAlpha = z.enabled ? 1 : 0.35;
    // clearance band: stroke the shape with width 2*clearance and round joins (Minkowski sum look)
    if (z.clearance > 0) {
      zonePath(ctx, view, z);
      ctx.lineJoin = 'round';
      ctx.lineWidth = z.clearance * 2 * view.k;
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.16)';
      ctx.stroke();
    }
    zonePath(ctx, view, z);
    ctx.fillStyle = 'rgba(244, 63, 94, 0.32)';
    ctx.fill();
    ctx.setLineDash(z.enabled ? [] : [4, 4]);
    ctx.lineWidth = sel ? 2.5 : 1.5;
    ctx.strokeStyle = sel ? '#fde047' : '#fb7185';
    ctx.stroke();
    ctx.restore();
    if (ui.tab === 'zones' || sel) {
      const center = z.kind === 'circle' ? { x: z.cx, y: z.cy } : centroid(z.pts);
      const c = view.toScreen(center);
      handles.push({ kind: 'zoneBody', zoneId: z.id, x: c.x, y: c.y, r: 9, shape: 'body' });
      if (sel) {
        if (z.kind === 'circle') {
          const e = view.toScreen({ x: z.cx + z.r, y: z.cy });
          handles.push({ kind: 'zoneVertex', zoneId: z.id, vertex: 0, x: e.x, y: e.y, r: 7 });
        } else {
          z.pts.forEach((p, i) => {
            const s = view.toScreen(p);
            handles.push({ kind: 'zoneVertex', zoneId: z.id, vertex: i, x: s.x, y: s.y, r: 7 });
          });
        }
      }
    }
  }
}

function centroid(pts) {
  const n = pts.length || 1;
  return { x: pts.reduce((a, p) => a + p.x, 0) / n, y: pts.reduce((a, p) => a + p.y, 0) / n };
}

function drawRobot(ctx, view, pose, settings, style) {
  const corners = robotCorners(pose, settings.robot.length, settings.robot.width);
  ctx.save();
  poly(ctx, view, corners);
  if (style.fill) {
    ctx.fillStyle = style.fill;
    ctx.fill();
  }
  ctx.setLineDash(style.dash || []);
  ctx.lineWidth = style.width || 1.5;
  ctx.strokeStyle = style.stroke || '#fff';
  ctx.stroke();
  // front edge marker
  const c = view.toScreen(pose);
  const v = view.headingVec(pose.h);
  const half = (settings.robot.length / 2) * view.k;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(c.x, c.y);
  ctx.lineTo(c.x + v.x * half, c.y + v.y * half);
  ctx.stroke();
  if (style.nose) {
    const tip = { x: c.x + v.x * (half + 6), y: c.y + v.y * (half + 6) };
    const px = { x: -v.y, y: v.x };
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(c.x + v.x * half + px.x * 5, c.y + v.y * half + px.y * 5);
    ctx.lineTo(c.x + v.x * half - px.x * 5, c.y + v.y * half - px.y * 5);
    ctx.closePath();
    ctx.fillStyle = style.stroke || '#fff';
    ctx.fill();
  }
  ctx.restore();
}

function arrow(ctx, from, v, len, color) {
  const tip = { x: from.x + v.x * len, y: from.y + v.y * len };
  const px = { x: -v.y, y: v.x };
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tip.x + v.x * 4, tip.y + v.y * 4);
  ctx.lineTo(tip.x + px.x * 3.5, tip.y + px.y * 3.5);
  ctx.lineTo(tip.x - px.x * 3.5, tip.y - px.y * 3.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function handle(ctx, s, shape, color, r = 6) {
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#0b0f17';
  ctx.fillStyle = color;
  ctx.beginPath();
  if (shape === 'square') ctx.rect(s.x - r + 1, s.y - r + 1, (r - 1) * 2, (r - 1) * 2);
  else if (shape === 'diamond') {
    ctx.moveTo(s.x, s.y - r); ctx.lineTo(s.x + r, s.y); ctx.lineTo(s.x, s.y + r); ctx.lineTo(s.x - r, s.y); ctx.closePath();
  } else ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function headingKnob(view, pose, settings) {
  const c = view.toScreen(pose);
  const v = view.headingVec(pose.h);
  const d = (settings.robot.length / 2) * view.k + 16;
  return { x: c.x + v.x * d, y: c.y + v.y * d, from: c };
}

function drawKnob(ctx, knob, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(knob.from.x, knob.from.y);
  ctx.lineTo(knob.x, knob.y);
  ctx.stroke();
  ctx.restore();
  handle(ctx, knob, 'circle', color, 5);
}

function drawLabel(ctx, s, text, color = '#e5e7eb', dy = 0) {
  ctx.save();
  ctx.font = '600 11px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 8;
  const size = ctx.canvas.width / (window.devicePixelRatio || 1);
  const x = Math.min(Math.max(2, s.x + 8), size - w - 2);
  const y = Math.min(Math.max(2, s.y - 18 + dy), size - 18);
  ctx.fillStyle = 'rgba(11, 15, 23, 0.85)';
  ctx.fillRect(x, y, w, 16);
  ctx.fillStyle = color;
  ctx.fillText(text, x + 4, y + 12);
  ctx.restore();
}

function drawPathStep(ctx, view, step, color, selected, settings, handles, pathPolys, labels) {
  const g = step.geom;
  const n = Math.max(24, Math.ceil(g.length / 1.5));
  const screen = [];
  for (let i = 0; i <= n; i++) screen.push(view.toScreen(g.pointAt(i / n)));
  pathPolys.push({ stepId: step.id, pts: screen });
  ctx.save();
  if (selected) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    screen.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = selected ? 3 : 2.25;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  screen.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
  ctx.restore();

  const endS = view.toScreen(step.end);
  if (labels) drawLabel(ctx, endS, `${step.index + 1}. ${step.raw.name || 'path'}`, color);

  if (!selected) {
    handle(ctx, endS, 'circle', color, 4.5);
    return;
  }
  // heading preview arrows along the path
  const count = Math.max(2, Math.floor(g.length / 10));
  for (let i = 0; i <= count; i++) {
    const s = i / count;
    const p = view.toScreen(g.pointAt(s));
    const h = step.interp(g.paramOfCompletion(s));
    arrow(ctx, p, view.headingVec(h), 12, 'rgba(255,255,255,0.75)');
  }
  // control polygon + handles
  step.segPts.forEach((pts, si) => {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const s = view.toScreen(p);
      if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y);
    });
    ctx.stroke();
    ctx.restore();
    pts.slice(1, -1).forEach((p, ci) => {
      const s = view.toScreen(p);
      handle(ctx, s, 'square', '#e5e7eb', 6);
      handles.push({ kind: 'control', stepId: step.id, seg: si, ctrl: ci, x: s.x, y: s.y, r: 8 });
    });
    const endPt = view.toScreen(pts[pts.length - 1]);
    const last = si === step.segPts.length - 1;
    handle(ctx, endPt, 'circle', last ? color : '#cbd5e1', last ? 7 : 6);
    handles.push({ kind: 'segEnd', stepId: step.id, seg: si, x: endPt.x, y: endPt.y, r: 9 });
  });
  const startS = view.toScreen(step.start);
  handle(ctx, startS, 'circle', '#94a3b8', 6);
  handles.push({ kind: 'pathStart', stepId: step.id, x: startS.x, y: startS.y, r: 8 });
  // ghost robots at both ends + end heading knob
  const endH = step.interp(1);
  drawRobot(ctx, view, { ...step.end, h: endH }, settings, { stroke: color, dash: [5, 4], width: 1.25 });
  if (Math.abs(Math.atan2(Math.sin(endH - step.end.h), Math.cos(endH - step.end.h))) > 0.02) {
    drawRobot(ctx, view, step.end, settings, { stroke: 'rgba(255,255,255,0.5)', dash: [2, 4], width: 1 });
  }
  const knob = headingKnob(view, step.end, settings);
  drawKnob(ctx, knob, color);
  handles.push({ kind: 'endHeading', stepId: step.id, x: knob.x, y: knob.y, r: 8 });
  // markers
  (step.markers || []).forEach((m, mi) => {
    const s = view.toScreen(g.pointAt(m.at));
    handle(ctx, s, 'diamond', m.cmd.color || '#fff', 7);
    handles.push({ kind: 'marker', stepId: step.id, marker: mi, x: s.x, y: s.y, r: 9 });
    if (labels) drawLabel(ctx, s, `${Math.round(m.at * 100)}% ${m.cmd.name}`, m.cmd.color);
  });
}

function drawFootprints(ctx, view, sim, settings) {
  ctx.save();
  for (const item of sim.items) {
    if (item.motion.kind === 'hold') continue;
    const poses = itemPoses(item);
    const every = Math.max(1, Math.floor(poses.length / Math.max(1, (item.motion.geom?.length || 20) / 5)));
    poses.forEach((p, i) => {
      if (i % every) return;
      drawRobot(ctx, view, p, settings, { stroke: 'rgba(250, 204, 21, 0.18)', width: 1 });
    });
  }
  ctx.restore();
}

function drawPark(ctx, view, park) {
  if (!park) return;
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = 'rgba(203, 213, 225, 0.65)';
  ctx.lineWidth = 2;
  for (const leg of park.legs) {
    const a = view.toScreen(leg.from);
    const b = view.toScreen(leg.to);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
  const end = view.toScreen(park.legs[park.legs.length - 1].to);
  drawLabel(ctx, end, 'AutoBase park', '#cbd5e1');
}

function drawViolations(ctx, view, collisions, settings) {
  for (const v of collisions.violations) {
    for (const p of v.hits) drawRobot(ctx, view, p, settings, { stroke: '#f43f5e', width: 1.25, fill: 'rgba(244, 63, 94, 0.12)' });
  }
}

function drawPoints(ctx, view, points, labels) {
  points.forEach((p, i) => {
    const s = view.toScreen(p);
    ctx.save();
    ctx.strokeStyle = '#e879f9';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(s.x - 6, s.y); ctx.lineTo(s.x + 6, s.y);
    ctx.moveTo(s.x, s.y - 6); ctx.lineTo(s.x, s.y + 6);
    ctx.stroke();
    ctx.restore();
    if (p.h !== null && p.h !== undefined) arrow(ctx, s, view.headingVec(p.h), 14, '#e879f9');
    if (labels) drawLabel(ctx, s, p.name, '#f5d0fe', i % 2 ? 22 : 0);
  });
}

function drawDraft(ctx, view, draft) {
  if (!draft) return;
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = '#fde047';
  ctx.fillStyle = 'rgba(253, 224, 71, 0.15)';
  ctx.lineWidth = 1.5;
  if (draft.kind === 'rect' && draft.a && draft.b) {
    poly(ctx, view, [draft.a, { x: draft.b.x, y: draft.a.y }, draft.b, { x: draft.a.x, y: draft.b.y }]);
    ctx.fill();
    ctx.stroke();
  } else if (draft.kind === 'circle' && draft.a && draft.b) {
    const c = view.toScreen(draft.a);
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.hypot(draft.b.x - draft.a.x, draft.b.y - draft.a.y) * view.k, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (draft.kind === 'poly' && draft.pts?.length) {
    ctx.beginPath();
    [...draft.pts, draft.hover].filter(Boolean).forEach((p, i) => {
      const s = view.toScreen(p);
      if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y);
    });
    ctx.stroke();
    for (const p of draft.pts) handle(ctx, view.toScreen(p), 'circle', '#fde047', 4);
  }
  ctx.restore();
}

export function render(ctx, view, store, images, extra = {}) {
  const { state, playback } = store;
  const { settings, ui } = state;
  const d = store.derived();
  const handles = [];
  const pathPolys = [];
  ctx.clearRect(0, 0, view.size, view.size);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, view.size, view.size);
  ctx.clip();
  ctx.globalAlpha = settings.field.opacity ?? 1;
  const custom = settings.field.customImage;
  const drawn = custom
    ? drawImage(ctx, view, images.get(custom), settings.field.customImagePlusX)
    : drawImage(ctx, view, images.get(settings.field.image), 'up');
  ctx.globalAlpha = 1;
  if (!drawn) drawFallbackField(ctx, view);
  if (settings.field.grid) drawGrid(ctx, view);
  drawAxes(ctx, view);
  drawZones(ctx, view, d.resolved.zones, ui, handles);
  drawPoints(ctx, view, d.resolved.points, ui.view.labels);
  if (ui.view.park) drawPark(ctx, view, d.sim.park);
  if (ui.view.footprints) drawFootprints(ctx, view, d.sim, settings);

  let colorIdx = 0;
  const colors = {};
  for (const step of d.resolved.steps) {
    if (step.type !== 'path') continue;
    colors[step.id] = PATH_COLORS[colorIdx++ % PATH_COLORS.length];
  }
  // unselected first so the selected path sits on top
  for (const step of d.resolved.steps) {
    if (step.type === 'path' && step.id !== ui.selectedStepId) drawPathStep(ctx, view, step, colors[step.id], false, settings, handles, pathPolys, ui.view.labels);
  }
  const selStep = d.resolved.steps.find((s) => s.id === ui.selectedStepId);
  if (selStep?.type === 'path') drawPathStep(ctx, view, selStep, colors[selStep.id], true, settings, handles, pathPolys, ui.view.labels);
  if (selStep?.type === 'turn') {
    drawRobot(ctx, view, selStep.end, settings, { stroke: '#c084fc', dash: [5, 4] });
    const knob = headingKnob(view, selStep.end, settings);
    drawKnob(ctx, knob, '#c084fc');
    handles.push({ kind: 'turnHeading', stepId: selStep.id, x: knob.x, y: knob.y, r: 8 });
  }
  drawViolations(ctx, view, d.collisions, settings);

  // start pose
  const start = d.resolved.start;
  const allianceColor = ALLIANCE[ui.alliance];
  drawRobot(ctx, view, start, settings, { stroke: allianceColor, dash: [3, 3], width: 1.5 });
  const ss = view.toScreen(start);
  handle(ctx, ss, 'circle', allianceColor, 6);
  handles.push({ kind: 'start', x: ss.x, y: ss.y, r: 9 });
  if (ui.selectedStepId === '__start' || !ui.selectedStepId) {
    const knob = headingKnob(view, start, settings);
    drawKnob(ctx, knob, allianceColor);
    handles.push({ kind: 'startHeading', x: knob.x, y: knob.y, r: 8 });
  }
  if (ui.view.labels) drawLabel(ctx, ss, 'start', '#e5e7eb');

  // robot at playback time
  const pose = d.sim.poseAt(playback.time);
  drawRobot(ctx, view, pose, settings, { stroke: '#ffffff', fill: `${allianceColor}66`, width: 2, nose: true });
  drawDraft(ctx, view, extra.draft);
  ctx.restore();
  return { handles, pathPolys };
}

/** Completion along a path item at a given time (for the timeline/marker readouts). */
export function itemCompletion(item, t) {
  if (item.motion.kind !== 'path') return null;
  return completionAtTime(item.motion.prof, Math.min(t - item.t0, item.motion.prof.duration));
}
