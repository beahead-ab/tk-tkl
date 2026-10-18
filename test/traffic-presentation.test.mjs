import test from 'node:test';
import assert from 'node:assert/strict';
import {configureTraffic,destinationDefaults,destinationLines,legacyDestinationDefaults,legacyDestinationLines,legacyIncomingFields,legacyAnchors,defaultOutgoing,isOutgoingDestination,destinationAnchor,lineTrainPlacement,destinationDisplay} from '../public/destination-data.js';
import {incomingFields,incomingAnchors,normalIncoming,incomingChoice} from '../public/incoming-trains.js';
import {trackedTrainPlacement} from '../public/train-tracking.js';
import {stationSides} from '../public/timetable-rows.js';

// Ett stationspaket skickar denna form via /api/config. Inga CDA-filer krävs av provet.
const traffic={
  explicitConnections:true,
  destinationDefaults:['A','B','C'].map(id=>({id,name:'Linje '+id,phone:'',position:'Linje '+id})),
  destinationLines:[{id:'A',name:'Linje A',side:'left',tracks:['A'],outgoing:'A'},{id:'B',name:'Linje B',side:'right',tracks:['B'],outgoing:'B'},{id:'C',name:'Linje C',side:'right',tracks:['C'],outgoing:'C'}],
  incomingFields:{},
  anchors:{A:{button:'htvA',side:'left',outward:'left',label:{dx:-34,dy:52}},B:{button:'htvB',side:'right',outward:'right',label:{dx:34,dy:52}},C:{button:'htvC',side:'right',outward:'down',label:{dx:34,dy:42}}}
};
const controls=[{sensor:'htvA',centerX:75,centerY:140},{sensor:'htvB',centerX:895,centerY:140},{sensor:'htvC',centerX:799,centerY:303}];
const useTraffic=t=>{configureTraffic(traffic);t.after(()=>configureTraffic());};

test('panel, ortsregister, inkommande fält och tidtabell följer samma stationsmodell',t=>{
  useTraffic(t);
  assert.deepEqual(destinationDefaults.map(d=>d.id),['A','B','C']);
  assert.deepEqual(defaultOutgoing(),{A:'A',B:'B',C:'C'});
  assert.ok(destinationDefaults.every(d=>isOutgoingDestination(d.id)));
  assert.equal(isOutgoingDestination('Cu'),false);
  assert.deepEqual(destinationLines.map(l=>normalIncoming(l.id)),['A','B','C']);
  assert.deepEqual(incomingFields,{});
  assert.deepEqual(incomingAnchors(controls),[]);
  assert.equal(incomingChoice('incoming:CuppIn'),null);
  const sides=stationSides({entries:[{id:'A',source:'trainmeet',stationId:'left'},{id:'C',source:'trainmeet',stationId:'right'}]});
  assert.deepEqual([...sides],[['left','left'],['right','right']]);
  assert.deepEqual(legacyDestinationDefaults.map(d=>d.id),['Cu','Cn','Au','An','Bu','Bn','D']);
  assert.equal(legacyDestinationLines.length,4);
  assert.equal(Object.keys(legacyIncomingFields).length,7);
});

test('A/B/C ritas vid sina uttryckliga knappar, med lodrät riktning på C',t=>{
  useTraffic(t);
  for(const id of ['A','B','C']){
    const anchor=destinationAnchor(id,controls);
    assert.equal(anchor.control.sensor,'htv'+id);
    assert.equal(anchor.x,anchor.control.centerX+traffic.anchors[id].label.dx);
    assert.equal(anchor.y,anchor.control.centerY+traffic.anchors[id].label.dy);
  }
  assert.deepEqual(lineTrainPlacement('A','in',controls),{x:93,y:168,anchor:'start',arrow:'→'});
  assert.deepEqual(lineTrainPlacement('B','in',controls),{x:877,y:168,anchor:'end',arrow:'←'});
  assert.equal(lineTrainPlacement('B','in',controls).arrow,'←');
  assert.equal(lineTrainPlacement('C','in',controls).arrow,'↑');
  assert.equal(lineTrainPlacement('C','out',controls).arrow,'↓');
  assert.equal(lineTrainPlacement('C','out',controls,2).y-lineTrainPlacement('C','out',controls).y,28);
  assert.equal(destinationAnchor('C',controls.slice(0,2)),null);
  assert.equal(lineTrainPlacement('Cu','in',controls),null);
});

test('en ej ansluten linje visar saknad TrainMeet-anslutning, även om en station har valts',t=>{
  useTraffic(t);
  const entry={id:'C',name:'Linje C',phone:'',source:'local',stationId:''};
  assert.equal(destinationDisplay(entry,null).name,'Linje C');
  assert.equal(destinationDisplay(entry,null).connectionMissing,true);
  assert.match(destinationDisplay(entry,null).sourceLabel,/anslutning saknas/);
  const chosen={...entry,source:'trainmeet',stationId:'remote-id'};
  const context={stations:[{id:'remote-id',name:'Riktig granne'}],lines:[]};
  assert.match(destinationDisplay(chosen,{context}).sourceLabel,/anslutning saknas/);
  context.lines=[{neighborId:'remote-id'}];
  assert.equal(destinationDisplay(chosen,{context}).name,'Riktig granne');
  assert.equal(destinationDisplay(chosen,{context}).sourceLabel,'TrainMeet');
  assert.equal(destinationDisplay(chosen,{context}).connectionMissing,false);
  assert.match(destinationDisplay(chosen,{context,stale:true}).sourceLabel,/senaste uppgifter/);
});

test('utan ny konfiguration behåller Charlottendal sina sju poster, fält och exakta etikettlägen',()=>{
  configureTraffic();
  assert.equal(destinationDefaults,legacyDestinationDefaults);
  assert.equal(destinationLines,legacyDestinationLines);
  assert.equal(incomingFields,legacyIncomingFields);
  for(const [id,binding] of Object.entries(legacyAnchors)){
    const control={sensor:'htv'+id,centerX:100,centerY:200};
    const anchor=destinationAnchor(id,[control]);
    assert.equal(anchor.x,binding.side==='right'?2078:50);
    assert.equal(anchor.y,200+(id.endsWith('n')||id==='D'?38:-36));
    const tag=lineTrainPlacement(id,'in',[control]);
    assert.equal(tag.x,binding.side==='right'?118:82);
    assert.equal(tag.anchor,binding.side==='right'?'start':'end');
  }
});

test('tågets frontpil följer också lodräta block när C kommer in på stationen',()=>{
  assert.deepEqual(trackedTrainPlacement({x:10,y:20},{x:10,y:70},'station'),{x:10,y:-8,arrow:'↑'});
  assert.deepEqual(trackedTrainPlacement({x:10,y:70},{x:10,y:20},'station'),{x:10,y:98,arrow:'↓'});
  assert.deepEqual(trackedTrainPlacement({x:100,y:20},{x:20,y:20},'station'),{x:140,y:20,arrow:'→'});
  assert.deepEqual(trackedTrainPlacement({x:20,y:20},{x:100,y:20},'station'),{x:-20,y:20,arrow:'←'});
  assert.equal(trackedTrainPlacement({x:10,y:20},{x:10,y:70},'ghost').arrow,'');
});
