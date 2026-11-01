import test from 'node:test';
import assert from 'node:assert/strict';
import {TrainMeet,lineActions,CLEARANCE_ACTIONS} from '../src/trainmeet.mjs';
import {lineStatus,needsAttention} from '../public/clearance-text.js';

function rig(){
  let saved,now=100000;const calls=[],responses={};
  const storage={load:(n,d)=>structuredClone(saved??d),save:(n,d)=>{saved=structuredClone(d);}};
  const train={id:'m1',station_id:'cda',train_number:'3581',track:'3',arrival_time:'05:00',departure_time:'05:05'};
  const display={protocol_version:1,publication_id:'pub',active_day:'Dagl',revision:3,meet:{name:'Grimslöv 2027'},clock:{time:'08:43:27',speed:4,running:true,configured:true},
    stations:[{id:'cda',name:'Charlottendal'},{id:'lek',name:'Lekby'},{id:'vag',name:'Vagnsta'},{id:'x',name:'X'},{id:'y',name:'Y'}],
    connections:[{id:'cda-lek',station_a_id:'cda',station_b_id:'lek',track_type:'double'},{id:'vag-cda',station_a_id:'vag',station_b_id:'cda',track_type:'single'},{id:'x-y',station_a_id:'x',station_b_id:'y',track_type:'double'}],
    trains:[train,{id:'m2',station_id:'lek',train_number:'9'}]};
  const context={protocol_version:1,publication_id:'pub',active_day:'Dagl',station:{id:'cda',name:'Charlottendal'},movements:{},shift:null,previous_shift:null,
    connection_states:[{id:'cda-lek',state:'free',from_station_id:null,to_station_id:null,train_number:null},{id:'vag-cda',state:'requested',from_station_id:'vag',to_station_id:'cda',train_number:'3581'},{id:'x-y',state:'occupied',from_station_id:'x',to_station_id:'y',train_number:'1'}]};
  const timetable={schema_version:3,publication_id:'pub',active_day:'Dagl',stations:[{id:'cda',name:'Charlottendal'}],tracks:[{id:'t3',station_id:'cda',display_label:'3',operating_point_id:null}],trains:[{...train,track_id:'t3'}]};
  const fetcher=async(url,options={})=>{const path=new URL(url).pathname;calls.push({path,method:options.method||'GET',body:options.body?JSON.parse(options.body):null});
    if(responses[path]){const r=responses[path];return new Response(JSON.stringify(r.body),{status:r.status});}
    const data=path==='/v1/pair'?{protocol_version:1,client_id:'cda-tkl',access_token:'TOKEN'}:path==='/v1/tkl/context'?context:path==='/v1/timetable'?timetable:path==='/v1/display'?display:{ok:true};
    return new Response(JSON.stringify(data),{status:200});};
  const service=new TrainMeet({origin:'https://trainmeet.example',storage,fetcher,now:()=>now});
  const journal=[];service.on('journal',text=>journal.push(text));
  return {service,calls,context,display,responses,journal,storage,fetcher,now:n=>{now=n;},posts:()=>calls.filter(c=>c.method==='POST'&&c.path!=='/v1/pair')};
}
const pair=r=>r.service.pair({...r.service.view(),stationId:'cda',code:'458982'});

