// End-to-end tests: drives the real app in headless Chromium.
//   npm run e2e            (needs Playwright: npm i -D playwright && npx playwright install chromium)
// Each check is independent; the run prints every failure and exits non-zero if any failed.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { chromium } = require('playwright');
const { startServer } = require('./server.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const results = [];
const only = process.argv[2] || null;

function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  if (!cond) console.log(`  FAIL ${name} ${detail ? `:: ${detail}` : ''}`);
}
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

async function newPage(browser, url, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1500, height: 950 }, acceptDownloads: true, ...(opts.context || {}) });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(`console: ${m.text()}`); });
  if (opts.init) await ctx.addInitScript(opts.init);
  await page.goto(url + (opts.hash || ''));
  await page.waitForFunction(() => !!window.valleyVis);
  await page.waitForTimeout(150);
  return page;
}

const helpers = (page) => {
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const project = () => ev(() => JSON.parse(JSON.stringify(window.valleyVis.store.state.project)));
  const settings = () => ev(() => JSON.parse(JSON.stringify(window.valleyVis.store.state.settings)));
  const ui = () => ev(() => JSON.parse(JSON.stringify(window.valleyVis.store.state.ui)));
  /** client coordinates of a design-frame (blue) field point under the current alliance + orientation */
  const at = async (x, y) => ev(([px, py]) => {
    const app = window.valleyVis;
    const fr = app.store.derived().resolved.frame;
    const real = fr.point(px, py);
    const s = app.view().toScreen(real);
    const r = document.getElementById('field').getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y };
  }, [x, y]);
  const atReal = async (x, y) => ev(([px, py]) => {
    const app = window.valleyVis;
    const s = app.view().toScreen({ x: px, y: py });
    const r = document.getElementById('field').getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y };
  }, [x, y]);
  const handle = async (pred) => ev(async (src) => {
    // handles are refreshed on the next animation frame after a change
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    // eslint-disable-next-line no-new-func
    const f = new Function('h', `return (${src})(h)`);
    const hd = window.valleyVis.lastRender().handles.filter((h) => f(h));
    const r = document.getElementById('field').getBoundingClientRect();
    return hd.map((h) => ({ ...h, cx: r.left + h.x, cy: r.top + h.y }));
  }, pred.toString());
  const drag = async (from, to, opts = {}) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    if (opts.shift) await page.keyboard.down('Shift');
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 3 });
    await page.mouse.up();
    if (opts.shift) await page.keyboard.up('Shift');
    await page.waitForTimeout(40);
  };
  const settle = () => page.waitForTimeout(60);
  const menu = async (button, item) => {
    await page.click(button);
    await page.click(`.menu [data-menu="${item}"]`);
    await page.waitForTimeout(60);
  };
  const example = (id) => menu('#btnRoutines', `example-${id}`);
  const issues = () => ev(() => window.valleyVis.store.derived().issues.map((i) => ({ level: i.level, msg: i.msg, stepId: i.stepId })));
  return { ev, project, settings, ui, at, atReal, handle, drag, settle, issues, menu, example };
};

const tests = {};

