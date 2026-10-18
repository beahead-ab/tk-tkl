// Verkliga kärnan, fältmodellen och spårningen i en lokal klocka. Inget nätverk eller några driftdata används.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Engine} from '../src/engine.mjs';
import {Field} from '../src/field.mjs';
import {TrainTracker} from '../src/train-tracking.mjs';
import {TrainAutomation} from '../src/train-automation.mjs';
import {currentStation,stationData} from '../src/station.mjs';
import {stationTraffic} from '../src/station-traffic.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL('../'+p,import.meta.url)));
const profile=read('stations/trakvista/profiles/network.json'),plant=read('stations/trakvista/profiles/field.json');
const station=currentStation({CHARLOTTENDAL_STATION:'trakvista'}),panel=stationData('panel.json',station),traffic=stationTraffic(station,profile,panel);
async function run({opposed=false,slowRelease=false}={}){
  let now=100000;const queue=[],delayed=[],releasing=new Set(),log=[],calls=[],spawned=new Set(),requests=[];
  const edges={A:{stationId:'bilbo',incoming:true},B:{stationId:'cda',incoming:true},C:{stationId:'',incoming:true}};
  let meet={sessionId:'session',revision:3,status:'connected',stale:false,busy:false,context:{publicationId:'pub',day:'day',revision:7,station:{id:'tk'},
    tracks:[{id:'track-i',label:'I'},{id:'track-ii',label:'II'}],trains:[{id:'m401',train_number:'401',track_id:'track-i'}],movements:[],directions:{m401:{from:'bilbo',to:'cda'}},
    lines:[{id:'a',neighborId:'bilbo',state:'requested',direction:'in',trainNumber:'401',actions:['accept','reject']},{id:'b',neighborId:'cda',state:'free',direction:'',trainNumber:'',actions:['request']}]}};
  if(opposed){
    meet.context.trains.push({id:'m402',train_number:'402',track_id:'track-ii'});meet.context.directions.m402={from:'cda',to:'bilbo'};
    Object.assign(meet.context.lines[1],{state:'requested',direction:'in',trainNumber:'402',actions:['accept','reject']});
  }
  const field=new Field(plant,{traffic,now:()=>now,movementMs:100}),engine=new Engine(profile,{now:()=>now,send:bytes=>queue.push(['order',bytes])});
  field.on('frame',bytes=>queue.push(['report',bytes]));
  const tracker=new TrainTracker({profile,panel,traffic,now:()=>now});
  const check=data=>{assert.equal(data.contextRevision,meet.context.revision);assert.deepEqual(data.contextIdentity,{stationId:'tk',publicationId:'pub',day:'day'});};
  const automation=new TrainAutomation({profile,policy:'trainmeet',traffic,available:true,now:()=>now,edgeBlock:traffic.edgeBlocks,log:(k,m)=>log.push(m),
    request:(a,b)=>{requests.push([a,b]);return engine.request(a,b,'build');},
    clearance:async data=>{
      check(data);calls.push([data.trainNumber,data.action]);const next=structuredClone(meet),line=next.context.lines.find(l=>l.id===data.connectionId);
      assert.ok(line.actions.includes(data.action),'provtjänsten godkänner bara aktuella klareringssteg');
      if(data.action==='accept')Object.assign(line,{state:'reserved',actions:[]});
      if(data.action==='arrive')Object.assign(line,{state:'free',direction:'',trainNumber:'',actions:['request']});
      // Provtjänstens grannstation svarar direkt ja på den utgående begäran.
      if(data.action==='request')Object.assign(line,{state:'reserved',direction:'out',trainNumber:data.trainNumber,actions:['depart','cancel']});
      if(data.action==='depart')Object.assign(line,{state:'occupied',actions:[]});
      next.context.revision++;meet=next;return next;
    },movement:async data=>{
      check(data);calls.push([data.trainNumber,data.arrival||data.departure]);const next=structuredClone(meet);
      let record=next.context.movements.find(m=>m.id===data.movementId);
      if(!record){record={id:data.movementId,revision:0};next.context.movements.push(record);}
      if(data.arrival)Object.assign(record,{arrival:data.arrival,track:data.actualTrack});
      if(data.departure){assert.ok(!field.trains.some(t=>t.number===data.trainNumber),'avgång anmäls först när tåget lämnat fältmodellen');record.departure=data.departure;}
      record.revision++;next.context.revision++;meet=next;return next;
    }});
  const drain=()=>{let guard=20000;while(queue.length&&guard--){const [kind,bytes]=queue.shift();if(kind==='order')field.accept(bytes);else if(slowRelease&&engine.routes.some(r=>r.cancelRequested))delayed.push([now+450,bytes]);else engine.receive(bytes);}assert.ok(guard>0);
    // Stoppåterrapporten är asynkron också på en snabb dator. Kärnans normala upplösning ska därför synas för
    // automaten under flera tickar, både efter ankomsten och efter den fullständiga utfarten.
    while(delayed[0]?.[0]<=now)engine.receive(delayed.shift()[1]);};
  engine.connection(true);field.allReports();drain();automation.set(true);
  for(let i=0;i<130000;i+=50){
    now+=50;field.tick();if(now%1000===0)field.allReports();drain();engine.tick();drain();
    tracker.observe({blocks:engine.blocks,turnouts:engine.turnouts,routes:engine.routes,connected:true,lines:meet.context.lines,edgeInfo:edges});
    if(now%250===0){
      for(const r of engine.routes.filter(r=>r.cancelRequested))releasing.add(r.arrival?'arrival':'departure');
      await automation.tick({state:{...engine.snapshot(),connected:engine.connected},trains:tracker.view().trains,meet,edges});
    }
    for(const line of meet.context.lines)if(line.direction==='in'&&line.state==='reserved'&&!spawned.has(line.trainNumber)){
      assert.ok(engine.routes.some(r=>['active','traversing'].includes(r.state)),'tåget sänds först efter godkänd aktiv infart');
      const edge=Object.keys(edges).find(e=>edges[e].stationId===line.neighborId);
      Object.assign(line,{state:'occupied',actions:['arrive']});meet.context.revision++;
      field.spawnTrain({number:line.trainNumber,at:traffic.anchors[edge].button});spawned.add(line.trainNumber);
    }
    assert.equal(automation.enabled,true,log.join('\n'));
  }
  assert.equal(field.trains.length,0,'alla tåg har lämnat stationen');assert.equal(engine.routes.length,0,'alla tågvägslås har lösts');assert.equal(tracker.view().trains.length,0);
  const numbers=opposed?['401','402']:['401'];
  for(const number of numbers)assert.deepEqual(calls.filter(([n])=>n===number).map(([,step])=>step),['accept','arrived','arrive','request','depart','departed'],number+' har varje steg exakt en gång');
  assert.deepEqual(requests.filter(([from])=>from==='htvA'),[['htvA','htvI']]);
  assert.ok(requests.some(([from,to])=>from==='htvI'&&to==='htvB'));
  if(opposed){assert.ok(requests.some(([from,to])=>from==='htvB'&&to==='htvII'));assert.ok(requests.some(([from,to])=>from==='htvII'&&to==='htvA'));}
  if(slowRelease)assert.deepEqual([...releasing].sort(),['arrival','departure'],'båda normala upplösningarna observerades före låsfrigivningen');
}
test('Träkvistas automat kör ett tåg A–I–B med full klarering genom kärna, fältmodell och spårning',()=>run());
test('Träkvistas automat möter två tåg på tidtabellsspår I/II och skickar dem vidare på enkelspåren',()=>run({opposed:true}));
test('Träkvistas automat inväntar kärnans normala ankomst- och utfartsupplösning med sen stoppåterrapport',()=>run({slowRelease:true}));