test('lines join the catalogue with live state: neighbour names, direction and the actions this station may take',async()=>{
  const r=rig();await pair(r);const lines=r.service.view().context.lines;
  assert.deepEqual(lines.map(l=>[l.id,l.neighborName,l.trackType,l.state,l.direction,l.trainNumber,l.actions]),[
    ['cda-lek','Lekby','double','free','','',['request']],
    ['vag-cda','Vagnsta','single','requested','in','3581',['accept','reject']]]);
  assert.equal(r.service.view().context.connections.length,3,'the raw state list is still exposed');
  assert.deepEqual(lines.map(l=>l.neighborMode),['',''],'an older server says nothing about the neighbours');
  r.context.station_modes={lek:'automatic',vag:'bogus'};await r.service.refresh();
  assert.deepEqual(r.service.view().context.lines.map(l=>l.neighborMode),['automatic',''],'TrainMeet says who answers; unknown values are dropped');
  delete r.context.station_modes;
  assert.equal(r.service.view().contract,'TrainMeet HTTP v1 · TKL-terminal');
  for(const [state,direction,expected] of [['free','',['request']],['requested','out',['cancel']],['requested','in',['accept','reject']],['reserved','out',['depart','cancel']],['reserved','in',[]],['occupied','in',['arrive']],['occupied','out',[]],['unknown','',[]]])assert.deepEqual(lineActions(state,direction),expected,state+'/'+direction);
  assert.deepEqual(CLEARANCE_ACTIONS,['request','accept','reject','cancel','depart','arrive']);
  // A line whose state the server no longer reports is shown as unknown, never as free.
  r.context.connection_states=r.context.connection_states.filter(c=>c.id!=='cda-lek');
  await r.service.refresh();assert.equal(r.service.view().context.lines[0].state,'unknown');assert.deepEqual(r.service.view().context.lines[0].actions,[]);
});

test('clearance steps are posted only for own lines, with no traffic shift; refusals keep the server wording and re-read the context',async()=>{
  const r=rig();await pair(r);
  await assert.rejects(()=>r.service.clearance({...r.service.view(),connectionId:'x-y',action:'arrive'}),/hör inte till stationen/);
  await assert.rejects(()=>r.service.clearance({...r.service.view(),connectionId:'cda-lek',action:'request',trainNumber:'P12'}),/tågnumret med siffror/);
  await assert.rejects(()=>r.service.clearance({...r.service.view(),connectionId:'cda-lek',action:'launch'}),/Okänd klareringsåtgärd/);
  await assert.rejects(()=>r.service.clearance({sessionId:'other',revision:0,connectionId:'cda-lek',action:'request',trainNumber:'3581'}),/ändrats/);
  assert.equal(r.posts().length,0);
  r.context.connection_states[1]={id:'vag-cda',state:'reserved',from_station_id:'vag',to_station_id:'cda',train_number:'3581'};
  const accepted=await r.service.clearance({...r.service.view(),connectionId:'vag-cda',action:'accept',trainNumber:''});
  assert.deepEqual(r.posts().at(-1),{path:'/v1/tkl/clearance',method:'POST',body:{station_id:'cda',connection_id:'vag-cda',action:'accept',train_number:''}});
  assert.equal(accepted.context.lines[1].state,'reserved');assert.deepEqual(accepted.context.lines[1].actions,[]);
  const before=r.calls.length;
  r.responses['/v1/tkl/clearance']={status:409,body:{error:'tkl_clearance_action_rejected',message:'Sträckan är redan upptagen'}};
  await assert.rejects(()=>r.service.clearance({...r.service.view(),connectionId:'cda-lek',action:'request',trainNumber:'3581'}),e=>e.message==='Sträckan är redan upptagen'&&e.status===409);
  assert.ok(r.calls.slice(before).some(c=>c.path==='/v1/tkl/context'),'the context is read back after a refusal');
  assert.equal(r.service.view().status,'connected');assert.equal(r.service.view().error,'');
  r.responses['/v1/tkl/clearance']={status:500,body:{message:'internal'}};
  await assert.rejects(()=>r.service.clearance({...r.service.view(),connectionId:'cda-lek',action:'request',trainNumber:'3581'}),/svarade med fel 500/);
  delete r.responses['/v1/tkl/clearance'];
  await r.service.clearance({...r.service.view(),connectionId:'cda-lek',action:'request',trainNumber:'3581'});
  assert.deepEqual(r.posts().at(-1).body,{station_id:'cda',connection_id:'cda-lek',action:'request',train_number:'3581'});
  assert.deepEqual(r.journal,['Klarering godkänd · tåg 3581 · Vagnsta.','Klarering begärd · tåg 3581 · Lekby.']);
  assert.ok(r.calls.every(c=>!c.path.startsWith('/v1/tkl/shift')),'a paired station is in service like an assigned box: no shift is started');
  // A server from before the shift-free contract says so plainly, not "start a shift".
  r.responses['/v1/tkl/clearance']={status:409,body:{error:'tkl_shift_not_started',message:'Starta trafikpasset innan en tågklarering hanteras'}};
  await assert.rejects(()=>r.service.clearance({...r.service.view(),connectionId:'cda-lek',action:'cancel'}),/för gammal: den kräver trafikpass/);
});

