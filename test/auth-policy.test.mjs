import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { createAuth, isAdminRoute, UserAuth } from '../src/auth.mjs';
const root = fileURLToPath(new URL('../public', import.meta.url)), tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cda-auth-'));
// A writable so that staticFile can pipe the login page into it.
const fakeRes = () => { const r = new Writable({ write(chunk, _enc, cb) { r.body += chunk; cb(); } }); r.headers = {}; r.status = null; r.body = '';
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; }; r.writeHead = (s, h = {}) => { r.status = s; Object.assign(r.headers, Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]))); };
  const end = r.end.bind(r); r.end = (b = '') => { r.body += b; end(); }; return r; };
const req = (method, url, { cookie, origin, body } = {}) => { const headers = { host: '127.0.0.1:8910' }; if (cookie) headers.cookie = cookie; if (origin) headers.origin = origin; const r = { method, url, headers, [Symbol.asyncIterator]: async function* () { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); } }; return r; };
const call = async (auth, method, url, opts) => { const r = req(method, url, opts), res = fakeRes(), u = new URL(url, 'http://127.0.0.1:8910'); let error = null; let handled; try { handled = await auth.handle(r, res, u); } catch (e) { error = e; } return { handled, res, error, json: res.body ? JSON.parse(res.body) : null }; };

test('administrationen och operatörens vägar', () => {
  for (const p of ['/studio.html', '/api/studio', '/api/studio/measure/probe', '/api/ai', '/api/ai/test', '/api/users', '/api/users/invite', '/api/bindings/save', '/api/recordings/x/download', '/api/update/check', '/api/configuration/save', '/api/destinations', '/api/note', '/api/trainmeet/configure', '/api/streamdeck/save']) assert.ok(isAdminRoute(p), p + ' är administration');
  for (const p of ['/', '/index.html', '/api/state', '/api/events', '/api/config', '/api/route', '/api/all-stop', '/api/clock', '/api/trainmeet/movement', '/api/streamdeck/seen', '/api/train-information/follow', '/data/panel.json', '/api/aix', '/api/updates']) assert.ok(!isAdminRoute(p), p + ' är operatörens');
});

test('lokalt: allt öppet tills ägaren finns, därefter kräver administrationen inloggning och operatören ingen', async () => {
  const dir = tempDir(), auth = createAuth(root, true, {}, { stateDir: dir });
  assert.equal(auth.mode, 'local'); assert.ok(fs.existsSync(path.join(dir, 'users.json')));
  let r = await call(auth, 'GET', '/api/auth/session'); assert.deepEqual([r.json.mode, r.json.authenticated, r.json.setup], ['local', false, { needed: true, allowed: true }]);
  for (const url of ['/studio.html', '/api/studio', '/api/route']) { r = await call(auth, 'GET', url); assert.equal(r.handled, false, url + ' är öppen innan ägaren finns'); }
  r = await call(auth, 'POST', '/api/auth/login', { body: { username: 'casper@example.se', password: 'x' } }); assert.equal(r.error.status, 401);
  r = await call(auth, 'POST', '/api/auth/setup', { body: { username: 'casper@example.se', password: 'hemligt1', next: '/#advanced/ai' } });
  assert.equal(r.json.ok, true); assert.equal(r.json.next, '/#advanced/ai'); assert.match(r.res.headers['set-cookie'], /^cda_session=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200$/, 'lokal cookie utan Secure, så att http://127.0.0.1 fungerar');
  const cookie = r.res.headers['set-cookie'].split(';')[0];
  r = await call(auth, 'POST', '/api/auth/setup', { body: { username: 'x@example.se', password: 'hemligt1' } }); assert.equal(r.error.status, 409);
  // Nu krävs inloggning för administrationen; operatörens vägar är fortfarande öppna.
  r = await call(auth, 'GET', '/studio.html'); assert.equal(r.res.status, 303); assert.equal(r.res.headers.location, '/login?next=%2Fstudio.html');
  r = await call(auth, 'GET', '/api/studio'); assert.equal(r.error.status, 401);
  r = await call(auth, 'POST', '/api/ai/save'); assert.equal(r.error.status, 401);
  for (const url of ['/', '/api/state', '/api/config', '/data/panel.json']) { r = await call(auth, 'GET', url); assert.equal(r.handled, false, url); }
  r = await call(auth, 'POST', '/api/route'); assert.equal(r.handled, false); r = await call(auth, 'POST', '/api/streamdeck/seen'); assert.equal(r.handled, false);
  r = await call(auth, 'GET', '/api/studio', { cookie }); assert.equal(r.handled, false); r = await call(auth, 'GET', '/studio.html', { cookie }); assert.equal(r.handled, false);
  assert.equal(await auth.authenticate(req('GET', '/api/state')), null); await assert.rejects(auth.authenticate(req('GET', '/api/studio'), new URL('http://127.0.0.1:8910/api/studio')), /Logga in/);
  assert.equal(typeof await auth.authenticate(req('GET', '/api/studio', { cookie }), new URL('http://127.0.0.1:8910/api/studio')), 'number');
  r = await call(auth, 'GET', '/api/auth/session', { cookie }); assert.deepEqual([r.json.authenticated, r.json.user.username, r.json.user.role, r.json.setup.needed], [true, 'casper@example.se', 'owner', false]);
  // Ägaren bjuder in; administratören får se listan men inte ändra den.
  assert.equal(auth.requireRole(req('GET', '/api/users', { cookie }), 'owner').username, 'casper@example.se');
  const invited = auth.users.invite({ username: 'benny@example.se', role: 'admin' });
  r = await call(auth, 'POST', '/api/auth/redeem', { body: { username: 'benny@example.se', code: invited.code, password: 'hemligt2', next: '//evil' } }); assert.equal(r.json.user.role, 'admin'); assert.equal(r.json.next, '/');
  const bennyCookie = r.res.headers['set-cookie'].split(';')[0];
  assert.equal(auth.requireRole(req('GET', '/api/users', { cookie: bennyCookie }), 'admin').username, 'benny@example.se');
  assert.throws(() => auth.requireRole(req('POST', '/api/users/invite', { cookie: bennyCookie }), 'owner'), /Bara ägaren/);
  assert.throws(() => auth.requireRole(req('GET', '/api/users'), 'admin'), /Logga in/);
  r = await call(auth, 'POST', '/api/auth/logout', { cookie: bennyCookie }); assert.equal(r.json.ok, true); assert.match(r.res.headers['set-cookie'], /Max-Age=0/);
  r = await call(auth, 'GET', '/api/studio', { cookie: bennyCookie }); assert.equal(r.error.status, 401);
  r = await call(auth, 'GET', '/login'); assert.equal(r.handled, true); assert.equal(r.res.status, 200); await new Promise(resolve => setTimeout(resolve, 50)); assert.match(r.res.body, /Jag har en inbjudningskod/);
});

