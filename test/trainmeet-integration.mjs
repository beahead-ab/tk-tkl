import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const cwd=fileURLToPath(new URL('..',import.meta.url));
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function until(fn){for(let i=0;i<150;i++){try{const r=await fn();if(r)return r;}catch{}await new Promise(r=>setTimeout(r,40));}throw Error('TrainMeet integration timed out');}
test('TKL process pairs and reads TrainMeet, keeps tokens private, survives restart and never sends field orders from timetable data',{timeout:20000},async()=>{
  let clientId,pairs=0,requests=[];const gateway=http.createServer(async(req,res)=>{requests.push(req.method+' '+req.url);res.setHeader('Content-Type','application/json');
    if(req.url==='/v1/pair'){let body='';for await(const c of req)body+=c;const data=JSON.parse(body);assert.equal(data.device_kind,'tkl_terminal');assert.equal(data.client_id,'cda-tkl-demo');assert.equal(data.display_name,'cda-tkl-demo');assert.equal(data.pairing_code,'TESTCODE');clientId=data.client_id;pairs++;return res.end(JSON.stringify({protocol_version:1,client_id:clientId,access_token:'integration-private-token'}));}
    if(req.headers.authorization!=='Bearer integration-private-token'){res.writeHead(401);return res.end('{}');}
    const common={protocol_version:1,publication_id:'pub1',active_day:'Dagl'};
    if(req.url==='/v1/tkl/context?station_id=cda')return res.end(JSON.stringify({...common,station:{id:'cda',name:'Charlottendal'},shift:{shift_id:'s0',operator_name:'Rig'},previous_shift:null,movements:{m1:{revision:1,arrival:'arrived',departure:'waiting',actualTrack:'track1'}},connection_states:[]}));
    if(req.url==='/v1/timetable?station_id=cda')return res.end(JSON.stringify({schema_version:3,publication_id:'pub1',active_day:'Dagl',stations:[{id:'cda'}],tracks:[{id:'track1',station_id:'cda',display_label:'1a'}],trains:[{id:'m1',station_id:'cda',train_number:'P123',track_id:'track1',arrival_time:'11:55',departure_time:'12:05',note:'Testtidtabell'}]}));
    if(req.url==='/v1/display')return res.end(JSON.stringify({...common,stations:[{id:'cda',name:'Charlottendal'},{id:'lek',name:'Lekby'}],revision:1,clock:{configured:true,time:'12:00:00',running:true,speed:4},trains:[{id:'m1',station_id:'cda',train_number:'P123',track:'1'}]}));
    res.writeHead(404);res.end('{}');});
  await new Promise(r=>gateway.listen(0,'127.0.0.1',r));const port=await freePort(),wire=await freePort(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'cda-trainmeet-'));let child,output='';
  const launch=()=>{child=spawn(process.execPath,['src/server.mjs'],{cwd,env:{...process.env,CHARLOTTENDAL_AUTH_MODE:'cloudflare',CHARLOTTENDAL_PUBLIC_ORIGIN:'',CHARLOTTENDAL_PORT:String(port),CHARLOTTENDAL_WIRE_PORT:String(wire),CHARLOTTENDAL_STATE_DIR:dir,CHARLOTTENDAL_TRAINMEET_ORIGIN:''}});child.stderr.on('data',c=>{output+=c;});};
  const state=async()=>(await fetch('http://127.0.0.1:'+port+'/api/state')).json();
  const stop=async()=>{const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;};
  try{launch();const initial=await until(state);assert.equal(initial.trainMeet.status,'unconfigured');assert.equal(initial.trainMeet.clientId,'cda-tkl');
    const configure=await fetch('http://127.0.0.1:'+port+'/api/trainmeet/configure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...initial.trainMeet,origin:'http://127.0.0.1:'+gateway.address().port,clientId:'cda-tkl-demo'})});assert.equal(configure.status,200);
    const configured=await configure.json();assert.equal(configured.status,'unpaired');assert.equal(requests.length,0);
    const response=await fetch('http://127.0.0.1:'+port+'/api/trainmeet/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...configured,stationId:'cda',code:'test-code'})});assert.equal(response.status,200);assert.ok(!(await response.text()).includes('integration-private-token'));
    let s=await state();assert.equal(s.trainMeet.context.trains[0].train_number,'P123');assert.equal(s.trainMeet.context.trains[0].departure_time,'12:05');assert.equal(s.trainMeet.context.tracks[0].label,'1a');assert.ok(requests.includes('GET /v1/timetable?station_id=cda'));assert.equal(s.routes.length,0);assert.ok(Object.values(s.blocks).every(b=>b.occupied===null));assert.equal(s.clock.authority,'local');
    const entry={...s.destinations.entries[0],source:'trainmeet',stationId:'lek',phone:'123'};
    const saved=await fetch('http://127.0.0.1:'+port+'/api/destinations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:s.destinations.revision,entry})});assert.equal(saved.status,200);
    assert.deepEqual((await state()).destinations.entries[0],entry);
    await stop();launch();s=await until(async()=>{const v=await state();return v.trainMeet.status==='connected'?v:null;});assert.equal(s.trainMeet.context.movements.length,1);assert.equal(s.trainMeet.clientId,'cda-tkl-demo');assert.equal(pairs,1);assert.equal(s.destinations.entries[0].phone,'123');assert.equal(s.destinations.entries[0].stationId,'lek');assert.ok(requests.filter(r=>r.startsWith('POST')).every(r=>r==='POST /v1/pair'));assert.equal(output,'');
    assert.equal(fs.statSync(path.join(dir,'trainmeet.json')).mode&0o777,0o600);
  }finally{if(child?.exitCode===null)await stop();await new Promise(r=>gateway.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});

test('TKL process drives clearances and movement declarations through TrainMeet and journals accepted steps',{timeout:20000},async()=>{
  const posts=[];let lineState={id:'cda-lek',state:'free',from_station_id:null,to_station_id:null,train_number:null};
  const gateway=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');let body='';for await(const c of req)body+=c;const data=body?JSON.parse(body):null;
    if(req.url==='/v1/pair')return res.end(JSON.stringify({protocol_version:1,client_id:data.client_id,access_token:'integration-private-token'}));
    if(req.headers.authorization!=='Bearer integration-private-token'){res.writeHead(401);return res.end('{}');}
    const common={protocol_version:1,publication_id:'pub1',active_day:'Dagl'};
    if(req.url==='/v1/tkl/context?station_id=cda')return res.end(JSON.stringify({...common,station:{id:'cda',name:'Charlottendal'},shift:null,previous_shift:null,movements:{},connection_states:[lineState]}));
    if(req.url==='/v1/timetable?station_id=cda')return res.end(JSON.stringify({schema_version:3,publication_id:'pub1',active_day:'Dagl',stations:[{id:'cda'}],tracks:[{id:'track1',station_id:'cda',display_label:'1a'}],trains:[{id:'m1',station_id:'cda',train_number:'3581',track_id:'track1',departure_time:'12:05'}]}));
    if(req.url==='/v1/display')return res.end(JSON.stringify({...common,stations:[{id:'cda',name:'Charlottendal'},{id:'lek',name:'Lekby'}],connections:[{id:'cda-lek',station_a_id:'cda',station_b_id:'lek',track_type:'double'}],revision:1,clock:{configured:true,time:'12:00:00',running:true,speed:4},trains:[{id:'m1',station_id:'cda',train_number:'3581',track:'1a',departure_time:'12:05'}]}));
    if(req.method==='POST'){posts.push({url:req.url,body:data});
      if(req.url==='/v1/tkl/clearance'){if(data.action==='request'&&lineState.state!=='free'){res.writeHead(409);return res.end(JSON.stringify({error:'tkl_clearance_action_rejected',message:'Sträckan är redan upptagen'}));}lineState={...lineState,state:data.action==='request'?'requested':lineState.state,from_station_id:'cda',to_station_id:'lek',train_number:data.train_number};return res.end(JSON.stringify({action:data.action,connection:lineState,revision:2}));}
      if(req.url==='/v1/tkl/movement')return res.end(JSON.stringify({movement:{}}));
    }
    res.writeHead(404);res.end('{}');});
  await new Promise(r=>gateway.listen(0,'127.0.0.1',r));const port=await freePort(),wire=await freePort(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'cda-trainmeet-'));
  const child=spawn(process.execPath,['src/server.mjs'],{cwd,env:{...process.env,CHARLOTTENDAL_AUTH_MODE:'cloudflare',CHARLOTTENDAL_PUBLIC_ORIGIN:'',CHARLOTTENDAL_PORT:String(port),CHARLOTTENDAL_WIRE_PORT:String(wire),CHARLOTTENDAL_STATE_DIR:dir,CHARLOTTENDAL_TRAINMEET_ORIGIN:''}});
  const state=async()=>(await fetch('http://127.0.0.1:'+port+'/api/state')).json();
  const call=async(name,payload)=>{const r=await fetch('http://127.0.0.1:'+port+'/api/trainmeet/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});return {status:r.status,body:await r.json()};};
  try{
    const initial=await until(state);
    const configured=(await call('configure',{...initial.trainMeet,origin:'http://127.0.0.1:'+gateway.address().port})).body;
    const paired=(await call('pair',{...configured,stationId:'cda',code:'test-code'})).body;
    assert.deepEqual(paired.context.lines.map(l=>[l.neighborName,l.state,l.actions]),[['Lekby','free',['request']]]);
    assert.equal((await call('launch',{})).status,404);
    for(const name of ['shift-start','operator-name'])assert.equal((await call(name,{})).status,404,'no shift commands remain: '+name);
    const requested=await call('clearance',{...paired,connectionId:'cda-lek',action:'request',trainNumber:'3581'});assert.equal(requested.status,200);
    assert.deepEqual(posts.at(-1),{url:'/v1/tkl/clearance',body:{station_id:'cda',connection_id:'cda-lek',action:'request',train_number:'3581'}});
    assert.deepEqual(requested.body.context.lines[0].actions,['cancel']);assert.equal(requested.body.context.lines[0].direction,'out');
    const refused=await call('clearance',{...requested.body,connectionId:'cda-lek',action:'request',trainNumber:'3581'});assert.equal(refused.status,409);assert.equal(refused.body.error,'Sträckan är redan upptagen');
    const moved=await call('movement',{...requested.body,movementId:'m1',departure:'positioned'});assert.equal(moved.status,200);
    assert.deepEqual(posts.at(-1),{url:'/v1/tkl/movement',body:{station_id:'cda',movement_id:'m1',departure:'positioned',arrival:'none',event_type:'tkl_positioned',actual_track:'track1'}});
    const s=await state();const journal=JSON.stringify(s.events??s.journal??[]);
    for(const text of ['Klarering begärd · tåg 3581 · Lekby','Tåg 3581: uppställt anmält'])assert.ok(journal.includes(text),'journal: '+text);
    assert.ok(posts.every(p=>!p.url.startsWith('/v1/tkl/shift')),'no traffic shift is started');
    assert.equal(s.routes.length,0);assert.ok(Object.values(s.blocks).every(b=>b.occupied===null),'no field state touched by clearances');
  }finally{const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;await new Promise(r=>gateway.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});

test('TKL reads the meet clock at once when TrainMeet\'s change feed says it changed',{timeout:20000},async()=>{
  let running=true,feed=null,feedAuth;
  const gateway=http.createServer(async(req,res)=>{
    if(req.url==='/v1/events'){feedAuth=req.headers.authorization;res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('retry: 2000\nevent: hello\ndata: {"boot":"b1","seq":1}\n\n');feed=res;return;}
    res.setHeader('Content-Type','application/json');
    if(req.url==='/v1/pair')return res.end(JSON.stringify({protocol_version:1,client_id:'cda-tkl',access_token:'clock-token'}));
    if(req.headers.authorization!=='Bearer clock-token'){res.writeHead(401);return res.end('{}');}
    const common={protocol_version:1,publication_id:'pub1',active_day:'Dagl'};
    if(req.url==='/v1/tkl/context?station_id=cda')return res.end(JSON.stringify({...common,station:{id:'cda',name:'Charlottendal'},shift:{shift_id:'s0',operator_name:'Rig'},previous_shift:null,movements:{},connection_states:[]}));
    if(req.url==='/v1/timetable?station_id=cda')return res.end(JSON.stringify({schema_version:3,publication_id:'pub1',active_day:'Dagl',stations:[{id:'cda'}],tracks:[],trains:[]}));
    if(req.url==='/v1/display')return res.end(JSON.stringify({...common,stations:[{id:'cda',name:'Charlottendal'}],revision:1,clock:{configured:true,time:'12:00:00',running,speed:4},trains:[],routes:[],connections:[]}));
    res.writeHead(404);res.end('{}');});
  await new Promise(r=>gateway.listen(0,'127.0.0.1',r));const port=await freePort(),wire=await freePort(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'cda-trainmeet-clock-'));let child,output='';
  const state=async()=>(await fetch('http://127.0.0.1:'+port+'/api/state')).json();
  try{
    child=spawn(process.execPath,['src/server.mjs'],{cwd,env:{...process.env,CHARLOTTENDAL_AUTH_MODE:'cloudflare',CHARLOTTENDAL_PUBLIC_ORIGIN:'',CHARLOTTENDAL_PORT:String(port),CHARLOTTENDAL_WIRE_PORT:String(wire),CHARLOTTENDAL_STATE_DIR:dir,CHARLOTTENDAL_TRAINMEET_ORIGIN:''}});child.stderr.on('data',c=>{output+=c;});
    const initial=await until(state);
    const configured=await (await fetch('http://127.0.0.1:'+port+'/api/trainmeet/configure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...initial.trainMeet,origin:'http://127.0.0.1:'+gateway.address().port,clientId:'cda-tkl'})})).json();
    const paired=await fetch('http://127.0.0.1:'+port+'/api/trainmeet/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...configured,stationId:'cda',code:'clock-code'})});assert.equal(paired.status,200,output);
    let s=await until(async()=>{const v=await state();return v.trainMeet.context?.clock?.running===true&&feed?v:null;});
    assert.ok(Number.isFinite(s.trainMeet.context.clock.readAt),'the reading is dated');
    assert.ok(Number.isFinite(s.trainMeet.clockAgeMs)&&s.trainMeet.clockAgeMs>=0&&s.trainMeet.clockAgeMs<6000,'and its age is sent');
    assert.equal(feedAuth,undefined,'the change feed never carries the key');
    // Let the five-second poll settle first, so only the feed can explain a quick read.
    await new Promise(r=>setTimeout(r,600));
    running=false;const stopped=Date.now();feed.write('event: change\ndata: {"seq":2,"topics":["clock"]}\n\n');
    s=await until(async()=>{const v=await state();return v.trainMeet.context?.clock?.running===false?v:null;});
    assert.ok(Date.now()-stopped<2000,'the stop reached TKL in '+(Date.now()-stopped)+' ms, well inside the 5 s poll');
  }finally{if(child?.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;}feed?.end();gateway.closeAllConnections?.();await new Promise(r=>gateway.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
