import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ConnectionMode, listSerialDevices } from '../src/connection-mode.mjs';

// Live och offline (0.78.0): läget sparas i connection.json, live kräver en LocoBuffer, och TKL startar och stoppar
// LocoBufferns gateway själv.
const profile = { transport: { host: '127.0.0.1', port: 8912 } };
function memory(initial = {}) { const files = { ...initial }; return { files, load: (n, f) => n in files ? structuredClone(files[n]) : f, save: (n, v) => { files[n] = structuredClone(v); } }; }
function fakeSpawn() {
  const calls = [];
  const spawn = (cmd, args, options) => { const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.killed = false; child.kill = sig => { child.killed = sig; }; calls.push({ cmd, args, options, child }); return child; };
  return { spawn, calls };
}
const make = (over = {}) => { const s = fakeSpawn(), timers = []; return { s, timers, c: new ConnectionMode({ storage: memory(), env: { CHARLOTTENDAL_CONNECTION_MODE: 'simulator', CHARLOTTENDAL_WIRE_PORT: '8912' }, platform: 'linux', root: '/opt/cda-tkl/current', spawn: s.spawn, listDevices: () => [{ path: '/dev/ttyACM0', label: 'ttyACM0' }], setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {}, ...over }) }; };

test('utan val kör TKL offline mot simulatorn, och live kräver en LocoBuffer', () => {
  const { c } = make();
  assert.equal(c.mode, 'offline');
  assert.deepEqual(c.target(profile), { mode: 'simulator', host: '127.0.0.1', port: 8912, label: 'LocoNet ej ansluten · TKL svarar själv och kör trafikspelets tåg' });
  assert.match(c.liveReason(), /Ingen LocoBuffer/);
  assert.throws(() => c.switch('live'), /Ingen LocoBuffer/);
  assert.throws(() => c.switch('kanske'), /Okänt läge/);
  assert.equal(c.view().live.available, false); assert.equal(c.view().devices, undefined); assert.equal(c.view({ devices: true }).devices.length, 1);
});

test('LocoBuffern sparas och prövas; live startar gatewayen, offline stoppar den', () => {
  const { c, s } = make();
  assert.throws(() => c.setLocobuffer({ device: 'COM3', baud: '57600', flow: 'rtscts' }), /under \/dev/);
  assert.throws(() => c.setLocobuffer({ device: '/dev/../etc/passwd', baud: '57600', flow: 'rtscts' }), /under \/dev/);
  assert.throws(() => c.setLocobuffer({ device: '/dev/ttyACM0', baud: '1200', flow: 'rtscts' }), /hastighet/);
  assert.throws(() => c.setLocobuffer({ device: '/dev/ttyACM0', baud: '57600', flow: 'xon' }), /flödeskontroll/);
  c.setLocobuffer({ device: '/dev/serial/by-id/usb-RR-CirKits_LocoBuffer-USB-if00', baud: '57600', flow: 'rtscts' });
  assert.equal(c.storage.files['connection.json'].locobuffer.device, '/dev/serial/by-id/usb-RR-CirKits_LocoBuffer-USB-if00');
  assert.equal(s.calls.length, 0, 'offline startas ingen gateway');
  c.switch('live');
  assert.equal(c.mode, 'live'); assert.equal(c.storage.files['connection.json'].mode, 'live');
  assert.deepEqual(s.calls[0].args.slice(1), ['--device', '/dev/serial/by-id/usb-RR-CirKits_LocoBuffer-USB-if00', '--baud', '57600', '--flow', 'rtscts', '--port', '8913']);
  assert.match(s.calls[0].args[0], /scripts\/locobuffer-gateway\.mjs$/);
  assert.deepEqual(c.target(profile), { mode: 'hardware', host: '127.0.0.1', port: 8913, label: 'LocoNet ansluten via LocoBuffer (/dev/serial/by-id/usb-RR-CirKits_LocoBuffer-USB-if00)' });
  s.calls[0].child.stdout.emit('data', 'LocoNet-gateway: 127.0.0.1:8913\n'); assert.equal(c.view().gateway.state, 'running');
  assert.throws(() => c.setLocobuffer({ device: '', baud: '57600', flow: 'rtscts' }), /Koppla från LocoNet innan/);
  c.switch('offline');
  assert.equal(s.calls[0].child.killed, 'SIGTERM'); assert.equal(c.mode, 'offline'); assert.equal(c.view().gateway.state, 'stopped');
});

