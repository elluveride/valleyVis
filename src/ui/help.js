// Help overlay: what the mouse and keyboard do.

import { h } from '../util.js';

const SECTIONS = [
  ['On the field', [
    ['Drag ●', 'Move a path end, a joint or the start pose'],
    ['Drag ■', 'Move a curve control point'],
    ['Drag the round knob', 'Aim a heading (snaps to 5°)'],
    ['Drag ◆', 'Slide a marker along its path'],
    ['Double-click a selected path', 'Add a control point there (a line becomes a curve)'],
    ['Right-click ■ or ◆', 'Remove that control point or marker'],
    ['Hold Shift while dragging', 'No snapping: 0.01 in and 0.1° steps'],
    ['Click empty field', 'Deselect'],
    ['Ruler button, then drag', 'Measure a distance and direction'],
  ]],
  ['Keyboard', [
    ['Space', 'Play / pause'],
    ['← →', 'Step the playhead 0.1 s (Shift: 1 s)'],
    ['Ctrl/⌘ + Z', 'Undo'],
    ['Ctrl/⌘ + Shift + Z or Ctrl + Y', 'Redo'],
    ['Delete', 'Delete the selected step or zone'],
    ['Esc', 'Cancel a drawing, close a dialog, deselect'],
    ['Enter', 'Finish a polygon zone'],
    ['?', 'Open this help'],
  ]],
  ['Typing values', [
    ['144-L/2', 'Coordinate fields take maths. L and W are the robot length and width; add your own names in Settings → Constants.'],
    ['Blue frame', 'Everything is entered for blue, like f.of(x, y, heading) in the team code. The Red toggle previews the mirrored version.'],
  ]],
  ['Good to know', [
    ['Routines', 'Every routine is saved in this browser as you edit. Use Share for a link, or save a file to keep in the repo.'],
    ['Problems tab', 'Lists anything that would crash on the robot, hit a keep-out zone, or run past the timeout.'],
    ['Timing', 'Times are estimates. Tune Settings → Motion against a stopwatch.'],
  ]],
];

export function createHelp(overlay) {
  const modal = h('div.modal.help', { role: 'dialog', 'aria-label': 'Help' }, [
    h('header', {}, [h('h2', { text: 'How to use ValleyVis' }), h('button', { text: 'Close', onclick: () => close() })]),
    h('div.content', {}, SECTIONS.map(([title, rows]) => h('section', {}, [
      h('h3', { text: title }),
      h('dl.keys', {}, rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
    ]))),
  ]);
  overlay.append(modal);
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });
  function open() { overlay.hidden = false; }
  function close() { overlay.hidden = true; }
  return { open, close, isOpen: () => !overlay.hidden };
}