test('an action waits for a poll in flight instead of interleaving with it',async()=>{
  const r=rig();await pair(r);
  r.now(200000);const poll=r.service.refresh();
  assert.equal(r.service.view().busy,true);
  const action=r.service.clearance({...r.service.view(),connectionId:'vag-cda',action:'reject'});
  await poll;await action;
  const order=r.calls.map(c=>c.method+' '+c.path);
  assert.ok(order.lastIndexOf('GET /v1/tkl/context')>order.indexOf('POST /v1/tkl/clearance'),'context re-read after the action');
  assert.ok(order.indexOf('POST /v1/tkl/clearance')>order.indexOf('GET /v1/display'),'the poll finished first');
  assert.equal(r.service.view().busy,false);
});

test('Godkänn, Neka och tågrörelser skickar serverns aktuella träffgeneration',async()=>{
  for(const action of ['accept','reject','movement']){
    const r=rig();r.context.meet_generation=7;
    // Samma generationsvillkor som TrainMeet Servers runtime_command.
    const fetcher=async(url,options={})=>{
      const path=new URL(url).pathname;
      if(options.method==='POST'&&path!=='/v1/pair'){
        const body=JSON.parse(options.body);
        if(body.meet_generation!==r.context.meet_generation)return new Response(JSON.stringify({message:'Träffen eller configen har ändrats. Läs in arbetsytan igen innan du fortsätter.'}),{status:409});
        if(path==='/v1/tkl/clearance')r.context.connection_states[1].state=body.action==='accept'?'reserved':'free';
        else r.context.movements.m1={revision:1,departure:'positioned',arrival:'none'};
      }
      return r.fetcher(url,options);
    };
    const service=new TrainMeet({storage:r.storage,origin:'https://trainmeet.example',fetcher,changeFeed:false});
    await service.pair({...service.view(),stationId:'cda',code:'458982'});
    assert.equal(service.view().context.meetGeneration,7);
    const data={...service.view(),meetGeneration:7};
    const result=action==='movement'?await service.movement({...data,movementId:'m1',departure:'positioned'}):await service.clearance({...data,connectionId:'vag-cda',action});
    assert.equal(r.posts().at(-1).body.meet_generation,7);
    if(action==='movement')assert.equal(result.context.movements[0].departure,'positioned');
    else assert.equal(result.context.lines[1].state,action==='accept'?'reserved':'free');
    r.context.meet_generation=8;await service.refresh();
    const count=r.posts().length;
    await assert.rejects(()=>service.clearance({...service.view(),meetGeneration:7,connectionId:'vag-cda',action:'reject'}),/Träffen har ändrats/);
    assert.equal(r.posts().length,count,'gammalt knapptryck skickas inte i en ny generation');
  }
});

test('en väntande klarering följer inte med en poll till en ny träffgeneration',async()=>{
  const r=rig();r.context.meet_generation=1;await pair(r);
  r.context.meet_generation=2;
  const poll=r.service.refresh();
  const command=r.service.clearance({...r.service.view(),connectionId:'vag-cda',action:'reject'});
  await poll;
  await assert.rejects(()=>command,/Träffen har ändrats/);
  assert.equal(r.posts().length,0);
});

test('ogiltig träffgeneration godtas inte; äldre servrar utan generation fungerar',async()=>{
  for(const generation of ['7',-1,1.5,true]){
    const r=rig();r.context.meet_generation=generation;
    await assert.rejects(()=>pair(r),/Ogiltig träffgeneration/);
    assert.equal(r.posts().length,0);
  }
  for(const generation of [undefined,null,0]){
    const r=rig();r.context.meet_generation=generation;await pair(r);
    await r.service.clearance({...r.service.view(),connectionId:'vag-cda',action:'reject'});
    assert.equal(Object.hasOwn(r.posts().at(-1).body,'meet_generation'),generation===0);
  }
});

