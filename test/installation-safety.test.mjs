import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InstallationStation, physicalDirectory, readInstallationSelection, resolveInstallationStart } from '../src/installation-station.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tkl-fysisk-drift-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, data) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify(data)); };
  write('profiles/charlottendal-network.json', {}); write('stations/trakvista/station.json', { title: 'Träkvista' }); write('stations/trakvista/profiles/network.json', {});
  const file = path.join(root, '.tkl-installation/station.json');
  const config = map => write('.tkl-installation/station.json', { version: 1, stationId: 'charlottendal', requireTrainMeetConnect: false, stationStateDirectories: map });
  return { root, file, config };
}
const safe = () => ({ engine: { routes: [], controls: { programming: { reserved: false } }, yard: { requests: [] } }, connection: { mode: 'offline', locked: false }, recorder: {}, automation: {}, trainMeet: {} });

test('två olika sökvägar genom samma symboliska länk får inte dela users och routes', t => {
  const { root, file, config } = fixture(t), cda = path.join(root, 'cda'), alias = path.join(root, 'tk-lank');
  fs.mkdirSync(cda); fs.writeFileSync(path.join(cda, 'users.json'), '{"bevarad":true}'); fs.writeFileSync(path.join(cda, 'routes.json'), '{"las":"kvar"}');
  const users = fs.readFileSync(path.join(cda, 'users.json')), routes = fs.readFileSync(path.join(cda, 'routes.json'));
  fs.symlinkSync(cda, alias, 'dir'); config({ charlottendal: cda, trakvista: alias });
  assert.throws(() => readInstallationSelection(file), /olika driftkataloger/);
  assert.throws(() => resolveInstallationStart({ root, env: { CHARLOTTENDAL_STATE_DIR: cda } }), /olika driftkataloger/);
  assert.deepEqual(fs.readFileSync(path.join(cda, 'users.json')), users); assert.deepEqual(fs.readFileSync(path.join(cda, 'routes.json')), routes);
});

test('ännu inte skapade kataloger jämförs genom verklig befintlig förälder och även en hängande länk', t => {
  const { root, file, config } = fixture(t), parent = path.join(root, 'verklig'), alias = path.join(root, 'foralder-lank');
  fs.mkdirSync(parent); fs.symlinkSync(parent, alias, 'dir');
  const future = path.join(parent, 'framtida-station'), throughAlias = path.join(alias, 'framtida-station');
  assert.equal(fs.existsSync(future), false); assert.equal(physicalDirectory(future), physicalDirectory(throughAlias));
  config({ charlottendal: future, trakvista: throughAlias }); assert.throws(() => readInstallationSelection(file), /olika driftkataloger/);
  const dangling = path.join(root, 'hangande-lank'); fs.symlinkSync(future, dangling, 'dir');
  assert.equal(fs.existsSync(dangling), false); assert.equal(physicalDirectory(dangling), physicalDirectory(future));
  config({ charlottendal: future, trakvista: dangling }); assert.throws(() => readInstallationSelection(file), /olika driftkataloger/);
  assert.equal(fs.existsSync(future), false, 'valideringen skapar inga driftkataloger');
});

test('standardkatalogerna får inte peka på samma fysiska katalog', t => {
  const { root, file } = fixture(t), env = resolveInstallationStart({ root, env: {} }).env;
  const selection = new InstallationStation({ root, env, send: () => {} });
  const cda = path.join(root, 'var'); fs.mkdirSync(cda); fs.symlinkSync(cda, path.join(cda, 'trakvista'), 'dir');
  assert.match(selection.targetReason('trakvista'), /fysiska driftkataloger/);
  assert.throws(() => selection.prepare('trakvista', safe()), /fysiska driftkataloger/);
  assert.equal(fs.existsSync(file), false);
  assert.throws(() => resolveInstallationStart({ root, env: {} }), /fysiska driftkataloger/);
});

test('en länk som ändrats efter start kontrolleras igen vid stationsbyte', t => {
  const { root, file, config } = fixture(t), cda = path.join(root, 'cda'), tk = path.join(root, 'tk'), alias = path.join(root, 'tk-lank');
  fs.mkdirSync(cda); fs.mkdirSync(tk); fs.symlinkSync(tk, alias, 'dir'); config({ charlottendal: cda, trakvista: alias });
  const env = resolveInstallationStart({ root, env: { CHARLOTTENDAL_STATE_DIR: cda } }).env;
  const selection = new InstallationStation({ root, env, send: () => {} }); assert.equal(selection.targetReason('trakvista'), '');
  const before = fs.readFileSync(file); fs.unlinkSync(alias); fs.symlinkSync(cda, alias, 'dir');
  assert.throws(() => selection.prepare('trakvista', safe()), /fysiska driftkataloger/);
  assert.deepEqual(fs.readFileSync(file), before, 'nekad ändring lämnar startupvalet orört');
});
