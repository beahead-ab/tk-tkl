import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Onboarding } from '../src/onboarding.mjs';
import { Storage } from '../src/storage.mjs';
const storage = () => new Storage(fs.mkdtempSync(path.join(os.tmpdir(), 'cda-onboarding-')));
const ctx = ({ owner = false, mode = 'local', ai = false, tested = false, connected = false, tm = 'unconfigured' } = {}) => ({ auth: { mode, users: { hasOwner: () => owner } }, ai: { configured: ai, lastTest: tested ? { ok: true } : null, model: 'claude-opus-5-5' }, connection: { mode: 'simulator', state: connected ? 'connected' : 'disconnected' }, trainMeet: { status: tm, paired: tm === 'connected' || tm === 'disconnected', origin: tm === 'unconfigured' ? '' : 'https://server.trainmeet.app' } });

test('Kom igång räknar stegen ur det som finns och kräver ägare och kontakt med banan', () => {
  const o = new Onboarding({ storage: storage() });
  let v = o.view(ctx());
  assert.deepEqual(v.steps.map(s => [s.id, s.required, s.done, s.skipped]), [['owner', true, false, false], ['ai', false, false, false], ['connection', true, false, false], ['trainmeet', false, false, false]]);
  assert.deepEqual([v.done, v.remaining, v.canFinish, v.steps[0].how], [false, 4, false, 'page']);
  assert.equal(o.view(ctx({ mode: 'external' })).steps[0].how, 'script'); assert.equal(o.view(ctx({ mode: 'cloudflare' })).steps[0].done, true);
  assert.throws(() => o.finish({}, { context: ctx() }), /inte klar: Ägare, AI-tjänst, Banan \(LocoNet\), TrainMeet\. Hoppa över/);
  assert.throws(() => o.finish({ skipped: ['ai', 'trainmeet'] }, { context: ctx({ owner: true }) }), /inte klar: Banan \(LocoNet\)\.$/);
  assert.throws(() => o.finish({ skipped: ['connection'] }, { context: ctx({ owner: true, ai: true, tm: 'connected' }) }), /Banan/, 'det krävda går inte att hoppa över');
  assert.throws(() => o.finish({ skipped: ['x'] }, { context: ctx() }), /Okänt steg/);
  v = o.view(ctx({ owner: true, ai: true, connected: true })); assert.deepEqual([v.remaining, v.canFinish], [1, false]);
  v = o.finish({ skipped: ['trainmeet', 'ai'] }, { by: 'casper', now: 123, context: ctx({ owner: true, ai: true, connected: true }) });
  assert.deepEqual([v.done, v.finishedAt, v.finishedBy, v.skipped, v.remaining], [true, 123, 'casper', ['trainmeet'], 0], 'bara det som verkligen hoppades över sparas');
  const again = new Onboarding({ storage: new Storage(o.storage.directory) }); assert.equal(again.view(ctx({ owner: true, ai: true, connected: true })).done, true);
  v = again.view(ctx({ owner: true, ai: true, connected: true, tm: 'unpaired' })); assert.equal(v.steps[3].skipped, true); assert.equal(v.remaining, 0);
  v = again.reopen(ctx({ owner: true, ai: true, connected: true, tm: 'connected' })); assert.deepEqual([v.done, v.remaining, v.canFinish], [false, 0, true]);
  assert.equal(again.view(ctx({ owner: true, ai: true, tested: true, connected: true })).steps[1].tested, true);
});
