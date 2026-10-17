import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FrameReader, LineReader, decode } from '../src/protocol.mjs';
import { Field } from '../src/field.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
async function freePort() { const s = net.createServer(); await new Promise((ok, no) => { s.once('error', no); s.listen(0, '127.0.0.1', ok); }); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function until(fn, timeout = 20000) { const end = Date.now() + timeout; let error; while (Date.now() < end) { try { const result = await fn(); if (result) return result; } catch (e) { error = e; } await new Promise(r => setTimeout(r, 100)); } throw error || Error('Timed out waiting for state'); }

// Live och offline (0.78.0) genom riktiga processer: TKL och simulatorn som i installationen, och en virtuell LocoBuffer
// (pty, test/fixtures/pty-locobuffer.py) med en egen simulerad bana bakom som ekar varje telegram, som en LocoBuffer, och
// svarar som MGP-korten. TKL startar LocoBufferns gateway själv när läget byts till live.
test('stationen byter mellan offline (simulerad bana) och live (LocoNet via LocoBuffer) utan omstart', { timeout: 120000 }, async () => {
  const [httpPort, simPort, wirePort, busPort] = await Promise.all([freePort(), freePort(), freePort(), freePort()]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'charlottendal-live-'));
  const env = { ...process.env, CHARLOTTENDAL_PROFILE: 'network', CHARLOTTENDAL_CONNECTION_MODE: 'simulator', CHARLOTTENDAL_AUTH_MODE: 'cloudflare', CHARLOTTENDAL_PUBLIC_ORIGIN: '',
    CHARLOTTENDAL_PORT: String(httpPort), CHARLOTTENDAL_SIM_PORT: String(simPort), CHARLOTTENDAL_WIRE_PORT: String(wirePort), CHARLOTTENDAL_LOCOBUFFER_PORT: String(busPort), CHARLOTTENDAL_STATE_DIR: dir };
  let output = ''; const children = [];
  const launch = (file, args = [], options = {}) => { const child = spawn(file, args, { cwd: root, env, ...options }); children.push(child); child.stderr.on('data', d => output += d); return child; };
  const get = async () => (await fetch(`http://127.0.0.1:${httpPort}/api/state`)).json();
  const post = async (command, data, expected = 200) => { const r = await fetch(`http://127.0.0.1:${httpPort}/api/${command}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); const result = await r.json(); assert.equal(r.status, expected, JSON.stringify(result)); return result; };
  const ready = mode => until(async () => { const s = await get(); return s.connectionMode.mode === mode && s.connection === 'connected' && Object.values(s.blocks).every(b => b.occupied === false) && s; });
  // Den riktiga banan i provet: en pty som LocoBuffer, och bakom den en bana som ekar och svarar.
  const bus = []; let device = null, pty = null, tick = null;
  try {
    launch(process.execPath, ['src/simulator.mjs']); launch(process.execPath, ['src/server.mjs']);
    const offline = await ready('offline');
    assert.match(offline.connectionInfo.label, /^LocoNet ej ansluten/); assert.equal(offline.trafficTrains.available, true);
    assert.match((await post('connection/mode', { mode: 'live' }, 409)).error, /Ingen LocoBuffer/);

    pty = launch(process.env.PYTHON || 'python3', ['-u', 'test/fixtures/pty-locobuffer.py']);
    const field = new Field(JSON.parse(fs.readFileSync(new URL('../profiles/simulator-network.json', import.meta.url))));
    const write = bytes => pty.stdin.write(JSON.stringify({ bytes: Buffer.from(bytes).toString('base64') }) + '\n');
    field.on('frame', write); tick = setInterval(() => field.tick(), 50);
    const frames = new FrameReader(frame => { write(frame); bus.push(decode(frame)); field.accept(frame); });
    const lines = new LineReader(line => { const m = JSON.parse(line); if (m.device) device = m.device; if (m.bytes) frames.push(Buffer.from(m.bytes, 'base64')); }); pty.stdout.on('data', d => lines.push(d));
    await until(() => device);

    const saved = await post('connection/locobuffer', { device, baud: '57600', flow: 'none' });
    assert.equal(saved.locobuffer.device, device); assert.equal(saved.live.available, true);
    // En tågväg offline hindrar bytet: den gäller den simulerade banan.
    await post('route', { from: 'htvAu', to: 'htvSpIA' });
    assert.match((await post('connection/mode', { mode: 'live' }, 409)).error, /Återta alla tågvägar/);
    await post('route', { from: 'htvAu', to: 'htvSpIA', intent: 'cancel' });
    await until(async () => (await get()).routes.length === 0);

    await post('connection/mode', { mode: 'live' });
    const live = await ready('live');
    assert.match(live.connectionInfo.label, /^LocoNet ansluten via LocoBuffer/);
    assert.equal(live.connectionMode.gateway.state, 'running');
    assert.equal(live.trafficTrains.available, false, 'trafikspelets tåg kör TKL bara när LocoNet inte är ansluten');
    assert.equal(live.automation.available, false, 'automaten finns bara offline');
    assert.ok(bus.some(d => d.kind === 'interrogate'), 'TKL frågade av ingångarna på LocoNet');
    assert.ok(Object.values(live.signals).filter(s => !s.virtual).every(s => s.aspect === 'stop'), 'signalerna svarade på stopp');
    assert.ok(Object.values(live.turnouts).every(t => t.position === 'unknown'), 'växlarna är okända tills de får en order');
    assert.ok(live.events.some(e => /^LocoNet ansluten: TKL styr banan/.test(e.message)), 'bytet står i journalen');

    // En tågväg live går ut på LocoNet och etableras med banans återrapporter.
    const before = bus.length;
    await post('route', { from: 'htvAu', to: 'htvSpIA' });
    await until(async () => (await get()).routes[0]?.state === 'active');
    assert.ok(bus.slice(before).some(d => d.kind === 'order' && d.on && Object.values(field.profile.turnouts).some(t => t.address === d.address)), 'växelorder på LocoNet');
    await post('route', { from: 'htvAu', to: 'htvSpIA', intent: 'cancel' });
    await until(async () => (await get()).routes.length === 0);

    // Tillbaka till offline: simulatorn igen, gatewayen stoppad.
    await post('connection/mode', { mode: 'offline' });
    const back = await ready('offline');
    assert.equal(back.connectionMode.gateway.state, 'stopped'); assert.equal(back.trafficTrains.available, true);
    const quiet = bus.length; await new Promise(r => setTimeout(r, 1500));
    assert.equal(bus.length, quiet, 'offline går inget ut på LocoNet');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'connection.json'))).mode, 'offline');
  } catch (error) { error.message += '\n' + output.slice(-2000); throw error; }
  finally { clearInterval(tick); await Promise.all(children.map(c => new Promise(r => { if (c.exitCode !== null) return r(); c.once('exit', r); c.kill(); }))); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
});
