// Hela den manuella trafikkedjan mot en lokal TrainMeet-provserver. Samma prov följer med stationspaketet;
// bara stationer som faktiskt finns i paketet startas. Ingen riktig bana, driftkatalog eller extern server används.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stationIds } from '../src/station.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const available = stationIds().filter(id => ['charlottendal', 'trakvista'].includes(id));
const cases = {
  charlottendal: { title: 'Charlottendal', stationId: 'meet-cda',
    journeys: [{ edge: 'Au', out: 'Bu', block: 'SU2A', button: 'htvSpIA', track: '1a', trackBlock: 'SIA', number: '421' }] },
  trakvista: { title: 'Träkvista', stationId: 'meet-tk',
    journeys: [
      { edge: 'A', out: 'A', block: 'SA2', button: 'htvII', track: 'II', trackBlock: 'SII', number: '7101' },
      { edge: 'B', out: 'B', block: 'SB2', button: 'htvI', track: 'I', trackBlock: 'SI', number: '7102' },
      { edge: 'C', out: 'C', block: 'SC2', button: 'htvIII', track: 'III', trackBlock: 'SIII', number: '7103' }
    ] }
};
const positionedTracks = [
  { label: 'I', button: 'htvI', block: 'SI' }, { label: 'II', button: 'htvII', block: 'SII' },
  { label: 'III', button: 'htvIII', block: 'SIII' }, { label: 'IIIa', button: 'htvIIIA', block: 'SIIIa' },
  { label: 'IIIc', button: 'htvIIIC', block: 'SIIIc' }
];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, timeout = 25000) {
  const end = Date.now() + timeout;
  let error;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch (e) { error = e; }
    await delay(100);
  }
  throw Error('Tidsgräns: ' + label + (error ? '\n' + error.message : ''));
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}

