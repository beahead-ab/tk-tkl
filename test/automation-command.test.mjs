// Aktuell kärna och spårning kontrolleras efter TrainMeets kö, även om operatören tagit över medan poll pågår.
import test from 'node:test';
import assert from 'node:assert/strict';
import { automationCommand } from '../src/automation-command.mjs';
import { TrainMeet } from '../src/trainmeet.mjs';
const copy=value=>structuredClone(value),rejected=e=>e.status===409;
function rig(){
  const a={enabled:true,generation:1},e={connected:true,storageFault:null,controls:{mode:'local',stopAll:false,emergency:null},blocks:{SI:{occupied:true}},routes:[]};
  const arrival={id:'arrival',from:'htvA',to:'htvI',state:'active',cancelRequested:false},departure={id:'departure',from:'htvI',to:'htvB',state:'active',cancelRequested:false,blocks:['path','edge']};
  e.profile={routes:[copy(departure)]};e.blocks.path={occupied:false};e.blocks.edge={occupied:false};
  let trains=[{id:'t1',number:'401',certain:true,state:'station',head:'SI',blocks:['SI']}];
  const tracker={view:()=>({trains:copy(trains)})},current={automation:a,engine:e,connection:{mode:'offline'}};
  const proof={trackBlock:'SI',arrival:{id:arrival.id,from:arrival.from,to:arrival.to},departure:{id:departure.id,from:departure.from,to:departure.to,blocks:copy(departure.blocks)}};
  const guard=data=>()=>automationCommand(current,a,e,tracker,data);
  return {a,e,current,arrival,departure,proof,guard,get trains(){return trains;},set trains(value){trains=value;}};
}
const data=(r,extra={})=>({trainNumber:'401',automationGeneration:r.a.generation,proof:copy(r.proof),...extra});
for(const [action,kind] of [['accept','arrival'],['depart','departure']]){
  test(`${action} kräver exakt aktiv tågväg, inklusive id, från, till och ingen återtagning`,()=>{
    for(const alter of [
      r=>{r.e.routes=[];},r=>{r.e.routes[0].id='annan';},r=>{r.e.routes[0].from='htvC';},r=>{r.e.routes[0].to='htvII';},
      r=>{r.e.routes[0].state='setting';},r=>{r.e.routes[0].state='held';},r=>{r.e.routes[0].cancelRequested=true;}
    ]){const r=rig();r.e.routes=[copy(r[kind])];alter(r);assert.throws(r.guard(data(r,{action})),rejected);}
    for(const state of ['active','traversing']){const r=rig();r.e.routes=[{...r[kind],state}];assert.doesNotThrow(r.guard(data(r,{action})));}
  });
}
test('byte av runtime, avstängd automat eller osäkert driftläge stoppar kommandot',()=>{
  for(const alter of [
    r=>{r.current.automation={enabled:true};},r=>{r.current.engine={...r.e};},r=>{r.a.enabled=false;},
    r=>{r.current.connection.mode='live';},r=>{r.e.connected=false;},r=>{r.e.storageFault='diskfel';},
    r=>{r.e.controls.stopAll=true;},r=>{r.e.controls.emergency={requestedAt:1};},r=>{r.e.controls.mode='remote';}
  ]){const r=rig();r.e.routes=[r.arrival];alter(r);assert.throws(r.guard(data(r,{action:'accept'})),rejected);}
});
for(const extra of [{action:'request'},{action:'arrive'},{arrival:'arrived'}]){
  test(`${extra.action||extra.arrival} kräver säkert identifierat tåg på belagt tidtabellsspår och upplöst infart`,()=>{
    for(const alter of [
      r=>{r.e.routes=[r.arrival];},r=>{r.trains=[];},r=>{r.trains[0].number='402';},r=>{r.trains[0].head='SII';},
      r=>{r.trains[0].certain=false;},r=>{r.trains[0].state='ghost';},r=>{r.e.blocks.SI.occupied=false;},r=>{r.e.blocks.SI.occupied=null;}
    ]){const r=rig();alter(r);assert.throws(r.guard(data(r,extra)),rejected);}
    const r=rig();assert.doesNotThrow(r.guard(data(r,extra)));
  });
}
test('departed kräver upplöst utfart och att tåget försvunnit även ur spårningens spökläge',()=>{
  for(const alter of [r=>{r.e.routes=[r.departure];r.trains=[];},r=>{},r=>{r.trains[0].state='ghost';}]){
    const r=rig();alter(r);assert.throws(r.guard(data(r,{departure:'departed'})),rejected);
  }
  const r=rig();r.trains=[];r.e.blocks.SI.occupied=false;assert.doesNotThrow(r.guard(data(r,{departure:'departed'})));
  for(const block of ['SI','path','edge'])for(const occupied of [true,null]){const r=rig();r.trains=[];r.e.blocks.SI.occupied=false;r.e.blocks[block].occupied=occupied;assert.throws(r.guard(data(r,{departure:'departed'})),rejected);}
});
test('ett kommando utan spårbevis stoppas',()=>{
  const r=rig();r.e.routes=[r.arrival];assert.throws(r.guard({trainNumber:'401',action:'accept'}),rejected);
});
function meetRig(runtime){
  const posts=[],now=100000;
  const stored={version:1,clientId:'tk-tkl',stationId:'tk',token:'TEST-TOKEN',origin:'https://trainmeet.example',pairings:{}};
  const service=new TrainMeet({storage:{load:()=>copy(stored),save(){}},origin:stored.origin,changeFeed:false,now:()=>now,
    fetcher:async(url,options)=>{posts.push({path:new URL(url).pathname,body:JSON.parse(options.body)});return new Response('{"ok":true}');}});
  service.status='connected';service.updatedAt=now;
  service.context={station:{id:'tk'},publicationId:'pub',day:'day',revision:7,movements:[],trains:[{id:'m401',train_number:'401',track_id:'i'}],
    lines:[{id:'line',neighborId:'neighbor',neighborName:'Granne',state:'requested',direction:'in',trainNumber:'401',actions:['accept','reject']}]};
  let release,started=false;const pending=new Promise(ok=>{release=ok;});
  // Endast pollens väntan ersätts här. TrainMeets verkliga exclusive-kö, validering och POST används.
  service.read=async()=>{if(!started){started=true;await pending;}return copy(service.context);};
  const view=service.view(),request={sessionId:view.sessionId,revision:view.revision,contextRevision:view.context.revision,
    contextIdentity:{stationId:'tk',publicationId:'pub',day:'day'},connectionId:'line',action:'accept',...data(runtime)};
  return {service,posts,request,release};
}
test('kärnvakten körs efter väntande poll och stoppar en infart som operatören återtagit i kön',async()=>{
  const r=rig();r.e.routes=[r.arrival];const m=meetRig(r),poll=m.service.refresh();let guarded=0;
  const sent=m.service.clearance(m.request,{guard:()=>{guarded++;r.guard(m.request)();}}),reject=assert.rejects(sent,rejected);
  assert.equal(guarded,0,'vakten får inte ha körts innan den väntande pollen');
  r.e.routes[0].cancelRequested=true;m.release();await poll;await reject;
  assert.equal(guarded,1);assert.deepEqual(m.posts,[],'inget klarerings-POST efter återtagen infart');
});
test('runtimebyte i kön stoppar även en fortfarande aktiv route från det gamla objektet',async()=>{
  const r=rig();r.e.routes=[r.arrival];const m=meetRig(r),poll=m.service.refresh();
  const sent=m.service.clearance(m.request,{guard:r.guard(m.request)}),reject=assert.rejects(sent,rejected);
  r.current.engine={...r.e};m.release();await poll;await reject;assert.deepEqual(m.posts,[]);
});
test('färsk infart med oförändrat driftläge får en klarering först efter pollen',async()=>{
  const r=rig();r.e.routes=[r.arrival];const m=meetRig(r),poll=m.service.refresh();let guarded=0;
  const sent=m.service.clearance(m.request,{guard:()=>{guarded++;r.guard(m.request)();}});
  assert.equal(guarded,0);assert.deepEqual(m.posts,[]);m.release();await poll;await sent;
  assert.equal(guarded,1);assert.deepEqual(m.posts,[{path:'/v1/tkl/clearance',body:{station_id:'tk',connection_id:'line',action:'accept',train_number:''}}]);
});
test('movement-vakten körs efter poll och stoppar ankomst om spårets läge blivit okänt i kön',async()=>{
  const r=rig(),m=meetRig(r),{action:_action,connectionId:_connection,...identity}=m.request;
  const movement={...identity,movementId:'m401',arrival:'arrived',actualTrack:'i'},poll=m.service.refresh();let guarded=0;
  const sent=m.service.movement(movement,{guard:()=>{guarded++;r.guard(movement)();}}),reject=assert.rejects(sent,rejected);
  assert.equal(guarded,0);r.e.blocks.SI.occupied=null;m.release();await poll;await reject;
  assert.equal(guarded,1);assert.deepEqual(m.posts,[]);
});
test('färsk movement-ankomst använder samma vakt och protokollets spår-id efter pollen',async()=>{
  const r=rig(),m=meetRig(r),{action:_action,connectionId:_connection,...identity}=m.request;
  const movement={...identity,movementId:'m401',arrival:'arrived',actualTrack:'i'},poll=m.service.refresh();let guarded=0;
  const sent=m.service.movement(movement,{guard:()=>{guarded++;r.guard(movement)();}});
  assert.equal(guarded,0);m.release();await poll;await sent;assert.equal(guarded,1);
  assert.deepEqual(m.posts,[{path:'/v1/tkl/movement',body:{station_id:'tk',movement_id:'m401',departure:'none',arrival:'arrived',event_type:'tkl_arrived',actual_track:'i'}}]);
});

test('av och på igen medan poll väntar återupptar inget gammalt automatkommando',async()=>{
  const r=rig();r.e.routes=[r.arrival];const m=meetRig(r),poll=m.service.refresh();
  const sent=m.service.clearance(m.request,{guard:r.guard(m.request)}),reject=assert.rejects(sent,rejected);
  r.a.enabled=false;r.a.generation++;r.a.enabled=true;r.a.generation++;
  m.release();await poll;await reject;assert.deepEqual(m.posts,[]);
});
