// Settings page: robot constants, motion estimates, match timing, field view, camera, constants,
// named points, the command library, and Java export options. Saved in this browser.

import { cloneDeep, DEFAULT_COMMANDS } from '../defaults.js';
import { download, h, toast, uid } from '../util.js';
import { checkbox, exprInput, fld, numInput, preserveFocus, selectInput, textArea, textInput } from './fields.js';

const SECTIONS = [
  ['robot', 'Robot'],
  ['motion', 'Motion'],
  ['match', 'Match timing'],
  ['field', 'Field view'],
  ['camera', 'Camera (HuskyLens)'],
  ['constants', 'Constants'],
  ['points', 'Named points'],
  ['commands', 'Commands'],
  ['code', 'Java export'],
  ['data', 'Import / reset'],
];

export function createSettingsPage(overlay, app) {
  const { store } = app;
  let section = 'robot';
  const content = h('div.content');
  const nav = h('nav.side');
  const modal = h('div.modal', { role: 'dialog', 'aria-label': 'Settings' }, [
    h('header', {}, [h('h2', { text: 'Settings' }), h('span.hint', { text: 'Saved in this browser · export them under Import / reset' }), h('button', { text: 'Close', onclick: () => close() })]),
    h('div.body', {}, [nav, content]),
  ]);
  overlay.append(modal);
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });

  const set = (fn) => (v, o) => store.updateSettings((s) => fn(s, v), { ...o, source: 'settings' });
  const num = (key, label, value, fn, opts = {}) => fld(label, numInput(app, `set.${key}`, value, set(fn), opts), opts.title);

  function robot(s) {
    return [
      h('p.hint', { text: 'Footprint used for keep-out checks and drawing. Length runs along the heading (front to back). These also feed L and W in coordinate expressions.' }),
      h('div.form-grid', {}, [
        num('rl', 'Length L (in)', s.robot.length, (st, v) => { st.robot.length = v; }, { step: 0.125, min: 1 }),
        num('rw', 'Width W (in)', s.robot.width, (st, v) => { st.robot.width = v; }, { step: 0.125, min: 1 }),
        fld('Java for L', textInput(app, 'set.rlj', s.robot.lengthJava, set((st, v) => { st.robot.lengthJava = v; }), { mono: true })),
        fld('Java for W', textInput(app, 'set.rwj', s.robot.widthJava, set((st, v) => { st.robot.widthJava = v; }), { mono: true })),
      ]),
    ];
  }

  function motion(s) {
    return [
      h('p.hint', { text: 'Timeline estimates only (trapezoid profile, slowed in tight curves). The two top speeds are the maxAchievable…Velocity values from PedroConstants; like Pedro, the estimate blends them by drive direction, so driving nose-first is fastest and diagonals are slowest. Time a real run and tune the rest until the timeline matches.' }),
      h('div.form-grid', {}, [
        num('mvf', 'Top speed forward (in/s)', s.motion.maxVelForward, (st, v) => { st.motion.maxVelForward = v; }, { min: 1 }),
        num('mvs', 'Top speed strafing (in/s)', s.motion.maxVelStrafe, (st, v) => { st.motion.maxVelStrafe = v; }, { min: 1 }),
        num('ma', 'Acceleration (in/s²)', s.motion.accel, (st, v) => { st.motion.accel = v; }, { min: 1 }),
        num('md', 'Deceleration (in/s²)', s.motion.decel, (st, v) => { st.motion.decel = v; }, { min: 1 }),
        num('ml', 'Lateral accel in curves (in/s²)', s.motion.lateralAccel, (st, v) => { st.motion.lateralAccel = v; }, { min: 1 }),
        num('mt', 'Turn rate (°/s)', s.motion.turnRate, (st, v) => { st.motion.turnRate = v; }, { min: 1 }),
        num('ms', 'Settle at end of path/turn (s)', s.motion.settle, (st, v) => { st.motion.settle = v; }, { min: 0, step: 0.05 }),
      ]),
    ];
  }

  function match(s) {
    return [
      h('p.hint', { text: 'AutoBase runs routine().withTimeout(20.0), then GoToCmd(routeToPark).withTimeout(9.75).' }),
      h('div.form-grid', {}, [
        num('rt', 'Routine timeout (s)', s.match.routineTimeout, (st, v) => { st.match.routineTimeout = v; }, { min: 0 }),
        num('pt', 'Park timeout (s)', s.match.parkTimeout, (st, v) => { st.match.parkTimeout = v; }, { min: 0 }),
        num('al', 'Autonomous length (s)', s.match.autoLength, (st, v) => { st.match.autoLength = v; }, { min: 1 }),
        num('wt', 'Wall tolerance (in)', s.match.wallTolerance, (st, v) => { st.match.wallTolerance = v; }, { min: 0, step: 0.25, title: 'How far the footprint may poke past a wall before it is flagged' }),
      ]),
      checkbox('set.et', 'Cut the routine at the timeout during playback (like AutoBase does)', s.match.enforceTimeout !== false, (v) => store.updateSettings((st) => { st.match.enforceTimeout = v; })),
      checkbox('set.sp', 'Simulate the AutoBase park route after the routine', s.match.showPark, (v) => store.updateSettings((st) => { st.match.showPark = v; })),
    ];
  }

  function field(s) {
    const orient = [['up', '+x up (matches the BIOBUZZ image)'], ['right', '+x right'], ['down', '+x down'], ['left', '+x left']];
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
    file.addEventListener('change', () => {
      const f = file.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        store.updateSettings((st) => { st.field.customImage = reader.result; });
        rerender();
      };
      reader.readAsDataURL(f);
    });
    return [
      h('div.form-grid', {}, [
        fld('Screen orientation', selectInput('set.px', orient, s.field.plusX, (v) => store.updateSettings((st) => { st.field.plusX = v; }))),
        num('sn', 'Drag snap (in, Shift = off)', s.field.snap, (st, v) => { st.field.snap = v; }, { min: 0, step: 0.25 }),
        fld('Image opacity', (() => {
          const r = h('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: s.field.opacity ?? 1 });
          r.addEventListener('input', () => store.updateSettings((st) => { st.field.opacity = Number(r.value); }, { source: 'settings' }));
          return r;
        })()),
      ]),
      checkbox('set.grid', 'Show 6 in grid', s.field.grid, (v) => store.updateSettings((st) => { st.field.grid = v; })),
      h('h3', { text: 'Field image' }),
      h('p.hint', { text: s.field.customImage ? 'Using your uploaded image.' : 'Using the bundled BIOBUZZ image (+x up, +y left, origin bottom-right, 144 × 144 in).' }),
      h('div.row', {}, [
        h('button', { text: 'Upload image…', onclick: () => file.click() }),
        s.field.customImage ? h('button', { text: 'Use bundled image', onclick: () => { store.updateSettings((st) => { st.field.customImage = null; }); rerender(); } }) : null,
        s.field.customImage ? fld('In your image, +x points', selectInput('set.cpx', orient.map(([v]) => [v, v]), s.field.customImagePlusX || 'up', (v) => store.updateSettings((st) => { st.field.customImagePlusX = v; }))) : null,
        file,
      ]),
      h('p.hint', { text: 'Crop uploads to the inside of the walls so the edges are 0 and 144 in.' }),
      h('h3', { text: 'Red alliance' }),
      fld('How field() builds red poses', selectInput('set.rt', [
        ['point', 'mirrorX(72).mirrorY(72): rotate 180° (AutoPaths.RED)'],
        ['mirrorX', 'mirrorX(72) only'],
        ['mirrorY', 'mirrorY(72) only'],
        ['none', 'no transform'],
      ], s.alliance.redTransform, (v) => store.updateSettings((st) => { st.alliance.redTransform = v; }))),
    ];
  }

  function table(rows, cols, onAdd, onRemove) {
    const tbl = h('table.tbl', {}, [h('tr', {}, [...cols.map((c) => h('th', { text: c.label })), h('th')])]);
    rows.forEach((r, i) => tbl.append(h('tr', {}, [...cols.map((c) => h('td', {}, [c.input(r, i)])), h('td', {}, [h('button.ghost', { text: '✕', onclick: () => onRemove(i) })])])));
    return [tbl, h('button.small', { text: '+ add', onclick: onAdd })];
  }

  function constants(s) {
    return [
      h('p.hint', { text: 'Extra names for coordinate fields, e.g. MID_X = 82 then type MID_X-10 into a field. The Java column is what the export writes instead.' }),
      h('p.hint', { text: 'Built in: L and W (robot length / width from the Robot section).' }),
      ...table(s.constants, [
        { label: 'Name', input: (r, i) => textInput(app, `set.c${i}n`, r.name, set((st, v) => { st.constants[i].name = v.replace(/[^A-Za-z0-9_]/g, ''); }), { mono: true }) },
        { label: 'Value', input: (r, i) => numInput(app, `set.c${i}v`, r.value, set((st, v) => { st.constants[i].value = v; })) },
        { label: 'Java', input: (r, i) => textInput(app, `set.c${i}j`, r.java, set((st, v) => { st.constants[i].java = v; }), { mono: true }) },
      ], () => { store.updateSettings((st) => { st.constants.push({ name: `C${st.constants.length + 1}`, value: 0, java: '' }); }); rerender(); },
      (i) => { store.updateSettings((st) => { st.constants.splice(i, 1); }); rerender(); }),
    ];
  }

  function points(s) {
    return [
      h('p.hint', { text: 'Blue-frame spots drawn on the field. Any of them can be a "face a point" target. Give one a heading and it becomes a pose a path can end on: pick it in the path editor, or drag a path end near it and it snaps. Give it Java as well and the export writes that expression (for example AutoPaths.xFlower(f)) instead of raw numbers.' }),
      ...table(s.points, [
        { label: 'Name', input: (r, i) => textInput(app, `set.p${i}n`, r.name, set((st, v) => { st.points[i].name = v; })) },
        { label: 'x', input: (r, i) => exprInput(app, `set.p${i}x`, r.x, set((st, v) => { st.points[i].x = v; })) },
        { label: 'y', input: (r, i) => exprInput(app, `set.p${i}y`, r.y, set((st, v) => { st.points[i].y = v; })) },
        { label: 'Heading ° (optional)', input: (r, i) => exprInput(app, `set.p${i}h`, r.h ?? '', set((st, v) => { st.points[i].h = v === '' ? null : v; }), { allowEmpty: true }) },
        { label: 'Java (optional)', input: (r, i) => textInput(app, `set.p${i}j`, r.java, set((st, v) => { st.points[i].java = v; }), { mono: true }) },
      ], () => { store.updateSettings((st) => { st.points.push({ name: `Point ${st.points.length + 1}`, x: 72, y: 72, h: null, java: '' }); }); rerender(); },
      (i) => { store.updateSettings((st) => { st.points.splice(i, 1); }); rerender(); }),
    ];
  }

  function usedCommandIds() {
    const used = new Set();
    for (const step of store.state.project.steps || []) {
      for (const r of [...(step.cmds || []), ...(step.during || []), ...(step.markers || []).map((m) => m.cmd)]) used.add(r?.lib);
    }
    return used;
  }

  function commandCard(c, i) {
    const setC = (fn) => set((st, v) => fn(st.commands[i], v));
    return h('div.libcard', {}, [
      h('div.form-grid', {}, [
        fld('Name', textInput(app, `set.k${i}name`, c.name, setC((cc, v) => { cc.name = v; }))),
        fld('Id (used by routines)', textInput(app, `set.k${i}id`, c.id, setC((cc, v) => { cc.id = v.replace(/\s+/g, ''); }), { mono: true })),
        fld('Kind', selectInput(`set.k${i}type`, [['command', 'Command (b.command)'], ['instant', 'Instant code (b.doInstant)']], c.type, (v) => { store.updateSettings((st) => { st.commands[i].type = v; }); rerender(); })),
        fld('Colour', (() => {
          const el = h('input', { type: 'color', value: c.color || '#888888' });
          el.addEventListener('input', () => store.updateSettings((st) => { st.commands[i].color = el.value; }, { source: 'settings' }));
          return el;
        })()),
      ]),
      fld(c.type === 'instant' ? 'Java statements ({param} placeholders)' : 'Java expression returning a Command ({param} placeholders)', textArea(app, `set.k${i}java`, c.java, setC((cc, v) => { cc.java = v; }), { rows: 2 })),
      h('div.form-grid', {}, [
        fld('Duration (s): number, expression of params, or "forever"', textInput(app, `set.k${i}dur`, c.duration, setC((cc, v) => { cc.duration = v; }), { mono: true })),
        fld('Requires subsystems (comma list)', textInput(app, `set.k${i}req`, c.requires, setC((cc, v) => { cc.requires = v; }))),
      ]),
      fld('Imports (one per line)', textArea(app, `set.k${i}imp`, c.imports, setC((cc, v) => { cc.imports = v; }), { rows: 2 })),
      h('div.section-title', { text: 'Parameters' }),
      ...table(c.params || [], [
        { label: 'Key', input: (p, j) => textInput(app, `set.k${i}p${j}k`, p.key, set((st, v) => { st.commands[i].params[j].key = v.replace(/[^A-Za-z0-9_]/g, ''); }), { mono: true }) },
        { label: 'Label', input: (p, j) => textInput(app, `set.k${i}p${j}l`, p.label, set((st, v) => { st.commands[i].params[j].label = v; })) },
        { label: 'Default', input: (p, j) => textInput(app, `set.k${i}p${j}d`, p.default, set((st, v) => { st.commands[i].params[j].default = v; }), { mono: true }) },
      ], () => { store.updateSettings((st) => { (st.commands[i].params = st.commands[i].params || []).push({ key: `p${(st.commands[i].params || []).length + 1}`, label: 'Value', default: 0 }); }); rerender(); },
      (j) => { store.updateSettings((st) => { st.commands[i].params.splice(j, 1); }); rerender(); }),
      h('div.row', {}, [h('span.spacer'), h('button.danger.small', { text: 'Delete command', onclick: () => {
        if (usedCommandIds().has(c.id) && !confirm(`"${c.name}" is used in this routine. Delete it anyway?`)) return;
        store.updateSettings((st) => { st.commands.splice(i, 1); });
        rerender();
      } })]),
    ]);
  }

  function commands(s) {
    return [
      h('p.hint', { html: 'The "states" you can put between and during motion. Commands go into <code>b.command(...)</code> (or <code>deadlineWith</code> during a path); instant code goes into <code>b.doInstant(() -&gt; { ... })</code>. A duration of "forever" means it only ends when interrupted (fine during a path, needs a timeout as a step).' }),
      h('div.row', {}, [
        h('button', { text: '+ New command', onclick: () => { store.updateSettings((st) => { st.commands.push({ id: uid('cmd').slice(0, 14), name: 'New command', type: 'command', color: '#38bdf8', java: 'Commands.none()', params: [], duration: '0', requires: '', imports: '' }); }); rerender(); } }),
        h('button', { text: 'Reset library to team defaults', onclick: () => { if (confirm('Replace the command library with the defaults from team2844simple?')) { store.updateSettings((st) => { st.commands = cloneDeep(DEFAULT_COMMANDS); }); rerender(); } } }),
      ]),
      ...s.commands.map(commandCard),
    ];
  }

  function camera(s) {
    const c = s.camera;
    const cn = (key, label, k, opts = {}) => num(`cam.${key}`, label, c[k], (st, v) => { st.camera[k] = v; }, opts);
    return [
      h('p.hint', { text: 'The original HuskyLens (DFRobot SEN0305): the BIOBUZZ manual allows it by name (R702) and the FTC SDK drives it on an I2C port. Position is from the robot centre: x forward, y left. Export → Vision setup turns these into Constants.HUSKY_* lines.' }),
      h('div.form-grid', {}, [
        fld('Device name (robot config)', textInput(app, 'set.cam.dn', c.deviceName, set((st, v) => { st.camera.deviceName = v; }), { mono: true })),
        cn('x', 'Forward of centre x (in)', 'x', { step: 0.25 }),
        cn('y', 'Left of centre y (in)', 'y', { step: 0.25 }),
        cn('ht', 'Lens height off the tiles (in)', 'height', { step: 0.25, min: 0 }),
        cn('yaw', 'Turned left (°)', 'yaw', { step: 1 }),
        cn('pitch', 'Tilted down (°)', 'pitch', { step: 1 }),
        cn('hf', 'Horizontal field of view (°)', 'hfov', { step: 1, min: 5, max: 170 }),
        cn('vf', 'Vertical field of view (°)', 'vfov', { step: 1, min: 5, max: 170 }),
      ]),
      checkbox('set.cam.cal', 'Checked on the robot with HuskyLensCheck (the field of view is not published for this camera, so measure it)', c.calibrated, (v) => store.updateSettings((st) => { st.camera.calibrated = v; })),
      h('h3', { text: 'Color IDs' }),
      h('p.hint', { text: 'Teach each ball color on the HuskyLens (Color Recognition) and enter the ID it gets. Nectar uses your alliance\'s ID.' }),
      h('div.form-grid', {}, [
        cn('ip', 'Pollen (yellow) ID', 'idPollen', { step: 1, min: 1 }),
        cn('inr', 'Red nectar ID', 'idNectarRed', { step: 1, min: 1 }),
        cn('inb', 'Blue nectar ID', 'idNectarBlue', { step: 1, min: 1 }),
      ]),
      h('h3', { text: 'Pickup behaviour' }),
      h('div.form-grid', {}, [
        cn('ma', 'Smallest blob (px², of 320 × 240)', 'minArea', { step: 1, min: 1, title: 'Blobs smaller than this are ignored. It also sets how far away a ball can be seen.' }),
        cn('lt', 'Look time per heading (s)', 'lookTime', { step: 0.05, min: 0 }),
        cn('cd', 'Stop re-aiming within (in)', 'commitDistance', { step: 0.5, min: 0, title: 'Close to the ball it drops out of the bottom of the image; from here the robot drives to its last estimate.' }),
        cn('rd', 'Re-plan if the ball moves (in)', 'reaimDistance', { step: 0.5, min: 0.5 }),
      ]),
      fld('Ball-in check (Java, optional)', textInput(app, 'set.cam.bi', c.ballInJava, set((st, v) => { st.camera.ballInJava = v; }), { mono: true, placeholder: 'e.g. intake.hasBall()' })),
      h('p.hint', { text: 'Leave blank for now: without a sensor the pickup ends when the robot reaches the ball. If you add one later, type the boolean here and the pickup also ends as soon as it is true.' }),
    ];
  }

  function code(s) {
    const t = (key, label, k) => fld(label, textInput(app, `set.code.${key}`, s.code[k], set((st, v) => { st.code[k] = v; }), { mono: true }));
    return [
      h('p.hint', { text: 'Where the generated classes go and the names they use. Defaults match Team2844_Season2026/team2844simple.' }),
      h('div.form-grid', {}, [
        t('rp', 'Routine package', 'routinePackage'),
        t('gp', 'Geometry package', 'geometryPackage'),
        t('bp', 'Blue OpMode package', 'bluePackage'),
        t('redp', 'Red OpMode package', 'redPackage'),
        t('bc', 'Base class', 'baseClass'),
        t('bi', 'Base class import', 'baseImport'),
        t('ci', 'Constants import', 'constantsImport'),
        t('dr', 'Drive subsystem expression', 'drive'),
        t('pf', 'PoseFactory expression', 'poseFactory'),
        t('ba', 'Blue alliance()', 'blueAlliance'),
        t('ra', 'Red alliance()', 'redAlliance'),
        t('tt', 'Turn command ({drive}, {heading} radians)', 'turnTemplate'),
        t('ti', 'Turn command imports', 'turnImports'),
        t('xi', 'Other classes your Java mentions (comma separated)', 'extraImports'),
        t('vp', 'Vision package (HuskyLens files)', 'visionPackage'),
        t('hu', 'HuskyLens subsystem expression', 'husky'),
        t('gi', 'GoToCmd import (paths after a pickup)', 'goToImport'),
      ]),
    ];
  }

  function data() {
    const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    file.addEventListener('change', async () => {
      const f = file.files[0];
      if (!f) return;
      try {
        const parsed = JSON.parse(await f.text());
        const incoming = parsed.kind === 'valleyvis-settings' ? parsed.settings : parsed.settings || parsed;
        if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw new Error('not a settings file');
        store.replaceSettings(incoming);
        toast('Settings imported');
        rerender();
      } catch (e) {
        toast(`Could not read settings: ${e.message}`);
      }
    });
    return [
      h('p.hint', { text: 'Share one robot setup with the whole team: export here, commit the file, import on another laptop.' }),
      h('div.row', {}, [
        h('button', { text: 'Export settings (.json)', onclick: () => download('valleyvis-settings.json', JSON.stringify({ kind: 'valleyvis-settings', settings: store.state.settings }, null, 2)) }),
        h('button', { text: 'Import settings…', onclick: () => file.click() }),
        h('button.danger', { text: 'Reset everything to defaults', onclick: () => { if (confirm('Reset all settings (robot, motion, commands, code) to defaults?')) { store.resetSettings(); rerender(); } } }),
        file,
      ]),
    ];
  }

  const builders = { robot, motion, match, field, camera, constants, points, commands, code, data };

  function rerender() {
    const s = store.state.settings;
    nav.replaceChildren(...SECTIONS.map(([id, label]) => h(`button${id === section ? '.on' : ''}`, { text: label, onclick: () => { section = id; rerender(); } })));
    preserveFocus(content, () => {
      content.replaceChildren(h('h3', { text: SECTIONS.find((x) => x[0] === section)[1] }), ...builders[section](s).filter(Boolean));
    });
  }

  function open(sec) {
    if (sec) section = sec;
    overlay.hidden = false;
    rerender();
  }
  function close() {
    overlay.hidden = true;
    store.commit();
  }
  return { open, close, rerender, isOpen: () => !overlay.hidden };
}
