import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {TrainAutomation,DWELL_MS,TRACK_ORDER} from '../src/train-automation.mjs';

const read=p=>JSON.parse(fs.readFileSync(new URL('../'+p,import.meta.url)));
const profile=read('stations/trakvista/profiles/network.json');
const traffic={edgeLines:{A:'A',B:'B',C:'C'},edgeBlocks:{A:'SA2',B:'SB2',C:'SC2'},stationTracks:{
  i:{button:'htvI',block:'SI',label:'I'},ii:{button:'htvII',block:'SII',label:'II'},iii:{button:'htvIII',block:'SIII',label:'III'},
  iiia:{button:'htvIIIA',block:'SIIIa',label:'IIIa'},iiic:{button:'htvIIIC',block:'SIIIc',label:'IIIc'}}};
const actions=(state,direction)=>state==='free'?['request']:state==='requested'?(direction==='in'?['accept','reject']:['cancel']):state==='reserved'&&direction==='out'?['depart','cancel']:state==='occupied'&&direction==='in'?['arrive']:[];
function rig({clearance,request,movement,deny}={}){
  let now=100000,serial=0;
  const requests=[],posts=[],declarations=[],log=[],state={connected:true,controls:{mode:'local'},blocks:Object.fromEntries(Object.keys(profile.blocks).map(b=>[b,{occupied:false}])),routes:[]};
  const edges={A:{stationId:'bilbo',incoming:true},B:{stationId:'cda',incoming:true},C:{stationId:'',incoming:true}};
  let meet={sessionId:'session',revision:3,status:'connected',stale:false,busy:false,context:{publicationId:'pub',day:'day',revision:7,station:{id:'tk'},
    tracks:[{id:'track-i',label:'I'},{id:'track-ii',label:'II'}],trains:[{id:'movement-401',train_number:'401',track_id:'track-i'}],movements:[],directions:{'movement-401':{from:'bilbo',to:'cda'}},
    lines:[{id:'tk-bilbo',neighborId:'bilbo',trainNumber:'401',state:'requested',direction:'in',actions:['accept','reject']},{id:'tk-cda',neighborId:'cda',trainNumber:'',state:'free',direction:'',actions:['request']}]}};
  const changeLine=(id,values)=>{const line=meet.context.lines.find(l=>l.id===id);Object.assign(line,values);line.actions=actions(line.state,line.direction);meet.context.revision++;};
  const automation=new TrainAutomation({profile,policy:'trainmeet',traffic,available:true,edgeBlock:traffic.edgeBlocks,now:()=>now,log:(kind,message)=>log.push(message),
    request:(from,to)=>{requests.push([from,to]);if(request)return request(from,to);const route=profile.routes.find(r=>r.kind==='main'&&r.from===from&&r.to===to);assert.ok(route,'tågvägen finns i den verkliga Träkvistaprofilen');const laid={...structuredClone(route),id:'route-'+(++serial),state:'setting'};state.routes.push(laid);return laid;},
    clearance:async data=>{posts.push(data);if(data.action===deny)throw Error('Nekat steg: '+deny);if(clearance)return clearance(data);const answer=structuredClone(meet),line=answer.context.lines.find(l=>l.id===data.connectionId);
      assert.equal(data.sessionId,meet.sessionId);assert.equal(data.revision,meet.revision);assert.equal(data.contextRevision,meet.context.revision);
      if(data.action==='accept')Object.assign(line,{state:'reserved',direction:'in',trainNumber:data.trainNumber});
      if(data.action==='request')Object.assign(line,{state:'requested',direction:'out',trainNumber:data.trainNumber});
      if(data.action==='depart')Object.assign(line,{state:'occupied',direction:'out',trainNumber:data.trainNumber});
      if(data.action==='arrive')Object.assign(line,{state:'free',direction:'',trainNumber:''});
      line.actions=actions(line.state,line.direction);answer.context.revision++;meet=answer;return answer;
    },movement:async data=>{
      declarations.push(data);if((data.arrival||data.departure)===deny)throw Error('Nekat steg: '+deny);if(movement)return movement(data);
      assert.equal(data.contextRevision,meet.context.revision);
      const answer=structuredClone(meet);let record=answer.context.movements.find(m=>m.id===data.movementId);
      if(!record){record={id:data.movementId,revision:0};answer.context.movements.push(record);}
      if(data.arrival)Object.assign(record,{arrival:data.arrival,track:data.actualTrack});
      if(data.departure)record.departure=data.departure;
      record.revision++;answer.context.revision++;meet=answer;return answer;
    }});
  const tick=async(trains=[])=>{await automation.tick({state,trains,meet,edges,outgoing:{A:'A',B:'B',C:'C'}});};
  const advance=ms=>{now+=ms;};
  const train=(number='401',head='SI')=>({id:'train-'+number,number,certain:true,state:'station',head,blocks:[head],movedAt:now-DWELL_MS-3000});
  return {automation,state,edges,requests,posts,declarations,log,tick,advance,train,changeLine,get meet(){return meet;},set meet(value){meet=value;}};
}