test('line wording follows state and direction; only incoming requests demand attention',()=>{
  const base={neighborName:'Lekby',trainNumber:'3581'};
  assert.equal(lineStatus({...base,state:'free',direction:''}),'Fri');
  assert.equal(lineStatus({...base,state:'requested',direction:'in'}),'Förfrågan från Lekby · tåg 3581');
  assert.equal(lineStatus({...base,state:'requested',direction:'out'}),'Begärd av oss · tåg 3581 mot Lekby');
  assert.equal(lineStatus({...base,state:'reserved',direction:'out'}),'Klart · tåg 3581 får avgå mot Lekby');
  assert.equal(lineStatus({...base,state:'occupied',direction:'in'}),'tåg 3581 på väg från Lekby · bekräfta mottaget vid ankomst');
  assert.equal(lineStatus({...base,state:'unknown',direction:''}),'Okänt läge');
  assert.equal(needsAttention({state:'requested',direction:'in'}),true);
  assert.equal(needsAttention({state:'requested',direction:'out'}),false);
  assert.equal(needsAttention({state:'occupied',direction:'in'}),false);
});

import {movementStatus,movementActions,movementDone} from '../public/clearance-text.js';
test('movement declarations send unchanged fields with their current values and follow the TMBox order',async()=>{
  const r=rig();await pair(r);
  await assert.rejects(()=>r.service.movement({...r.service.view(),movementId:'',departure:'positioned'}),/vilken tågrörelse/);
  await assert.rejects(()=>r.service.movement({...r.service.view(),movementId:'m1',departure:'flying'}),/Okänt avgångsläge/);
  await assert.rejects(()=>r.service.movement({...r.service.view(),movementId:'m1',arrival:'gone'}),/Okänt ankomstläge/);
  await assert.rejects(()=>r.service.movement({...r.service.view(),movementId:'m1'}),/Ingen ändring/);
  await assert.rejects(()=>r.service.movement({...r.service.view(),movementId:'m9',departure:'positioned'}),/finns inte på stationen/);
  assert.equal(r.posts().length,0);
  r.context.movements={m1:{revision:1,arrival:'approaching',departure:'none',actualTrack:'t3',crewReady:false,operatorNote:'Kort'}};
  await r.service.refresh();
  assert.deepEqual(r.service.view().context.movements,[{id:'m1',revision:1,arrival:'approaching',departure:'none',track:'t3',crewReady:false,note:'Kort'}]);
  await r.service.movement({...r.service.view(),movementId:'m1',departure:'positioned'});
  assert.deepEqual(r.posts().at(-1).body,{station_id:'cda',movement_id:'m1',departure:'positioned',arrival:'approaching',event_type:'tkl_positioned',actual_track:'t3'});
  await r.service.movement({...r.service.view(),movementId:'m1',arrival:'arrived',actualTrack:' 4 '});
  assert.deepEqual(r.posts().at(-1).body,{station_id:'cda',movement_id:'m1',departure:'none',arrival:'arrived',event_type:'tkl_arrived',actual_track:'4'});
  assert.deepEqual(r.journal,['Tåg 3581: uppställt anmält hos TrainMeet.','Tåg 3581: ankommit anmält hos TrainMeet.']);
  const stop={arrival_time:'05:00',departure_time:'05:05'},departureOnly={departure_time:'05:05'},arrivalOnly={arrival_time:'05:00'};
  // Not seen coming, the train can also be moved here at once (issue #115), after a question.
  assert.deepEqual(movementActions(undefined,stop).map(a=>a.label),['Närmar sig','Flytta hit']);
  assert.deepEqual(movementActions(undefined,{...stop,train_number:'3581'}).at(-1),{field:'arrival',value:'arrived',label:'Flytta hit',primary:false,confirm:'Flytta tåg 3581 hit? Avsändarens del räknas som gjord och sträckan blir fri.'});
  assert.deepEqual(movementActions(undefined,{...stop,train_number:'93'},true).map(a=>a.label),['Närmar sig'],'on its way on a line: no move');
  assert.deepEqual(movementActions({arrival:'approaching'},stop).map(a=>a.label),['Ankommit']);
  assert.deepEqual(movementActions({arrival:'arrived',departure:'none'},stop).map(a=>a.label),['Uppställt']);
  assert.deepEqual(movementActions({arrival:'arrived',departure:'positioned'},stop).map(a=>a.label),['Förare på plats']);
  assert.deepEqual(movementActions({arrival:'arrived',departure:'ready'},stop),[]);
  assert.deepEqual(movementActions(undefined,departureOnly).map(a=>a.label),['Uppställt']);
  assert.deepEqual(movementActions({arrival:'arrived'},arrivalOnly),[]);
  assert.equal(movementStatus({arrival:'arrived',departure:'ready'},stop),'Ankommit · Redo · begär klarering på sträckan');
  assert.equal(movementStatus(undefined,departureOnly),'Ej uppställt');
  assert.equal(movementDone({arrival:'arrived',departure:'departed'},stop),true);
  assert.equal(movementDone({arrival:'arrived'},stop),false);
  assert.equal(movementDone({arrival:'arrived'},arrivalOnly),true);
});

