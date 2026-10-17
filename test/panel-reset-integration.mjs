import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function until(fn){const end=Date.now()+12000;while(Date.now()<end){try{const v=await fn();if(v)return v;}catch{}await new Promise(r=>setTimeout(r,80));}throw Error('Timed out');}
const stop=c=>c.exitCode===null&&c.signalCode===null?new Promise(r=>{c.once('exit',r);c.kill();}):Promise.resolve();
test('panel reset across real processes preserves occupied track and crossing warning; new clear routes remain usable',{timeout:30000},async()=>{
  const [app,sim,wire]=await Promise.all([freePort(),freePort(),freePort()]);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cda-panel-reset-'));
  const env={...process.env,CHARLOTTENDAL_PROFILE:'network',CHARLOTTENDAL_AUTH_MODE:'cloudflare',CHARLOTTENDAL_PUBLIC_ORIGIN:'',CHARLOTTENDAL_PORT:String(app),CHARLOTTENDAL_SIM_PORT:String(sim),CHARLOTTENDAL_WIRE_PORT:String(wire),CHARLOTTENDAL_STATE_DIR:dir};
  const children=[];let output='';
  const get=async p=>(await fetch(`http://127.0.0.1:${p}/api/state`)).json();
  const post=async(p,command,data={},expected=200)=>{const r=await fetch(`http://127.0.0.1:${p}/api/${command}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const v=await r.json();assert.equal(r.status,expected,JSON.stringify(v));return v;};
  try{
    for(const script of ['src/simulator.mjs','src/server.mjs']){const c=spawn(process.execPath,[script],{cwd:root,env});children.push(c);c.stdout.on('data',d=>output+=d);c.stderr.on('data',d=>output+=d);}
    await until(async()=>{const s=await get(app);return s.connection==='connected'&&Object.values(s.blocks).every(b=>b.occupied===false)&&s.panelIndications.V1.warning.value===false;});
    const from='htvCu',to='htvSpIA';await post(app,'route',{from,to});
    await until(async()=>(await get(app)).routes[0]?.state==='active');
    await post(sim,'block',{name:'S100',occupied:true});await until(async()=>(await get(app)).blocks.S100.occupied===true);
    await post(app,'panel-reset');
    const reset=await until(async()=>{const s=await get(app);return s.panelReset.phase==='complete'&&s;});
    assert.equal(reset.routes.length,0);assert.equal(reset.controls.stopAll,false);assert.equal(reset.blocks.S100.occupied,true);assert.equal(reset.panelIndications.V1.warning.value,true);
    assert.equal((await get(sim)).blocks.S100,true);assert.ok(Object.values(reset.signals).every(s=>s.desired==='STOP'&&s.aspect==='stop'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'routes.json'))).routes.length,0);
    assert.match((await post(app,'route',{from,to},400)).error,/belagt/);
    await post(sim,'block',{name:'S100',occupied:false});await until(async()=>(await get(app)).panelIndications.V1.warning.value===false);
    await post(app,'route',{from,to});await until(async()=>(await get(app)).routes[0]?.state==='active');
    await post(app,'panel-reset');await until(async()=>{const s=await get(app);return s.panelReset.phase==='complete'&&!s.routes.length&&!s.controls.stopAll;});
    assert.equal((await get(app)).panelIndications.V1.warning.value,false);
  }catch(e){e.message+='\n'+output;throw e;}finally{await Promise.all(children.map(stop));fs.rmSync(dir,{recursive:true,force:true});}
});
