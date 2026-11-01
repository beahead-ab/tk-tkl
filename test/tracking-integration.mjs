import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { destinationDefaults } from '../public/destination-data.js';
const root = fileURLToPath(new URL('..', import.meta.url));
// Trafikspelet i provet (0.79.0): en TrainMeet-server med Charlottendal och Kungsfors, där sträckan Kungsfors → Charlottendal
// är belagd av tåg 421. Kungsfors-spåren Au/An pekar på Kungsfors i TrainMeet, som Orter och telefon gör det.
async function trafficGame(dir,{departure=false}={}) {
  let line = departure?{id:'cda-kfs',state:'reserved',from_station_id:'cda',to_station_id:'kfs',train_number:'92'}:{ id: 'cda-kfs', state: 'occupied', from_station_id: 'kfs', to_station_id: 'cda', train_number: '421' };
  const trains=departure?[{id:'m92',station_id:'cda',train_number:'92',track_id:'t1a',track:'1a',departure_time:'06:20',departure_to:'Kungsfors'}]:[];
  const movements=departure?{m92:{revision:1,arrival:'none',departure:'positioned',actualTrack:'t1a'}}:{};
  const posted=[];
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json'); let body = ''; for await (const c of req) body += c;
    if (req.url === '/v1/pair') return res.end(JSON.stringify({ protocol_version: 1, client_id: JSON.parse(body).client_id, access_token: 'traffic-token' }));
    if (req.headers.authorization !== 'Bearer traffic-token') { res.writeHead(401); return res.end('{}'); }
    const common = { protocol_version: 1, publication_id: 'pub1', active_day: 'Dagl' };
    if(req.url==='/v1/tkl/movement'&&departure){const data=JSON.parse(body);posted.push(data);movements.m92={...movements.m92,revision:2,departure:data.departure};line.state='occupied';return res.end('{}');}
    if (req.url === '/v1/tkl/context?station_id=cda') return res.end(JSON.stringify({ ...common, station: { id: 'cda', name: 'Charlottendal' }, shift: null, previous_shift: null, movements, connection_states: [line] }));
    if (req.url === '/v1/timetable?station_id=cda') return res.end(JSON.stringify({ schema_version: 3, publication_id: 'pub1', active_day: 'Dagl', stations: [{ id: 'cda' }], tracks: departure?[{id:'t1a',station_id:'cda',display_label:'1a'}]:[], trains }));
    if (req.url === '/v1/display') return res.end(JSON.stringify({ ...common, stations: [{ id: 'cda', name: 'Charlottendal' }, { id: 'kfs', name: 'Kungsfors' }], connections: [{ id: 'cda-kfs', station_a_id: 'cda', station_b_id: 'kfs', track_type: 'double' }], revision: 1, clock: { configured: true, time: '12:00:00', running: true, speed: 1 }, trains }));
    res.writeHead(404); res.end('{}');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const linked=departure?['Bu','Bn']:['Au','An'];
  fs.writeFileSync(path.join(dir, 'destinations.json'), JSON.stringify({ revision: 1, entries: destinationDefaults.map(({ id, name, phone }) => ({ id, name, phone, source: linked.includes(id) ? 'trainmeet' : 'local', stationId: linked.includes(id) ? 'kfs' : '' })) }));
  return { posted,origin: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(r => server.close(r)), set: next => { line = { ...line, ...next }; } };
}
async function pair(httpPort, origin) {
  const call = async (name, data) => { const r = await fetch(`http://127.0.0.1:${httpPort}/api/trainmeet/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); const v = await r.json(); assert.equal(r.status, 200, JSON.stringify(v)); return v; };
  const initial = (await (await fetch(`http://127.0.0.1:${httpPort}/api/state`)).json()).trainMeet;
  const configured = await call('configure', { ...initial, origin });
  return call('pair', { ...configured, stationId: 'cda', code: 'test-code' });
}
async function freePort() { const s = net.createServer(); await new Promise((ok, no) => { s.once('error', no); s.listen(0, '127.0.0.1', ok); }); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function until(fn, timeout = 15000) { const end = Date.now() + timeout; let error; while (Date.now() < end) { try { const result = await fn(); if (result) return result; } catch (e) { error = e; } await new Promise(r => setTimeout(r, 100)); } throw error || Error('Timed out waiting for state'); }

test('uppställt tåg 92 kör ut på lagd tågväg och rapporten uppdateras utan manuellt avgångsklick', {timeout:90000}, async()=>{
  const [httpPort,simPort,wirePort]=await Promise.all([freePort(),freePort(),freePort()]);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'charlottendal-departure-'));
  const game=await trafficGame(dir,{departure:true}),children=[];let output='';
  const env={...process.env,CHARLOTTENDAL_PROFILE:'network',CHARLOTTENDAL_CONNECTION_MODE:'simulator',CHARLOTTENDAL_AUTH_MODE:'cloudflare',CHARLOTTENDAL_PUBLIC_ORIGIN:'',CHARLOTTENDAL_TRAINMEET_ORIGIN:'',CHARLOTTENDAL_PORT:String(httpPort),CHARLOTTENDAL_SIM_PORT:String(simPort),CHARLOTTENDAL_WIRE_PORT:String(wirePort),CHARLOTTENDAL_STATE_DIR:dir};
  const get=async()=>(await fetch(`http://127.0.0.1:${httpPort}/api/state`)).json();
  try{
    for(const file of ['src/simulator.mjs','src/server.mjs']){const child=spawn(process.execPath,[file],{cwd:root,env});children.push(child);child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);}
    await until(async()=>{const s=await get();return s.connection==='connected'&&Object.values(s.blocks).every(b=>b.occupied===false);});
    await pair(httpPort,game.origin);
    await until(async()=>(await get()).trainTracking.trains.some(t=>t.number==='92'&&t.certain));
    assert.equal(game.posted.length,0,'stående tåg rapporteras inte som avgånget');
    const response=await fetch(`http://127.0.0.1:${httpPort}/api/route`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from:'htvSpIC',to:'htvBu'})});
    assert.equal(response.status,200,JSON.stringify(await response.json()));
    const after=await until(async()=>{const s=await get();return s.trainMeet.departures.some(r=>r.movementId==='m92'&&r.status==='confirmed')&&s;},60000);
    assert.equal(after.trainMeet.context.movements.find(m=>m.id==='m92').departure,'departed');
    assert.equal(after.trainTracking.trains.some(t=>t.number==='92'),false);
    assert.equal(game.posted.length,1);assert.equal(game.posted[0].movement_id,'m92');assert.equal(game.posted[0].departure,'departed');
    assert.ok(after.operatingEvents.some(e=>/Tåg 92: verifierad avgång återrapporterad/.test(e.message)));
  }catch(error){error.message+='\n'+output.slice(-3000);throw error;}
  finally{await Promise.all(children.map(c=>new Promise(r=>{if(c.exitCode!==null)return r();c.once('exit',r);c.kill();})));await game.close();fs.rmSync(dir,{recursive:true,force:true,maxRetries:5});}
});

