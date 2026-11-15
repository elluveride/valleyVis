// Tiny arithmetic expression language for coordinate fields.
// Lets a field hold "144 - L/2" so the sim uses the robot constants and the
// Java export emits "144.0 - Constants.ROBOT_LENGTH / 2.0" instead of a number.
// Grammar: expr := term (('+'|'-') term)* ; term := unary (('*'|'/') unary)*
//          unary := ('-'|'+') unary | primary ; primary := number | ident | '(' expr ')'

const cache = new Map();

function tokenize(src) {
  const tokens = [];
  const re = /\s*(?:(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(\S))/y;
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < src.length && (m = re.exec(src))) {
    if (m[1] !== undefined) tokens.push({ t: 'num', v: parseFloat(m[1]) });
    else if (m[2] !== undefined) tokens.push({ t: 'id', v: m[2] });
    else if (m[3] !== undefined) tokens.push({ t: 'op', v: m[3] });
  }
  return tokens;
}

function parseTokens(tokens) {
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;

  function primary() {
    const tok = tokens[i++];
    if (!tok) throw new Error('unexpected end of expression');
    if (tok.t === 'num') return { t: 'num', v: tok.v };
    if (tok.t === 'id') return { t: 'id', name: tok.v };
    if (tok.t === 'op' && tok.v === '(') {
      const e = expr();
      if (!isOp(')')) throw new Error('missing )');
      i++;
      return { t: 'paren', a: e };
    }
    throw new Error(`unexpected "${tok.v}"`);
  }
  function unary() {
    if (isOp('-')) { i++; return { t: 'neg', a: unary() }; }
    if (isOp('+')) { i++; return unary(); }
    return primary();
  }
  function term() {
    let a = unary();
    while (isOp('*') || isOp('/')) {
      const op = tokens[i++].v;
      a = { t: 'bin', op, a, b: unary() };
    }
    return a;
  }
  function expr() {
    let a = term();
    while (isOp('+') || isOp('-')) {
      const op = tokens[i++].v;
      a = { t: 'bin', op, a, b: term() };
    }
    return a;
  }
  const ast = expr();
  if (i < tokens.length) throw new Error(`unexpected "${tokens[i].v}"`);
  return ast;
}

export function parseExpr(src) {
  const key = String(src);
  if (cache.has(key)) return cache.get(key);
  const ast = parseTokens(tokenize(key));
  cache.set(key, ast);
  return ast;
}

export function evalAst(ast, scope) {
  switch (ast.t) {
    case 'num': return ast.v;
    case 'paren': return evalAst(ast.a, scope);
    case 'neg': return -evalAst(ast.a, scope);
    case 'id': {
      if (!(ast.name in scope)) throw new Error(`unknown name "${ast.name}"`);
      return scope[ast.name];
    }
    case 'bin': {
      const a = evalAst(ast.a, scope);
      const b = evalAst(ast.b, scope);
      if (ast.op === '+') return a + b;
      if (ast.op === '-') return a - b;
      if (ast.op === '*') return a * b;
      return a / b;
    }
    default: throw new Error('bad expression');
  }
}

/** Number or expression string -> number. Throws on bad input. */
export function evalValue(v, scope = {}) {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined || String(v).trim() === '') throw new Error('empty value');
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const out = evalAst(parseExpr(v), scope);
  if (!Number.isFinite(out)) throw new Error('not a finite number');
  return out;
}

export function isExpression(v) {
  return typeof v === 'string' && v.trim() !== '' && !Number.isFinite(Number(v));
}

/** Java double literal: 96 -> "96.0", 79.93751 -> "79.9375". */
export function fmtNum(n, digits = 4) {
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  const v = Object.is(r, -0) ? 0 : r;
  const s = String(v);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

function astToJava(ast, javaNames) {
  switch (ast.t) {
    case 'num': return fmtNum(ast.v, 6);
    case 'paren': return `(${astToJava(ast.a, javaNames)})`;
    case 'neg': return `-${astToJava(ast.a, javaNames)}`;
    case 'id': return javaNames[ast.name] ?? ast.name;
    case 'bin': return `${astToJava(ast.a, javaNames)} ${ast.op} ${astToJava(ast.b, javaNames)}`;
    default: return '0.0';
  }
}

/** Number or expression -> Java source. javaNames maps L -> "Constants.ROBOT_LENGTH". */
export function javaValue(v, javaNames = {}) {
  if (typeof v === 'number') return fmtNum(v);
  const n = Number(v);
  if (Number.isFinite(n)) return fmtNum(n);
  return astToJava(parseExpr(v), javaNames);
}

/** Replace {name} placeholders in a template. */
export function fillTemplate(tpl, values) {
  return String(tpl).replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
}