// Ort-id:n är medvetet andra än A/B/C, Kungsfors och andra standardnamn. En koppling måste sparas av operatören
// mot stationskatalogen från just denna träff. Ett ockuperat C ligger först omappat och ska då lämnas helt ifred.
async function trafficGame(ids, { automatic = false, observe = async () => ({}) } = {}) {
  let revision = 1;
  const posts = [], pairs = [], requests = [], states = new Map();
  for (const id of ids) {
    const def = cases[id], tracks = id === 'trakvista' ? positionedTracks : [{ label: '1a' }];
    const journeys = def.journeys.map(j => ({ ...j, neighbor: def.stationId + '-actual-' + j.edge,
      connection: def.stationId + '-connection-' + j.edge, movement: def.stationId + '-movement-' + j.edge,
      trackId: def.stationId + '-track-' + j.track.toLowerCase() }));
    const trains = journeys.map(j => ({ id: j.movement, station_id: def.stationId, train_number: j.number,
      track_id: j.trackId, arrival_time: '12:00', departure_time: '12:10' }));
    const positioned = id === 'trakvista' ? positionedTracks.map((track, i) => ({ ...track,
      id: def.stationId + '-positioned-' + i, station_id: def.stationId, train_number: String(7200 + i),
      track_id: def.stationId + '-track-' + track.label.toLowerCase() })) : [];
    states.set(def.stationId, { id, ...def, journeys, positioned, trains: [...trains, ...positioned],
      tracks: tracks.map(track => ({ id: def.stationId + '-track-' + track.label.toLowerCase(), station_id: def.stationId, display_label: track.label })),
      movements: {}, lines: journeys.map(j => ({ id: j.connection, state: 'free', from_station_id: null, to_station_id: null, train_number: null })) });
  }
  if (automatic) {
    assert.deepEqual(ids, ['trakvista']);
    const s = states.get(cases.trakvista.stationId), from = s.journeys.find(j => j.edge === 'A'), to = s.journeys.find(j => j.edge === 'B');
    s.automatic = { number: '7301', movementId: s.stationId + '-automatic', serviceId: 'service-A-Tk-B',
      trackId: s.stationId + '-track-i', from, to };
    const train = s.automatic;
    s.trains = [{ id: train.movementId, service_id: train.serviceId, station_id: s.stationId,
      train_number: train.number, track_id: train.trackId, arrival_time: '12:00', departure_time: '12:10' }];
    s.routes = [
      { service_id: train.serviceId, station_id: from.neighbor, stop_order: 0, departure_time: '11:55' },
      { service_id: train.serviceId, station_id: s.stationId, stop_order: 1, arrival_time: '12:00', departure_time: '12:10' },
      { service_id: train.serviceId, station_id: to.neighbor, stop_order: 2, arrival_time: '12:20' }
    ];
    s.movements[train.movementId] = { revision: 1, arrival: 'approaching', departure: 'none', actualTrack: train.trackId };
    Object.assign(s.lines.find(l => l.id === from.connection), { state: 'requested', from_station_id: from.neighbor,
      to_station_id: s.stationId, train_number: train.number });
  }
  const common = () => ({ protocol_version: 1, publication_id: 'traffic-process', active_day: 'Dagl' });
  const stationRows = () => [...states.values()].flatMap(s => [{ id: s.stationId, name: s.title },
    ...s.journeys.map(j => ({ id: j.neighbor, name: 'Provorten ' + j.edge + ' vid ' + s.title }))]);
  const server = http.createServer(async (req, res) => {
    try {
      requests.push(req.method + ' ' + req.url);
      res.setHeader('Content-Type', 'application/json');
      let raw = ''; for await (const chunk of req) raw += chunk;
      const data = raw ? JSON.parse(raw) : null, url = new URL(req.url, 'http://127.0.0.1');
      const send = value => res.end(JSON.stringify(value));
      if (url.pathname === '/v1/pair') {
        assert.equal(data.device_kind, 'tkl_terminal'); assert.equal(data.pairing_code, 'TESTCODE');
        pairs.push(data.client_id);
        return send({ protocol_version: 1, client_id: data.client_id, access_token: 'local-traffic-token' });
      }
      // Stationslistan får läsas före parkopplingen, som när panelens Anslut väljer stationen automatiskt.
      if (url.pathname !== '/v1/display' && req.headers.authorization !== 'Bearer local-traffic-token') {
        res.writeHead(401); return send({ error: 'saknar provets token' });
      }
      if (url.pathname === '/v1/display') return send({ ...common(), stations: stationRows(), revision,
        clock: { configured: true, time: '12:00:00', running: true, speed: 1 },
        connections: [...states.values()].flatMap(s => s.journeys.map(j => ({ id: j.connection,
          station_a_id: s.stationId, station_b_id: j.neighbor, track_type: s.id === 'trakvista' ? 'single' : 'double' }))),
        trains: [...states.values()].flatMap(s => s.trains),
        ...(automatic ? { routes: [...states.values()].flatMap(s => s.routes || []) } : {}) });
      const state = states.get(data?.station_id || url.searchParams.get('station_id'));
      if (!state) { res.writeHead(404); return send({ error: 'okänd provstation' }); }
      if (url.pathname === '/v1/tkl/context') return send({ ...common(), station: { id: state.stationId, name: state.title },
        shift: null, previous_shift: null, movements: state.movements, connection_states: state.lines });
      if (url.pathname === '/v1/timetable') return send({ schema_version: 3, publication_id: 'traffic-process', active_day: 'Dagl',
        stations: [{ id: state.stationId }], tracks: state.tracks, trains: state.trains });
      if (url.pathname === '/v1/tkl/movement') {
        assert.ok(state.trains.some(t => t.id === data.movement_id));
        const observed = automatic ? await observe({ path: url.pathname, ...data }) : {};
        posts.push({ path: url.pathname, ...data, ...observed });
        state.movements[data.movement_id] = { revision: ++revision, arrival: data.arrival,
          departure: data.departure, actualTrack: data.actual_track || '' };
        return send({ movement: state.movements[data.movement_id] });
      }
      if (url.pathname === '/v1/tkl/clearance') {
        const line = state.lines.find(l => l.id === data.connection_id);
        assert.ok(line);
        if (automatic) {
          const observed = await observe({ path: url.pathname, ...data }), train = state.automatic;
          posts.push({ path: url.pathname, ...data, ...observed });
          if (data.action === 'accept') {
            assert.equal(line.id, train.from.connection); assert.equal(line.state, 'requested');
            assert.equal(line.to_station_id, state.stationId);
            // Grannen sänder direkt efter godkännandet. Först nu får TrafficTrains ställa tåget utanför A.
            line.state = 'occupied';
          } else if (data.action === 'arrive') {
            assert.equal(line.id, train.from.connection); assert.equal(line.state, 'occupied');
            Object.assign(line, { state: 'free', from_station_id: null, to_station_id: null, train_number: null });
          } else if (data.action === 'request') {
            assert.equal(line.id, train.to.connection); assert.equal(line.state, 'free'); assert.equal(data.train_number, train.number);
            // Provgrannen beviljar den utgående klareringen i samma svar, med oförändrat tågnummer.
            Object.assign(line, { state: 'reserved', from_station_id: state.stationId,
              to_station_id: train.to.neighbor, train_number: train.number });
          } else if (data.action === 'depart') {
            assert.equal(line.id, train.to.connection); assert.equal(line.state, 'reserved');
            assert.equal(line.from_station_id, state.stationId); line.state = 'occupied';
          } else assert.fail('Oväntad automatklarering: ' + data.action);
          revision++; return send({ connection: line });
        }
        assert.equal(data.action, 'arrive'); assert.equal(line.state, 'occupied');
        posts.push({ path: url.pathname, ...data });
        Object.assign(line, { state: 'free', from_station_id: null, to_station_id: null, train_number: null }); revision++;
        return send({ connection: line });
      }
      res.writeHead(404); send({ error: 'okänd provbegäran' });
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ message: error.message })); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { states, posts, pairs, requests, origin: 'http://127.0.0.1:' + server.address().port,
    change(fn) { fn(); revision++; }, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}

async function stationProcess(id, base) {
  const [port, simPort, wirePort] = await Promise.all([freePort(), freePort(), freePort()]);
  const dir = path.join(base, id); fs.mkdirSync(dir);
  // Även om en installationstyp skulle råka aktivera uppdateraren får barnprocessen bara göra lokala HTTP-anrop.
  const guard = path.join(base, 'local-fetch.mjs');
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(CHARLOTTENDAL_|CDA_|RENDER_|NODE_OPTIONS$|PORT$)/.test(key)));
  const env = { ...inherited, CHARLOTTENDAL_STATION: id, CHARLOTTENDAL_PROFILE: 'network', CHARLOTTENDAL_AUTH_MODE: 'local',
    CHARLOTTENDAL_PUBLIC_ORIGIN: '', CHARLOTTENDAL_TRAINMEET_ORIGIN: '', CHARLOTTENDAL_INSTALL_KIND: '',
    CHARLOTTENDAL_CONNECTION_MODE: 'simulator', CHARLOTTENDAL_WIRE_HOST: '127.0.0.1', CHARLOTTENDAL_LISTEN: '127.0.0.1',
    CHARLOTTENDAL_PORT: String(port), CHARLOTTENDAL_SIM_PORT: String(simPort), CHARLOTTENDAL_WIRE_PORT: String(wirePort),
    CHARLOTTENDAL_STATE_DIR: dir, CHARLOTTENDAL_USERS_FILE: path.join(dir, 'users.json') };
  let output = '', cookie = '', backend, simulator;
  const launch = file => {
    const child = spawn(process.execPath, ['--import', pathToFileURL(guard).href, file], { cwd: root, env });
    child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
    return child;
  };
  const request = async (pathname, data, { expected = 200, token = cookie, simulator: field = false } = {}) => {
    const response = await fetch(`http://127.0.0.1:${field ? simPort : port}${pathname}`, {
      ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }),
      headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: token } : {}) }, signal: AbortSignal.timeout(5000)
    });
    const text = await response.text();
    assert.equal(response.status, expected, id + ' ' + pathname + ': ' + text.slice(0, 700));
    return { body: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text,
      cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
  };
  const get = async pathname => (await request(pathname || '/api/state')).body;
  const post = async (command, data, options) => (await request('/api/' + command, data, options)).body;
  const state = () => get('/api/state'), field = async () => (await request('/api/state', undefined, { simulator: true })).body;
  const wait = (fn, label, timeout) => until(fn, id + ': ' + label, timeout).catch(error => { error.message += '\n' + output.slice(-3500); throw error; });
  const ready = () => wait(async () => { const s = await state(); return s.connection === 'connected' && Object.values(s.blocks).every(b => b.occupied === false) && s; }, 'fria återrapporter', 30000);
  const refresh = () => wait(async () => {
    const meet = (await state()).trainMeet;
    if (meet.busy) return false;
    try { return await post('trainmeet/refresh', meet); } catch (error) { if (/409/.test(error.message)) return false; throw error; }
  }, 'färsk TrainMeet-kontext');
  const command = async (name, data) => wait(async () => {
    const meet = (await state()).trainMeet;
    if (meet.busy) return false;
    try { return await post('trainmeet/' + name, { ...meet, ...data }); } catch (error) { if (/409/.test(error.message)) return false; throw error; }
  }, 'TrainMeet ' + name);
  simulator = launch('src/simulator.mjs'); backend = launch('src/server.mjs');
  return { id, dir, port, state, field, get, post, request, wait, ready, refresh, command,
    get cookie() { return cookie; },
    async login(setup = false) {
      const response = await request('/api/auth/' + (setup ? 'setup' : 'login'), {
        username: 'owner-' + id + '@example.invalid', password: 'Provets eget lösenord ' + id
      }, { token: '' });
      assert.ok(response.cookie); cookie = response.cookie; return response.body.user;
    },
    async restart() { await stop(backend); backend = launch('src/server.mjs'); },
    async close() { await Promise.all([stop(backend), stop(simulator)]); }
  };
}

