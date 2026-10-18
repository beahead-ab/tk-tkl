// Gemensamma läsvägar utan filflytt. Proven går också i ett stationspaket utan Charlottendals källor.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { currentStation, stateDirectory, stationIds } from '../src/station.mjs';
import { loadProfile } from '../src/profile.mjs';
import { loadSources } from '../src/studio/sources.mjs';
import { studioData } from '../src/studio/index.mjs';
const ids = stationIds();
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function withEnv(values, fn) {
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { return fn(); }
  finally { for (const [key, value] of Object.entries(before)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}

for (const id of ids) {
  const station = currentStation({ CHARLOTTENDAL_STATION: id });
  test(`${station.title}: läsvägen bevarar hela profilerna, identiteten och driftkatalogen`, () => {
    assert.match(stateDirectory({}, station), id === 'charlottendal' ? /\/var$/ : new RegExp('/var/' + id + '$'));
    assert.equal(stateDirectory({ CHARLOTTENDAL_STATE_DIR: '/tmp/eget-tkl-tillstand' }, station), '/tmp/eget-tkl-tillstand');
    if (id === 'charlottendal') assert.equal(station.tklId, 'cda-tkl');
    if (id === 'trakvista') assert.equal(station.tklId, 'tk-tkl');
    withEnv({ CHARLOTTENDAL_STATION: id, CHARLOTTENDAL_PROFILE: 'network' }, () => {
      // Även egenskapernas ordning bevaras: sparade driftbindningar använder hash av JSON.stringify(profilen).
      assert.equal(JSON.stringify(loadProfile()), JSON.stringify(read(station.profile)));
      assert.equal(JSON.stringify(loadProfile('field', { activated: false })), JSON.stringify(read(station.field)));
    });
    withEnv({ CHARLOTTENDAL_STATION: id, CHARLOTTENDAL_PROFILE: 'legacy' }, () => {
      if (station.legacyProfile) {
        assert.equal(JSON.stringify(loadProfile()), JSON.stringify(read(station.legacyProfile)));
        assert.equal(JSON.stringify(loadProfile('field', { activated: false })), JSON.stringify(read(station.legacyField)));
      } else assert.throws(() => loadProfile(), /Provprofilen finns bara för Charlottendal/);
    });
    const sources = loadSources(undefined, station), data = studioData(sources);
    assert.equal(JSON.stringify(sources.profile), JSON.stringify(read(station.profile)));
    assert.deepEqual(sources.migration, station.migration ? read(station.migration) : null);
    assert.deepEqual(sources.rules, station.rules ? read(station.rules) : null);
    assert.equal(data.rules.compiledIdentical, true);
    if (id === 'charlottendal') assert.deepEqual([data.counts.routes, data.counts.turnouts, data.counts.signals], [340, 49, 66]);
  });
}

// Små isolerade källor visar att root fortfarande gäller, och att ofullständiga eller felaktiga underlag inte
// godtas som tomma dokument när Studio läser Charlottendal. Ingenting skrivs i installationens filer.
function sourceFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tkl-studio-source-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const docs = {
    'profiles/charlottendal-network.json': { id: 'provprofil', sourceHash: 'provhash' },
    'profiles/charlottendal-rules.json': { sourceHash: 'provhash', rules: [] },
    'public/data/panel.json': { panels: [] },
    'public/data/route-coverage.json': { sourceHash: 'provhash', nx: [], excluded: [] },
    'public/data/indications.json': { sourceHash: 'provhash', indicators: [] },
    'public/data/migration.json': { sourceHash: 'provhash', rules: [] }
  };
  for (const [file, value] of Object.entries(docs)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), JSON.stringify(value));
  }
  fs.mkdirSync(path.join(dir, 'public/data/source'));
  fs.writeFileSync(path.join(dir, 'public/data/source/Cda60.xml'), '<layout/>');
  return { dir, root: pathToFileURL(dir + path.sep) };
}

