// Project-level checks the simulation can't see: subsystem conflicts inside parallel
// groups, Java naming problems, markers that may never fire.

import { javaIdent } from './codegen.js';

function requirementConflicts(cmds, extra = []) {
  const seen = new Map();
  const conflicts = [];
  for (const c of [...extra, ...cmds]) {
    for (const r of c.requires || []) {
      if (seen.has(r)) conflicts.push(`${seen.get(r)} and ${c.name} both require "${r}"`);
      else seen.set(r, c.name);
    }
  }
  return conflicts;
}

export function lintProject(project, resolved) {
  const issues = [];
  const names = new Map();
  for (const step of resolved.steps) {
    const raw = step.raw;
    if (step.type === 'action') {
      for (const c of requirementConflicts(step.cmds)) {
        issues.push({ level: 'warn', stepId: step.id, msg: `Parallel commands fight over a subsystem: ${c}.` });
      }
      if (step.cmds.some((c) => !c.ok)) issues.push({ level: 'error', stepId: step.id, msg: 'Uses a command that is not in the command library (Settings → Commands).' });
    }
    if (step.type === 'vision') {
      const pickup = { name: 'the pickup', requires: ['drive', 'husky'] };
      for (const c of requirementConflicts(step.during, [pickup])) {
        issues.push({ level: 'warn', stepId: step.id, msg: `Commands running during the pickup fight over a subsystem: ${c}.` });
      }
      if (step.during.some((c) => !c.ok)) issues.push({ level: 'error', stepId: step.id, msg: 'Uses a command that is not in the command library (Settings → Commands).' });
    }
    if (step.type === 'path') {
      const follow = { name: 'the path follow', requires: ['drive'] };
      const all = [...step.during, ...step.markers.map((m) => m.cmd)];
      for (const c of requirementConflicts(all, [follow])) {
        issues.push({ level: 'warn', stepId: step.id, msg: `Commands running during the path fight over a subsystem: ${c}.` });
      }
      if (all.some((c) => !c.ok)) issues.push({ level: 'error', stepId: step.id, msg: 'Uses a command that is not in the command library (Settings → Commands).' });
      for (const m of step.markers) {
        if (m.at >= 0.98) issues.push({ level: 'warn', stepId: step.id, msg: `Marker at ${Math.round(m.at * 100)}% may never fire: the follow can end before completion gets there.` });
      }
      for (const [label, value] of [['Path name', raw.name], ['End pose name', raw.endName]]) {
        if (!value) continue;
        const id = javaIdent(value);
        if (id !== value) issues.push({ level: 'info', stepId: step.id, msg: `${label} "${value}" will be exported as "${id}".` });
        if (names.has(id)) issues.push({ level: 'info', stepId: step.id, msg: `${label} "${value}" is already used by step ${names.get(id) + 1}; export will rename it.` });
        else names.set(id, step.index);
      }
    }
  }
  issues.push(...headingHandoffIssues(resolved));
  if (!project.steps?.length) issues.push({ level: 'info', stepId: null, msg: 'No steps yet: add a path or action from the Routine tab.' });
  return issues;
}

function usesStartHeading(heading) {
  const h = heading || { mode: 'linear' };
  if (h.mode === 'linear') return true;
  if (h.mode === 'constant') return (h.hold || 'start') === 'start';
  if (h.mode === 'piecewise') {
    return (h.pieces || []).some((p) => (p.mode === 'constant' && (p.hold || 'start') === 'start') || (p.mode === 'linear' && (p.from || 'start') === 'start') || (p.mode === 'linear' && p.to === 'start'));
  }
  return false;
}

/**
 * A path's "start heading" is the previous end pose's heading. If the previous path's heading
 * mode leaves the robot facing somewhere else (tangent, facing a point...), the next path
 * begins by snapping to a heading the robot does not have.
 */
function headingHandoffIssues(resolved) {
  const issues = [];
  let prev = null; // previous path step, cleared by a turn (which sets a fresh heading)
  for (const step of resolved.steps) {
    if (step.type === 'turn') prev = null;
    if (step.type !== 'path') continue;
    if (prev && usesStartHeading(step.raw.heading)) {
      const actual = prev.interp(1);
      const diff = Math.abs(Math.atan2(Math.sin(actual - prev.end.h), Math.cos(actual - prev.end.h)));
      if (diff > (2 * Math.PI) / 180) {
        const deg = (r) => Math.round((Math.atan2(Math.sin(resolved.frame.heading(r)), Math.cos(resolved.frame.heading(r))) * 180) / Math.PI);
        issues.push({
          level: 'warn',
          stepId: step.id,
          msg: `Starts from the end pose of step ${prev.index + 1} (${deg(prev.end.h)}°), but the robot will be facing ${deg(actual)}° after that step. Open step ${prev.index + 1} and use "Set end heading" to line them up.`,
        });
      }
    }
    prev = step;
  }
  return issues;
}
