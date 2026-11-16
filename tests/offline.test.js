// The service worker's offline list must name every file the app loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
}

test('sw.js lists every app file for offline use', () => {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const listed = JSON.parse(sw.match(/const SHELL = (\[[\s\S]*?\]);/)[1]);
  const expected = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', ...walk('src').filter((f) => f.endsWith('.js')), ...walk('assets')];
  assert.deepEqual([...listed].sort(), [...expected].sort(), 'update the SHELL list in sw.js when files are added or removed');
  for (const f of listed) if (f !== './') assert.ok(fs.existsSync(path.join(root, f)), `${f} is listed but missing`);
});

test('every module import points at a file that exists', () => {
  for (const file of walk('src').filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    for (const m of src.matchAll(/from '(\.[^']+)'/g)) {
      const target = path.join(root, path.dirname(file), m[1]);
      assert.ok(fs.existsSync(target), `${file} imports ${m[1]}, which does not exist`);
    }
  }
});

test('the web manifest icons exist', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(root, icon.src)), icon.src);
});