test('Studio läser samtliga källor från angiven rot, med granskade regler och migrering', t => {
  const { root } = sourceFixture(t), sources = loadSources(root);
  assert.equal(sources.profile.id, 'provprofil');
  assert.deepEqual(loadSources(root.href), sources);
  assert.deepEqual(loadSources(root.pathname), sources);
  assert.deepEqual(sources.rules, { sourceHash: 'provhash', rules: [] });
  assert.deepEqual(sources.migration, { sourceHash: 'provhash', rules: [] });
});
for (const file of ['route-coverage', 'indications', 'migration']) {
  test(`Studio stoppar när Charlottendals obligatoriska ${file}.json saknas`, t => {
    const { dir, root } = sourceFixture(t);
    fs.unlinkSync(path.join(dir, 'public/data/' + file + '.json'));
    assert.throws(() => loadSources(root), { code: 'ENOENT' });
  });
  test(`Studio stoppar när ${file}.json hör till en annan profil`, t => {
    const { dir, root } = sourceFixture(t);
    fs.writeFileSync(path.join(dir, 'public/data/' + file + '.json'), JSON.stringify({ sourceHash: 'annan-hash' }));
    assert.throws(() => loadSources(root), /hör till en annan källversion/);
  });
}
test('Studio tillåter saknad granskad regelfil men avvisar felaktig fil och annan källversion', t => {
  for (const content of [null, '{fel json', JSON.stringify({ sourceHash: 'annan-hash' })]) {
    const { dir, root } = sourceFixture(t), file = path.join(dir, 'profiles/charlottendal-rules.json');
    if (content === null) { fs.unlinkSync(file); assert.equal(loadSources(root).rules, null); }
    else {
      fs.writeFileSync(file, content);
      assert.throws(() => loadSources(root), content.startsWith('{fel') ? SyntaxError : /hör till en annan källversion/);
    }
  }
});

for (const file of ['profiles/charlottendal-network.json', 'profiles/charlottendal-rules.json', 'public/data/panel.json',
  'public/data/route-coverage.json', 'public/data/indications.json', 'public/data/migration.json']) {
  test(`Studio avvisar befintlig ${path.basename(file)} som saknar ett JSON-objekt`, t => {
    for (const value of [null, false, 0, '', [], true]) {
      const { dir, root } = sourceFixture(t);
      fs.writeFileSync(path.join(dir, file), JSON.stringify(value));
      assert.throws(() => loadSources(root), { message: `${path.basename(file)} måste innehålla ett JSON-objekt.` });
    }
  });
}
test('Studio ersätter en annan stations valfria data endast när filerna saknas', t => {
  for (const value of [undefined, null, false, 0, '', []]) {
    const { dir, root } = sourceFixture(t);
    const station = { ...currentStation({ CHARLOTTENDAL_STATION: 'charlottendal' }, root),
      id: 'provstation', optionalStudioData: true, migration: null, rules: null };
    for (const file of ['route-coverage.json', 'indications.json']) {
      const target = path.join(dir, 'public/data', file);
      if (value === undefined) fs.unlinkSync(target);
      else fs.writeFileSync(target, JSON.stringify(value));
    }
    if (value === undefined) {
      const sources = loadSources(root, station);
      assert.deepEqual(sources.coverage, { sourceHash: 'provhash', nx: [], excluded: [] });
      assert.deepEqual(sources.indications, { sourceHash: 'provhash', indicators: [] });
      assert.equal(sources.migration, null);
      assert.equal(sources.rules, null);
    } else assert.throws(() => loadSources(root, station), /måste innehålla ett JSON-objekt/);
  }
});

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
for (const id of ids) test(`${id}: HTTP lämnar ut exakt stationens data och ingen annan stations källa`, { timeout: 30000 }, async () => {
  const station = currentStation({ CHARLOTTENDAL_STATION: id });
  const [port, wire] = await Promise.all([freePort(), freePort()]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tkl-station-http-'));
  const env = { ...process.env, CHARLOTTENDAL_STATION: id, CHARLOTTENDAL_PROFILE: 'network',
    CHARLOTTENDAL_STATE_DIR: dir, CHARLOTTENDAL_USERS_FILE: path.join(dir, 'users.json'), CHARLOTTENDAL_AUTH_MODE: '', CHARLOTTENDAL_PUBLIC_ORIGIN: '',
    CHARLOTTENDAL_PORT: String(port), CHARLOTTENDAL_WIRE_PORT: String(wire), CHARLOTTENDAL_WIRE_HOST: '127.0.0.1', CHARLOTTENDAL_CONNECTION_MODE: 'simulator' };
  let output = '';
  const child = spawn(process.execPath, ['src/server.mjs'], { cwd: new URL('..', import.meta.url), env });
  child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
  const get = pathname => fetch(`http://127.0.0.1:${port}${pathname}`, { headers: { Connection: 'close' } });
  try {
    let ready = false;
    for (const end = Date.now() + 15000; Date.now() < end;) {
      try { ready = (await get('/api/config')).status === 200; } catch {}
      if (ready || child.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, output);
    for (const file of ['panel.json', 'train-fields.json', 'indications.json', 'source/index.json']) {
      const response = await get('/data/' + file);
      assert.equal(response.status, 200, file);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(station.dataDir + '/' + file), file);
    }
    const source = await get('/data/source/' + station.sourceName);
    assert.equal(source.status, 200);
    assert.deepEqual(Buffer.from(await source.arrayBuffer()), fs.readFileSync(station.source));
    for (const file of ['station.json', 'Cda60.xml', 'Trakvista.xml'].filter(file => file !== station.sourceName))
      assert.equal((await get('/data/source/' + file)).status, 404, file);
  } finally {
    if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
