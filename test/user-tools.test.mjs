import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { UserStore } from '../src/users.mjs';

function installation(t, identity) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tkl-user-tools-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const file of ['scripts/create-owner.mjs', 'scripts/recover-user.mjs', 'src/users.mjs', 'src/station.mjs']) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.copyFileSync(new URL('../' + file, import.meta.url), path.join(dir, file));
  }
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  };
  write('packaging/identity.env', `TKL_STATION=${identity}\n`);
  write('profiles/charlottendal-network.json', '{}\n');
  write('stations/trakvista/station.json', '{"title":"Träkvista"}\n');
  write('stations/trakvista/profiles/network.json', '{}\n');
  return { dir, write };
}

const selections = [
  { title: 'Charlottendal väljs med miljövariabeln före paketets station', identity: 'trakvista', station: 'charlottendal', selected: 'charlottendal' },
  { title: 'Träkvista väljs med miljövariabeln', identity: 'charlottendal', station: 'trakvista', selected: 'trakvista' },
  { title: 'Charlottendal är paketets standardstation', identity: 'charlottendal', selected: 'charlottendal' },
  { title: 'Träkvista är paketets standardstation utan Charlottendals filer', identity: 'trakvista', selected: 'trakvista', packaged: true },
];
const overrides = ['state', 'auth', 'users'];
const cases = [
  ...selections,
  ...['charlottendal', 'trakvista'].flatMap(station => overrides.map(override => ({
    title: `${station}: ${override} går före stationens driftkatalog`, identity: station, selected: station, override,
  }))),
  ...overrides.map(override => ({
    title: `explicit ${override} fungerar med okänd station och saknade stationsprofiler`,
    identity: 'charlottendal', station: 'saknas', override, onlyOverride: true, noProfiles: true,
  })),
];

for (const scenario of cases) test(`användarverktygen: ${scenario.title}`, { timeout: 60000 }, async t => {
  const { dir, write } = installation(t, scenario.identity);
  if (scenario.packaged) fs.rmSync(path.join(dir, 'profiles'), { recursive: true });
  if (scenario.noProfiles) for (const directory of ['profiles', 'stations']) fs.rmSync(path.join(dir, directory), { recursive: true });
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CHARLOTTENDAL_')));
  if (scenario.station) env.CHARLOTTENDAL_STATION = scenario.station;
  const files = {
    charlottendal: path.join(dir, 'var/users.json'),
    trakvista: path.join(dir, 'var/trakvista/users.json'),
    state: path.join(dir, 'custom-state/users.json'),
    auth: path.join(dir, 'legacy-auth/users.json'),
    users: path.join(dir, 'custom-users/owners.json'),
  };
  if (scenario.override && (!scenario.onlyOverride || scenario.override === 'state')) env.CHARLOTTENDAL_STATE_DIR = path.join(dir, 'custom-state');
  if (['auth', 'users'].includes(scenario.override) && (!scenario.onlyOverride || scenario.override === 'auth')) env.CHARLOTTENDAL_AUTH_FILE = path.join(dir, 'legacy-auth/auth.json');
  if (scenario.override === 'users') env.CHARLOTTENDAL_USERS_FILE = files.users;
  const file = files[scenario.override || scenario.selected];
  // Tomma användarregister på de andra platserna får aldrig skrivas över, inte ens vid återställning.
  const untouched = Object.values(files).filter(candidate => candidate !== file);
  const sentinel = '{"version":2,"users":[],"sessions":[],"attempts":[]}\n';
  for (const candidate of untouched) write(path.relative(dir, candidate), sentinel);
  const run = (script, input) => {
    const result = spawnSync(process.execPath, [path.join(dir, 'scripts', script), 'owner@example.se'], {
      cwd: os.tmpdir(), env, encoding: 'utf8', input, timeout: 30000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  assert.ok(run('create-owner.mjs', 'hemligt1\n').includes(file));
  const store = new UserStore(file);
  const owner = await store.login({ username: 'owner@example.se', password: 'hemligt1' });
  assert.equal(owner.role, 'owner');
  const session = store.issueSession(owner.id);
  const recovery = run('recover-user.mjs');
  const code = /: ([A-Z2-9]{4}-[A-Z2-9]{4})\n/.exec(recovery)?.[1];
  assert.ok(code, recovery);
  assert.equal(store.session(session.token), null, 'återställningen avslutar den befintliga sessionen');
  await assert.rejects(store.login({ username: owner.username, password: 'hemligt1' }), /Fel e-post eller lösenord/);
  const redeemed = await store.redeem({ username: owner.username, code, password: 'hemligt2' });
  assert.equal(redeemed.id, owner.id, 'koden återställer samma ägare i rätt användarfil');
  for (const candidate of untouched) assert.equal(fs.readFileSync(candidate, 'utf8'), sentinel, candidate);
});
