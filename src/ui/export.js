// Export dialog: the generated Java in four flavours, with copy and download buttons.

import { generateJava } from '../codegen.js';
import { copyText, download, h, toast } from '../util.js';

const TABS = [
  ['methods', 'Paste-in methods', 'startingPose() + routine() for any class that extends AutoBase. Quickest way to test.'],
  ['routineClass', 'Routine class', 'A full abstract routine class (like UpRoutine), with imports.'],
  ['blueOpMode', 'Blue OpMode', '@Autonomous class that picks the blue alliance and target().'],
  ['redOpMode', 'Red OpMode', '@Autonomous class that picks the red alliance and target().'],
];

export function createExportDialog(overlay, app) {
  const { store } = app;
  let tab = 'methods';
  let result = null;
  const pre = h('pre.code');
  const tabsEl = h('div.code-tabs');
  const desc = h('p.hint');
  const notes = h('div');
  const fileName = () => {
    if (!result) return 'Routine.java';
    if (tab === 'routineClass') return `${result.className}.java`;
    if (tab === 'blueOpMode') return `${(result.blueOpMode.match(/public class (\w+)/) || [])[1] || 'BlueAuto'}.java`;
    if (tab === 'redOpMode') return `${(result.redOpMode.match(/public class (\w+)/) || [])[1] || 'RedAuto'}.java`;
    return `${result.className}-methods.java`;
  };
  const modal = h('div.modal', { role: 'dialog', 'aria-label': 'Export Java' }, [
    h('header', {}, [
      h('h2', { text: 'Export Java' }),
      h('button.primary', { text: 'Copy', onclick: async () => { if (result) toast((await copyText(result[tab])) ? 'Copied to clipboard' : 'Copy failed'); } }),
      h('button', { text: 'Download', onclick: () => result && download(fileName(), result[tab], 'text/x-java') }),
      h('button', { text: 'Close', onclick: () => close() }),
    ]),
    h('div.content', {}, [tabsEl, desc, notes, pre]),
  ]);
  overlay.append(modal);
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });

  function render() {
    const { project, settings } = store.state;
    result = generateJava(project, settings, store.resolvedBlue());
    tabsEl.replaceChildren(...TABS.map(([id, label]) => h(`button${id === tab ? '.on' : ''}`, { text: label, onclick: () => { tab = id; render(); } })));
    desc.textContent = TABS.find((t) => t[0] === tab)[2];
    const d = store.derived();
    const errors = d.issues.filter((i) => i.level === 'error');
    const msgs = [...result.warnings];
    if (errors.length) msgs.unshift(`${errors.length} error(s) in the Problems tab (keep-out hits, never-ending actions, bad expressions). The code still compiles, but check them before running.`);
    notes.replaceChildren(...(msgs.length ? [h('div.warnbox', {}, msgs.map((m) => h('div', { text: `• ${m}` })))] : []));
    pre.textContent = result[tab];
  }

  function open() {
    overlay.hidden = false;
    render();
  }
  function close() {
    overlay.hidden = true;
  }
  return { open, close, render, isOpen: () => !overlay.hidden };
}
