import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInstallation } from '../src/start-supervisor.mjs';

for (const failing of ['server-exit-1', 'simulator-signal']) test('stationsbyte stoppas vid ' + failing, { timeout: 10000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tkl-felavslut-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, text) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
  write('profiles/charlottendal-network.json', '{}'); write('stations/trakvista/station.json', '{"title":"Träkvista"}'); write('stations/trakvista/profiles/network.json', '{}');
  const common = `import fs from 'node:fs';import path from 'node:path';fs.appendFileSync('starter.txt',process.env.CHARLOTTENDAL_STATION+'\\n');setInterval(()=>{},1000);`;
  write('src/simulator.mjs', common + (failing === 'simulator-signal' ? '' : `process.on('SIGTERM',()=>process.exit(0));`));
  write('src/server.mjs', common + `process.on('SIGTERM',()=>process.exit(${failing === 'server-exit-1' ? 1 : 0}));
    setTimeout(()=>{const file=process.env.TKL_INSTALLATION_CONFIG;fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({version:1,stationId:'trakvista',requireTrainMeetConnect:true}));process.send({type:'tkl-station-change',stationId:'trakvista'});},200);`);
  await assert.rejects(runInstallation({ root, env: {}, stdio: 'ignore', shutdownMs: 2000 }), /fel eller signal.*Ingen annan station startas/);
  const started = fs.readFileSync(path.join(root, 'starter.txt'), 'utf8').trim().split('\n');
  assert.deepEqual(started, ['charlottendal', 'charlottendal'], 'nästa stations processer får inte startas efter fel vid avslut');
});
