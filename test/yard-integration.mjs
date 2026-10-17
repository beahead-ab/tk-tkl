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
test('the kernel owns the ranger\'s requests over HTTP: request, approve, lock, restart, return',{timeout:30000},async()=>{
  const [app,sim,wire]=await Promise.all([freePort(),freePort(),freePort()]);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cda-yard-'));
  const env={...process.env,CHARLOTTENDAL_PROFILE:'network',CHARLOTTENDAL_AUTH_MODE:'cloudflare',CHARLOTTENDAL_PUBLIC_ORIGIN:'',CHARLOTTENDAL_PORT:String(app),CHARLOTTENDAL_SIM_PORT:String(sim),CHARLOTTENDAL_WIRE_PORT:String(wire),CHARLOTTENDAL_STATE_DIR:dir};
  const children=[];let output='';
  const start=script=>{const c=spawn(process.execPath,[script],{cwd:root,env});children.push(c);c.stdout.on('data',d=>output+=d);c.stderr.on('data',d=>output+=d);return c;};
  const get=async()=>(await fetch(`http://127.0.0.1:${app}/api/state`)).json();
  const post=async(command,data={},expected=200)=>{const r=await fetch(`http://127.0.0.1:${app}/api/${command}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const v=await r.json();assert.equal(r.status,expected,JSON.stringify(v));return v;};
  const ready=()=>until(async()=>{const s=await get();return s.yard?.groups.find(g=>g.id==='right-11')?.can?.allowed&&s;});
  try{
    start('src/simulator.mjs');let backend=start('src/server.mjs');
    const initial=await ready();assert.equal(initial.yard.requests.length,0);assert.equal(initial.yard.groups.length,8);
    await post('ranger/request',{group:'nowhere'},400);
    const requested=(await post('ranger/request',{group:'right-11'})).state;
    const open=requested.yard.requests[0];assert.equal(open.state,'open');assert.equal(open.label,'Höger 11');
    await post('ranger/return',{id:'nowhere'},400);
    await post('ranger/answer',{id:open.id,approved:true});
    const laid=await until(async()=>{const s=await get();return s.turnouts.Vx131.position==='T'&&s.turnouts.Vx132.position==='T'&&s.yard.requests[0]?.state==='laid'&&s;});
    assert.match((await post('turnout',{name:'Vx131',position:'C'},400)).error,/Höger 11 ligger ute/);
    assert.match((await post('route',{from:'htvBu',to:'htvSpIIIA'},400)).error,/Höger 11 ligger ute/);
    // The HTTP panel is TKL: an operator field in the body gives it no ranger role, and TKL may open a boundary itself.
    await post('turnout',{name:'Vx112',position:'T',operator:'ranger'});
    for(const kind of ['ranger-request','ranger-approved'])assert.ok(laid.events.some(e=>e.kind===kind),kind);
    await stop(backend);backend=start('src/server.mjs');
    const restored=await until(async()=>{const s=await get();return s.connection==='connected'&&s.yard?.requests[0]?.state==='laid'&&Object.values(s.blocks).every(b=>b.occupied===false)&&s;});
    assert.equal(restored.yard.requests[0].id,laid.yard.requests[0].id);
    assert.equal(restored.bindingActivation.allowed,false);
    // MGP-korten upprepar inget (0.77.0): efter omstarten är gruppens växlar okända tills de får en order; låset ligger kvar.
    assert.equal((await get()).turnouts.Vx131.position,'unknown');
    await post('ranger/return',{id:open.id});
    await until(async()=>{const s=await get();return s.turnouts.Vx131.position==='C'&&s.turnouts.Vx132.position==='C'&&s.yard.requests.length===0;});
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'controls.json'))).yard.requests.length,0);
    assert.ok((await get()).events.some(e=>e.kind==='ranger-returned'),'the journal after restart has the return');
  }catch(e){e.message+='\n'+output;throw e;}finally{await Promise.all(children.map(stop));fs.rmSync(dir,{recursive:true,force:true});}
});