test('webbdriften kräver HTTPS, en separat användarfil och inloggning överallt; cloudflare-läget är oförändrat', async () => {
  const dir = tempDir();
  assert.throws(() => createAuth(root, true, { CHARLOTTENDAL_AUTH_MODE: 'password', CHARLOTTENDAL_PUBLIC_ORIGIN: 'http://x.test', CHARLOTTENDAL_AUTH_FILE: path.join(dir, 'auth.json') }), /HTTPS/);
  assert.throws(() => createAuth(root, true, { CHARLOTTENDAL_AUTH_MODE: 'password', CHARLOTTENDAL_PUBLIC_ORIGIN: 'https://x.test' }), /användarfil/);
  assert.throws(() => createAuth(root, true, { CHARLOTTENDAL_AUTH_MODE: 'other' }), /Okänt/);
  const auth = createAuth(root, true, { CHARLOTTENDAL_AUTH_MODE: 'password', CHARLOTTENDAL_PUBLIC_ORIGIN: 'https://cda-tkl.trainmeet.app', CHARLOTTENDAL_AUTH_FILE: path.join(dir, 'auth.json') });
  assert.ok(auth instanceof UserAuth); assert.equal(auth.mode, 'external'); assert.ok(fs.existsSync(path.join(dir, 'users.json')));
  let r = await call(auth, 'GET', '/'); assert.equal(r.res.status, 303); assert.equal(r.res.headers.location, '/login');
  r = await call(auth, 'GET', '/api/state'); assert.equal(r.error.status, 401);
  r = await call(auth, 'POST', '/api/auth/setup', { origin: 'https://cda-tkl.trainmeet.app', body: { username: 'casper@example.se', password: 'hemligt1' } }); assert.equal(r.error.status, 409, 'ägaren skapas på servern i webbdriften');
  r = await call(auth, 'GET', '/api/auth/session'); assert.deepEqual(r.json.setup, { needed: true, allowed: false });
  await auth.users.createOwner({ username: 'casper@example.se', password: 'hemligt1' });
  r = await call(auth, 'POST', '/api/auth/login', { body: { username: 'casper@example.se', password: 'hemligt1' } }); assert.equal(r.error.status, 403, 'POST utan rätt Origin');
  r = await call(auth, 'POST', '/api/auth/login', { origin: 'https://cda-tkl.trainmeet.app', body: { username: 'casper@example.se', password: 'hemligt1' } });
  assert.match(r.res.headers['set-cookie'], /^__Host-cda_session=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Strict/);
  const cookie = r.res.headers['set-cookie'].split(';')[0];
  r = await call(auth, 'GET', '/api/state', { cookie }); assert.equal(r.handled, false); r = await call(auth, 'GET', '/', { cookie }); assert.equal(r.handled, false);
  r = await call(auth, 'POST', '/api/route', { cookie }); assert.equal(r.error.status, 403); r = await call(auth, 'POST', '/api/route', { cookie, origin: 'https://cda-tkl.trainmeet.app' }); assert.equal(r.handled, false);
  const cf = createAuth(root, true, { CHARLOTTENDAL_AUTH_MODE: 'cloudflare', CHARLOTTENDAL_PUBLIC_ORIGIN: 'https://x.test', CHARLOTTENDAL_ACCESS_ISSUER: 'https://t.cloudflareaccess.com', CHARLOTTENDAL_ACCESS_AUD: 'a', CHARLOTTENDAL_ACCESS_EMAIL: 'o@x.test' });
  assert.equal(cf.mode, 'cloudflare'); assert.equal(await cf.handle(), false); assert.equal(cf.view().mode, 'cloudflare');
});