test('gatewayen som faller startas om, allt glesare, så länge läget är live', () => {
  const { c, s, timers } = make();
  c.setLocobuffer({ device: '/dev/ttyACM0', baud: '57600', flow: 'none' }); c.switch('live');
  s.calls[0].child.stderr.emit('data', 'No such file or directory: /dev/ttyACM0\n'); s.calls[0].child.emit('exit', 1);
  assert.equal(c.view().gateway.state, 'failed'); assert.match(c.view().gateway.error, /ttyACM0/);
  assert.equal(timers[0].ms, 2000); timers[0].fn(); assert.equal(s.calls.length, 2);
  s.calls[1].child.emit('exit', 1); assert.equal(timers[1].ms, 4000);
  timers[1].fn(); s.calls[2].child.emit('exit', 1); timers[2].fn(); s.calls[3].child.emit('exit', 1); timers[3].fn(); s.calls[4].child.emit('exit', 1);
  assert.equal(timers[4].ms, 15000, 'högst var 15:e sekund');
  // En ändrad LocoBuffer i live startar om gatewayen med de nya värdena.
  timers[4].fn(); c.setLocobuffer({ device: '/dev/ttyUSB0', baud: '57600', flow: 'none' });
  assert.equal(s.calls.at(-2).child.killed, 'SIGTERM'); assert.equal(s.calls.at(-1).args[2], '/dev/ttyUSB0');
});

test('valet består över omstart; live utan LocoBuffer faller tillbaka till offline', () => {
  const storage = memory({ 'connection.json': { schema: 1, mode: 'live', locobuffer: { device: '/dev/ttyACM0', baud: '57600', flow: 'rtscts' } } });
  const { s } = make(), c = new ConnectionMode({ storage, env: {}, platform: 'linux', root: '/x', spawn: s.spawn, listDevices: () => [] });
  assert.equal(c.mode, 'live'); c.start(); assert.equal(s.calls.length, 1, 'start() startar gatewayen när läget är live'); c.stop();
  const render = new ConnectionMode({ storage, env: { CHARLOTTENDAL_INSTALL_KIND: 'render' }, platform: 'linux', root: '/x', spawn: s.spawn, listDevices: () => [] });
  assert.equal(render.mode, 'offline'); assert.match(render.liveReason(), /Webbdriften/);
  const windows = new ConnectionMode({ storage, env: {}, platform: 'win32', root: '/x', spawn: s.spawn, listDevices: () => [] });
  assert.equal(windows.mode, 'offline'); assert.match(windows.liveReason(), /Windows/);
});

test('CHARLOTTENDAL_CONNECTION_MODE=hardware: fristående gateway, låst till live', () => {
  const { s } = make(), c = new ConnectionMode({ storage: memory(), env: { CHARLOTTENDAL_CONNECTION_MODE: 'hardware', CHARLOTTENDAL_WIRE_HOST: 'gateway.local', CHARLOTTENDAL_WIRE_PORT: '1234' }, platform: 'linux', root: '/x', spawn: s.spawn, listDevices: () => [] });
  assert.equal(c.mode, 'live'); assert.equal(c.locked, true);
  assert.deepEqual(c.target(profile), { mode: 'hardware', host: 'gateway.local', port: 1234, label: 'LocoNet ansluten via gateway gateway.local:1234' });
  assert.throws(() => c.switch('offline'), /fristående/); c.start(); assert.equal(s.calls.length, 0, 'TKL startar ingen egen gateway');
  assert.throws(() => new ConnectionMode({ storage: memory(), env: { CHARLOTTENDAL_CONNECTION_MODE: 'gissning' }, root: '/x' }), /Okänt anslutningsläge/);
});

test('USB-serieportarna listas med stabila namn först', () => {
  const dirs = { '/dev/serial/by-id': ['usb-RR-CirKits_LocoBuffer-USB-if00'], '/dev': ['tty', 'ttyACM0', 'ttyS0', 'ttyUSB1', 'cu.usbserial-A1', 'null'] };
  const list = listSerialDevices(d => { if (!dirs[d]) throw Error('ENOENT'); return dirs[d]; });
  assert.deepEqual(list.map(d => d.path), ['/dev/serial/by-id/usb-RR-CirKits_LocoBuffer-USB-if00', '/dev/cu.usbserial-A1', '/dev/ttyACM0', '/dev/ttyUSB1']);
});

