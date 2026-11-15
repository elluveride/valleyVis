// Problems tab: every error / warning from resolve, simulation, collisions and lint.

import { h } from '../util.js';
import { stepTitle } from './routine.js';

const ORDER = { error: 0, warn: 1, info: 2 };

export function problemCounts(issues) {
  return {
    error: issues.filter((i) => i.level === 'error').length,
    warn: issues.filter((i) => i.level === 'warn').length,
  };
}

export function renderProblemsTab(container, app) {
  const d = app.store.derived();
  const { project } = app.store.state;
  const issues = [...d.issues].sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  if (!issues.length) {
    container.append(h('div.hint', { text: 'No problems. Paths clear every zone, the routine fits the timeout, and all commands resolve.' }));
    return;
  }
  for (const iss of issues) {
    const idx = project.steps.findIndex((s) => s.id === iss.stepId);
    const step = idx >= 0 ? project.steps[idx] : null;
    const where = step ? `Step ${idx + 1} · ${stepTitle(step)}` : iss.stepId === 'start' ? 'Start pose' : 'Routine';
    const dotCls = iss.level === 'error' ? 'err' : iss.level === 'warn' ? 'warn' : 'info';
    container.append(h(`div.issue.${iss.level}`, {
      onclick: () => {
        if (step) {
          app.store.setUi({ selectedStepId: step.id, tab: 'routine' });
          const item = d.sim.items.find((i) => i.stepId === step.id);
          if (item) app.seek(item.t0);
        } else if (iss.zoneId) {
          app.store.setUi({ selectedZoneId: iss.zoneId, tab: 'zones' });
        }
      },
    }, [h(`span.dot.${dotCls}`), h('div', {}, [h('div.faint', { text: where }), h('div', { text: iss.msg })])]));
  }
}
