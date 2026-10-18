import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InstallationStation, installationConfigFile, installationLockReason, readInstallationSelection, resolveInstallationStart, stationChangeReason } from '../src/installation-station.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tkl-stationsval-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, data) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, typeof data === 'string' ? data : JSON.stringify(data)); };
  write('profiles/charlottendal-network.json', {}); write('packaging/identity.env', 'TKL_STATION=charlottendal\n');
  write('stations/trakvista/station.json', { title: 'Träkvista', signature: 'Tk' }); write('stations/trakvista/profiles/network.json', {});
  return { root, write, config: data => write('.tkl-installation/station.json', data) };
}
const safe = () => ({ engine: { routes: [], controls: { programming: { reserved: false } }, yard: { requests: [] } }, connection: { mode: 'offline', locked: false }, recorder: {}, automation: {}, trainMeet: {} });
const managed = root => resolveInstallationStart({ root, env: {} }).env;

test('stationsvalet gäller installerade paket och lämnar stationernas driftfiler orörda', t => {
  const { root, write } = fixture(t);
  write('var/users.json', { station: 'Cda', hemlighet: 'Cda' }); write('var/trakvista/users.json', { station: 'Tk', hemlighet: 'Tk' });
  const cdaBefore = fs.readFileSync(path.join(root, 'var/users.json')), tkBefore = fs.readFileSync(path.join(root, 'var/trakvista/users.json'));
  const messages = [], selection = new InstallationStation({ root, env: managed(root), send: message => messages.push(message) });
  assert.deepEqual(selection.view(safe()).stations.map(s => s.id), ['charlottendal', 'trakvista']);
  assert.equal(selection.view(safe()).locked, false);
  assert.throws(() => selection.prepare('../annan', safe()), /inte installerad/);
  assert.throws(() => selection.prepare('charlottendal', safe()), /körs redan/);
  assert.deepEqual(selection.prepare('trakvista', safe()), { restarting: true, stationId: 'trakvista', title: 'Träkvista' });
  assert.equal(messages.length, 0, 'HTTP-svaret får avslutas före omstarten');
  selection.restart(); assert.deepEqual(messages, [{ type: 'tkl-station-change', stationId: 'trakvista' }]);
  assert.equal(selection.view(safe()).restarting, true);
  assert.throws(() => selection.prepare('trakvista', safe()), /Vänta/);
  assert.deepEqual(fs.readFileSync(path.join(root, 'var/users.json')), cdaBefore);
  assert.deepEqual(fs.readFileSync(path.join(root, 'var/trakvista/users.json')), tkBefore);
  const restarted = resolveInstallationStart({ root, env: {} }); assert.equal(restarted.stationId, 'trakvista');
  const next = new InstallationStation({ root, env: restarted.env, send: () => {} }); assert.equal(next.requireTrainMeetConnect, true);
  next.resumeTrainMeet(); assert.equal(next.requireTrainMeetConnect, false);
  assert.equal(readInstallationSelection(installationConfigFile(root, {})).requireTrainMeetConnect, false);
});

test('fasta miljöval och Render visar listan med en tydlig spärr', t => {
  const { root, config } = fixture(t);
  config({ version: 1, stationId: 'trakvista', requireTrainMeetConnect: true });
  const fixed = resolveInstallationStart({ root, env: { CHARLOTTENDAL_STATION: 'charlottendal' } });
  assert.equal(fixed.stationId, 'charlottendal'); assert.equal(fixed.env.TKL_STATION_SELECTION, 'locked');
  const selection = new InstallationStation({ root, env: fixed.env, send: () => {} });
  assert.equal(selection.view(safe()).stations.length, 2); assert.equal(selection.view(safe()).locked, true);
  assert.match(selection.view(safe()).reason, /startkommandot/);
  assert.throws(() => selection.prepare('trakvista', safe()), /startkommandot/);
  for (const key of ['CHARLOTTENDAL_STATE_DIR', 'CHARLOTTENDAL_USERS_FILE', 'CHARLOTTENDAL_AUTH_FILE', 'CHARLOTTENDAL_PROFILE', 'CHARLOTTENDAL_TRAINMEET_ORIGIN']) assert.match(installationLockReason({ [key]: '/fast' }, true), new RegExp(key));
  assert.match(installationLockReason({ CHARLOTTENDAL_INSTALL_KIND: 'render' }, true), /Render/);
  assert.match(installationLockReason({}, false), /npm start/);
  assert.throws(() => resolveInstallationStart({ root, env: { CHARLOTTENDAL_STATION: 'charlottendal' }, args: ['trakvista'] }), /skiljer sig/);
});