// Tågspårningen mot simulatorn i en egen process: tågvägen Au → Spår 1c läggs i TKL, simulatorn kör tåget, och
// spårningen följer det från kanten till spåret ur de rapporter som kommer över LocoNet.
test('tågspårningen följer ett simulerat tåg från Kungsfors till spår 1c och kan få sitt nummer', { timeout: 60000 }, async () => {
  const [httpPort, simPort, wirePort] = await Promise.all([freePort(), freePort(), freePort()]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'charlottendal-tracking-'));
  const env = { ...process.env, CHARLOTTENDAL_PROFILE: 'network', CHARLOTTENDAL_CONNECTION_MODE: 'simulator', CHARLOTTENDAL_AUTH_MODE: 'cloudflare', CHARLOTTENDAL_PUBLIC_ORIGIN: '',
    CHARLOTTENDAL_PORT: String(httpPort), CHARLOTTENDAL_SIM_PORT: String(simPort), CHARLOTTENDAL_WIRE_PORT: String(wirePort), CHARLOTTENDAL_STATE_DIR: dir };
  let output = ''; const children = [];
  const launch = file => { const child = spawn(process.execPath, [file], { cwd: root, env }); children.push(child); child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d); };
  const get = async () => (await fetch(`http://127.0.0.1:${httpPort}/api/state`)).json();
  const post = async (port, command, data) => { const r = await fetch(`http://127.0.0.1:${port}/api/${command}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); const result = await r.json(); assert.equal(r.status, 200, JSON.stringify(result)); return result; };
  try {
    launch('src/simulator.mjs'); launch('src/server.mjs');
    await until(async () => { const s = await get(); return s.connection === 'connected' && Object.values(s.blocks).every(b => b.occupied === false); });
    assert.deepEqual((await get()).trainTracking, { enabled: true, trains: [], lines: [] });
    await post(httpPort, 'route', { from: 'htvAu', to: 'htvSpIA' });
    await until(async () => (await get()).routes.some(r => r.state === 'active'));
    await post(simPort, 'train', { id: 'htvAu--htvSpIA' });
    const seen = new Set();
    const arrived = await until(async () => { const t = (await get()).trainTracking.trains[0]; if (t?.state === 'station') seen.add(t.head); return t?.state === 'station' && t.head === 'SIA' ? t : null; }, 30000);
    for (const block of ['S95', 'S110', 'SIA']) assert.ok(seen.has(block) || arrived.blocks.includes(block), 'fronten passerade ' + block);
    assert.equal((await get()).trainTracking.trains.length, 1, 'ett tåg, inga spöktåg från de delade detektorerna');
    const named = await post(httpPort, 'tracking/name', { id: arrived.id, number: '421' });
    assert.equal(named.trains[0].number, '421'); assert.equal(named.trains[0].certain, true);
    const events = (await get()).operatingEvents.filter(e => e.kind === 'train-tracking').map(e => e.message);
    assert.ok(events.some(m => /kom in från .*\(Au\)/.test(m)), events.join(' | '));
    assert.ok(events.some(m => /Tåg 421 bekräftat av operatören/.test(m)));
  } catch (error) { error.message += '\n' + output.slice(-2000); throw error; }
  finally { await Promise.all(children.map(c => new Promise(r => { if (c.exitCode !== null) return r(); c.once('exit', r); c.kill(); }))); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
});

// Trafikspelets tåg (0.79.0): LocoNet ej ansluten. Grannstationen Kungsfors har sänt tåg 421 på sträckan hit; TKL ställer
// det utanför infartssignalen, operatören lägger tågvägen, tåget kör in med sitt nummer, stannar och tågvägen löses upp.
test('trafikspelets tåg kommer in från linjen med nummer, stannar på spåret och tågvägen löses upp vid ankomst', { timeout: 90000 }, async () => {
  const [httpPort, simPort, wirePort] = await Promise.all([freePort(), freePort(), freePort()]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'charlottendal-traffic-'));
  const game = await trafficGame(dir);
  const env = { ...process.env, CHARLOTTENDAL_PROFILE: 'network', CHARLOTTENDAL_CONNECTION_MODE: 'simulator', CHARLOTTENDAL_AUTH_MODE: 'cloudflare', CHARLOTTENDAL_PUBLIC_ORIGIN: '', CHARLOTTENDAL_TRAINMEET_ORIGIN: '',
    CHARLOTTENDAL_PORT: String(httpPort), CHARLOTTENDAL_SIM_PORT: String(simPort), CHARLOTTENDAL_WIRE_PORT: String(wirePort), CHARLOTTENDAL_STATE_DIR: dir };
  let output = ''; const children = [];
  const launch = file => { const child = spawn(process.execPath, [file], { cwd: root, env }); children.push(child); child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d); };
  const get = async () => (await fetch(`http://127.0.0.1:${httpPort}/api/state`)).json();
  const post = async (command, data) => { const r = await fetch(`http://127.0.0.1:${httpPort}/api/${command}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); const result = await r.json(); assert.equal(r.status, 200, JSON.stringify(result)); return result; };
  try {
    launch('src/simulator.mjs'); launch('src/server.mjs');
    await until(async () => { const s = await get(); return s.connection === 'connected' && Object.values(s.blocks).every(b => b.occupied === false); });
    assert.equal((await get()).trafficTrains.available, true, 'LocoNet ej ansluten: TKL kör trafikspelets tåg');
    await pair(httpPort, game.origin);
    const waiting = await until(async () => { const s = await get(); return s.blocks.SU2A.occupied === true && s; }, 20000);
    assert.ok(waiting.events.some(e => /Tåg 421 på linjen från Kungsfors/.test(e.message)), 'utställt vid infarten');
    await post('route', { from: 'htvAu', to: 'htvSpIA' });
    const parked = await until(async () => { const v = await get(); const t = v.trainTracking.trains.find(x => x.number === '421'); return t && v.routes.length === 0 && t.state === 'station' && t.head === 'SIA' ? t : null; }, 45000);
    assert.equal(parked.certain, true); assert.equal(parked.source, 'TrainMeet', 'numret kom från trafikspelet');
    const after = await get();
    assert.equal(after.blocks.SIA.occupied, true, 'tåget står kvar på spåret');
    assert.ok(after.operatingEvents.some(e => /tåget står på målspåret/.test(e.message)), 'tågvägen löstes upp vid ankomst');
    assert.equal(after.trainTracking.trains.filter(t => t.number === '421').length, 1, 'tåget ställs inte ut två gånger');
  } catch (error) { error.message += '\n' + output.slice(-2000); throw error; }
  finally { await Promise.all(children.map(c => new Promise(r => { if (c.exitCode !== null) return r(); c.once('exit', r); c.kill(); }))); await game.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
});

// Trafikspelets tåg + automat: stationen kör av sig själv. Tåget från Kungsfors ställs ut, automaten lägger infarten, tåget
// står på spåret, automaten lägger utfarten mot nästa linje och tåget lämnar.
test('med trafikspelets tåg och automat kör stationen ett tåg in och ut av sig själv', { timeout: 150000 }, async () => {
  const [httpPort, simPort, wirePort] = await Promise.all([freePort(), freePort(), freePort()]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'charlottendal-automation-'));
  const game = await trafficGame(dir);
  const env = { ...process.env, CHARLOTTENDAL_PROFILE: 'network', CHARLOTTENDAL_CONNECTION_MODE: 'simulator', CHARLOTTENDAL_AUTH_MODE: 'cloudflare', CHARLOTTENDAL_PUBLIC_ORIGIN: '', CHARLOTTENDAL_TRAINMEET_ORIGIN: '',
    CHARLOTTENDAL_PORT: String(httpPort), CHARLOTTENDAL_SIM_PORT: String(simPort), CHARLOTTENDAL_WIRE_PORT: String(wirePort), CHARLOTTENDAL_STATE_DIR: dir };
  let output = ''; const children = [];
  const launch = file => { const child = spawn(process.execPath, [file], { cwd: root, env }); children.push(child); child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d); };
  const get = async () => (await fetch(`http://127.0.0.1:${httpPort}/api/state`)).json();
  const post = async (command, data) => { const r = await fetch(`http://127.0.0.1:${httpPort}/api/${command}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); const result = await r.json(); assert.equal(r.status, 200, JSON.stringify(result)); return result; };
  const said = async pattern => (await get()).operatingEvents.some(e => pattern.test(e.message));
  try {
    launch('src/simulator.mjs'); launch('src/server.mjs');
    await until(async () => { const s = await get(); return s.connection === 'connected' && Object.values(s.blocks).every(b => b.occupied === false); });
    assert.deepEqual((await post('automation', { enabled: true })).enabled, true);
    await pair(httpPort, game.origin);
    await until(() => said(/Automaten lägger .* för tåg 421/), 30000);
    await until(() => said(/tåget står på målspåret/), 40000);
    await until(() => said(/Automaten lägger Spår .* för tåg 421/), 60000);
    await until(() => said(/Tåg 421 lämnade mot/), 40000);
    const s = await get();
    assert.equal(s.automation.enabled, true, 'automaten lämnade inte över');
    assert.equal(s.trainTracking.trains.filter(t => t.state === 'station').length, 0);
  } catch (error) { error.message += '\n' + output.slice(-2000); throw error; }
  finally { await Promise.all(children.map(c => new Promise(r => { if (c.exitCode !== null) return r(); c.once('exit', r); c.kill(); }))); await game.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
});