tests.freshLoad = async (browser, url) => {
  const page = await newPage(browser, url);
  const t = helpers(page);
  const p = await t.project();
  check('fresh: loads the Up example', p.steps.length === 6 && /Up/.test(p.name), JSON.stringify(p.name));
  const size = await t.ev(() => { const c = document.getElementById('field'); return [c.clientWidth, c.clientHeight, c.width, c.height]; });
  check('fresh: canvas is square and sized', size[0] === size[1] && size[0] > 300, JSON.stringify(size));
  check('fresh: field image loaded', await t.ev(() => new Promise((res) => { const i = new Image(); i.onload = () => res(i.naturalWidth > 0); i.onerror = () => res(false); i.src = 'assets/field-biobuzz.webp'; })));
  check('fresh: no problems on the team Up routine', (await t.issues()).filter((i) => i.level !== 'info').length === 0, JSON.stringify(await t.issues()));
  check('fresh: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
};

tests.startPose = async (browser, url) => {
  const page = await newPage(browser, url);
  const t = helpers(page);
  const before = await t.project();
  const from = await t.at(79.9375, 136.0625);
  const to = await t.at(60, 120);
  await t.drag(from, to);
  let p = await t.project();
  check('start: drag moves start pose (snapped to 0.5)', near(p.start.x, 60, 0.26) && near(p.start.y, 120, 0.26) && Number.isInteger(p.start.x * 2), JSON.stringify(p.start));
  check('start: drag selects the start card', (await t.ui()).selectedStepId === '__start');
  const knob = (await t.handle((h) => h.kind === 'startHeading'))[0];
  check('start: heading knob is shown', !!knob);
  if (knob) {
    // drag knob to point along +y (heading 90)
    const c = await t.at(p.start.x, p.start.y);
    const target = await t.at(p.start.x, p.start.y + 30);
    await t.drag({ x: knob.cx, y: knob.cy }, target);
    p = await t.project();
    check('start: knob sets heading 90', p.start.h === 90, String(p.start.h));
    void c;
  }
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  p = await t.project();
  check('start: two undos restore the expression start pose', JSON.stringify(p.start) === JSON.stringify(before.start), JSON.stringify(p.start));
  check('start: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
};

tests.pathEditing = async (browser, url) => {
  const page = await newPage(browser, url);
  const t = helpers(page);
  await page.click('[data-step="u3"] .hd'); // readyShoot1: line from garden to (96,108)
  let end = (await t.handle((h) => h.kind === 'segEnd' && h.stepId === 'u3'))[0];
  check('path: selected path shows an end handle', !!end);
  await t.drag({ x: end.cx, y: end.cy }, await t.at(90, 100));
  let p = await t.project();
  check('path: drag end point', near(p.steps[2].segments[0].end.x, 90, 0.26) && near(p.steps[2].segments[0].end.y, 100, 0.26), JSON.stringify(p.steps[2].segments[0].end));
  // shift = fine precision
  end = (await t.handle((h) => h.kind === 'segEnd' && h.stepId === 'u3'))[0];
  const fine = await t.at(91.37, 101.21);
  await t.drag({ x: end.cx, y: end.cy }, fine, { shift: true });
  p = await t.project();
  const e = p.steps[2].segments[0].end;
  check('path: shift-drag is not snapped to 0.5', !Number.isInteger(e.x * 2) || !Number.isInteger(e.y * 2), JSON.stringify(e));
  check('path: shift-drag lands near the pointer', near(e.x, 91.37, 0.3) && near(e.y, 101.21, 0.3), JSON.stringify(e));
  // end heading knob
  const knob = (await t.handle((h) => h.kind === 'endHeading' && h.stepId === 'u3'))[0];
  await t.drag({ x: knob.cx, y: knob.cy }, await t.at(e.x + 30, e.y));
  p = await t.project();
  check('path: end heading knob sets 0°', p.steps[2].endH === 0, String(p.steps[2].endH));
  // double-click on the line adds a control point (line -> curve)
  const mid = await t.ev(() => {
    const app = window.valleyVis;
    const st = app.store.derived().resolved.steps[2];
    const q = st.geom.pointAt(0.5);
    const s = app.view().toScreen(q);
    const r = document.getElementById('field').getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y };
  });
  await page.mouse.dblclick(mid.x, mid.y);
  await t.settle();
  p = await t.project();
  check('path: double-click turns the line into a curve with 1 control', p.steps[2].segments[0].type === 'curve' && p.steps[2].segments[0].controls.length === 1, JSON.stringify(p.steps[2].segments[0]));
  // drag the control point
  let ctrl = (await t.handle((h) => h.kind === 'control' && h.stepId === 'u3'))[0];
  await t.drag({ x: ctrl.cx, y: ctrl.cy }, await t.at(120, 110));
  p = await t.project();
  check('path: drag control point', near(p.steps[2].segments[0].controls[0].x, 120, 0.26) && near(p.steps[2].segments[0].controls[0].y, 110, 0.26), JSON.stringify(p.steps[2].segments[0].controls));
  // right-click removes it
  ctrl = (await t.handle((h) => h.kind === 'control' && h.stepId === 'u3'))[0];
  await page.mouse.click(ctrl.cx, ctrl.cy, { button: 'right' });
  await t.settle();
  p = await t.project();
  check('path: right-click removes the control (back to a line)', p.steps[2].segments[0].type === 'line' && p.steps[2].segments[0].controls.length === 0, JSON.stringify(p.steps[2].segments[0]));
  // dragging the path start moves the previous path's end
  const startH = (await t.handle((h) => h.kind === 'pathStart' && h.stepId === 'u3'))[0];
  await t.drag({ x: startH.cx, y: startH.cy }, await t.at(130, 130));
  p = await t.project();
  check('path: dragging a path start moves the previous path end', near(p.steps[1].segments[0].end.x, 130, 0.26) && near(p.steps[1].segments[0].end.y, 130, 0.26), JSON.stringify(p.steps[1].segments[0].end));
  check('path: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
};

tests.markers = async (browser, url) => {
  const page = await newPage(browser, url);
  const t = helpers(page);
  await page.click('[data-step="u2"] .hd');
  await page.click('button:has-text("+ marker")');
  let p = await t.project();
  check('marker: added at 50%', p.steps[1].markers.length === 1 && p.steps[1].markers[0].at === 0.5);
  const mk = (await t.handle((h) => h.kind === 'marker'))[0];
  check('marker: handle is drawn', !!mk);
  const target = await t.ev(() => {
    const app = window.valleyVis;
    const st = app.store.derived().resolved.steps[1];
    const s = app.view().toScreen(st.geom.pointAt(0.8));
    const r = document.getElementById('field').getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y };
  });
  await t.drag({ x: mk.cx, y: mk.cy }, target);
  p = await t.project();
  check('marker: drag along the path to ~80%', near(p.steps[1].markers[0].at, 0.8, 0.03), String(p.steps[1].markers[0].at));
  const spans = await t.ev(() => window.valleyVis.store.derived().sim.items[1].spans.map((s) => s.kind));
  check('marker: appears on the timeline', spans.includes('marker'), JSON.stringify(spans));
  const mk2 = (await t.handle((h) => h.kind === 'marker'))[0];
  await page.mouse.click(mk2.cx, mk2.cy, { button: 'right' });
  await t.settle();
  p = await t.project();
  check('marker: right-click deletes', p.steps[1].markers.length === 0);
  check('marker: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
};

tests.zones = async (browser, url) => {
  const page = await newPage(browser, url);
  const t = helpers(page);
  await page.click('#tabs button[data-tab="zones"]');
  // rectangle
  await page.click('.seg button:has-text("Rectangle")');
  await t.drag(await t.at(20, 20), await t.at(40, 50));
  let p = await t.project();
  let z = p.zones[p.zones.length - 1];
  check('zone: rectangle drawn', z.shape === 'rect' && near(z.x, 20, 0.6) && near(z.y, 20, 0.6) && near(z.w, 20, 0.6) && near(z.h, 30, 0.6), JSON.stringify(z));
  check('zone: tool returns to select and the zone is selected', (await t.ui()).tool === 'select' && (await t.ui()).selectedZoneId === z.id);
  // circle
  await page.click('.seg button:has-text("Circle")');
  await t.drag(await t.at(30, 110), await t.at(30, 120));
  p = await t.project();
  z = p.zones[p.zones.length - 1];
  check('zone: circle drawn', z.shape === 'circle' && near(z.cx, 30, 0.6) && near(z.cy, 110, 0.6) && near(z.r, 10, 0.6), JSON.stringify(z));
  // polygon: click 3 corners then Enter
  await page.click('.seg button:has-text("Polygon")');
  for (const [x, y] of [[100, 20], [120, 20], [110, 40]]) {
    const c = await t.at(x, y);
    await page.mouse.click(c.x, c.y);
  }
  await page.keyboard.press('Enter');
  await t.settle();
  p = await t.project();
  z = p.zones[p.zones.length - 1];
  check('zone: polygon finished with Enter', z.shape === 'poly' && z.points.length === 3, JSON.stringify(z));
  // polygon: finish by double-click
  await page.click('.seg button:has-text("Polygon")');
  for (const [x, y] of [[100, 60], [120, 60], [120, 80]]) {
    const c = await t.at(x, y);
    await page.mouse.click(c.x, c.y);
  }
  const last = await t.at(100, 80);
  await page.mouse.dblclick(last.x, last.y);
  await t.settle();
  p = await t.project();
  z = p.zones[p.zones.length - 1];
  check('zone: polygon finished with double-click has 4 corners', z.shape === 'poly' && z.points.length === 4, JSON.stringify(z.points));
  // Escape cancels a draft
  const count = p.zones.length;
  await page.click('.seg button:has-text("Polygon")');
  const c1 = await t.at(60, 20);
  await page.mouse.click(c1.x, c1.y);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  p = await t.project();
  check('zone: Escape cancels a polygon draft', p.zones.length === count && (await t.ui()).tool === 'select');
  // move the rectangle by its body
  const rect = p.zones.find((q) => q.shape === 'rect' && q.name.startsWith('Keep-out'));
  await page.click(`.card .hd:has-text("${rect.name}")`);
  const body = (await t.handle((h) => h.kind === 'zoneBody'))
    .find((h) => h.zoneId === rect.id);
  await t.drag({ x: body.cx, y: body.cy }, await t.at(40, 45));
  p = await t.project();
  let r2 = p.zones.find((q) => q.id === rect.id);
  check('zone: drag body moves the rectangle', near(r2.x, 30, 0.6) && near(r2.y, 30, 0.6) && near(r2.w, 20, 0.6), JSON.stringify(r2));
  // resize by a corner
  const corner = (await t.handle((h) => h.kind === 'zoneVertex')).find((h) => h.zoneId === rect.id && h.vertex === 2);
  await t.drag({ x: corner.cx, y: corner.cy }, await t.at(60, 70));
  p = await t.project();
  r2 = p.zones.find((q) => q.id === rect.id);
  check('zone: drag corner resizes', near(r2.x, 30, 0.6) && near(r2.w, 30, 0.6) && near(r2.h, 40, 0.6), JSON.stringify(r2));
  // collision is reported when a zone sits on the path
  await page.click('.seg button:has-text("Rectangle")');
  await t.drag(await t.at(100, 112), await t.at(112, 124));
  const iss = await t.issues();
  check('zone: path through a zone is reported', iss.some((i) => i.level === 'error' && /Keep-out/.test(i.msg)), JSON.stringify(iss.map((i) => i.msg)));
  // delete with the keyboard
  const n = (await t.project()).zones.length;
  await page.locator('#field').focus();
  await page.keyboard.press('Delete');
  check('zone: Delete removes the selected zone', (await t.project()).zones.length === n - 1);
  check('zone: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
};

tests.redFrame = async (browser, url) => {
  const page = await newPage(browser, url);
  const t = helpers(page);
  await page.click('#allianceToggle button[data-alliance="red"]');
  await page.click('[data-step="u3"] .hd');
  const end = (await t.handle((h) => h.kind === 'segEnd' && h.stepId === 'u3'))[0];
  // drop it at real (50, 40) => blue-frame (94, 104)
  await t.drag({ x: end.cx, y: end.cy }, await t.atReal(50, 40));
  let p = await t.project();
  const e = p.steps[2].segments[0].end;
  check('red: dragging in the red view stores blue-frame coordinates', near(e.x, 94, 0.3) && near(e.y, 104, 0.3), JSON.stringify(e));
  const knob = (await t.handle((h) => h.kind === 'endHeading' && h.stepId === 'u3'))[0];
  await t.drag({ x: knob.cx, y: knob.cy }, await t.atReal(50, 80)); // real heading +90 => blue-frame -90
  p = await t.project();
  check('red: heading knob stores the blue-frame heading', p.steps[2].endH === -90, String(p.steps[2].endH));
  // a zone drawn on red with "mirror" lands in the blue frame
  await page.click('#tabs button[data-tab="zones"]');
  await page.click('.seg button:has-text("Rectangle")');
  await t.drag(await t.atReal(10, 10), await t.atReal(20, 30));
  p = await t.project();
  const z = p.zones[p.zones.length - 1];
  check('red: zone drawn in red view is stored mirrored', near(z.x, 124, 0.6) && near(z.y, 114, 0.6) && near(z.w, 10, 0.6) && near(z.h, 20, 0.6), JSON.stringify(z));
  await page.click('#allianceToggle button[data-alliance="blue"]');
  const rz = await t.ev(() => window.valleyVis.store.derived().resolved.zones.at(-1).pts.map((q) => [q.x, q.y]));
  check('red: the same zone appears at the mirrored spot on blue', rz.some(([x, y]) => near(x, 124, 0.6) && near(y, 114, 0.6)), JSON.stringify(rz));
  check('red: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
};

tests.saveOpen = async (browser, url) => {
  const page = await newPage(browser, url);
  const t = helpers(page);
  await t.example('solo');
  const before = await t.project();
  await page.click('#btnRoutines');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.menu [data-menu="save-file"]')]);
  const file = path.join(os.tmpdir(), `vv-${Date.now()}.vvis.json`);
  await dl.saveAs(file);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  check('save: file contains the project', saved.kind === 'valleyvis-project' && saved.project.steps.length === before.steps.length);
  check('save: filename is derived from the routine name', /Solo/.test(dl.suggestedFilename()) && dl.suggestedFilename().endsWith('.vvis.json'), dl.suggestedFilename());
  await t.menu('#btnRoutines', 'new');
  check('save: New opens an empty routine', (await t.project()).steps.length === 0);
  const countBefore = (await t.ev(() => window.valleyVis.store.routines())).length;
  await page.setInputFiles('#fileInput', file);
  await page.waitForTimeout(150);
  const opened = await t.project();
  check('open: the file comes back as a new routine with the same contents', JSON.stringify({ ...opened, name: before.name }) === JSON.stringify(before) && (await t.ev(() => window.valleyVis.store.routines())).length === countBefore + 1, opened.name);
  check('open: a duplicate name gets a number', opened.name === `${before.name} (2)`, opened.name);
  // bad files do not break anything
  const bad = path.join(os.tmpdir(), `vv-bad-${Date.now()}.json`);
  for (const [label, content] of [['an unrelated JSON file', '{"hello": 1}'], ['a non-JSON file', 'not json at all'], ['a JSON null', 'null'], ['a JSON array', '[1,2,3]']]) {
    fs.writeFileSync(bad, content);
    await page.setInputFiles('#fileInput', bad);
    await page.waitForTimeout(120);
    check(`open: ${label} is rejected`, JSON.stringify(await t.project()) === JSON.stringify(opened) && (await t.ev(() => window.valleyVis.store.routines())).length === countBefore + 1);
  }
  // persistence across reloads
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForFunction(() => !!window.valleyVis);
  check('persist: reload keeps the routine', JSON.stringify(await t.project()) === JSON.stringify(opened));
  check('save: no page errors', page.errors.length === 0, page.errors.join(' | '));
  fs.rmSync(file, { force: true });
  fs.rmSync(bad, { force: true });
  await page.context().close();
};

tests.library = async (browser, url) => {
  const page = await newPage(browser, url);
  const t = helpers(page);
  const list = () => t.ev(() => window.valleyVis.store.routines());
  check('library: starts with the example routine', (await list()).length === 1 && /Up/.test((await list())[0].name));
  await t.example('solo');
  await t.example('down');
  let l = await list();
  check('library: examples are added, not swapped in', l.length === 3 && /Down/.test(l.find((r) => r.current).name), JSON.stringify(l.map((r) => r.name)));
  // edit Down, switch to Up, edit, switch back: both edits kept, undo is per routine
  await t.ev(() => window.valleyVis.store.update((p) => { p.steps[1].seconds = 3; }));
  await t.menu('#btnRoutines', `routine-${l[0].id}`);
  check('library: switching shows the other routine', /Up/.test((await t.project()).name) && (await t.project()).steps.length === 6);
  check('library: a routine you have not edited has nothing to undo', await t.ev(() => !window.valleyVis.store.canUndo()));
  await page.click('[data-step="u5"] .hd');
  await page.locator('[data-key="u5.sec"]').fill('2');
  await page.locator('[data-key="u5.sec"]').press('Tab');
  await t.menu('#btnRoutines', `routine-${l[2].id}`);
  check('library: edits to the first routine were kept on switch', (await t.project()).steps[1].seconds === 3);
  await page.locator('#field').focus();
  await page.keyboard.press('Control+z');
  check('library: undo applies to the routine on screen only', (await t.project()).steps[1].seconds === 15, String((await t.project()).steps[1].seconds));
  await t.menu('#btnRoutines', `routine-${l[0].id}`);
  check('library: the other routine still has its edit', (await t.project()).steps[4].seconds === 2);
  // rename through the header shows up in the menu
  await page.locator('#projectName').fill('Renamed Up');
  await page.locator('#projectName').press('Tab');
  check('library: renaming updates the list', (await list()).some((r) => r.name === 'Renamed Up'));
  // duplicate + delete
  await t.menu('#btnRoutines', `dup-${l[0].id}`);
  l = await list();
  check('library: duplicate makes a copy and opens it', l.length === 4 && l.find((r) => r.current).name === 'Renamed Up copy', JSON.stringify(l.map((r) => r.name)));
  page.once('dialog', (d) => d.accept());
  await t.menu('#btnRoutines', `del-${l.find((r) => r.current).id}`);
  l = await list();
  check('library: delete removes it and opens a neighbour', l.length === 3 && !l.some((r) => r.name === 'Renamed Up copy') && l.some((r) => r.current));
  page.once('dialog', (d) => d.dismiss());
  await t.menu('#btnRoutines', `del-${l[0].id}`);
  check('library: cancelling the delete keeps the routine', (await list()).length === 3);
  // everything survives a reload, including which routine is open
  const current = (await list()).find((r) => r.current).name;
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForFunction(() => !!window.valleyVis);
  l = await list();
  check('library: reload keeps all routines and the open one', l.length === 3 && l.find((r) => r.current).name === current, JSON.stringify(l));
  // deleting the last routine leaves an empty one
  for (let i = 0; i < 3; i++) {
    page.once('dialog', (d) => d.accept());
    const cur = (await list()).find((r) => r.current);
    await t.menu('#btnRoutines', `del-${cur.id}`);
  }
  l = await list();
  check('library: deleting everything leaves one empty routine', l.length === 1 && l[0].steps === 0, JSON.stringify(l));
  // menu closes on Escape and on an outside click
  await page.click('#btnRoutines');
  await page.keyboard.press('Escape');
  check('library: Escape closes the menu', (await page.locator('.menu').count()) === 0);
  await page.click('#btnRoutines');
  await page.mouse.click(700, 500);
  check('library: clicking elsewhere closes the menu', (await page.locator('.menu').count()) === 0);
  check('library: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
};

tests.legacyMigration = async (browser, url) => {
  const legacy = { name: 'Old single routine', start: { x: 30, y: 30, h: 0 }, steps: [{ id: 'w', type: 'wait', seconds: 2 }], zones: [] };
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx.addInitScript(`if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('valleyvis.project.v1', ${JSON.stringify(JSON.stringify(legacy))}); }`);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => !!window.valleyVis);
  const t = helpers(page);
  const l = await t.ev(() => window.valleyVis.store.routines());
  check('migration: a routine saved by the old version becomes the first library entry', l.length === 1 && l[0].name === 'Old single routine' && (await t.project()).steps[0].seconds === 2, JSON.stringify(l));
  check('migration: no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
};

tests.shareLinks = async (browser, url) => {
  const page = await newPage(browser, url, { context: { permissions: ['clipboard-read', 'clipboard-write'] } });
  const t = helpers(page);
  await t.example('solo');
  await t.ev(() => window.valleyVis.store.updateSettings((s) => { s.robot.length = 17; }));
  const original = await t.project();
  await t.menu('#btnShare', 'share-routine');
  await page.waitForTimeout(150);
  const link = await page.evaluate(() => navigator.clipboard.readText());
  check('share: link is copied and reasonably short', link.startsWith(url) && link.includes('#r=') && link.length < 2500, `${link.length} chars`);
  // open it in a completely fresh browser profile
  const other = await newPage(browser, link);
  const o = helpers(other);
  await other.waitForTimeout(300);
  const got = await o.project();
  check('share: the link opens the same routine in a fresh browser', JSON.stringify(got) === JSON.stringify(original), got.name);
  check('share: the receiver keeps their own example too', (await o.ev(() => window.valleyVis.store.routines())).length === 2);
  check('share: the hash is cleared so a reload does not import twice', (await other.evaluate(() => location.hash)) === '');
  check('share: receiver settings are untouched by a routine-only link', (await o.settings()).robot.length === 15.875);
  await other.reload();
  await other.waitForFunction(() => !!window.valleyVis);
  check('share: reload does not add another copy', (await o.ev(() => window.valleyVis.store.routines())).length === 2);
  check('share: no page errors on the receiving side', other.errors.length === 0, other.errors.join(' | '));
  await other.context().close();
  // link with settings: receiver is asked first
  await t.menu('#btnShare', 'share-all');
  await page.waitForTimeout(150);
  const link2 = await page.evaluate(() => navigator.clipboard.readText());
  const ctxYes = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const yes = await ctxYes.newPage();
  yes.on('dialog', (d) => d.accept());
  await yes.goto(link2);
  await yes.waitForFunction(() => !!window.valleyVis);
  await yes.waitForTimeout(400);
  check('share: accepting takes the sender settings', (await yes.evaluate(() => window.valleyVis.store.state.settings.robot.length)) === 17);
  await ctxYes.close();
  const ctxNo = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const no = await ctxNo.newPage();
  no.on('dialog', (d) => d.dismiss());
  await no.goto(link2);
  await no.waitForFunction(() => !!window.valleyVis);
  await no.waitForTimeout(400);
  check('share: declining keeps your settings but still opens the routine', (await no.evaluate(() => window.valleyVis.store.state.settings.robot.length)) === 15.875 && (await no.evaluate(() => window.valleyVis.store.state.project.name)) === original.name);
  await ctxNo.close();
  // damaged links fail politely
  for (const bad of ['#r=1AAAA', '#r=0bm90IGpzb24', '#r=9zzz', '#r=', '#r=0e30']) {
    const b = await newPage(browser, url + bad);
    await b.waitForTimeout(300);
    const alive = await b.evaluate(() => window.valleyVis.store.routines().length);
    check(`share: damaged link ${bad} is ignored without breaking the app`, alive === 1 && b.errors.length === 0, `${alive} ${b.errors.join(' | ')}`);
    await b.context().close();
  }
  check('share: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
};

tests.helpAndShortcutGuards = async (browser, url) => {
  const page = await newPage(browser, url);
  const t = helpers(page);
  await page.click('#btnHelp');
  check('help: opens from the ? button', !(await t.ev(() => document.getElementById('helpOverlay').hidden)));
  await page.keyboard.press('Escape');
  check('help: Escape closes it', await t.ev(() => document.getElementById('helpOverlay').hidden));
  await page.locator('#field').focus();
  await page.keyboard.press('?');
  check('help: the ? key opens it', !(await t.ev(() => document.getElementById('helpOverlay').hidden)));
  // editor shortcuts are off while a dialog is open
  await page.keyboard.press('Escape');
  await page.click('[data-step="u2"] .hd');
  await page.click('#btnExport');
  await page.keyboard.press('Delete');
  await page.keyboard.press(' ');
  check('guard: Delete and Space do nothing to the routine while a dialog is open', (await t.project()).steps.length === 6 && !(await t.ev(() => window.valleyVis.store.playback.playing)));
  await page.keyboard.press('Escape');
  await page.click('#btnRoutines');
  await page.keyboard.press('Delete');
  check('guard: Delete does nothing while a menu is open', (await t.project()).steps.length === 6);
  await page.keyboard.press('Escape');
  // typing ? in a text field does not open help
  await page.locator('#projectName').click();
  await page.keyboard.type('What?');
  check('help: typing ? in a field does not open help', await t.ev(() => document.getElementById('helpOverlay').hidden));
  check('help: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
};

tests.settings = async (browser, url) => {
  const page = await newPage(browser, url);
  const t = helpers(page);
  const startBefore = await t.ev(() => window.valleyVis.store.derived().resolved.start);
  await page.click('#btnSettings');
  const len = page.locator('[data-key="set.rl"]');
  await len.fill('18');
  await len.press('Tab');
  const startAfter = await t.ev(() => window.valleyVis.store.derived().resolved.start);
  check('settings: robot length feeds the L expression', near(startAfter.x, 72 + 9) && near(startBefore.x, 72 + 15.875 / 2), JSON.stringify([startBefore.x, startAfter.x]));
  check('settings: focus moves to the next field on Tab', (await t.ev(() => document.activeElement?.getAttribute('data-key'))) === 'set.rw');
  // every section renders
  for (const name of ['Motion', 'Match timing', 'Field view', 'Constants', 'Named points', 'Commands', 'Java export', 'Import / reset', 'Robot']) {
    await page.click(`#settingsOverlay nav button:has-text("${name}")`);
    await page.waitForTimeout(30);
  }
  check('settings: all sections open without errors', page.errors.length === 0, page.errors.join(' | '));
  // constants
  await page.click('#settingsOverlay nav button:has-text("Constants")');
  await page.click('#settingsOverlay .content button:has-text("+ add")');
  await page.locator('[data-key="set.c0n"]').fill('MID_X');
  await page.locator('[data-key="set.c0v"]').fill('82');
  await page.locator('[data-key="set.c0j"]').fill('SoloGeometry.MID_X');
  await page.locator('[data-key="set.c0j"]').press('Tab');
  const s = await t.settings();
  check('settings: constant saved', s.constants[0]?.name === 'MID_X' && s.constants[0]?.value === 82, JSON.stringify(s.constants));
  // export / import / reset
  await page.click('#settingsOverlay nav button:has-text("Import / reset")');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Export settings")')]);
  const file = path.join(os.tmpdir(), `vv-settings-${Date.now()}.json`);
  await dl.saveAs(file);
  page.once('dialog', (d) => d.accept());
  await page.click('button:has-text("Reset everything")');
  check('settings: reset restores defaults', (await t.settings()).robot.length === 15.875 && (await t.settings()).constants.length === 0);
  await page.setInputFiles('#settingsOverlay input[type="file"]', file);
  await page.waitForTimeout(150);
  const s2 = await t.settings();
  check('settings: import restores the exported settings', s2.robot.length === 18 && s2.constants[0]?.name === 'MID_X', JSON.stringify([s2.robot.length, s2.constants]));
  await page.keyboard.press('Escape');
  check('settings: Escape closes the page', await t.ev(() => document.getElementById('settingsOverlay').hidden));
  // the constant works in a coordinate field and exports with its Java name
  await page.click('[data-step="u3"] .hd');
  const x = page.locator('[data-key="u3.x"]');
  await x.fill('MID_X+10');
  await x.press('Tab');
  const endX = await t.ev(() => window.valleyVis.store.derived().resolved.steps[2].end.x);
  check('settings: custom constant evaluates in a field', near(endX, 92), String(endX));
  await page.click('#btnExport');
  const code = await page.locator('#exportOverlay pre.code').textContent();
  check('settings: custom constant exports with its Java name', code.includes('SoloGeometry.MID_X + 10.0'), code.match(/Pose readyToShoot.*/)?.[0]);
  await page.reload();
  await page.waitForFunction(() => !!window.valleyVis);
  check('settings: persist across reload', (await t.settings()).robot.length === 18);
  check('settings: no page errors', page.errors.length === 0, page.errors.join(' | '));
  fs.rmSync(file, { force: true });
  await page.context().close();
};

tests.steps = async (browser, url) => {
  const page = await newPage(browser, url);
  const t = helpers(page);
  await t.menu('#btnRoutines', 'new');
  for (const label of ['+ Path', '+ Action', '+ Wait', '+ Turn', '+ Java']) await page.click(`button:text-is("${label}")`);
  let p = await t.project();
  check('steps: each type can be added in order', p.steps.map((s) => s.type).join(',') === 'path,action,wait,turn,java', p.steps.map((s) => s.type).join(','));
  // new steps are inserted after the selected one
  await page.click(`[data-step="${p.steps[0].id}"] .hd`);
  await page.click('button:text-is("+ Wait")');
  p = await t.project();
  check('steps: a new step goes after the selected step', p.steps[1].type === 'wait' && p.steps.length === 6, p.steps.map((s) => s.type).join(','));
  // reorder / duplicate / delete
  const firstId = p.steps[0].id;
  await page.click(`[data-step="${firstId}"] button[title="Move down"]`);
  p = await t.project();
  check('steps: move down', p.steps[1].id === firstId);
  await page.click(`[data-step="${firstId}"] button[title="Duplicate"]`);
  p = await t.project();
  check('steps: duplicate inserts a renamed copy', p.steps[2].type === 'path' && p.steps[2].id !== firstId && p.steps[2].name !== p.steps[1].name, JSON.stringify([p.steps[1].name, p.steps[2].name]));
  await page.click(`[data-step="${p.steps[2].id}"] button[title="Delete"]`);
  p = await t.project();
  check('steps: delete', p.steps.length === 6);
  // path editor: heading modes all render and export
  await page.click(`[data-step="${firstId}"] .hd`);
  if ((await t.ui()).selectedStepId !== firstId) await page.click(`[data-step="${firstId}"] .hd`);
  for (const mode of ['constant', 'tangent', 'reverseTangent', 'facing', 'piecewise', 'linear']) {
    await page.selectOption(`[data-key="${firstId}.heading.mode"]`, mode);
    await t.settle();
    p = await t.project();
    check(`steps: heading mode ${mode} applies`, p.steps.find((s) => s.id === firstId).heading.mode === mode);
  }
  // segments: add a segment, make it a curve, add a control
  await page.click('button:has-text("+ segment")');
  await page.selectOption(`[data-key="${firstId}.seg1.type"]`, 'curve');
  await page.click(`.sub .sub:has([data-key="${firstId}.seg1.type"]) button:has-text("+ control point")`);
  p = await t.project();
  const st = p.steps.find((s) => s.id === firstId);
  check('steps: multi-segment path with a 2-control curve', st.segments.length === 2 && st.segments[1].type === 'curve' && st.segments[1].controls.length === 2, JSON.stringify(st.segments));
  // during + speed + timeout
  await page.click('button:has-text("+ run during path")');
  await page.locator(`[data-key="${firstId}.speed"]`).fill('0.5');
  await page.locator(`[data-key="${firstId}.timeout"]`).fill('4');
  await page.locator(`[data-key="${firstId}.timeout"]`).press('Tab');
  p = await t.project();
  const st2 = p.steps.find((s) => s.id === firstId);
  check('steps: during/speed/timeout stored', st2.during.length === 1 && st2.maxSpeed === 0.5 && st2.timeout === 4, JSON.stringify([st2.during, st2.maxSpeed, st2.timeout]));
  await page.locator(`[data-key="${firstId}.speed"]`).fill('');
  await page.locator(`[data-key="${firstId}.speed"]`).press('Tab');
  check('steps: clearing max speed stores null', (await t.project()).steps.find((s) => s.id === firstId).maxSpeed === null);
  // export still works for this mix
  await page.click('#btnExport');
  for (const tab of ['Routine class', 'Blue OpMode', 'Red OpMode', 'Paste-in methods']) {
    await page.click(`#exportOverlay .code-tabs button:has-text("${tab}")`);
    const code = await page.locator('#exportOverlay pre.code').textContent();
    check(`steps: export tab "${tab}" has code`, code.length > 100);
  }
  check('steps: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
};

tests.headingHandoff = async (browser, url) => {
  const page = await newPage(browser, url);
  const t = helpers(page);
  // toGarden (u2) ends at heading 0; make it tangent so the robot really ends facing somewhere else
  await page.click('[data-step="u2"] .hd');
  await page.selectOption('[data-key="u2.heading.mode"]', 'tangent');
  await t.settle();
  const warn = (await t.issues()).find((i) => i.stepId === 'u3' && /will be facing/.test(i.msg));
  check('handoff: the next path is warned that it starts from a heading the robot will not have', !!warn, JSON.stringify((await t.issues()).map((i) => i.msg)));
  const fix = page.locator('[data-key="u2.fixH"]');
  check('handoff: the path offers to line up its end heading', (await fix.count()) === 1);
  const label = await fix.textContent();
  await fix.click();
  await t.settle();
  const p = await t.project();
  check('handoff: the button sets the end heading to where the robot ends', `Set end heading to ${p.steps[1].endH}°` === label, `${label} vs ${p.steps[1].endH}`);
  check('handoff: the warning goes away', !(await t.issues()).some((i) => /will be facing/.test(i.msg)));
  check('handoff: the offer disappears once they match', (await page.locator('[data-key="u2.fixH"]').count()) === 0);
  // same thing while previewing red: the stored heading is still blue-frame
  await page.keyboard.press('Control+z');
  await page.click('#allianceToggle button[data-alliance="red"]');
  await t.settle();
  await page.locator('[data-key="u2.fixH"]').click();
  await t.settle();
  check('handoff: fixing it in the red preview stores the same blue-frame heading', (await t.project()).steps[1].endH === p.steps[1].endH, String((await t.project()).steps[1].endH));
  // a turn in between resets the heading, so no warning
  await page.click('#allianceToggle button[data-alliance="blue"]');
  await page.keyboard.press('Control+z');
  await t.ev(() => window.valleyVis.store.update((pr) => { pr.steps.splice(2, 0, { id: 'tn', type: 'turn', h: 0 }); }));
  await t.settle();
  check('handoff: a turn step in between clears the warning', !(await t.issues()).some((i) => /will be facing/.test(i.msg)));
  check('handoff: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
};

tests.zoneReadout = async (browser, url) => {
  const page = await newPage(browser, url);
  const t = helpers(page);
  await page.click('#tabs button[data-tab="zones"]');
  const text = await page.locator('.card .hd:has-text("Hive frame leg (x≈96)") .dur').textContent();
  const shown = Number((text.match(/closest ([\d.]+) in/) || [])[1]);
  const real = await t.ev(() => window.valleyVis.store.derived().collisions.closest['hive-leg-back'].dist);
  check('zones: each zone shows the closest the robot gets', near(shown, real, 0.06) && real > 2, `${text} vs ${real}`);
  await page.click('.card .hd:has-text("Hive frame leg (x≈96)")');
  check('zones: the selected zone names the step', /Closest approach: [\d.]+ in on (step \d+|the park route)/.test(await page.locator('.card.sel .stat').textContent()), await page.locator('.card.sel .stat').textContent());
  // disabling the zone hides the readout
  await page.click('.card.sel input[data-key$=".en"]');
  await t.settle();
  check('zones: a disabled zone has no readout', (await page.locator('.card .hd:has-text("Hive frame leg (x≈96)") .dur').count()) === 0);
  check('zones readout: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
};

tests.namedPoses = async (browser, url) => {
  const page = await newPage(browser, url);
  const t = helpers(page);
  await page.click('[data-step="u3"] .hd');
  // drag the path end near xFlower (96, L/2): it snaps onto the pose and takes its heading
  let end = (await t.handle((h) => h.kind === 'segEnd' && h.stepId === 'u3'))[0];
  await t.drag({ x: end.cx, y: end.cy }, await t.at(97.2, 9.1));
  let st = (await t.project()).steps[2];
  check('poses: dragging a path end near a named pose snaps to it', st.segments[0].end.x === 96 && st.segments[0].end.y === 'L/2' && st.endH === -90 && st.endRef === 'xFlower', JSON.stringify([st.segments[0].end, st.endH, st.endRef]));
  check('poses: the picker shows the tie', (await page.locator('[data-key="u3.pose"]').inputValue()) === 'xFlower');
  await page.click('#btnExport');
  let code = await page.locator('#exportOverlay pre.code').textContent();
  check('poses: export uses the pose Java and imports its class', /Pose readyToShoot = AutoPaths\.xFlower\(f\);/.test(code) && /import org\.firstinspires\.ftc\.team2844simple\.autos\.AutoPaths;/.test(code), code.match(/Pose readyToShoot.*/)?.[0]);
  await page.keyboard.press('Escape');
  // Shift-drag ignores the magnet
  end = (await t.handle((h) => h.kind === 'segEnd' && h.stepId === 'u3'))[0];
  await t.drag({ x: end.cx, y: end.cy }, await t.at(97.2, 9.1), { shift: true });
  st = (await t.project()).steps[2];
  check('poses: Shift-drag does not snap', typeof st.segments[0].end.y === 'number' && !st.endRef, JSON.stringify([st.segments[0].end, st.endRef]));
  // choose a pose from the picker
  await page.selectOption('[data-key="u3.pose"]', 'yFlower');
  await t.settle();
  st = (await t.project()).steps[2];
  check('poses: picking a pose moves the end onto it', st.segments[0].end.x === '144-L/2' && st.segments[0].end.y === 96 && st.endH === 0 && st.endRef === 'yFlower', JSON.stringify([st.segments[0].end, st.endH]));
  // changing the heading breaks the tie, and export goes back to numbers
  await page.locator('[data-key="u3.h"]').fill('45');
  await page.locator('[data-key="u3.h"]').press('Tab');
  await page.waitForTimeout(80);
  check('poses: editing the heading unties the pose', (await page.locator('[data-key="u3.pose"]').inputValue()) === '');
  await page.click('#btnExport');
  code = await page.locator('#exportOverlay pre.code').textContent();
  check('poses: an untied end exports as coordinates', /Pose readyToShoot = f\.of\(144\.0 - Constants\.ROBOT_LENGTH \/ 2\.0, 96\.0, 45\.0\);/.test(code), code.match(/Pose readyToShoot.*/)?.[0]);
  await page.keyboard.press('Escape');
  // the same drag while previewing red lands on the mirrored pose
  await page.click('#allianceToggle button[data-alliance="red"]');
  await t.settle();
  end = (await t.handle((h) => h.kind === 'segEnd' && h.stepId === 'u3'))[0];
  await t.drag({ x: end.cx, y: end.cy }, await t.atReal(144 - 96.5, 144 - 8.5));
  st = (await t.project()).steps[2];
  check('poses: snapping works in the red preview too', st.endRef === 'xFlower' && st.segments[0].end.y === 'L/2', JSON.stringify([st.segments[0].end, st.endRef]));
  check('poses: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
};

tests.nowReadout = async (browser, url) => {
  const page = await newPage(browser, url);
  const t = helpers(page);
  const read = async (time) => {
    await t.ev((tt) => window.valleyVis.seek(tt), time);
    await t.ev(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
    return page.locator('#nowReadout').innerText();
  };
  check('now: shows the step and its command', /Step 1/.test(await read(1)) && /Shoot/.test(await read(1)), await read(1));
  const during = await read(5);
  check('now: shows what runs during a path', /Step 2 · toGarden/.test(during) && /Intake \+ transfer/.test(during), during);
  const sim = await t.ev(() => ({ total: window.valleyVis.store.derived().sim.routineTotal, end: window.valleyVis.store.derived().sim.end }));
  check('now: shows the park route after the routine', /park/i.test(await read(sim.total + 0.5)), await read(sim.total + 0.5));
  check('now: says when auto is over', /finished/i.test(await read(sim.end)), await read(sim.end));
  check('now: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
};

tests.twoTabs = async (browser, url) => {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const open = async () => {
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => !!window.valleyVis);
    return page;
  };
  const a = await open();
  await a.waitForTimeout(500); // let the first tab save the starter routine
  const b = await open();
  const A = helpers(a);
  const B = helpers(b);
  const names = (t) => t.ev(() => window.valleyVis.store.routines().map((r) => r.name + (r.current ? '*' : '')));
  check('tabs: both tabs start on the same single routine', (await names(A)).length === 1 && (await names(B)).length === 1, JSON.stringify([await names(A), await names(B)]));
  // a routine added in one tab shows up in the other, which stays where it was
  await A.example('solo');
  await b.waitForTimeout(700);
  check('tabs: a routine added in tab A appears in tab B', (await names(B)).some((n) => /^Solo/.test(n)) && (await names(B)).some((n) => /^Up.*\*$/.test(n)), JSON.stringify(await names(B)));
  // tab B edits Up while tab A is on Solo: A picks up the edit and keeps its own
  await B.ev(() => window.valleyVis.store.update((p) => { p.steps[4].seconds = 7; }));
  await A.ev(() => window.valleyVis.store.update((p) => { p.steps[0].cmds[0].params.timeoutMs = 1234; }));
  await a.waitForTimeout(900);
  const upInA = await A.ev(() => { const s = window.valleyVis.store; const up = s.routines().find((r) => /^Up/.test(r.name)); s.switchRoutine(up.id); return s.state.project.steps[4].seconds; });
  check('tabs: an edit made in tab B reaches tab A', upInA === 7, String(upInA));
  await b.waitForTimeout(700);
  const soloInB = await B.ev(() => { const s = window.valleyVis.store; const solo = s.routines().find((r) => /^Solo/.test(r.name)); s.switchRoutine(solo.id); return s.state.project.steps[0].cmds[0].params.timeoutMs; });
  check('tabs: neither tab erased the other tab\'s edit', soloInB === 1234, String(soloInB));
  // both tabs looking at the same routine: an edit in one redraws the other
  await B.ev(() => { const s = window.valleyVis.store; s.switchRoutine(s.routines().find((r) => /^Up/.test(r.name)).id); });
  await B.ev(() => window.valleyVis.store.update((p) => { p.steps[4].seconds = 9; }));
  await a.waitForTimeout(900);
  check('tabs: the routine on screen updates when another tab edits it', (await A.project()).steps[4].seconds === 9, String((await A.project()).steps[4].seconds));
  check('tabs: the sidebar redraws with it', /Wait 9 s/.test(await a.locator('#tabBody').innerText()));
  // delete in one tab removes it in the other
  await A.ev(() => { const s = window.valleyVis.store; s.deleteRoutine(s.routines().find((r) => /^Solo/.test(r.name)).id); });
  await b.waitForTimeout(900);
  check('tabs: a routine deleted in tab A disappears from tab B', !(await names(B)).some((n) => /^Solo/.test(n)), JSON.stringify(await names(B)));
  // settings travel too
  await A.ev(() => window.valleyVis.store.updateSettings((s) => { s.robot.length = 16.5; }));
  await b.waitForTimeout(900);
  check('tabs: a settings change reaches the other tab', (await B.settings()).robot.length === 16.5);
  // after a reload everything agrees
  await a.waitForTimeout(400);
  await a.reload();
  await a.waitForFunction(() => !!window.valleyVis);
  check('tabs: reload shows the merged result', (await names(A)).length === 1 && (await A.project()).steps[4].seconds === 9, JSON.stringify(await names(A)));
  check('tabs: no page errors', a.errors.length === 0 && b.errors.length === 0, [...a.errors, ...b.errors].join(' | '));
  await ctx.close();
};

tests.offline = async (browser) => {
  // its own server, so it can be switched off mid-test
  const own = await startServer(ROOT);
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(own.url);
  await page.waitForFunction(() => !!window.valleyVis);
  const t = helpers(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(async () => (await (await caches.open('valleyvis-v1')).keys()).length >= 30, null, { timeout: 15000 });
  await t.example('solo');
  await page.waitForTimeout(500);
  // pull the plug
  own.server.closeAllConnections();
  await new Promise((res) => own.server.close(res));
  await page.reload();
  let loaded = true;
  await page.waitForFunction(() => !!window.valleyVis, null, { timeout: 15000 }).catch(() => { loaded = false; });
  check('offline: the app loads with the server gone', loaded);
  if (loaded) {
    check('offline: your routines are still there', (await t.ev(() => window.valleyVis.store.routines().length)) === 2);
    check('offline: the field image is served from the cache', await t.ev(() => new Promise((res) => { const i = new Image(); i.onload = () => res(i.naturalWidth > 0); i.onerror = () => res(false); i.src = 'assets/field-biobuzz.webp'; })));
    await page.click('button:text-is("+ Path")');
    await page.click('#btnExport');
    const code = await page.locator('#exportOverlay pre.code').textContent();
    check('offline: editing and exporting still work', /PedroAutoDsl\.auto/.test(code));
  }
  check('offline: no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
};

tests.keyboardTimeline = async (browser, url) => {
  const page = await newPage(browser, url);
  const t = helpers(page);
  await page.locator('#field').focus();
  await page.keyboard.press(' ');
  await page.waitForTimeout(400);
  const playing = await t.ev(() => window.valleyVis.store.playback.playing);
  await page.keyboard.press(' ');
  const time = await t.ev(() => window.valleyVis.store.playback.time);
  check('keys: Space plays and pauses', playing && time > 0.2 && !(await t.ev(() => window.valleyVis.store.playback.playing)), String(time));
  await page.keyboard.press('ArrowRight');
  check('keys: ArrowRight steps 0.1 s', near(await t.ev(() => window.valleyVis.store.playback.time), time + 0.1, 0.02));
  // typing a space in a text field must not toggle playback
  await page.locator('#projectName').click();
  await page.keyboard.type('a b');
  check('keys: Space in a text field does not start playback', !(await t.ev(() => window.valleyVis.store.playback.playing)));
  // timeline click seeks, clicking a block selects the step
  const strip = await page.locator('.strip').boundingBox();
  await page.mouse.click(strip.x + strip.width * 0.5, strip.y + 45);
  const scale = await t.ev(() => window.valleyVis.store.derived().sim.end);
  const tt = await t.ev(() => window.valleyVis.store.playback.time);
  check('timeline: click seeks', tt > 0 && tt <= scale + 0.01, String(tt));
  const blk = await page.locator('.strip [data-step="u2"]').boundingBox();
  await page.mouse.click(blk.x + blk.width / 2, blk.y + blk.height / 2);
  check('timeline: clicking a block selects that step', (await t.ui()).selectedStepId === 'u2');
  // Delete removes the selected step; undo brings it back
  await page.locator('#field').focus();
  await page.keyboard.press('Delete');
  check('keys: Delete removes the selected step', (await t.project()).steps.length === 5);
  await page.keyboard.press('Control+z');
  check('keys: Ctrl+Z restores it', (await t.project()).steps.length === 6);
  await page.keyboard.press('Control+y');
  check('keys: Ctrl+Y redoes', (await t.project()).steps.length === 5);
  // end of playback stops at the end
  await t.ev(() => { window.valleyVis.store.playback.speed = 4; window.valleyVis.seek(window.valleyVis.store.derived().sim.end - 0.3); });
  await page.keyboard.press(' ');
  await page.waitForTimeout(500);
  const st = await t.ev(() => [window.valleyVis.store.playback.playing, window.valleyVis.store.playback.time, window.valleyVis.store.derived().sim.end]);
  check('timeline: playback stops at the end', st[0] === false && near(st[1], st[2], 0.01), JSON.stringify(st));
  check('keys: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
};

tests.orientation = async (browser, url) => {
  const page = await newPage(browser, url);
  const t = helpers(page);
  for (const o of ['right', 'down', 'left', 'up']) {
    await t.ev((v) => window.valleyVis.store.updateSettings((s) => { s.field.plusX = v; }), o);
    await t.settle();
    await page.click('[data-step="u3"] .hd');
    if ((await t.ui()).selectedStepId !== 'u3') await page.click('[data-step="u3"] .hd');
    const end = (await t.handle((h) => h.kind === 'segEnd' && h.stepId === 'u3'))[0];
    await t.drag({ x: end.cx, y: end.cy }, await t.at(80, 90));
    const e = (await t.project()).steps[2].segments[0].end;
    check(`orientation ${o}: drag maps back to the right field point`, near(e.x, 80, 0.3) && near(e.y, 90, 0.3), JSON.stringify(e));
    await page.keyboard.press('Control+z');
  }
  check('orientation: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
};

tests.badInput = async (browser, url) => {
  const page = await newPage(browser, url);
  const t = helpers(page);
  await page.click('[data-step="u3"] .hd');
  const x = page.locator('[data-key="u3.x"]');
  await x.fill('nope+1');
  check('bad: unknown name marks the field invalid', await x.evaluate((el) => el.classList.contains('invalid')));
  check('bad: unknown name is a reported problem', (await t.issues()).some((i) => /unknown name/.test(i.msg)));
  await x.fill('');
  await x.press('Tab');
  check('bad: empty coordinate is a reported problem, app still alive', (await t.issues()).some((i) => i.level === 'error') && (await t.ev(() => !!window.valleyVis.store.derived().sim)));
  await x.fill('96');
  await x.press('Tab');
  // zero-length path
  await t.ev(() => window.valleyVis.store.update((p) => { p.steps[2].segments[0].end = { x: '144-L/2', y: '144-W/2' }; }));
  await t.settle();
  check('bad: zero-length segment is reported', (await t.issues()).some((i) => /zero length/.test(i.msg)), JSON.stringify((await t.issues()).map((i) => i.msg)));
  await page.keyboard.press('Control+z');
  // unknown command id
  await t.ev(() => window.valleyVis.store.update((p) => { p.steps[0].cmds = [{ lib: 'doesNotExist', params: {} }]; }));
  await t.settle();
  check('bad: unknown command is reported', (await t.issues()).some((i) => /not in the command library/.test(i.msg)));
  await page.click('#btnExport');
  const code = await page.locator('#exportOverlay pre.code').textContent();
  check('bad: export marks the unknown command as a TODO', /TODO unknown command/.test(code));
  await page.keyboard.press('Escape');
  // invalid piecewise order
  await t.ev(() => window.valleyVis.store.update((p) => { p.steps[1].heading.pieces[1].until = 0.1; }));
  await t.settle();
  check('bad: piecewise order error is reported', (await t.issues()).some((i) => /must be greater than/.test(i.msg)));
  // empty command library
  await t.ev(() => window.valleyVis.store.updateSettings((s) => { s.commands = []; }));
  await t.settle();
  await page.click('button:text-is("+ Action")');
  await page.click('button:text-is("+ Path")');
  check('bad: empty command library does not break adding steps', (await t.project()).steps.length === 8);
  check('bad: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
};

tests.corruptStorage = async (browser, url) => {
  const cases = {
    garbage: () => { localStorage.setItem('valleyvis.project.v1', '{not json'); localStorage.setItem('valleyvis.settings.v1', 'xx'); localStorage.setItem('valleyvis.ui.v1', '[1,2'); },
    emptyObjects: () => { localStorage.setItem('valleyvis.project.v1', '{}'); localStorage.setItem('valleyvis.settings.v1', '{}'); localStorage.setItem('valleyvis.ui.v1', '{}'); },
    wrongTypes: () => { localStorage.setItem('valleyvis.project.v1', JSON.stringify({ name: 5, steps: 'x', zones: null, start: null })); localStorage.setItem('valleyvis.settings.v1', JSON.stringify({ robot: null, commands: 'no', motion: 3, field: [], constants: null, points: {} })); },
    partialSteps: () => { localStorage.setItem('valleyvis.project.v1', JSON.stringify({ name: 'x', start: { x: 10 }, steps: [{ type: 'path' }, { type: 'action' }, { type: 'wat' }, null, { type: 'turn' }, { type: 'wait' }, { type: 'java' }], zones: [{ shape: 'rect' }, { shape: 'poly' }, { shape: 'circle' }, null] })); },
    nullValues: () => { localStorage.setItem('valleyvis.project.v1', 'null'); localStorage.setItem('valleyvis.settings.v1', 'null'); },
  };
  for (const [name, init] of Object.entries(cases)) {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
    await ctx.addInitScript(`if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); (${init.toString()})(); }`);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForTimeout(500);
    const alive = await page.evaluate(() => {
      try {
        const app = window.valleyVis;
        if (!app) return 'no app';
        app.store.derived();
        return document.querySelectorAll('#tabBody .card').length > 0 ? 'ok' : 'no cards';
      } catch (e) {
        return `throws: ${e.message}`;
      }
    });
    check(`corrupt storage (${name}): app still loads`, alive === 'ok' && errors.length === 0, `${alive} ${errors.join(' | ')}`);
    if (alive === 'ok') {
      // and stays usable
      const t = helpers(page);
      await page.click('button:text-is("+ Path")').catch(() => {});
      await page.click('#btnExport').catch(() => {});
      await page.waitForTimeout(100);
      check(`corrupt storage (${name}): can add a path and export`, errors.length === 0 && (await t.project()).steps.some((s) => s && s.type === 'path'), errors.join(' | '));
    }
    await ctx.close();
  }
};

tests.presetsAndExport = async (browser, url) => {
  const page = await newPage(browser, url, { context: { permissions: ['clipboard-read', 'clipboard-write'] } });
  const t = helpers(page);
  for (const id of ['up', 'solo', 'down']) {
    await t.example(id);
    for (const al of ['red', 'blue']) {
      await page.click(`#allianceToggle button[data-alliance="${al}"]`);
      await t.settle();
    }
    await page.click('#btnExport');
    const code = await page.locator('#exportOverlay pre.code').textContent();
    check(`preset ${id}: exports a routine()`, /protected Command routine\(\)/.test(code) && /PedroAutoDsl\.auto/.test(code));
    await page.click('#exportOverlay button:has-text("Copy")');
    await page.waitForTimeout(80);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    check(`preset ${id}: Copy puts the code on the clipboard`, clip === code);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportOverlay button:has-text("Download")')]);
    check(`preset ${id}: Download gives a .java file`, dl.suggestedFilename().endsWith('.java'), dl.suggestedFilename());
    await page.keyboard.press('Escape');
  }
  check('presets: each example was added as its own routine', (await t.ev(() => window.valleyVis.store.routines())).length === 4);
  check('presets: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
};

tests.mobile = async (browser, url) => {
  const page = await newPage(browser, url, { viewport: { width: 390, height: 844 }, context: { hasTouch: true, isMobile: true } });
  const t = helpers(page);
  const w = await t.ev(() => [document.documentElement.scrollWidth, window.innerWidth]);
  check('mobile: no sideways scroll', w[0] <= w[1] + 1, JSON.stringify(w));
  const c = await page.locator('#field').boundingBox();
  check('mobile: field fits the screen', c.width <= 390 && c.width > 250, JSON.stringify(c));
  await page.locator('[data-step="u3"] .hd').scrollIntoViewIfNeeded();
  await page.tap('[data-step="u3"] .hd');
  check('mobile: tapping a step selects it', (await t.ui()).selectedStepId === 'u3');
  await page.tap('#btnSettings');
  const m = await page.locator('#settingsOverlay .modal').boundingBox();
  check('mobile: settings fit the screen', m.width <= 390, JSON.stringify(m));
  check('mobile: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
};

tests.performance = async (browser, url) => {
  const page = await newPage(browser, url);
  const t = helpers(page);
  const ms = await t.ev(() => {
    const app = window.valleyVis;
    app.store.update((p) => {
      p.steps = [];
      for (let i = 0; i < 40; i++) {
        p.steps.push({ id: `p${i}`, type: 'path', name: `p${i}`, endName: `e${i}`, segments: [{ type: 'curve', controls: [{ x: 30 + (i * 7) % 90, y: 30 + (i * 13) % 90 }], end: { x: 20 + (i * 17) % 100, y: 20 + (i * 29) % 100 } }], endH: (i * 40) % 360, heading: { mode: 'linear' }, during: [], markers: [] });
        p.steps.push({ id: `a${i}`, type: 'action', label: '', cmds: [{ lib: 'shoot', params: { timeoutMs: 200 } }], timeout: null });
      }
    });
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) {
      app.store.update((p) => { p.steps[0].segments[0].end.x = 20 + i; }, { history: false });
      app.store.derived();
    }
    return (performance.now() - t0) / 10;
  });
  check('perf: 80-step routine recomputes in under 50 ms', ms < 50, `${ms.toFixed(1)} ms`);
  check('perf: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
};

(async () => {
  const { server, url } = await startServer(ROOT);
  const browser = await chromium.launch();
  for (const [name, fn] of Object.entries(tests)) {
    if (only && name !== only) continue;
    const before = results.length;
    try {
      await fn(browser, url);
    } catch (e) {
      check(`${name}: threw`, false, e.message.split('\n')[0]);
    }
    const mine = results.slice(before);
    console.log(`${mine.every((r) => r.ok) ? 'ok  ' : 'FAIL'} ${name} (${mine.filter((r) => r.ok).length}/${mine.length})`);
  }
  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
})();
