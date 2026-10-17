import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AiSettings, AI_MODELS, DEFAULT_MODEL } from '../src/ai-settings.mjs';
import { StudioAssistant } from '../src/studio/assistant.mjs';
import { Storage } from '../src/storage.mjs';
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ai-settings-'));
const message = (obj, extra = {}) => ({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify(obj) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 }, ...extra });
const fakeFetch = (answer, calls = [], status = 200) => async (url, init) => { const body = JSON.parse(init.body); calls.push({ url: String(url), headers: new Headers(init.headers), body }); return new Response(JSON.stringify(typeof answer === 'function' ? answer(body) : answer), { status, headers: { 'content-type': 'application/json' } }); };

test('AI-tjänsten utan inställning: inte ansluten, standardmodell, miljön som reservvärde', () => {
  const off = new AiSettings({ storage: new Storage(tempDir()), env: {} });
  assert.deepEqual([off.view().configured, off.view().model, off.view().source, off.view().keyHint], [false, DEFAULT_MODEL, 'none', null]);
  assert.equal(off.view().models.length, 3); assert.ok(AI_MODELS.every(m => m.id.startsWith('claude-') && !m.id.includes('haiku')), 'bara modeller som fungerar med lösningen');
  const env = new AiSettings({ storage: new Storage(tempDir()), env: { ANTHROPIC_API_KEY: 'sk-ant-env-key-0000000000001234', CHARLOTTENDAL_STUDIO_MODEL: 'claude-sonnet-5-5' } });
  assert.deepEqual([env.view().configured, env.view().model, env.view().source, env.view().keyHint], [true, 'claude-sonnet-5-5', 'env', '…1234']);
  const odd = new AiSettings({ storage: new Storage(tempDir()), env: { CHARLOTTENDAL_STUDIO_MODEL: 'claude-haiku-4-5' } });
  assert.equal(odd.view().model, DEFAULT_MODEL, 'en modell utanför listan i miljön räknas inte');
});

test('spara, byta modell, prova och ta bort: nyckeln ligger i ai.json med läsrätt bara för servern och visas som fyra tecken', () => {
  const dir = tempDir(), storage = new Storage(dir), ai = new AiSettings({ storage, env: {} });
  assert.throws(() => ai.save({ model: 'gpt-5' }), /modellerna i listan/);
  assert.throws(() => ai.save({ model: 'claude-opus-5-5', key: 'kort' }), /API-nyckel/);
  assert.throws(() => ai.save({ model: 'claude-opus-5-5' }), /Ange en nyckel/);
  const saved = ai.save({ model: 'claude-fable-5-1', key: ' sk-ant-api03-abcdefghijklmnopqrstuvwxyz-9876 ' }, 1000);
  assert.deepEqual([saved.configured, saved.model, saved.source, saved.keyHint, saved.updatedAt], [true, 'claude-fable-5-1', 'app', '…9876', 1000]);
  const file = path.join(dir, 'ai.json'); assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).key, 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz-9876');
  assert.ok(!JSON.stringify(saved).includes('abcdefghijklmnop'), 'vyn bär aldrig hela nyckeln');
  // Modellbyte utan ny nyckel behåller nyckeln; en tom nyckel i formuläret betyder "behåll".
  assert.equal(ai.save({ model: 'claude-sonnet-5-5', key: '' }).keyHint, '…9876'); assert.equal(ai.model, 'claude-sonnet-5-5');
  ai.recordTest({ ok: false, error: 'fel 401' }, 2000); assert.deepEqual(ai.view().lastTest, { at: 2000, ok: false, error: 'fel 401' });
  const again = new AiSettings({ storage: new Storage(dir), env: {} });
  assert.deepEqual([again.key, again.model, again.view().lastTest.ok], ['sk-ant-api03-abcdefghijklmnopqrstuvwxyz-9876', 'claude-sonnet-5-5', false], 'inställningen överlever omstart');
  const cleared = again.clear(); assert.deepEqual([cleared.configured, cleared.source, cleared.keyHint], [false, 'none', null]);
  // Med nyckel i miljön går appens nyckel före, och borttagning faller tillbaka på miljön.
  const both = new AiSettings({ storage: new Storage(tempDir()), env: { ANTHROPIC_API_KEY: 'sk-ant-env-key-0000000000001234' } });
  both.save({ model: 'claude-opus-5-5', key: 'sk-ant-app-key-0000000000005678' }); assert.deepEqual([both.source, both.key.slice(-4)], ['app', '5678']);
  both.clear(); assert.deepEqual([both.source, both.key.slice(-4), both.view().configured], ['env', '1234', true]);
});

test('Studio-assistenten följer inställningen utan omstart: nyckel, modell och klient byts när admin sparar', async () => {
  const settings = new AiSettings({ storage: new Storage(tempDir()), env: {} }), calls = [];
  const ai = new StudioAssistant({ settings, fetcher: fakeFetch(body => message({ ok: true, greeting: 'Hej från ' + body.model }, { model: body.model }), calls) });
  assert.equal(ai.configured, false); assert.deepEqual(ai.view(), { configured: false, provider: 'Anthropic', model: DEFAULT_MODEL });
  await assert.rejects(ai.probe(), e => e.status === 503 && /inte ansluten/.test(e.message));
  settings.save({ model: 'claude-sonnet-5-5', key: 'sk-ant-first-key-00000000000000001' });
  assert.equal(ai.configured, true); assert.equal(ai.model, 'claude-sonnet-5-5');
  const first = await ai.probe();
  assert.deepEqual([first.ok, first.model, first.greeting], [true, 'claude-sonnet-5-5', 'Hej från claude-sonnet-5-5']);
  assert.equal(calls[0].headers.get('x-api-key'), 'sk-ant-first-key-00000000000000001'); assert.equal(calls[0].body.model, 'claude-sonnet-5-5');
  assert.equal(calls[0].body.output_config.effort, 'low', 'provet är litet'); assert.equal(calls[0].body.output_config.format.type, 'json_schema');
  settings.save({ model: 'claude-opus-5-5', key: 'sk-ant-second-key-0000000000000002' });
  await ai.probe(); assert.equal(calls[1].headers.get('x-api-key'), 'sk-ant-second-key-0000000000000002', 'ny nyckel ger ny klient'); assert.equal(calls[1].body.model, 'claude-opus-5-5');
  const wrong = new StudioAssistant({ settings, fetcher: fakeFetch(message({ ok: false, greeting: '' })) });
  await assert.rejects(wrong.probe(), /inte enligt schemat/);
  // Utan inställningsobjekt fungerar nyckel och modell som förut (tester och skript).
  const plain = new StudioAssistant({ key: 'k', model: 'claude-fable-5-1' }); assert.deepEqual([plain.configured, plain.model], [true, 'claude-fable-5-1']);
  assert.equal(new StudioAssistant({ key: '' }).configured, false);
});
