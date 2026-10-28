// Riktiga processer och HTTP: stationsbyte körs med samma startövervakare som npm start.
// Alla användare, inställningar och startupval ligger i tillfälliga kataloger; banan är den egna återrapporten.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { currentStation, stationIds, DEFAULT_STATION } from '../src/station.mjs';
import { UserStore } from '../src/users.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const ids = stationIds(), hasBoth = ids.includes('charlottendal') && ids.includes('trakvista');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve)); return port;
}
async function until(check, description, timeout = 25000) {
  const end = Date.now() + timeout; let error;
  while (Date.now() < end) { try { const value = await check(); if (value) return value; } catch (caught) { error = caught; } await pause(100); }
  throw Error(description + (error ? ': ' + error.message : ''));
}
function cleanEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CHARLOTTENDAL_') && !key.startsWith('TKL_') && key !== 'RENDER'));
}
function launch(env, installationRoot = root) {
  let output = ''; const child = spawn(process.execPath, ['scripts/start.mjs'], { cwd: installationRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
  return { child, output: () => output };
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  let timer;
  try { await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); timer = setTimeout(() => child.kill('SIGKILL'), 8000); }); }
  finally { clearTimeout(timer); }
}
function client(port) {
  return async (resource, { data, cookie, status = 200 } = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/${resource}`, { method: data === undefined ? 'GET' : 'POST',
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(5000) });
    const answer = await response.json(); assert.equal(response.status, status, resource + ': ' + JSON.stringify(answer));
    return { answer, response };
  };
}
async function owner(directory, username) {
  const store = new UserStore(path.join(directory, 'users.json'));
  await store.createOwner({ username, password: 'endast-stationsprovet' });
}
async function login(call, username) {
  const { response } = await call('auth/login', { data: { username, password: 'endast-stationsprovet' } });
  const cookie = response.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie, 'inloggningen ger en session'); return cookie;
}
function slowPost(port, cookie) {
  const payload = JSON.stringify({ key: 'langsam-begaran', note: 'En pågående HTTP-manöver ska hindra stationsbyte.' });
  let request;
  const response = new Promise((resolve, reject) => {
    request = http.request({ hostname: '127.0.0.1', port, path: '/api/note', method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, res => {
      let data = ''; res.on('data', chunk => data += chunk); res.on('end', () => resolve({ status: res.statusCode, answer: JSON.parse(data) }));
    });
    request.on('error', reject); request.write(payload.slice(0, 1));
  });
  return { async finish() { request.end(payload.slice(1)); return response; } };
}
const writeJSON = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n'); };
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function temporaryInstallation(directory) {
  const installationRoot = path.join(directory, 'program');
  fs.mkdirSync(installationRoot);
  // station.mjs måste finnas som riktig kopia: modulens egen ROOT ska peka här, så att standardsökvägen var/
  // och Träkvistas var/trakvista/ aldrig kan skriva i arbetsförrådet. De statiska källorna används bara för läsning.
  for (const folder of ['src', 'scripts']) fs.cpSync(path.join(root, folder), path.join(installationRoot, folder), { recursive: true });
  fs.copyFileSync(path.join(root, 'package.json'), path.join(installationRoot, 'package.json'));
  fs.mkdirSync(path.join(installationRoot, 'packaging'));
  fs.copyFileSync(path.join(root, 'packaging/identity.env'), path.join(installationRoot, 'packaging/identity.env'));
  for (const folder of ['public', 'profiles', 'stations', 'node_modules']) fs.symlinkSync(path.join(root, folder), path.join(installationRoot, folder), 'dir');
  return installationRoot;
}

test('en fast installation visar installerade stationer och nekar byte, också i stationens eget paket', { timeout: 45000 }, async () => {
  const [port, simPort, wirePort] = await Promise.all([freePort(), freePort(), freePort()]);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tkl-station-fast-'));
  const id = ids.includes(DEFAULT_STATION) ? DEFAULT_STATION : ids[0]; assert.ok(id, 'minst ett stationspaket finns');
  await owner(directory, 'fast@example.test');
  const run = launch({ ...cleanEnvironment(), CHARLOTTENDAL_STATION: id, CHARLOTTENDAL_STATE_DIR: directory, CHARLOTTENDAL_AUTH_MODE: 'local',
    TKL_INSTALLATION_CONFIG: path.join(directory, 'installation/station.json'), CHARLOTTENDAL_PORT: String(port), CHARLOTTENDAL_SIM_PORT: String(simPort), CHARLOTTENDAL_WIRE_PORT: String(wirePort) });
  try {
    const call = client(port);
    await until(async () => (await call('config')).answer.station?.id === id, 'Den fasta installationen startade inte');
    const cookie = await login(call, 'fast@example.test');
    const view = (await call('installation/station', { cookie })).answer;
    assert.equal(view.current, id); assert.equal(view.locked, true); assert.ok(view.reason);
    assert.deepEqual(view.stations.map(station => station.id).sort(), [...ids].sort());
    assert.ok(view.stations.every(station => !station.allowed));
    const target = ids.find(station => station !== id) || id;
    await call('installation/station', { cookie, data: { stationId: target }, status: 409 });
    assert.equal(fs.existsSync(path.join(directory, 'installation/station.json')), false, 'låst byte skriver ingen startupfil');
  } catch (error) { error.message += '\n' + run.output().slice(-5000); throw error; }
  finally { await stop(run.child); fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5 }); }
});

for (const mapped of [true, false]) test('två stationer byts med kontrollerad omstart, egna användare och driftdata samt pausad TrainMeet · ' +
  (mapped ? 'mappade driftkataloger' : 'standardsökvägar utan CHARLOTTENDAL_STATE_DIR'),
  { skip: hasBoth ? false : 'Paketet har bara sin egen station; den fasta installationen provas separat.', timeout: 120000 }, async () => {
  const [port, simPort, wirePort] = await Promise.all([freePort(), freePort(), freePort()]);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tkl-stationsbyte-'));
  const installationRoot = mapped ? root : temporaryInstallation(directory);
  const cdaDir = path.join(mapped ? directory : installationRoot, mapped ? 'befintliga-cda-data' : 'var');
  const tkDir = mapped ? path.join(directory, 'separata-tk-data') : path.join(installationRoot, 'var/trakvista');
  const startup = path.join(directory, 'installation/station.json');
  const requests = [];
  const meet = http.createServer((req, res) => { requests.push(req.url); res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{"message":"Endast ett isolerat stationsprov"}'); });
  await new Promise((resolve, reject) => { meet.once('error', reject); meet.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${meet.address().port}`;
  let run;
  try {
    await owner(cdaDir, 'cda@example.test'); await owner(tkDir, 'tk@example.test');
    writeJSON(startup, { version: 1, stationId: 'charlottendal', requireTrainMeetConnect: false,
      ...(mapped ? { stationStateDirectories: { charlottendal: cdaDir, trakvista: tkDir } } : {}) });
    const locobuffer = { device: '', baud: '57600', flow: 'rtscts' };
    writeJSON(path.join(tkDir, 'connection.json'), { schema: 1, mode: 'live', locobuffer });
    writeJSON(path.join(tkDir, 'trainmeet.json'), { version: 1, clientId: 'tk-tkl-stationsprov', stationId: 'tk-isolerat-prov', token: 'endast-provet', origin,
      pairings: { [origin]: { stationId: 'tk-isolerat-prov', token: 'endast-provet' } } });
    const env = { ...cleanEnvironment(), ...(mapped ? { CHARLOTTENDAL_STATE_DIR: cdaDir } : {}), CHARLOTTENDAL_AUTH_MODE: 'local', TKL_INSTALLATION_CONFIG: startup,
      CHARLOTTENDAL_PORT: String(port), CHARLOTTENDAL_SIM_PORT: String(simPort), CHARLOTTENDAL_WIRE_PORT: String(wirePort) };
    if (!mapped) {
      assert.equal(Object.hasOwn(env, 'CHARLOTTENDAL_STATE_DIR'), false, 'standardfallet har inget miljövalt driftläge');
      assert.equal(Object.hasOwn(readJSON(startup), 'stationStateDirectories'), false, 'standardfallet har ingen katalogkarta');
      assert.notEqual(fs.realpathSync(path.join(installationRoot, 'src/station.mjs')), fs.realpathSync(path.join(root, 'src/station.mjs')));
    }
    run = launch(env, installationRoot);
    const call = client(port), simulator = client(simPort);
    const ready = id => until(async () => {
      const config = (await call('config')).answer;
      if (config.station?.id !== id) return false;
      const state = (await call('state')).answer;
      return state.connection === 'connected' && Object.entries(state.blocks).every(([name, block]) => block.occupied === (config.blocks[name].internal ? null : false)) && { config, state };
    }, 'Stationen ' + id + ' fick inte fri återrapport');
    await ready('charlottendal');
    const cdaCookie = await login(call, 'cda@example.test');
    // Simulatorn saknar Studio-endpoint. 404 med rätt cookie bevisar ändå att dess egen auth släpper in ägaren;
    // 401 utan rätt cookie bevisar att det verkligen finns ett ägarregister också i den processen.
    await simulator('studio', { cookie: cdaCookie, status: 404 });
    await simulator('studio', { status: 401 });
    await call('note', { cookie: cdaCookie, data: { key: 'stationsprov', note: 'Charlottendals egen inställning' } });
    let view = (await call('installation/station', { cookie: cdaCookie })).answer;
    assert.equal(view.locked, false); assert.match(view.stations.find(station => station.id === 'trakvista').reason, /LocoNet/);
    await call('installation/station', { cookie: cdaCookie, data: { stationId: 'trakvista' }, status: 409 });
    assert.equal(readJSON(startup).stationId, 'charlottendal'); assert.equal(readJSON(path.join(tkDir, 'connection.json')).mode, 'live');
    writeJSON(path.join(tkDir, 'connection.json'), { schema: 1, mode: 'offline', locobuffer });
    // En POST som väntar på resten av sin kropp räknas också: stationsvalet får inte gå förbi den.
    const slow = slowPost(port, cdaCookie);
    try {
      await until(async () => /pågående manöver/.test((await call('installation/station', { cookie: cdaCookie })).answer.reason), 'Den pågående HTTP-manövern syntes inte');
      const busy = (await call('installation/station', { cookie: cdaCookie, data: { stationId: 'trakvista' }, status: 409 })).answer;
      assert.match(busy.error, /pågående manöver/);
    } finally { assert.equal((await slow.finish()).status, 200); }
    const cdaNotes = fs.readFileSync(path.join(cdaDir, 'notes.json'));

    // Riktig tågväg och bruten telegramförbindelse: också ett kvarhållet lås måste återtas före byte.
    await call('route', { cookie: cdaCookie, data: { from: 'htvCu', to: 'htvSpIA' } });
    await until(async () => (await call('state')).answer.routes[0]?.state === 'active', 'Tågvägen blev inte aktiv');
    await simulator('link', { cookie: cdaCookie, data: { connected: false } });
    await until(async () => (await call('state')).answer.routes[0]?.state === 'held', 'Tågvägslåset blev inte kvarhållet');
    const denied = (await call('installation/station', { cookie: cdaCookie, data: { stationId: 'trakvista' }, status: 409 })).answer;
    assert.match(denied.error, /tågvägar|lås/); assert.equal(readJSON(startup).stationId, 'charlottendal');
    await simulator('link', { cookie: cdaCookie, data: { connected: true } });
    await ready('charlottendal');
    const held = (await call('state')).answer.routes[0];
    await call('cancel', { cookie: cdaCookie, data: { id: held.id } });
    await until(async () => !(await call('state')).answer.routes.length, 'Tågvägslåset återtogs inte');

    view = (await call('installation/station', { cookie: cdaCookie })).answer;
    assert.equal(view.stations.find(station => station.id === 'trakvista').allowed, true);
    const accepted = (await call('installation/station', { cookie: cdaCookie, data: { stationId: 'trakvista' } })).answer;
    assert.equal(accepted.restarting, true); assert.equal(accepted.stationId, 'trakvista');
    if (mapped) assert.equal(readJSON(startup).stationStateDirectories.charlottendal, cdaDir, 'ursprungliga driftkatalogen är exakt bevarad');
    else assert.equal(Object.hasOwn(readJSON(startup), 'stationStateDirectories'), false, 'stationsbytet behåller standardsökvägarna');
    const tk = await ready('trakvista');
    assert.equal((await simulator('config')).answer.station.id, 'trakvista', 'också återrapportens process har bytt station');
    assert.equal(tk.config.notes.stationsprov, undefined, 'Charlottendals inställning följer inte med');
    assert.deepEqual(fs.readFileSync(path.join(cdaDir, 'notes.json')), cdaNotes);
    await call('installation/station', { cookie: cdaCookie, status: 401 });
    const tkCookie = await login(call, 'tk@example.test');
    await simulator('studio', { cookie: tkCookie, status: 404 });
    await simulator('studio', { cookie: cdaCookie, status: 401 });
    view = (await call('installation/station', { cookie: tkCookie })).answer;
    assert.equal(view.requireTrainMeetConnect, true, 'den nya stationen kräver uttrycklig TrainMeet-anslutning');
    assert.equal(tk.state.trainMeet.status, 'disconnected');
    await call('trainmeet/refresh', { cookie: tkCookie, data: { sessionId: tk.state.trainMeet.sessionId, revision: tk.state.trainMeet.revision }, status: 409 });
    await pause(1200); assert.deepEqual(requests, [], 'sparad TrainMeet-token ger ingen automatisk kontakt efter stationsbyte');
    const station = currentStation({ CHARLOTTENDAL_STATION: 'trakvista' });
    const panelResponse = await fetch(`http://127.0.0.1:${port}/data/panel.json`);
    assert.equal(panelResponse.status, 200); assert.deepEqual(await panelResponse.json(), readJSON(path.join(station.dataDir, 'panel.json')));
    await call('note', { cookie: tkCookie, data: { key: 'stationsprov', note: 'Träkvistas egen inställning' } });
    const tkNotes = fs.readFileSync(path.join(tkDir, 'notes.json'));
    await call('installation/station', { cookie: tkCookie, data: { stationId: 'charlottendal' } });
    const cda = await ready('charlottendal');
    assert.equal((await simulator('config')).answer.station.id, 'charlottendal');
    assert.equal(cda.config.notes.stationsprov, 'Charlottendals egen inställning');
    assert.deepEqual(fs.readFileSync(path.join(tkDir, 'notes.json')), tkNotes);
    await call('installation/station', { cookie: tkCookie, status: 401 });
    assert.equal((await call('installation/station', { cookie: cdaCookie })).answer.current, 'charlottendal', 'Charlottendals egen session finns kvar');
    await simulator('studio', { cookie: cdaCookie, status: 404 });
    await simulator('studio', { cookie: tkCookie, status: 401 });
    assert.equal(readJSON(path.join(cdaDir, 'routes.json')).routes.length, 0);
    assert.deepEqual(new UserStore(path.join(cdaDir, 'users.json')).summary().users.map(user => user.username), ['cda@example.test']);
    assert.deepEqual(new UserStore(path.join(tkDir, 'users.json')).summary().users.map(user => user.username), ['tk@example.test']);
    assert.equal((run.output().match(/Charlottendal TKL: http/g) || []).length, 2);
    assert.equal((run.output().match(/Träkvista TKL: http/g) || []).length, 1);
  } catch (error) { error.message += '\n' + (run?.output() || '').slice(-6000); throw error; }
  finally {
    await stop(run?.child);
    await new Promise(resolve => meet.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});
