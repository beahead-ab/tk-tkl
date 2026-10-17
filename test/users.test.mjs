import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UserStore, usersFile, CODE_ALPHABET, checkUsername } from '../src/users.mjs';
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cda-users-'));

test('users.json: var filen ligger, formen på filen och läsrätten', () => {
  assert.equal(usersFile({ CHARLOTTENDAL_USERS_FILE: '/x/u.json' }, '/state'), '/x/u.json');
  assert.equal(usersFile({ CHARLOTTENDAL_AUTH_FILE: '/var/lib/charlottendal-auth/auth.json' }, '/state'), '/var/lib/charlottendal-auth/users.json');
  assert.equal(usersFile({}, '/state'), path.join('/state', 'users.json'));
  const dir = tempDir(), file = path.join(dir, 'users.json'), store = new UserStore(file);
  assert.equal(fs.statSync(file).mode & 0o777, 0o640); assert.deepEqual(store.summary(), { count: 0, hasOwner: false, users: [] });
  // Användarnamnet är e-postadressen, med små bokstäver; ett vanligt namn godtas inte längre när ett konto skapas.
  for (const bad of ['ab', 'casper', 'a b@x.se', 'casper@', '@winsnes.se', 'casper@winsnes', 'casper@@winsnes.se', 'x'.repeat(250) + '@a.se']) assert.throws(() => checkUsername(bad), /e-postadress/, bad);
  assert.equal(checkUsername(' Casper@Winsnes.SE '), 'casper@winsnes.se'); assert.equal(checkUsername('c.w+tkl@mail.example.se'), 'c.w+tkl@mail.example.se');
});

test('ägare, inbjudan med engångskod, inlösen, lösenordsbyte, sista ägaren och sessioner', async () => {
  let clock = 1_000_000; const store = new UserStore(path.join(tempDir(), 'users.json'), { now: () => clock });
  await assert.rejects(store.createOwner({ username: 'casper@example.se', password: 'kort' }), /6–128/);
  const owner = await store.createOwner({ username: 'casper@example.se', password: 'hemligt1' });
  assert.deepEqual([owner.role, owner.status, store.hasOwner()], ['owner', 'active', true]);
  await assert.rejects(store.createOwner({ username: 'x@example.se', password: 'hemligt1' }), /redan användare/);
  // Inbjudan: koden ur alfabetet utan 0/O/1/I, visas en gång, lagras som hash.
  const invited = store.invite({ username: 'benny@example.se', role: 'admin' });
  assert.match(invited.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/); assert.ok([...invited.code.replace('-', '')].every(c => CODE_ALPHABET.includes(c)));
  assert.equal(invited.expires, clock + 7 * 86400000); assert.equal(invited.user.status, 'invited');
  assert.ok(!fs.readFileSync(store.file, 'utf8').includes(invited.code.replace('-', '')), 'koden lagras inte i klartext');
  assert.throws(() => store.invite({ username: 'Benny@example.se' }), /finns redan/); assert.throws(() => store.invite({ username: 'eva@example.se', role: 'root' }), /ägare, administratör eller rangerare/);
  await assert.rejects(store.login({ username: 'benny@example.se', password: 'x' }), /Fel e-post eller lösenord/, 'inbjuden utan lösenord kan inte logga in');
  await assert.rejects(store.redeem({ username: 'benny@example.se', code: 'AAAA-AAAA', password: 'hemligt2' }), /Fel e-post eller kod/);
  const benny = await store.redeem({ username: 'BENNY@example.se', code: invited.code.toLowerCase().replace('-', ' '), password: 'hemligt2' });
  assert.deepEqual([benny.status, benny.role, benny.username], ['active', 'admin', 'benny@example.se']);
  await assert.rejects(store.redeem({ username: 'benny@example.se', code: invited.code, password: 'hemligt2' }), /Fel e-post eller kod/, 'koden gäller en gång');
  const late = store.invite({ username: 'eva@example.se', role: 'owner' }); clock += 8 * 86400000;
  await assert.rejects(store.redeem({ username: 'eva@example.se', code: late.code, password: 'hemligt3' }), /gått ut/);
  assert.equal(store.user(late.user.id).status, 'expired');
  const again = store.reissue(late.user.id); assert.notEqual(again.code, late.code); assert.equal(await store.redeem({ username: 'eva@example.se', code: again.code, password: 'hemligt3' }).then(u => u.status), 'active');
  // Inloggning och sessioner: token i cookien, hash i filen, 12 timmar.
  const me = await store.login({ username: 'Casper@example.se', password: 'hemligt1' }); assert.equal(me.id, owner.id);
  const issued = store.issueSession(me.id); assert.match(issued.token, /^[a-f0-9]{64}$/); assert.equal(issued.expires, clock + 12 * 3600000);
  assert.ok(!fs.readFileSync(store.file, 'utf8').includes(issued.token));
  assert.equal(store.session(issued.token).user.username, 'casper@example.se'); assert.equal(store.session('nope'), null);
  clock += 13 * 3600000; assert.equal(store.session(issued.token), null, 'sessionen går ut');
  const s2 = store.issueSession(me.id);
  await assert.rejects(store.changePassword(me.id, { currentPassword: 'fel', newPassword: 'hemligt9' }), /Fel lösenord/);
  await store.changePassword(me.id, { currentPassword: 'hemligt1', newPassword: 'hemligt9' }); assert.equal(store.session(s2.token), null, 'lösenordsbyte avslutar sessionerna');
  assert.equal((await store.login({ username: 'casper@example.se', password: 'hemligt9' })).id, me.id);
  // Ägare: den sista kan inte tas bort, ingen tar bort sig själv; en ny kod nollställer lösenordet.
  assert.throws(() => store.remove(me.id, { by: me.id }), /dig själv/);
  const eva = store.summary().users.find(u => u.username === 'eva@example.se'); store.remove(eva.id, { by: me.id });
  assert.throws(() => store.remove(me.id, { by: benny.id }), /sista ägaren/);
  store.reissue(benny.id); await assert.rejects(store.login({ username: 'benny@example.se', password: 'hemligt2' }), /Fel e-post/);
  assert.deepEqual(store.summary().users.map(u => [u.username, u.role, u.status]), [['casper@example.se', 'owner', 'active'], ['benny@example.se', 'admin', 'invited']]);
  assert.equal(store.recover('casper@example.se').user.username, 'casper@example.se'); assert.equal(store.hasOwner(), false, 'ägaren utan lösenord räknas inte förrän koden lösts in');
});