async function bind(rig, edge, neighbor) {
  const d = (await rig.state()).destinations;
  const entry = d.entries.find(e => e.id === edge); assert.ok(entry, rig.id + ' har ortsposten ' + edge);
  return rig.post('destinations', { revision: d.revision, entry: { ...entry, phone: '123', source: 'trainmeet', stationId: neighbor } });
}

async function manualJourney(rig, game, journey) {
  const station = game.states.get(cases[rig.id].stationId), j = journey;
  game.change(() => {
    Object.assign(station.lines.find(l => l.id === j.connection), { state: 'occupied', from_station_id: j.neighbor,
      to_station_id: station.stationId, train_number: j.number });
    station.movements[j.movement] = { revision: 1, arrival: 'approaching', departure: 'none', actualTrack: j.trackId };
  });
  await rig.refresh();
  const waiting = await rig.wait(async () => {
    const [s, f] = await Promise.all([rig.state(), rig.field()]);
    const train = f.trains.find(t => t.number === j.number);
    return s.blocks[j.block]?.occupied === true && train?.standing && train.position === 'htv' + j.edge && { s, train };
  }, 'tåg ' + j.number + ' utanför ' + j.edge);
  assert.equal(waiting.train.blocks[0], j.block, 'utställt på uttryckligt yttre block');
  await rig.wait(async () => (await rig.state()).trainTracking.trains.some(t => t.number === j.number && t.source === 'TrainMeet'), 'numret från rätt grannstation');
  await rig.post('route', { from: 'htv' + j.edge, to: j.button });
  const parked = await rig.wait(async () => {
    const s = await rig.state(), f = await rig.field(), train = s.trainTracking.trains.find(t => t.number === j.number);
    return s.routes.length === 0 && s.blocks[j.trackBlock]?.occupied === true && train?.head === j.trackBlock &&
      f.trains.some(t => t.number === j.number && t.standing && t.position === j.button) && s;
  }, 'manuell infart, ankomst och frigivna lås för ' + j.number, 45000);
  assert.equal(parked.trainTracking.trains.filter(t => t.number === j.number).length, 1, 'ett tåg utan dubblerat nummer');
  assert.ok(parked.operatingEvents.some(e => /tåget står på målspåret.*lås frigivna/.test(e.message)), 'stopp bekräftas innan låsen frigörs');
  await rig.command('movement', { movementId: j.movement, arrival: 'arrived', actualTrack: j.trackId });
  await rig.command('clearance', { connectionId: j.connection, action: 'arrive' });
  game.change(() => Object.assign(station.lines.find(l => l.id === j.connection), { state: 'occupied',
    from_station_id: station.stationId, to_station_id: j.neighbor, train_number: j.number }));
  await rig.refresh();
  await rig.post('route', { from: j.button, to: 'htv' + j.out });
  await rig.wait(async () => {
    const s = await rig.state(), f = await rig.field();
    return !f.trains.some(t => t.number === j.number) && s.routes.length === 0 &&
      !s.trainTracking.trains.some(t => t.number === j.number && t.state === 'station') &&
      s.trainTracking.lines.some(t => t.number === j.number && t.direction === 'out' && t.edge === j.out) && s;
  }, 'utfart ' + j.out + ' lämnar Field och spårningen för ' + j.number, 45000);
  await rig.command('movement', { movementId: j.movement, departure: 'departed' });
  game.change(() => Object.assign(station.lines.find(l => l.id === j.connection), {
    state: 'free', from_station_id: null, to_station_id: null, train_number: null }));
  await rig.refresh();
}