test('varje driftvillkor nekar byte innan startupfilen skrivs', t => {
  const { root } = fixture(t), selection = new InstallationStation({ root, env: managed(root), send: () => {} });
  const cases = [
    [s => { s.engine.storageFault = 'full disk'; }, /lagring/],
    [s => { s.engine.routes.push({ state: 'held' }); }, /kvarhållna/],
    [s => { s.engine.controls.programming.reserved = true; }, /programmeringsspåret/],
    [s => { s.engine.yard.requests.push({}); }, /Rangerarens/],
    [s => { s.engine.controls.emergency = { completedAt: null }; }, /nödåtertagningen/],
    [s => { s.engine.controls.panelReset = { completedAt: null }; }, /panelåterställningen/],
    [s => { s.recorder.pending = {}; }, /telegraminspelningen/],
    [s => { s.automation.enabled = true; }, /automaten/],
    [s => { s.connection.mode = 'live'; }, /LocoNet/],
    [s => { s.connection.data = { mode: 'live' }; }, /LocoNet/],
    [s => { s.trainMeet.busy = true; }, /TrainMeet/],
    [s => { s.activeCommands = 1; }, /pågående manöver/],
    [s => { s.automating = true; }, /trafikåtgärd/],
    [s => { s.trafficBusy = true; }, /trafikåtgärd/]
  ];
  for (const [change, reason] of cases) { const state = safe(); change(state); assert.match(stationChangeReason(state), reason); assert.throws(() => selection.prepare('trakvista', state), reason); }
  assert.equal(fs.existsSync(installationConfigFile(root, {})), false);
});

test('målstationens sparade LocoNet-läge läses utan att ändras', t => {
  const { root, write } = fixture(t), selection = new InstallationStation({ root, env: managed(root), send: () => {} });
  write('var/trakvista/connection.json', { schema: 1, mode: 'live' });
  assert.throws(() => selection.prepare('trakvista', safe()), /sparade läge/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'var/trakvista/connection.json'))).mode, 'live');
  write('var/trakvista/connection.json', 'felaktig fil'); assert.match(selection.targetReason('trakvista'), /kunde inte läsas/);
  write('var/trakvista/connection.json', { schema: 1, mode: 'offline' }); assert.equal(selection.targetReason('trakvista'), '');
});

test('explicit driftkarta bevarar den gamla katalogen exakt och binder den andra stationen separat', t => {
  const { root, config, write } = fixture(t), original = path.join(root, 'befintlig-cda'), other = path.join(root, 'andra-stationer/trakvista');
  const directories = { charlottendal: original, trakvista: other };
  write('befintlig-cda/users.json', { bevarad: true }); write('befintlig-cda/routes.json', { bevarad: true });
  const before = fs.readFileSync(path.join(original, 'users.json'));
  config({ version: 1, stationId: 'charlottendal', requireTrainMeetConnect: false, stationStateDirectories: directories });
  const env = { CHARLOTTENDAL_STATE_DIR: original };
  const first = resolveInstallationStart({ root, env }); assert.equal(first.env.CHARLOTTENDAL_STATE_DIR, original); assert.equal(first.env.TKL_STATION_SELECTION, 'managed');
  const selection = new InstallationStation({ root, env: first.env, send: () => {} }); assert.equal(selection.view(safe()).locked, false);
  selection.prepare('trakvista', safe());
  assert.deepEqual(readInstallationSelection(installationConfigFile(root, env)).stationStateDirectories, directories);
  const second = resolveInstallationStart({ root, env }); assert.equal(second.env.CHARLOTTENDAL_STATE_DIR, other);
  assert.deepEqual(fs.readFileSync(path.join(original, 'users.json')), before);
  assert.equal(fs.existsSync(other), false, 'stationsvalet skriver inga nya driftfiler');
  assert.throws(() => resolveInstallationStart({ root, env: { CHARLOTTENDAL_STATE_DIR: original + '/' } }), /exakt samma/);
  config({ version: 1, stationId: 'trakvista', requireTrainMeetConnect: true, stationStateDirectories: { charlottendal: original, trakvista: original } });
  assert.throws(() => resolveInstallationStart({ root, env }), /olika driftkataloger/);
  config({ version: 1, stationId: 'trakvista', requireTrainMeetConnect: true, stationStateDirectories: { charlottendal: original } });
  assert.throws(() => resolveInstallationStart({ root, env }), /saknar en egen driftkatalog/);
});

test('ogiltig startupfil och en borttagen station stoppar starten', t => {
  const { root, config } = fixture(t);
  config({ version: 1, stationId: 'saknas', requireTrainMeetConnect: false }); assert.throws(() => resolveInstallationStart({ root, env: {} }), /inte installerad/);
  config({ version: 1, stationId: 'trakvista', requireTrainMeetConnect: false, stationStateDirectories: { trakvista: 'relativ' } }); assert.throws(() => resolveInstallationStart({ root, env: {} }), /driftkataloger/);
  config({ version: 7, stationId: 'trakvista' }); assert.throws(() => resolveInstallationStart({ root, env: {} }), /Ogiltigt stationsval/);
});