test('Träkvista lägger exakt tidtabellsspår på enkelspår och accepterar först en aktiv infart',async()=>{
  const r=rig();r.automation.set(true);
  await r.tick();assert.deepEqual(r.requests,[['htvA','htvI']]);assert.equal(r.posts.length,0);
  for(let i=0;i<3;i++){r.advance(3000);await r.tick();}
  assert.equal(r.requests.length,1);assert.equal(r.posts.length,0,'setting är inte aktiv infart');
  r.state.routes[0].state='active';await r.tick();
  assert.deepEqual(r.posts.map(p=>[p.connectionId,p.action,p.trainNumber]),[['tk-bilbo','accept','401']]);
  for(let i=0;i<3;i++)await r.tick();assert.equal(r.posts.length,1,'ingen dubbelklarering trots nya tickar');
  assert.equal(r.automation.enabled,true);
});

test('Träkvista tar emot, begär nästa verkliga granne, inväntar klarering och anmäler först aktiv utfart',async()=>{
  const r=rig();r.automation.set(true);await r.tick();r.state.routes[0].state='active';await r.tick();
  r.changeLine('tk-bilbo',{state:'occupied',direction:'in',trainNumber:'401'});r.state.routes=[];r.advance(4000);
  const train=r.train();r.state.blocks.SI.occupied=true;
  await r.tick([train]);assert.equal(r.declarations.at(-1).arrival,'arrived');assert.equal(r.declarations.at(-1).actualTrack,'track-i');assert.equal(r.posts.at(-1).action,'accept','ankomst bekräftas före mottaget');
  await r.tick([train]);assert.equal(r.posts.at(-1).action,'arrive');
  await r.tick([train]);assert.equal(r.posts.at(-1).action,'request');assert.equal(r.posts.at(-1).connectionId,'tk-cda');
  for(let i=0;i<3;i++){r.advance(3000);await r.tick([train]);}
  assert.equal(r.requests.length,1,'ingen utfart före beviljad klarering');assert.equal(r.posts.filter(p=>p.action==='request').length,1);
  r.changeLine('tk-cda',{state:'reserved',direction:'out',trainNumber:'401'});await r.tick([train]);
  assert.deepEqual(r.requests.at(-1),['htvI','htvB']);assert.equal(r.posts.filter(p=>p.action==='depart').length,0);
  r.state.routes[0].state='active';await r.tick([train]);assert.equal(r.posts.at(-1).action,'depart');
  for(let i=0;i<3;i++)await r.tick([train]);assert.equal(r.posts.filter(p=>p.action==='depart').length,1);assert.equal(r.declarations.filter(d=>d.departure).length,0,'avgång anmäls först efter fysisk utfart');
  r.state.routes=[];r.state.blocks.SI.occupied=false;await r.tick([]);assert.equal(r.declarations.at(-1).departure,'departed');await r.tick([]);assert.equal(r.declarations.filter(d=>d.departure).length,1);assert.equal(r.automation.enabled,true);
});

test('tidtabellsspåret väljs även när Charlottendals prioritering skulle valt annat',async()=>{
  const r=rig();r.meet.context.trains[0].track_id='track-ii';r.automation.set(true);await r.tick();
  assert.deepEqual(r.requests,[['htvA','htvII']]);assert.equal(r.automation.enabled,true);
  assert.deepEqual(TRACK_ORDER.east.slice(0,3),['htvSpIB','htvSpIC','htvSpIA'],'Charlottendals ordning är orörd');
});