test('fem försök per minut, också över omstart; migrering av dagens auth.json till ägaren admin; skrivskyddad katalog', async () => {
  let clock = 5_000_000; const dir = tempDir(), file = path.join(dir, 'users.json');
  const store = new UserStore(file, { now: () => clock }); await store.createOwner({ username: 'casper@example.se', password: 'hemligt1' });
  for (let i = 0; i < 5; i++) await assert.rejects(store.login({ username: 'casper@example.se', password: 'fel' }), /Fel e-post/);
  await assert.rejects(store.login({ username: 'casper@example.se', password: 'hemligt1' }), /För många försök/);
  await assert.rejects(new UserStore(file, { now: () => clock }).login({ username: 'casper@example.se', password: 'hemligt1' }), /För många försök/);
  clock += 61000; assert.equal((await store.login({ username: 'casper@example.se', password: 'hemligt1' })).username, 'casper@example.se');
  // Webbdriftens auth.json (ett delat lösenord) blir ägaren admin första gången; filen rörs inte.
  const legacyDir = tempDir(), legacy = path.join(legacyDir, 'auth.json'), record = JSON.parse(fs.readFileSync(file, 'utf8')).users[0];
  fs.writeFileSync(legacy, JSON.stringify({ version: 1, salt: record.salt, hash: record.hash, mustChange: true, sessions: [{ id: 'x', expires: 9e15 }], attempts: [] }));
  const migrated = new UserStore(path.join(legacyDir, 'users.json'), { legacyFile: legacy });
  assert.equal(migrated.migrated, true); assert.deepEqual(migrated.summary().users.map(u => [u.username, u.role, u.mustChange]), [['admin', 'owner', true]]);
  assert.equal((await migrated.login({ username: 'admin', password: 'hemligt1' })).mustChange, true); assert.equal(migrated.read().sessions.length, 0);
  assert.ok(fs.existsSync(legacy));
  // Simulatorn i webbdriften får bara läsa: utan fil ser den inga användare och väntar på TKL.
  const ro = tempDir(); fs.chmodSync(ro, 0o500);
  if (process.getuid?.() !== 0) { const sim = new UserStore(path.join(ro, 'users.json')); assert.equal(sim.readonly, true); assert.equal(sim.hasOwner(), false); }
  fs.chmodSync(ro, 0o700);
});