test('pairing, polling and disconnecting never start or finish a traffic shift',async()=>{
  const r=rig();await pair(r);
  for(const t of [150000,220000,300000])(r.now(t),await r.service.refresh());
  await r.service.disconnect(r.service.view());
  assert.equal(r.service.view().paired,false);assert.deepEqual(r.posts(),[],'nothing posted beyond the pairing');
  assert.ok(!('operatorName' in r.service.view())&&!('serviceError' in r.service.view()));
});
test('an older file with a shift operator name still loads, without the name',()=>{
  const legacy={version:1,clientId:'cda-tkl',stationId:'cda',token:'t',origin:'https://trainmeet.example',operatorName:'Anna',autoShift:{enabled:false,operatorName:'Casper'}};
  const service=new TrainMeet({storage:{load:()=>structuredClone(legacy),save(){}}});
  assert.equal(service.view().paired,true);assert.ok(!('autoShift' in service.data)&&!('operatorName' in service.data));
});

test('the station list comes from the public display without credentials and is validated',async()=>{
  const r=rig();
  const list=await r.service.stations();
  assert.deepEqual(list,{origin:'https://trainmeet.example',meet:'Grimslöv 2027',stations:[{id:'cda',name:'Charlottendal',code:''},{id:'lek',name:'Lekby',code:''},{id:'vag',name:'Vagnsta',code:''},{id:'x',name:'X',code:''},{id:'y',name:'Y',code:''}]});
  assert.ok(r.calls.every(c=>!c.body),'no pairing happened');assert.equal(r.calls.at(-1).path,'/v1/display');
  r.display.stations=[{id:'cda',name:{bad:true}}];await assert.rejects(()=>r.service.stations(),/stationslista/);
  const unconfigured=new TrainMeet({storage:{load:(n,d)=>structuredClone(d),save(){}}});await assert.rejects(()=>unconfigured.stations(),/inte angiven/);
});

test('what a poll shows to have happened becomes journal rows: announcement, arrival, departure',async()=>{
  const r=rig();await pair(r);r.journal.length=0;
  r.context.connection_states[0]={id:'cda-lek',state:'requested',from_station_id:'lek',to_station_id:'cda',train_number:'9'};
  await r.service.refresh();assert.deepEqual(r.journal,['Tåganmälan 9 från Lekby.']);
  r.context.connection_states[1]={id:'vag-cda',state:'free',from_station_id:null,to_station_id:null,train_number:null};
  await r.service.refresh();
  r.context.connection_states[1]={id:'vag-cda',state:'requested',from_station_id:'vag',to_station_id:'cda',train_number:'3581'};
  await r.service.refresh();assert.equal(r.journal.at(-1),'Tåganmälan 3581 från Vagnsta · väntad 05:00.');
  r.context.movements={m1:{revision:1,arrival:'arrived',departure:'none'}};
  await r.service.refresh();assert.equal(r.journal.at(-1),'Tåg 3581 ankommit spår 3.');
  r.context.movements={m1:{revision:2,arrival:'arrived',departure:'departed'}};
  await r.service.refresh();assert.equal(r.journal.at(-1),'Tåg 3581 avgått.');
  const count=r.journal.length;await r.service.refresh();assert.equal(r.journal.length,count);
});
