// Java export: ValleyLib 2.0.0 PedroAutoDsl + Pedro Pathing 3.0.1 paths, in the style of
// team2844simple/autos (PoseFactory f = field(); blue design frame, mirrored for red).

import { fillTemplate, fmtNum, javaValue } from './expr.js';
import { namedEndPose } from './poses.js';
import { symbolTable } from './resolve.js';

const JAVA_KEYWORDS = new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record yield'.split(' '));

export function javaIdent(name, fallback = 'value') {
  const words = String(name || '').replace(/[^A-Za-z0-9_ ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return fallback;
  let id = words.map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1))).join('');
  if (/^[0-9]/.test(id)) id = `_${id}`;
  if (JAVA_KEYWORDS.has(id)) id = `${id}_`;
  return id;
}

export function javaClassName(name, fallback = 'GeneratedRoutine') {
  const id = javaIdent(name, fallback);
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function makeNames(reserved) {
  const used = new Set(reserved);
  return (wanted, fallback) => {
    const base = javaIdent(wanted, fallback);
    let id = base;
    let k = 2;
    while (used.has(id)) id = `${base}${k++}`;
    used.add(id);
    return id;
  };
}

function splitList(s) {
  return String(s || '').split(/[\n,;]+/).map((x) => x.trim().replace(/^import\s+/, '')).filter(Boolean);
}

function paramJava(raw, def) {
  const n = Number(raw);
  if (raw === undefined || raw === null || raw === '') return paramJava(def, def);
  if (!Number.isFinite(n)) return String(raw);
  const wantsDouble = String(def).includes('.') || !Number.isInteger(n);
  return wantsDouble ? fmtNum(n) : String(n);
}

function statements(code) {
  return String(code || '').split('\n').map((l) => l.trim()).filter(Boolean);
}

export function createContext(project, settings, resolvedBlue) {
  const { java } = symbolTable(settings);
  return {
    project,
    settings,
    resolved: resolvedBlue,
    jv: (v) => javaValue(v, java),
    imports: new Set(),
    warnings: [],
    usesMarkers: false,
    usesJointSafe: false,
    name: makeNames(['f', 'b', 'subsystems', 'reached', 'jointSafe', 'start', 'startingPose', 'routine', 'field', 'alliance', 'target']),
  };
}

function useImport(ctx, ...list) {
  for (const i of list) if (i) ctx.imports.add(i);
}

function poseOf(ctx, x, y, h) {
  return `f.of(${ctx.jv(x)}, ${ctx.jv(y)}, ${ctx.jv(h)})`;
}

/** A library command as a Java expression of type Command. */
export function commandExpr(ref, ctx) {
  const lib = (ctx.settings.commands || []).find((c) => c.id === ref?.lib);
  if (!lib) {
    ctx.warnings.push(`Unknown command "${ref?.lib}" was left as a TODO.`);
    return `Commands.none() /* TODO unknown command "${ref?.lib}" */`;
  }
  useImport(ctx, ...splitList(lib.imports));
  const values = {};
  for (const p of lib.params || []) values[p.key] = paramJava(ref.params?.[p.key], p.default);
  const code = fillTemplate(lib.java, values).trim();
  if (lib.type === 'instant') {
    useImport(ctx, 'com.vcs.valleylib.core.command.Commands');
    const lines = statements(code);
    return lines.length === 1 ? `Commands.runOnce(() -> { ${lines[0]} })` : `Commands.runOnce(() -> {\n${lines.map((l) => `    ${l}`).join('\n')}\n})`;
  }
  return code;
}

function instantBody(ref, ctx) {
  const lib = (ctx.settings.commands || []).find((c) => c.id === ref?.lib);
  useImport(ctx, ...splitList(lib.imports));
  const values = {};
  for (const p of lib.params || []) values[p.key] = paramJava(ref.params?.[p.key], p.default);
  return statements(fillTemplate(lib.java, values));
}

function indentBlock(text, pad) {
  return text.split('\n').map((l, i) => (i === 0 ? l : pad + l)).join('\n');
}

function argList(args, pad) {
  return args.map((a) => `\n${pad}${indentBlock(a, pad)}`).join(',');
}

/* ---------------- headings ---------------- */

function headingPose(which, deg, pathCtx, ctx) {
  if (which === 'end') return pathCtx.endVar;
  if (which === 'custom') return poseOf(ctx, pathCtx.endX, pathCtx.endY, deg ?? 0);
  return pathCtx.startVar;
}

function pieceInterp(p, pathCtx, ctx) {
  switch (p.mode) {
    case 'constant': return `Interpolator.constant(${headingPose(p.hold || 'start', p.deg, pathCtx, ctx)})`;
    case 'linear': {
      const fn = p.long ? 'longLinear' : 'linear';
      return `Interpolator.${fn}(${headingPose(p.from || 'start', p.fromDeg, pathCtx, ctx)}, ${headingPose(p.to || 'end', p.toDeg, pathCtx, ctx)})`;
    }
    case 'tangent': return 'Interpolator.tangent';
    case 'reverseTangent': return 'Interpolator.tangent.reverse()';
    case 'facing': return `Interpolator.facingPoint(${poseOf(ctx, p.x ?? 72, p.y ?? 72, 0)})`;
    default: return `Interpolator.constant(${pathCtx.startVar})`;
  }
}

function piecewiseSuffix(pieces, pathCtx, ctx, pad) {
  useImport(ctx, 'com.pedropathing.paths.interpolator.Interpolator');
  const inner = `${pad}        `;
  const lines = pieces.map((p) => `\n${inner}.until(${fmtNum(Number(p.until))}, ${pieceInterp(p, pathCtx, ctx)})`).join('');
  if (pathCtx.multiSegment) {
    // Pedro 3.0.1 throws on ~1 in 9 multi-segment paths with a piecewise heading (rounding at the joints)
    ctx.usesJointSafe = true;
    return `\n${pad}.heading(jointSafe(Interpolator.piecewise()${lines}))`;
  }
  return `\n${pad}.heading(Interpolator.piecewise()${lines})`;
}

export function headingSuffix(heading, pathCtx, ctx, pad) {
  const h = heading || { mode: 'linear' };
  const s = pathCtx.startVar;
  const e = pathCtx.endVar;
  switch (h.mode) {
    case 'tangent': return `\n${pad}.tangent()`;
    case 'reverseTangent': return `\n${pad}.reverseTangent()`;
    case 'constant': return `\n${pad}.constant(${headingPose(h.hold || 'start', h.deg, pathCtx, ctx)})`;
    case 'facing': return `\n${pad}.facingPoint(${poseOf(ctx, h.x ?? 72, h.y ?? 72, 0)})`;
    case 'piecewise': return piecewiseSuffix(h.pieces || [], pathCtx, ctx, pad);
    case 'linear':
    default: {
      const endT = Number(h.endT ?? 1);
      if (h.long) {
        const pieces = endT < 1 && endT > 0
          ? [{ until: endT, mode: 'linear', from: 'start', to: 'end', long: true }, { until: 1, mode: 'constant', hold: 'end' }]
          : null;
        if (pieces) return piecewiseSuffix(pieces, pathCtx, ctx, pad);
        useImport(ctx, 'com.pedropathing.paths.interpolator.Interpolator');
        return `\n${pad}.heading(Interpolator.longLinear(${s}, ${e}))`;
      }
      if (endT < 1 && endT > 0) {
        if (pathCtx.multiSegment) {
          // Path.linear(start, end, endT) builds a piecewise internally, so it needs the same guard
          return piecewiseSuffix([{ until: endT, mode: 'linear', from: 'start', to: 'end' }, { until: 1, mode: 'constant', hold: 'end' }], pathCtx, ctx, pad);
        }
        return `\n${pad}.linear(${s}, ${e}, ${fmtNum(endT)})`;
      }
      return `\n${pad}.linear(${s}, ${e})`;
    }
  }
}

/* ---------------- steps ---------------- */

const POSE_PAD = '        '; // statements inside routine()
const B_PAD = '            '; // statements inside the PedroAutoDsl lambda

/** Token for "this path" in builder lines; each layout swaps in its own way of naming a path. */
const pathRef = (name) => `\u0001${name}\u0001`;
const renderPathRefs = (text, fn) => text.replace(/\u0001(\w+)\u0001/g, (m, name) => fn(name));

function addPose(state, name, expr) {
  state.poses.push(`Pose ${name} = ${expr};`);
  state.poseDefs.push({ name, expr });
}

function ensureStartVar(ctx, state, wanted) {
  if (state.cur.var) return state.cur.var;
  const v = ctx.name(wanted, 'pathStart');
  addPose(state, v, poseOf(ctx, state.cur.x, state.cur.y, state.cur.h));
  state.cur.var = v;
  return v;
}

function markerSequence(m, step, ctx) {
  const geom = ctx.resolved?.steps.find((s) => s.id === step.id)?.geom;
  const at = Math.min(Math.max(Number(m.at) || 0, 0), 1);
  const loc = geom ? geom.localCompletion(at) : { index: 0, completion: at };
  // inches left in that segment when the marker should fire (Pedro's own segment length)
  const segLen = geom ? geom.segs[loc.index].length : 0;
  const remaining = Math.max(0, (1 - loc.completion) * segLen);
  if (at >= 0.98) ctx.warnings.push(`Marker at ${(at * 100).toFixed(0)}% of "${step.name}" may never fire: the follow can finish (and cut the marker) before completion reaches it. Use an action step after the path instead.`);
  ctx.usesMarkers = true;
  useImport(ctx, 'com.vcs.valleylib.core.command.Commands');
  const cmd = commandExpr(m.cmd, ctx);
  return `Commands.sequence(\n    Commands.waitUntil(() -> reached(${loc.index}, ${fmtNum(remaining, 2)})),\n    ${indentBlock(cmd, '    ')})`;
}

function genPath(step, ctx, state) {
  const segs = step.segments || [];
  if (!segs.length) {
    state.builder.push('// (skipped an empty path)');
    return;
  }
  useImport(ctx, 'com.pedropathing.api.Paths', 'com.pedropathing.paths.Path');
  const pathName = ctx.name(step.name, 'path');
  const startVar = ensureStartVar(ctx, state, `${pathName}Start`);
  const last = segs[segs.length - 1];
  const endVar = ctx.name(step.endName || `${pathName}End`, 'pathEnd');
  const named = namedEndPose(step, ctx.settings);
  addPose(state, endVar, named && named.java && named.ph !== null
    ? named.java.trim().replace(/;$/, '')
    : poseOf(ctx, last.end.x, last.end.y, step.endH ?? 0));
  let prev = startVar;
  const joints = [];
  const segExprs = segs.map((seg, i) => {
    let to = endVar;
    if (i < segs.length - 1) {
      to = ctx.name(`${pathName} joint ${i + 1}`, 'joint');
      const expr = poseOf(ctx, seg.end.x, seg.end.y, 0);
      state.poses.push(`Pose ${to} = ${expr};`);
      joints.push({ name: to, expr });
    }
    const controls = seg.type === 'curve' ? seg.controls || [] : [];
    const expr = controls.length
      ? `Paths.curve(${[prev, ...controls.map((c) => poseOf(ctx, c.x, c.y, 0)), to].join(', ')})`
      : `Paths.line(${prev}, ${to})`;
    prev = to;
    return expr;
  });
  const cont = `${POSE_PAD}        `;
  const body = segExprs.length === 1
    ? segExprs[0]
    : `Paths.path(${segExprs.map((e) => `\n${cont}    ${e}`).join(',')})`;
  const pathCtx = { startVar, endVar, endX: last.end.x, endY: last.end.y, multiSegment: segs.length > 1, name: pathName };
  const suffix = headingSuffix(step.heading, pathCtx, ctx, cont);
  state.paths.push(`Path ${pathName} = ${body}${suffix};`);
  state.pathDefs.push({ name: pathName, start: startVar, end: endVar, joints, body, suffix });

  const drive = ctx.settings.code.drive;
  const speed = step.maxSpeed === null || step.maxSpeed === undefined || step.maxSpeed === '' ? null : ctx.jv(step.maxSpeed);
  const during = (step.during || []).map((r) => commandExpr(r, ctx));
  const markers = (step.markers || []).map((m) => markerSequence(m, step, ctx));
  const hasTimeout = !(step.timeout === null || step.timeout === undefined || step.timeout === '');
  const ref = pathRef(pathName);
  if (!during.length && !markers.length && !hasTimeout) {
    state.builder.push(speed ? `b.follow(${ref}, ${speed});` : `b.follow(${ref});`);
  } else {
    let expr = `${drive}.follow(${ref}${speed ? `, ${speed}` : ''})`;
    if (hasTimeout) expr += `\n        .withTimeout(${ctx.jv(step.timeout)})`;
    const parallel = [...during, ...markers];
    if (parallel.length) expr += `\n        .deadlineWith(${argList(parallel, '                ')})`;
    state.builder.push(`b.command(${expr});`);
  }
  state.cur = { var: endVar, x: last.end.x, y: last.end.y, h: step.endH ?? 0 };
}

function genAction(step, ctx, state) {
  const cmds = step.cmds || [];
  if (step.label) state.builder.push(`// ${step.label}`);
  if (!cmds.length) {
    state.builder.push('// (empty action)');
    return;
  }
  const hasTimeout = !(step.timeout === null || step.timeout === undefined || step.timeout === '');
  const libOf = (r) => (ctx.settings.commands || []).find((c) => c.id === r.lib);
  if (cmds.length === 1 && !hasTimeout && libOf(cmds[0])?.type === 'instant') {
    const lines = instantBody(cmds[0], ctx);
    state.builder.push(`b.doInstant(() -> {\n${lines.map((l) => `    ${l}`).join('\n')}\n});`);
    return;
  }
  const exprs = cmds.map((r) => commandExpr(r, ctx));
  if (cmds.length === 1) {
    state.builder.push(hasTimeout ? `b.command(${exprs[0]}.withTimeout(${ctx.jv(step.timeout)}));` : `b.command(${exprs[0]});`);
    return;
  }
  if (!hasTimeout) {
    state.builder.push(`b.parallel(${argList(exprs, '        ')});`);
    return;
  }
  useImport(ctx, 'com.vcs.valleylib.core.command.Commands');
  state.builder.push(`b.command(Commands.parallel(${argList(exprs, '        ')})\n        .withTimeout(${ctx.jv(step.timeout)}));`);
}

function genTurn(step, ctx, state) {
  useImport(ctx, ...splitList(ctx.settings.code.turnImports));
  const heading = `${poseOf(ctx, state.cur.x, state.cur.y, step.h ?? 0)}.heading()`;
  const expr = fillTemplate(ctx.settings.code.turnTemplate, { drive: ctx.settings.code.drive, heading });
  state.builder.push(`b.command(${expr});`);
  state.cur = { var: null, x: state.cur.x, y: state.cur.y, h: step.h ?? 0 };
}

function genStep(step, ctx, state) {
  if (step.type === 'path') genPath(step, ctx, state);
  else if (step.type === 'action') genAction(step, ctx, state);
  else if (step.type === 'turn') genTurn(step, ctx, state);
  else if (step.type === 'wait') state.builder.push(`b.waitFor(${ctx.jv(step.seconds ?? 0)});`);
  else if (step.type === 'java') state.builder.push(...statements(step.code).length ? [String(step.code).trim()] : ['// (empty Java step)']);
}

function reachedHelper(ctx) {
  useImport(ctx, 'com.pedropathing.follower.Follower');
  return [
    '    /**',
    '     * True once the follower is on path segment {@code segment} with at most {@code inchesLeft}',
    '     * to go in it, or is already past that segment. Uses remainingDistance() because in',
    '     * Pedro 3.0.1 completion() mixes the segment t with the whole path on multi-segment paths.',
    '     */',
    '    private boolean reached(int segment, double inchesLeft) {',
    `        Follower follower = ${ctx.settings.code.drive}.getFollower();`,
    '        return follower.pathIndex() > segment',
    '                || (follower.pathIndex() == segment && follower.remainingDistance() <= inchesLeft);',
    '    }',
  ].join('\n');
}

function jointSafeHelper(ctx) {
  useImport(ctx, 'com.pedropathing.paths.interpolator.Interpolator');
  return [
    '    /**',
    '     * Pedro 3.0.1 can throw when a piecewise heading sits on a multi-segment path: rounding at',
    '     * the segment joints makes it look up the wrong piece. Evaluating a hair earlier avoids it.',
    '     */',
    '    private static Interpolator jointSafe(Interpolator heading) {',
    '        return (curve, t) -> heading.interpolate(curve, Math.max(0.0, t - 1e-9));',
    '    }',
  ].join('\n');
}

function padLines(text, pad) {
  return text.split('\n').map((l) => (l ? pad + l : l)).join('\n');
}

/** Simple class name -> import, for every class the export or the command library knows about. */
function knownClasses(settings) {
  const fq = [
    'com.pedropathing.api.Paths', 'com.pedropathing.api.PoseFactory', 'com.pedropathing.math.Pose',
    'com.pedropathing.paths.Path', 'com.pedropathing.paths.interpolator.Interpolator', 'com.pedropathing.follower.Follower',
    'com.vcs.valleylib.core.command.Command', 'com.vcs.valleylib.core.command.Commands', 'com.vcs.valleylib.ftc.pedro.PedroAutoDsl',
    settings.code.constantsImport,
    ...splitList(settings.code.turnImports),
    ...splitList(settings.code.extraImports),
    ...(settings.commands || []).flatMap((c) => splitList(c.imports)),
  ];
  const out = {};
  for (const name of fq) {
    const simple = String(name || '').split('.').pop();
    if (/^[A-Z]\w*$/.test(simple) && !(simple in out)) out[simple] = name;
  }
  return out;
}

/** Body pieces shared by every export flavour. */
export function generateBody(project, settings, resolvedBlue) {
  const ctx = createContext(project, settings, resolvedBlue);
  useImport(ctx, 'com.pedropathing.api.PoseFactory', 'com.pedropathing.math.Pose', 'com.vcs.valleylib.core.command.Command', 'com.vcs.valleylib.ftc.pedro.PedroAutoDsl');
  const s = project.start || { x: 72, y: 72, h: 0 };
  const state = { poses: ['Pose start = startingPose();'], paths: [], builder: [], poseDefs: [], pathDefs: [], cur: { var: 'start', x: s.x, y: s.y, h: s.h ?? 0 } };
  for (const step of project.steps || []) genStep(step, ctx, state);
  const startExpr = `.of(${ctx.jv(s.x)}, ${ctx.jv(s.y)}, ${ctx.jv(s.h ?? 0)})`;

  const startingPose = [
    '    @Override',
    '    public Pose startingPose() {',
    `        return ${settings.code.poseFactory}.of(${ctx.jv(s.x)}, ${ctx.jv(s.y)}, ${ctx.jv(s.h ?? 0)});`,
    '    }',
  ].join('\n');

  const routine = [
    '    @Override',
    '    protected Command routine() {',
    `        PoseFactory f = ${settings.code.poseFactory};`,
    '',
    '        /* ----- Poses ----- */',
    ...state.poses.map((l) => POSE_PAD + l),
    ...(state.paths.length ? ['', '        /* ----- Paths ----- */', ...state.paths.map((l) => POSE_PAD + l)] : []),
    '',
    `        return PedroAutoDsl.auto(${settings.code.drive}, b -> {`,
    ...state.builder.map((l) => padLines(renderPathRefs(l, (name) => name), B_PAD)),
    '        });',
    '    }',
  ].join('\n');

  const helpers = [ctx.usesMarkers ? reachedHelper(ctx) : null, ctx.usesJointSafe ? jointSafeHelper(ctx) : null].filter(Boolean);
  const helper = helpers.length ? helpers.join('\n\n') : null;
  if (ctx.usesJointSafe) ctx.warnings.push('Multi-segment paths with a piecewise heading are wrapped in jointSafe(): Pedro 3.0.1 throws on about 1 in 9 of them otherwise. Keep the helper when you paste.');
  const all = [startingPose, routine, helper].filter(Boolean).join('\n');
  // hand-written Java steps and command templates can mention classes nothing else imported
  for (const [simple, fqcn] of Object.entries(knownClasses(settings))) {
    if (new RegExp(`(^|[^\\w.])${simple}\\b`).test(all)) useImport(ctx, fqcn);
  }
  const model = { startExpr, poseDefs: state.poseDefs, pathDefs: state.pathDefs, builder: state.builder, usesMarkers: ctx.usesMarkers, usesJointSafe: ctx.usesJointSafe, ctx };
  return { startingPose, routine, helper, imports: [...ctx.imports].sort(), warnings: ctx.warnings, model };
}

/** Imports a piece of generated Java needs, found by the class names it mentions. */
function importsFor(text, settings, extra = {}) {
  const out = new Set();
  for (const [simple, fqcn] of Object.entries({ ...knownClasses(settings), ...extra })) {
    if (fqcn && new RegExp(`(^|[^\\w.])${simple}\\b`).test(text)) out.add(fqcn);
  }
  return [...out].sort();
}

/**
 * The team's file layout: a Geometry class of static poses and paths (like UpGeometry),
 * and a routine class that follows them (like UpRoutine).
 */
function generateTeamLayout(project, settings, body, className) {
  const { model } = body;
  const geometryName = /Routine$/.test(className) ? className.replace(/Routine$/, 'Geometry') : `${className}Geometry`;
  const geometryPackage = settings.code.geometryPackage || settings.code.routinePackage;
  const pad = '        ';

  const poseMethods = [
    `    public static Pose startingPose(PoseFactory f) {\n        return f${model.startExpr};\n    }`,
    ...model.poseDefs.map((d) => `    public static Pose ${d.name}(PoseFactory f) {\n        return ${d.expr};\n    }`),
  ];
  const poseCall = (name) => (name === 'start' ? 'startingPose(f)' : `${name}(f)`);
  const pathMethods = model.pathDefs.map((d) => [
    `    public static Path ${d.name}(PoseFactory f) {`,
    `${pad}Pose ${d.start} = ${poseCall(d.start)};`,
    `${pad}Pose ${d.end} = ${poseCall(d.end)};`,
    ...d.joints.map((j) => `${pad}Pose ${j.name} = ${j.expr};`),
    `${pad}return ${d.body}${d.suffix};`,
    '    }',
  ].join('\n'));
  const geometryMembers = [
    `    private ${geometryName}() {}`,
    '',
    '    /* ----- Poses ----- */',
    poseMethods.join('\n\n'),
    ...(pathMethods.length ? ['', '    /* ----- Paths ----- */', pathMethods.join('\n\n')] : []),
    ...(model.usesJointSafe ? ['', jointSafeHelper(model.ctx)] : []),
  ].join('\n');
  const geometry = [
    `package ${geometryPackage};`,
    '',
    importLines(importsFor(geometryMembers, settings)),
    '',
    '/**',
    ` * Generated by ValleyVis from "${project.name}".`,
    ' * Poses and paths are written in the blue frame; pass field() to get the right alliance.',
    ' */',
    `public final class ${geometryName} {`,
    geometryMembers,
    '}',
    '',
  ].join('\n');

  const routineMembers = [
    '    @Override',
    '    public Pose startingPose() {',
    `        return ${geometryName}.startingPose(${settings.code.poseFactory});`,
    '    }',
    '',
    '    @Override',
    '    protected Command routine() {',
    `        PoseFactory f = ${settings.code.poseFactory};`,
    `        return PedroAutoDsl.auto(${settings.code.drive}, b -> {`,
    ...model.builder.map((l) => padLines(renderPathRefs(l, (name) => `${geometryName}.${name}(f)`), B_PAD)),
    '        });',
    '    }',
    ...(model.usesMarkers ? ['', reachedHelper(model.ctx)] : []),
  ].join('\n');
  const routineImports = importsFor(routineMembers, settings, {
    [geometryName]: geometryPackage === settings.code.routinePackage ? null : `${geometryPackage}.${geometryName}`,
  });
  const routine = [
    `package ${settings.code.routinePackage};`,
    '',
    importLines([...new Set([...routineImports, settings.code.baseImport])].sort()),
    '',
    '/**',
    ` * Generated by ValleyVis from "${project.name}". Paths live in ${geometryName}.`,
    ' */',
    `public abstract class ${className} extends ${settings.code.baseClass} {`,
    routineMembers,
    '}',
    '',
  ].join('\n');
  return { geometryName, geometry, routine };
}

function importLines(imports) {
  return imports.map((i) => `import ${i};`).join('\n');
}

export function generateJava(project, settings, resolvedBlue) {
  const body = generateBody(project, settings, resolvedBlue);
  const className = javaClassName(project.className || `${project.name} Routine`);
  const members = [body.startingPose, body.routine, body.helper].filter(Boolean).join('\n\n');
  const methods = [
    `// ----- ValleyVis: ${project.name} -----`,
    `// Paste inside a class that extends ${settings.code.baseClass}. Imports it needs:`,
    ...body.imports.map((i) => `// import ${i};`),
    '',
    members,
  ].join('\n');

  const classImports = [...new Set([...body.imports, settings.code.baseImport])].sort();
  const routineClass = [
    `package ${settings.code.routinePackage};`,
    '',
    importLines(classImports),
    '',
    '/**',
    ` * Generated by ValleyVis from "${project.name}".`,
    ' * Poses are written in the blue frame; field() mirrors them for red.',
    ' */',
    `public abstract class ${className} extends ${settings.code.baseClass} {`,
    members,
    '}',
    '',
  ].join('\n');

  const opMode = (alliance) => {
    const blue = alliance === 'blue';
    const pkg = blue ? settings.code.bluePackage : settings.code.redPackage;
    const prefix = blue ? 'Blue' : 'Red';
    const opName = `${project.opModeName || project.name} ${prefix}`;
    const cls = `${prefix}${javaClassName(project.opModeName || project.name, 'Auto')}`;
    const target = blue ? project.blueTarget || 'Constants.BACK_SIDE' : project.redTarget || 'Constants.AUDIENCE_SIDE';
    return [
      `package ${pkg};`,
      '',
      importLines(['com.qualcomm.robotcore.eventloop.opmode.Autonomous', `${settings.code.routinePackage}.${className}`, settings.code.constantsImport].sort()),
      '',
      `@Autonomous(name = "${opName.replace(/"/g, "'")}", group = "${prefix}")`,
      `public class ${cls} extends ${className} {`,
      '    @Override',
      '    public int alliance() {',
      `        return ${blue ? settings.code.blueAlliance : settings.code.redAlliance};`,
      '    }',
      '',
      '    @Override',
      '    public int target() {',
      `        return ${target};`,
      '    }',
      '}',
      '',
    ].join('\n');
  };

  const team = generateTeamLayout(project, settings, body, className);
  return {
    className,
    methods,
    routineClass,
    geometryName: team.geometryName,
    geometryClass: team.geometry,
    teamRoutineClass: team.routine,
    blueOpMode: opMode('blue'),
    redOpMode: opMode('red'),
    imports: body.imports,
    warnings: body.warnings,
  };
}
