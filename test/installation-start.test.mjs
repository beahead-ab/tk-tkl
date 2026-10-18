import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInstallation } from '../src/start-supervisor.mjs';

test('startövervakaren avslutar båda gamla processerna innan den valda stationen startas', { timeout: 15000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tkl-startprov-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, text) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
  write('profiles/charlottendal-network.json', '{}'); write('stations/trakvista/station.json', '{"title":"Träkvista"}'); write('stations/trakvista/profiles/network.json', '{}');
  const common = `const fs=require('node:fs'),p=require('node:path'),id=process.env.CHARLOTTENDAL_STATION;
    const log=x=>fs.appendFileSync('prov.ndjson',JSON.stringify({event:x,id,pid:process.pid})+'\\n');log('start');
    setInterval(()=>{},1000);`;
  write('src/simulator.mjs', `import {createRequire} from 'node:module';const require=createRequire(import.meta.url);${common}
    process.on('SIGTERM',()=>setTimeout(()=>{log('exit');process.exit(0)},150));`);
  write('src/server.mjs', `import {createRequire} from 'node:module';const require=createRequire(import.meta.url);${common}
    process.on('SIGTERM',()=>setTimeout(()=>{log('exit');process.exit(0)},50));
    if(id==='charlottendal')setTimeout(()=>{const file=process.env.TKL_INSTALLATION_CONFIG;fs.mkdirSync(p.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({version:1,stationId:'trakvista',requireTrainMeetConnect:true}));process.send({type:'tkl-station-change',stationId:'trakvista'});},200);
    else {const saved=JSON.parse(fs.readFileSync(process.env.TKL_INSTALLATION_CONFIG));if(!saved.requireTrainMeetConnect)process.exit(2);setTimeout(()=>{log('exit');process.exit(0)},200);}`);
  const code = await runInstallation({ root, env: {}, stdio: 'ignore', shutdownMs: 2000 }); assert.equal(code, 0);
  const events = fs.readFileSync(path.join(root, 'prov.ndjson'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.filter(event => event.event === 'start' && event.id === 'charlottendal').length, 2);
  assert.equal(events.filter(event => event.event === 'start' && event.id === 'trakvista').length, 2);
  const lastOldExit = events.findLastIndex(event => event.event === 'exit' && event.id === 'charlottendal');
  const firstNewStart = events.findIndex(event => event.event === 'start' && event.id === 'trakvista'); assert.ok(lastOldExit < firstNewStart);
  assert.equal(new Set(events.filter(event => event.event === 'start').map(event => event.pid)).size, 4);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.tkl-installation/station.json'))).stationId, 'trakvista');
});

test('en process som inte avslutar kontrollerat hindrar nästa station från att startas', { timeout: 15000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tkl-stopp-prov-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, text) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
  write('profiles/charlottendal-network.json', '{}'); write('stations/trakvista/station.json', '{"title":"Träkvista"}'); write('stations/trakvista/profiles/network.json', '{}');
  write('src/simulator.mjs', `import fs from 'node:fs';fs.appendFileSync('starter.txt',process.env.CHARLOTTENDAL_STATION+'\\n');process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`);
  write('src/server.mjs', `import fs from 'node:fs';import path from 'node:path';
    fs.appendFileSync('starter.txt',process.env.CHARLOTTENDAL_STATION+'\\n');setInterval(()=>{},1000);
    setTimeout(()=>{const file=process.env.TKL_INSTALLATION_CONFIG;fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({version:1,stationId:'trakvista',requireTrainMeetConnect:true}));process.send({type:'tkl-station-change',stationId:'trakvista'});},200);`);
  await assert.rejects(runInstallation({ root, env: {}, stdio: 'ignore', shutdownMs: 100 }), /Ingen annan station startas/);
  assert.equal(fs.readFileSync(path.join(root, 'starter.txt'), 'utf8').includes('trakvista'), false);
});
