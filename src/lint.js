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
  if (!project.steps?.length) issues.push({ level: 'info', stepId: null, msg: 'No steps yet: add a path or action from the Routine tab.' });
  return issues;
}