test('stationernas manuella trafik, ortskopplingar och sparade lås fungerar i oberoende processer och stationspaket', { timeout: 240000 }, async () => {
  assert.ok(available.length, 'paketet måste innehålla minst en provstation');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tkl-station-traffic-')), rigs = [];
  fs.writeFileSync(path.join(base, 'local-fetch.mjs'), `const realFetch=globalThis.fetch; globalThis.fetch=(input,options)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw Error('Processprovet tillåter bara lokal HTTP: '+u.origin);return realFetch(input,options);};\n`);
  const game = await trafficGame(available);
  try {
    for (const id of available) rigs.push(await stationProcess(id, base));
    await Promise.all(rigs.map(async rig => {
      await rig.ready();
      const config = await rig.get('/api/config');
      assert.equal(config.station.id, rig.id); assert.ok(config.traffic);
      assert.equal((await rig.state()).trafficTrains.available, true, 'LocoNet ej ansluten kör trafikspelets tåg');
      assert.equal((await rig.request('/', undefined)).body.includes('<html'), true, 'panelen serveras');
      await rig.login(true);
      await rig.request('/api/studio', undefined, { token: '', expected: 401 });
      const studio = await rig.get('/api/studio'); assert.equal(studio.counts.routes, rig.id === 'trakvista' ? 57 : 340);
      const connected = await rig.post('trainmeet/connect', { origin: game.origin, code: 'test-code' });
      assert.equal(connected.stationId, cases[rig.id].stationId); assert.equal(connected.status, 'connected');
      const def = game.states.get(connected.stationId);
      if (rig.id === 'trakvista') {
        assert.deepEqual(config.traffic.edgeLines, { A: 'A', B: 'B', C: 'C' });
        assert.deepEqual(config.traffic.edgeBlocks, { A: 'SA2', B: 'SB2', C: 'SC2' });
        assert.deepEqual(config.traffic.incomingFields, {}, 'Träkvista får inga Charlottendal-minnen');
        for (const track of positionedTracks) assert.deepEqual(config.traffic.stationTracks[track.label.toLowerCase()], {
          label: track.label, button: track.button, block: track.block
        }, 'uttrycklig bindning för spår ' + track.label);
        const c = def.journeys.find(j => j.edge === 'C');
        game.change(() => Object.assign(def.lines.find(l => l.id === c.connection), {
          state: 'occupied', from_station_id: c.neighbor, to_station_id: def.stationId, train_number: c.number }));
        await rig.refresh();
        // Två verkliga trafikvarv: en hämtad linje utan sparad ortskoppling får inget påhittat tåg.
        for (let i = 0; i < 25; i++) {
          const [s, f] = await Promise.all([rig.state(), rig.field()]);
          assert.equal(s.blocks.SC2.occupied, false); assert.ok(!f.trains.some(t => t.number === c.number));
          await delay(100);
        }
      } else {
        assert.deepEqual(config.traffic.edgeLines, { Au: 'A', An: 'A', Cu: 'C', Cn: 'C', Bu: 'B', Bn: 'B', D: 'D' });
        assert.equal(config.traffic.edgeBlocks.Au, 'SU2A');
        assert.deepEqual((await rig.state()).destinations.entries.map(e => e.id), ['Cu', 'Cn', 'Au', 'An', 'Bu', 'Bn', 'D']);
      }
      for (const j of def.journeys) {
        await bind(rig, j.edge, j.neighbor);
        if (j.out !== j.edge) await bind(rig, j.out, j.neighbor);
        await manualJourney(rig, game, j);
      }
      if (rig.id === 'trakvista') {
        game.change(() => { for (const train of def.positioned) def.movements[train.id] = {
          revision: 1, arrival: 'none', departure: 'positioned', actualTrack: train.track_id
        }; });
        await rig.refresh();
        await rig.wait(async () => {
          const [s, f] = await Promise.all([rig.state(), rig.field()]);
          return def.positioned.every(p => f.trains.some(t => t.number === p.train_number && t.position === p.button && t.blocks[0] === p.block) &&
            s.trainTracking.trains.some(t => t.number === p.train_number && t.head === p.block)) && s;
        }, 'tidtabellsspåren I/II/III/IIIa/IIIc använder egna knappar och block');
        game.change(() => { for (const train of def.positioned) Object.assign(def.movements[train.id], { revision: 2, departure: 'departed' }); });
        await rig.refresh();
        await rig.wait(async () => (await rig.field()).trains.length === 0 && (await rig.state()).trainTracking.trains.length === 0,
          'avgångna uppställda tåg tas bort utan spöktåg', 25000);
      }
      await rig.post('note', { key: 'traffic-process', note: 'Bara ' + rig.id });
      const first = def.journeys[0];
      await rig.post('route', { from: 'htv' + first.edge, to: first.button });
      const locked = await rig.wait(async () => {
        const s = await rig.state(); return s.routes[0]?.state === 'active' && s.routes[0];
      }, 'tågväg med hållna växellås före omstart');
      assert.ok(Object.keys(locked.turnouts).length > 0);
      const savedDestinations = (await rig.state()).destinations;
      const pairCount = game.pairs.length;
      await rig.restart();
      const restored = await rig.wait(async () => {
        const s = await rig.state(); return s.connection === 'connected' && s.routes.some(r => r.id === locked.id && r.state === 'held') &&
          s.trainMeet.status === 'connected' && Object.values(s.blocks).every(b => b.occupied === false) && s;
      }, 'omstart återläser inställningar och håller tågvägen');
      assert.deepEqual(restored.destinations, savedDestinations); assert.equal(game.pairs.length, pairCount, 'parkopplingen återanvänds');
      assert.equal((await rig.get('/api/config')).notes['traffic-process'], 'Bara ' + rig.id);
      assert.deepEqual(restored.routes[0].turnouts, locked.turnouts);
      assert.ok(locked.signals.every(name => restored.signals[name].aspect === 'stop'), 'omstart återupptar inget körbesked');
      await rig.login();
      const turnout = Object.keys(locked.turnouts)[0];
      await rig.post('turnout', { name: turnout, position: locked.turnouts[turnout] === 'C' ? 'T' : 'C' }, { expected: 400 });
      await rig.post('cancel', { id: locked.id });
      await rig.wait(async () => (await rig.state()).routes.length === 0, 'kontrollerad frigivning efter omstart');
    }));
    if (rigs.length === 2) {
      for (const [own, other] of [[rigs[0], rigs[1]], [rigs[1], rigs[0]]]) {
        await own.request('/api/studio', undefined, { token: other.cookie, expected: 401 });
        assert.notEqual(own.dir, other.dir); assert.notEqual(own.port, other.port);
        const users = JSON.parse(fs.readFileSync(path.join(own.dir, 'users.json'), 'utf8'));
        assert.ok(JSON.stringify(users).includes('owner-' + own.id + '@example.invalid'));
        assert.ok(!JSON.stringify(users).includes('owner-' + other.id + '@example.invalid'));
      }
    }
    for (const rig of rigs) {
      const def = game.states.get(cases[rig.id].stationId);
      for (const j of def.journeys) {
        assert.ok(game.posts.some(p => p.path === '/v1/tkl/movement' && p.station_id === def.stationId &&
          p.movement_id === j.movement && p.arrival === 'arrived' && p.actual_track === j.trackId), 'ankomst anmäld för ' + j.number);
        assert.ok(game.posts.some(p => p.path === '/v1/tkl/clearance' && p.station_id === def.stationId &&
          p.connection_id === j.connection && p.action === 'arrive'), 'mottaget anmält på rätt linje');
      }
    }
  } finally {
    await Promise.all(rigs.map(rig => rig.close())); await game.close();
    fs.rmSync(base, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('Träkvistas automat följer tidtabellsspår I och verkliga A/B-klareringar genom hela processkedjan',
  { skip: !available.includes('trakvista'), timeout: 150000 }, async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tkl-automatic-traffic-'));
    fs.writeFileSync(path.join(base, 'local-fetch.mjs'), `const realFetch=globalThis.fetch; globalThis.fetch=(input,options)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw Error('Processprovet tillåter bara lokal HTTP: '+u.origin);return realFetch(input,options);};\n`);
    let rig, game;
    const witness = async command => {
      const phase = command.path === '/v1/tkl/movement' ? command.departure === 'departed' ? 'departed' : 'arrived' : command.action;
      const [s, f] = await Promise.all([rig.state(), rig.field()]);
      assert.equal(s.automation.enabled, true, 'automatik på vid ' + phase);
      const train = f.trains.find(t => t.number === '7301'), tracked = s.trainTracking.trains.find(t => t.number === '7301');
      if (phase === 'accept' || phase === 'depart') {
        const from = phase === 'accept' ? 'htvA' : 'htvI', to = phase === 'accept' ? 'htvI' : 'htvB';
        const route = s.routes.find(r => r.from === from && r.to === to);
        assert.ok(route && ['active', 'traversing'].includes(route.state) && !route.cancelRequested,
          phase + ' skickas först efter aktiv och återrapporterad tågväg ' + from + ' → ' + to);
        if (phase === 'accept') {
          assert.equal(train, undefined, 'inget tåg ställs ut innan grannen fått infarten godkänd');
          assert.equal(s.blocks.SA2.occupied, false);
        }
      } else if (['arrived', 'arrive', 'request'].includes(phase)) {
        assert.equal(s.routes.length, 0, phase + ': infarten ska vara upplöst');
        assert.equal(s.blocks.SI.occupied, true, phase + ': tåget ska stå på tidtabellsspår I');
        assert.equal(tracked?.head, 'SI'); assert.equal(tracked?.certain, true);
        assert.equal(train?.position, 'htvI'); assert.equal(train?.standing, true);
      } else if (phase === 'departed') {
        assert.equal(s.routes.length, 0, 'utfartens lås är frigivna före avgångsanmälan');
        assert.equal(train, undefined, 'tåget har lämnat Field före avgångsanmälan');
        assert.equal(tracked, undefined, 'spårningens eftersläpning är avslutad före avgångsanmälan');
      } else assert.fail('Oväntat steg i automatprovet: ' + phase);
      return { observed: { phase, routeStates: s.routes.map(r => ({ from: r.from, to: r.to, state: r.state })),
        trackOccupied: s.blocks.SI.occupied, fieldTrain: train ? { position: train.position, standing: train.standing } : null,
        trackedHead: tracked?.head || '' } };
    };
    try {
      game = await trafficGame(['trakvista'], { automatic: true, observe: witness });
      rig = await stationProcess('trakvista', base);
      await rig.ready(); await rig.login(true);
      const connected = await rig.post('trainmeet/connect', { origin: game.origin, code: 'test-code' });
      const def = game.states.get(cases.trakvista.stationId), train = def.automatic;
      assert.equal(connected.stationId, def.stationId);
      assert.deepEqual(connected.context.directions[train.movementId], { from: train.from.neighbor, to: train.to.neighbor },
        'riktningen kommer ur det enda tågets verkliga serviceföljd');
      assert.equal(connected.context.trains.length, 1, 'en entydig tidtabellsrad');
      assert.equal(connected.context.tracks.find(t => t.id === train.trackId)?.label, 'I');
      await bind(rig, 'A', train.from.neighbor); await bind(rig, 'B', train.to.neighbor);
      const initial = await rig.state();
      assert.equal(initial.trainMeet.context.lines.find(l => l.id === train.from.connection)?.state, 'requested');
      assert.equal(initial.routes.length, 0); assert.equal((await rig.field()).trains.length, 0);
      assert.equal((await rig.post('automation', { enabled: true })).enabled, true);
      const seen = new Set();
      const finished = await rig.wait(async () => {
        const [s, f] = await Promise.all([rig.state(), rig.field()]);
        const tracked = s.trainTracking.trains.find(t => t.number === train.number);
        if (tracked) seen.add(tracked.head);
        if (!s.automation.enabled) throw Error('Automaten lämnade över: ' + s.automation.last + '\n' + JSON.stringify({
          posts: game.posts, routes: s.routes, blocks: s.blocks, trains: f.trains,
          tracking: s.trainTracking.trains, events: s.operatingEvents.slice(-20)
        }));
        return game.posts.some(p => p.path === '/v1/tkl/movement' && p.departure === 'departed') &&
          s.routes.length === 0 && f.trains.length === 0 && s.trainTracking.trains.length === 0 &&
          Object.values(s.blocks).every(b => b.occupied === false) && s;
      }, 'automatens A → spår I → B inklusive verklig väntetid och avgångsanmälan', 120000);
      assert.equal(finished.automation.enabled, true, 'automaten kör vidare efter tågets passage');
      assert.ok(seen.has('SA2'), 'rätt inkommande yttre block observerades');
      assert.ok(seen.has('SI'), 'tåget stannade på det tidtabellsvalda spåret');
      assert.ok(seen.has('SB2'), 'tåget följdes till rätt utgående yttre block');
      assert.ok(finished.trainTracking.lines.some(t => t.number === train.number && t.direction === 'out' && t.edge === 'B'));
      assert.deepEqual(game.posts.map(p => p.observed.phase), ['accept', 'arrived', 'arrive', 'request', 'depart', 'departed'],
        'varje klarering och tåganmälan skickas en gång och i säker ordning');
      const [accepted, arrived, received, requested, departed, declared] = game.posts;
      assert.equal(accepted.connection_id, train.from.connection);
      assert.equal(arrived.movement_id, train.movementId); assert.equal(arrived.actual_track, train.trackId);
      assert.equal(arrived.arrival, 'arrived'); assert.equal(received.connection_id, train.from.connection);
      assert.equal(requested.connection_id, train.to.connection); assert.equal(requested.train_number, train.number);
      assert.equal(departed.connection_id, train.to.connection); assert.equal(declared.movement_id, train.movementId);
      assert.equal(declared.departure, 'departed');
      assert.equal(finished.trainMeet.context.movements.find(m => m.id === train.movementId)?.departure, 'departed');
      assert.equal(finished.trainMeet.context.lines.find(l => l.id === train.from.connection)?.state, 'free');
      assert.equal(finished.trainMeet.context.lines.find(l => l.id === train.to.connection)?.direction, 'out');
      assert.ok(finished.operatingEvents.some(e => e.kind === 'automation' && /A → Spår I/.test(e.message)),
        'automatens infart finns i driftjournalen');
      assert.ok(finished.operatingEvents.some(e => e.kind === 'automation' && /Spår I → B/.test(e.message)),
        'automatens utfart finns i driftjournalen');
    } finally {
      await rig?.close(); await game?.close();
      fs.rmSync(base, { recursive: true, force: true, maxRetries: 5 });
    }
  });