// BTLocoBridge (0.83.0): Möllehems Bluetooth-kort som andra anslutning till samma LocoNet. Kortet paras i datorn;
// TKL ansluter till dess adress över RFCOMM, eller till den parade serieport systemet skapar åt det.
test('BTLocoBridge väljs som anslutning, prövas och startar gatewayen mot kortets adress', () => {
  const { c, s } = make();
  assert.equal(c.view().adapter, 'locobuffer');
  assert.throws(() => c.setAdapter({ adapter: 'btspp' }), /Okänd anslutning/);
  assert.throws(() => c.setAdapter({ adapter: 'btlocobridge', btlocobridge: { target: 'AA:BB:CC' } }), /AA:BB:CC:DD:EE:FF/);
  assert.throws(() => c.setAdapter({ adapter: 'btlocobridge', btlocobridge: { target: 'AA:BB:CC:DD:EE:FF', channel: 99 } }), /Kanalen är 1–30/);
  assert.match(c.liveReason(), /Ingen LocoBuffer/);
  c.setAdapter({ adapter: 'btlocobridge', btlocobridge: { target: 'aa:bb:cc:dd:ee:ff', channel: 1 } });
  assert.equal(c.view().adapter, 'btlocobridge');
  assert.equal(c.storage.files['connection.json'].btlocobridge.target, 'AA:BB:CC:DD:EE:FF', 'adressen sparas med versaler');
  assert.equal(c.storage.files['connection.json'].schema, 2);
  assert.equal(c.liveReason(), '');
  c.switch('live');
  assert.deepEqual(s.calls[0].args.slice(1), ['--adapter', 'btlocobridge', '--address', 'AA:BB:CC:DD:EE:FF', '--channel', '1', '--port', '8913']);
  assert.deepEqual(c.target(profile), { mode: 'hardware', host: '127.0.0.1', port: 8913, label: 'LocoNet ansluten via BTLocoBridge (AA:BB:CC:DD:EE:FF)' });
  assert.throws(() => c.setAdapter({ adapter: 'btlocobridge', btlocobridge: { target: '' } }), /Koppla från LocoNet innan BTLocoBridge/);
  // USB-inställningen ligger kvar bredvid och kan väljas igen utan att skrivas om.
  assert.equal(c.view().locobuffer.baud, '57600');
});

test('BTLocoBridge som parad serieport går över USB-vägen, och en adress kräver RFCOMM', () => {
  const { c, s } = make({ platform: 'darwin' });
  c.setAdapter({ adapter: 'btlocobridge', btlocobridge: { target: 'AA:BB:CC:DD:EE:FF' } });
  assert.match(c.liveReason(), /På Mac paras BTLocoBridge/);
  c.setAdapter({ adapter: 'btlocobridge', btlocobridge: { target: '/dev/cu.BTLocoBridge-SPP' } });
  assert.equal(c.liveReason(), '');
  c.switch('live');
  assert.deepEqual(s.calls[0].args.slice(1), ['--adapter', 'btlocobridge', '--address', '/dev/cu.BTLocoBridge-SPP', '--channel', '1', '--port', '8913']);
  assert.match(c.target(profile).label, /BTLocoBridge \(\/dev\/cu\.BTLocoBridge-SPP\)/);
});

test('en sparad fil från före BTLocoBridge läses som USB-anslutning', () => {
  const files = { 'connection.json': { schema: 1, mode: 'live', locobuffer: { device: '/dev/ttyACM0', baud: '57600', flow: 'rtscts' } } };
  const storage = { files, load: (n, f) => n in files ? structuredClone(files[n]) : f, save: (n, v) => { files[n] = structuredClone(v); } };
  const { c } = make({ storage });
  assert.equal(c.adapter, 'locobuffer');
  assert.equal(c.mode, 'live');
  assert.deepEqual(c.view().btlocobridge, { target: '', channel: 1 });
  c.setLocobuffer({ device: '/dev/ttyACM1', baud: '57600', flow: 'rtscts' });
  assert.equal(files['connection.json'].schema, 2, 'filen skrivs om till schema 2 först när något ändras');
});