test('mötande tåg får olika tidtabellsspår och väntar tills föregående infart lösts',async()=>{
  const r=rig();r.meet.context.trains.push({id:'movement-402',train_number:'402',track_id:'track-ii'});r.meet.context.directions['movement-402']={from:'cda',to:'bilbo'};
  r.changeLine('tk-cda',{state:'requested',direction:'in',trainNumber:'402'});r.automation.set(true);await r.tick();
  r.state.routes[0].state='active';await r.tick();r.advance(3000);await r.tick();assert.equal(r.requests.length,1,'mötande tåg väntar på pågående infart');
  r.changeLine('tk-bilbo',{state:'occupied',direction:'in',trainNumber:'401'});r.state.routes=[];r.state.blocks.SI.occupied=true;
  for(let i=0;i<3;i++)await r.tick([r.train()]);assert.deepEqual(r.requests.at(-1),['htvB','htvII']);
  r.state.routes[0].state='active';await r.tick([r.train()]);assert.equal(r.posts.filter(p=>p.action==='accept').length,2);assert.equal(r.automation.enabled,true);
});

for(const occupied of [true,null])test(`belagt eller okänt tidtabellsspår (${occupied}) ger överlämning utan alternativspår`,async()=>{
  const r=rig();r.state.blocks.SI.occupied=occupied;r.automation.set(true);await r.tick();
  assert.equal(r.automation.enabled,false);assert.equal(r.requests.length,0);assert.equal(r.posts.length,0);assert.match(r.log.at(-1),/Tidtabellsspåret är belagt eller okänt/);
});

test('saknat, tvetydigt eller gammalt TrainMeet-underlag ger ingen påhittad granne eller väg',async()=>{
  const cases=[r=>r.meet.stale=true,r=>delete r.meet.context.directions['movement-401'],r=>r.edges.B.stationId='',r=>r.meet.context.trains.push({...r.meet.context.trains[0],id:'extra'}),r=>r.meet.context.trains[0].track_id='saknas'];
  for(const alter of cases){const r=rig();alter(r);r.automation.set(true);await r.tick();assert.equal(r.automation.enabled,false);assert.equal(r.requests.length,0);assert.equal(r.posts.length,0);}
});

test('kärnans avslag och asynkront TrainMeet-avslag lämnar över utan omförsök',async()=>{
  const core=rig({request:()=>{throw Error('Växel är låst i motsatt läge.');}});core.automation.set(true);await core.tick();
  assert.equal(core.automation.enabled,false);assert.match(core.log.at(-1),/Växel är låst/);assert.equal(core.posts.length,0);
  const remote=rig({clearance:async()=>{throw Error('TrainMeet avslog gammal revision.');}});remote.automation.set(true);await remote.tick();remote.state.routes[0].state='active';
  await remote.tick();assert.equal(remote.automation.enabled,false);assert.match(remote.log.at(-1),/avslog gammal revision/);await remote.tick();assert.equal(remote.posts.length,1);
});

test('samtidiga tickar dubblerar inte en pågående klarering',async()=>{
  let release;const wait=new Promise(resolve=>{release=resolve;});
  const r=rig({clearance:async()=>{await wait;throw Error('Förlorat svar.');}});r.automation.set(true);await r.tick();r.state.routes[0].state='active';
  const first=r.tick();await r.tick();await r.tick();assert.equal(r.posts.length,1);release();await first;assert.equal(r.automation.enabled,false);
});

test('ändrad revision, återtagen infart eller omstart lämnas till operatören',async()=>{
  const stale=rig();stale.automation.set(true);await stale.tick();stale.meet.context.revision--;await stale.tick();assert.equal(stale.automation.enabled,false);assert.equal(stale.posts.length,0);
  const cancelled=rig();cancelled.automation.set(true);await cancelled.tick();cancelled.state.routes[0].state='active';await cancelled.tick();cancelled.state.routes=[];await cancelled.tick();assert.equal(cancelled.automation.enabled,false);assert.match(cancelled.log.at(-1),/Infarten försvann/);
  const restart=rig();restart.changeLine('tk-bilbo',{state:'free',direction:'',trainNumber:''});assert.equal(restart.automation.enabled,false,'ny automat startar avstängd');restart.automation.set(true);await restart.tick([restart.train()]);assert.equal(restart.automation.enabled,false);assert.match(restart.log.at(-1),/efter omstart/);assert.equal(restart.requests.length,0);
  restart.automation.set(true);await restart.tick([restart.train()]);assert.equal(restart.automation.enabled,false,'påslag igen ersätter inte en följd infart');assert.equal(restart.posts.length,0);
});

