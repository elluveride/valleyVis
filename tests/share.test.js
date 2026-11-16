import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS } from '../src/defaults.js';
import { PRESETS } from '../src/presets.js';
import { decodeShare, encodeShare } from '../src/share.js';

test('share links round-trip a routine, with and without settings', async () => {
  for (const preset of PRESETS) {
    const project = preset.make();
    const hash = await encodeShare({ project });
    assert.match(hash, /^r=[01][A-Za-z0-9_-]+$/);
    assert.ok(hash.length < 2500, `${preset.id}: ${hash.length} characters`);
    assert.deepEqual((await decodeShare(`#${hash}`)).project, project);
    assert.deepEqual((await decodeShare(hash)).project, project); // leading # is optional
  }
  const withSettings = await decodeShare(await encodeShare({ project: PRESETS[0].make(), settings: DEFAULT_SETTINGS }));
  assert.deepEqual(withSettings.settings, DEFAULT_SETTINGS);
});

test('share links survive non-ASCII names', async () => {
  const project = PRESETS[0].make();
  project.name = 'Über auto ✓ 自動';
  assert.equal((await decodeShare(await encodeShare({ project }))).project.name, project.name);
});

test('uncompressed links (older browsers) still decode', async () => {
  const project = PRESETS[1].make();
  const json = JSON.stringify({ v: 1, project });
  const b64 = Buffer.from(json, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.deepEqual((await decodeShare(`#r=0${b64}`)).project, project);
});

test('anything that is not a share link is ignored, damaged links throw', async () => {
  assert.equal(await decodeShare(''), null);
  assert.equal(await decodeShare('#settings'), null);
  assert.equal(await decodeShare(undefined), null);
  for (const bad of ['#r=1AAAA', '#r=0bm90IGpzb24', '#r=9zzz', '#r=', '#r=0e30', '#r=1!!!!']) {
    await assert.rejects(() => decodeShare(bad), `${bad} should be rejected`);
  }
});