test('normal upplösning inväntas utan anmälan, men återtagning utan fullständigt passagebevis lämnas över',async()=>{
  for(const phase of ['arrival','departure'])for(const fault of ['', 'manual', 'passage', 'occupancy', 'held']){
    const r=rig();r.automation.set(true);await r.tick();r.state.routes[0].state='active';await r.tick();
    r.changeLine('tk-bilbo',{state:'occupied',direction:'in',trainNumber:'401'});
    if(phase==='departure'){
      r.state.routes=[];r.state.blocks.SI.occupied=true;r.advance(4000);
      for(let i=0;i<3;i++)await r.tick([r.train()]);
      r.changeLine('tk-cda',{state:'reserved',direction:'out',trainNumber:'401'});await r.tick([r.train()]);
      r.state.routes[0].state='active';await r.tick([r.train()]);r.state.blocks.SI.occupied=false;
    }
    const route=r.state.routes[0];route.cancelRequested=true;route.state='cancelling';
    route.passage=[...new Set(route.blocks.map(b=>profile.blocks[b].address))].map(address=>({address,state:'clear'}));
    if(phase==='arrival'){
      route.arrival=true;route.passage.at(-1).state='occupied';r.state.blocks.SI.occupied=true;
    }
    if(fault==='manual'){if(phase==='arrival')delete route.arrival;else route.passage[0].state='occupied';}
    if(fault==='passage')route.passage[0].state='pending';
    if(fault==='occupancy')r.state.blocks[phase==='arrival'?'SI':route.blocks[0]].occupied=null;
    if(fault==='held')route.state='held';
    const sent=r.posts.length+r.declarations.length;
    for(let i=0;i<3;i++)await r.tick(phase==='arrival'?[r.train()]:[]);
    assert.equal(r.automation.enabled,!fault,phase+' / '+(fault||'normal upplösning'));
    assert.equal(r.posts.length+r.declarations.length,sent,'inget nytt TrainMeet-steg före låsfrigivning');
  }
});

test('ändrad linjeklarering under aktiv infart och ett obekräftat svar ger överlämning',async()=>{
  for(const values of [{state:'free',direction:'',trainNumber:''},{state:'occupied',direction:'in',trainNumber:'402'},{state:'occupied',direction:'out',trainNumber:'401'}]){
    const r=rig();r.automation.set(true);await r.tick();r.state.routes[0].state='active';await r.tick();r.changeLine('tk-bilbo',values);await r.tick();assert.equal(r.automation.enabled,false);assert.equal(r.posts.length,1);
  }
  const unknown=rig({clearance:async()=>undefined});unknown.automation.set(true);await unknown.tick();unknown.state.routes[0].state='active';await unknown.tick();assert.equal(unknown.automation.enabled,false);assert.equal(unknown.posts.length,1);
});

test('utgående enkelspår med mötande tåg och återtagen utgående begäran ger överlämning',async()=>{
  for(const refused of [false,true]){
    const r=rig();r.changeLine('tk-bilbo',{state:'free',direction:'',trainNumber:''});r.meet.context.movements.push({id:'movement-401',departure:'ready'});r.state.blocks.SI.occupied=true;r.automation.set(true);
    if(refused){await r.tick([r.train()]);assert.equal(r.posts[0].action,'request');r.changeLine('tk-cda',{state:'free',direction:'',trainNumber:''});}
    else r.changeLine('tk-cda',{state:'occupied',direction:'in',trainNumber:'402'});
    await r.tick([r.train()]);assert.equal(r.automation.enabled,false);assert.equal(r.requests.length,0);
  }
});

test('aktiv utfart övervakas även efter avgångsklarering och tåget får en kort spårningsfrist',async()=>{
  for(const changed of [true,false]){
    const r=rig();r.changeLine('tk-bilbo',{state:'free',direction:'',trainNumber:''});r.meet.context.movements.push({id:'movement-401',departure:'ready'});r.state.blocks.SI.occupied=true;r.automation.set(true);
    const train=r.train();await r.tick([train]);r.changeLine('tk-cda',{state:'reserved',direction:'out',trainNumber:'401'});await r.tick([train]);r.state.routes[0].state='active';await r.tick([train]);
    if(changed){r.changeLine('tk-cda',{state:'occupied',direction:'out',trainNumber:'402'});await r.tick([train]);assert.equal(r.automation.enabled,false);}
    else{r.state.routes=[];r.state.blocks.SI.occupied=false;await r.tick([train]);assert.equal(r.automation.enabled,true,'spårningens efterhäng tolereras');r.advance(2500);await r.tick([train]);assert.equal(r.automation.enabled,false,'utebliven fysisk avgång lämnas över');}
    assert.equal(r.declarations.length,0,'ingen avgångsanmälan medan tåget står kvar');
  }
});

test('nekad ankomstanmälan frigör inte inkommande linje och skickas inte igen',async()=>{
  const r=rig({movement:async()=>{throw Error('Ankomsten avslogs.');}});r.automation.set(true);await r.tick();r.state.routes[0].state='active';await r.tick();
  r.changeLine('tk-bilbo',{state:'occupied',direction:'in',trainNumber:'401'});r.state.routes=[];r.state.blocks.SI.occupied=true;
  await r.tick([r.train()]);assert.equal(r.automation.enabled,false);assert.match(r.log.at(-1),/Ankomsten avslogs/);assert.equal(r.posts.filter(p=>p.action==='arrive').length,0);await r.tick([r.train()]);assert.equal(r.declarations.length,1);
});

for(const denied of ['accept','arrived','arrive','request','depart','departed'])test(`nekad ${denied} förblir spärrad efter av/på och nya trafikrevisioner`,async()=>{
  const r=rig({deny:denied});let trains=[];
  r.automation.set(true);await r.tick();r.state.routes[0].state='active';await r.tick();
  if(r.automation.enabled){
    r.changeLine('tk-bilbo',{state:'occupied',direction:'in',trainNumber:'401'});r.state.routes=[];r.state.blocks.SI.occupied=true;r.advance(4000);trains=[r.train()];
    await r.tick(trains);if(r.automation.enabled)await r.tick(trains);if(r.automation.enabled)await r.tick(trains);
    if(r.automation.enabled){
      r.changeLine('tk-cda',{state:'reserved',direction:'out',trainNumber:'401'});await r.tick(trains);r.state.routes[0].state='active';await r.tick(trains);
      if(r.automation.enabled){r.state.routes=[];r.state.blocks.SI.occupied=false;trains=[];await r.tick(trains);}
    }
  }
  assert.equal(r.automation.enabled,false,'provet ska nå det nekade steget');assert.match(r.log.at(-1),new RegExp('Nekat steg: '+denied));
  const sent=r.posts.length+r.declarations.length;
  for(let attempt=0;attempt<3;attempt++){
    if(attempt)r.meet.context.revision++;
    r.automation.set(true);await r.tick(trains);
    assert.equal(r.automation.enabled,false,'osäkert steg kräver manuell hantering');assert.equal(r.posts.length+r.declarations.length,sent,'varken omförsök eller nästa steg skickas');
  }
  assert.ok([...r.automation.timetablePolicy.plans.values()].some(plan=>plan.dispatchUncertain?.step===denied));
});

for(const occupied of [true,null])test(`bortglömt tåg och borttagen utfart med stationsspår ${occupied} anmäls inte avgånget`,async()=>{
  const r=rig();r.changeLine('tk-bilbo',{state:'free',direction:'',trainNumber:''});r.meet.context.movements.push({id:'movement-401',departure:'ready'});r.state.blocks.SI.occupied=true;r.automation.set(true);
  const train=r.train();await r.tick([train]);r.changeLine('tk-cda',{state:'reserved',direction:'out',trainNumber:'401'});await r.tick([train]);r.state.routes[0].state='active';await r.tick([train]);
  r.state.routes=[];r.state.blocks.SI.occupied=occupied;await r.tick([]);
  assert.equal(r.automation.enabled,false);assert.match(r.log.at(-1),/belagt eller okänt spår/);assert.equal(r.declarations.length,0);
});
