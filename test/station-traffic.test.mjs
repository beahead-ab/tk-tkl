// Stationsdata och driftformat för den gemensamma manuella trafiken. Samma prov körs i stationspaketet.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {currentStation,stationIds,stationData,stateDirectory} from '../src/station.mjs';
import {stationTraffic,trafficEdgeInfo,LEGACY_EDGE_LINES} from '../src/station-traffic.mjs';
import {Destinations} from '../src/destinations.mjs';
import {legacyDestinationDefaults,legacyDestinationLines,legacyIncomingFields,configureTraffic} from '../public/destination-data.js';
import {TrafficTrains} from '../src/traffic-trains.mjs';
import {Topology} from '../src/topology.mjs';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const rig=id=>{const station=currentStation({CHARLOTTENDAL_STATION:id}),profile=read(station.profile),panel=stationData('panel.json',station);return {station,profile,panel,traffic:stationTraffic(station,profile,panel)};};
const memory=(value)=>{let saved=value,writes=0;return {load:(_name,fallback)=>structuredClone(saved??fallback),save:(_name,next)=>{saved=structuredClone(next);writes++;},get writes(){return writes;},get data(){return structuredClone(saved);}};};
const legacyBook=()=>({revision:0,entries:legacyDestinationDefaults.map(({id,name,phone})=>({id,name,phone,source:'local',stationId:''}))});

if(stationIds().includes('charlottendal'))test('Charlottendals trafikmodell behåller sju orter, riktningar, ankare, spårurval och oförändrade profiler',()=>{
  const {station,profile,panel,traffic}=rig('charlottendal'),before=JSON.stringify(profile),topology=new Topology(panel);
  assert.deepEqual(traffic.destinationDefaults,legacyDestinationDefaults);
  assert.deepEqual(traffic.destinationLines,legacyDestinationLines);
  assert.deepEqual(traffic.edgeLines,LEGACY_EDGE_LINES);
  assert.deepEqual(traffic.incomingFields,legacyIncomingFields);
  assert.equal(traffic.explicitConnections,false);
  assert.match(stateDirectory({},station),/\/var$/);
  for(const [edge,block] of Object.entries(traffic.edgeBlocks))assert.equal(block,topology.segments[topology.buttons['htv'+edge].segment].b);
  const oldTracks={};for(const [button,binding] of Object.entries(profile.buttons)){const match=/^Spår\s+(.+)$/.exec(binding.label||''),block=match&&profile.routes.find(route=>route.to===button)?.blocks.at(-1);if(block)oldTracks[match[1].trim().toLowerCase()]={button,block};}
  assert.deepEqual(Object.fromEntries(Object.entries(traffic.stationTracks).map(([key,{button,block}])=>[key,{button,block}])),oldTracks);
  assert.deepEqual(traffic.anchors.Cu.label,{x:50,dy:-36});assert.deepEqual(traffic.anchors.Bn.label,{x:2078,dy:38});
  const data=legacyBook();data.entries[0].name='Eget namn';data.entries[0].phone='123';
  const storage=memory(data),book=new Destinations(storage,traffic);
  assert.deepEqual(book.view().entries,data.entries);assert.equal(storage.writes,0);
  assert.deepEqual(book.view().outgoing,{C:'Cn',A:'An',B:'Bu',D:'D'});assert.equal(book.view().migration,undefined);
  // En webbkonsuments val av en annan station får inte ändra serverns konstanta CDA-grundvärden.
  configureTraffic({destinationDefaults:[],destinationLines:[],incomingFields:{},anchors:{}});
  assert.deepEqual(stationTraffic(station,profile,panel).destinationDefaults,traffic.destinationDefaults);
  configureTraffic(traffic);
  assert.equal(JSON.stringify(profile),before);
});

for(const id of stationIds().filter(id=>id==='trakvista')){
  test('Träkvista binder A/B/C och stationsspåren uttryckligen utan Charlottendals incoming-minnen',()=>{
    const {station,profile,panel,traffic}=rig(id),before=JSON.stringify(profile);
    assert.deepEqual(traffic.edgeLines,{A:'A',B:'B',C:'C'});assert.deepEqual(traffic.edgeBlocks,{A:'SA2',B:'SB2',C:'SC2'});
    assert.deepEqual(traffic.incomingFields,{});assert.equal(traffic.explicitConnections,true);
    assert.deepEqual(traffic.stationTracks,{i:{button:'htvI',block:'SI',label:'I'},ii:{button:'htvII',block:'SII',label:'II'},iii:{button:'htvIII',block:'SIII',label:'III'},iiia:{button:'htvIIIA',block:'SIIIa',label:'IIIa'},iiic:{button:'htvIIIC',block:'SIIIc',label:'IIIc'}});
    assert.deepEqual(traffic.destinationDefaults.map(d=>d.name),['Linje A','Linje B','Linje C']);
    assert.deepEqual(traffic.destinationLines.map(line=>line.tracks),[['A'],['B'],['C']]);
    assert.deepEqual([traffic.anchors.A.outward,traffic.anchors.B.outward,traffic.anchors.C.outward],['left','right','down']);
    const misleading=structuredClone(panel);for(const icon of misleading.sicons.filter(icon=>icon.sensor.startsWith('htv')))Object.assign(icon,{x:0,y:0});
    assert.deepEqual(stationTraffic(station,profile,misleading).edgeBlocks,traffic.edgeBlocks);
    assert.deepEqual(stationTraffic(station,profile,misleading).stationTracks,traffic.stationTracks);
    const invalid=structuredClone(station);invalid.definition.buttons.htvC.block='Saknas';
    assert.throws(()=>stationTraffic(invalid,profile,panel),/Linje C.*giltigt block/);
    assert.equal(JSON.stringify(profile),before);
  });
  test('Träkvistas TrainMeet-tåg kräver explicit sparad station och verklig linje; ej ansluten C placerar inget tåg',()=>{
    const {traffic}=rig(id),storage=memory(),book=new Destinations(storage,traffic),stations=[{id:'real-a',name:'Granne A'},{id:'real-c',name:'Granne C'}];
    const context={stations,lines:[{id:'line-a',neighborId:'real-a',state:'occupied',direction:'in',trainNumber:'701'},{id:'line-c',neighborId:'real-c',state:'occupied',direction:'in',trainNumber:'703'}]};
    const player=new TrafficTrains({available:true,send:async()=>{}});
    const wanted=()=>player.wanted({context,edges:Object.fromEntries(Object.entries(trafficEdgeInfo(traffic,book.view(),context)).map(([key,edge])=>[key,{...edge,block:traffic.edgeBlocks[key]}])),tracks:traffic.stationTracks});
    assert.deepEqual(wanted(),[],'namnen Bilbo och Charlottendal i källan är inga bindningar');
    assert.throws(()=>book.save({revision:0,entry:{...book.view().entries[0],source:'trainmeet',stationId:'guessed'}},stations),/finns inte/);
    book.save({revision:0,entry:{...book.view().entries[0],source:'trainmeet',stationId:'real-a'}},stations);
    assert.deepEqual(wanted().map(item=>[item.number,item.at,item.block]),[['701','htvA','SA2']]);
    assert.equal(trafficEdgeInfo(traffic,book.view(),context).C.stationId,'');
    const restored=new Destinations(storage,traffic);assert.deepEqual(restored.view(),book.view());
    const noLine=trafficEdgeInfo(traffic,book.view(),{stations,lines:[]});assert.equal(noLine.A.stationId,'');
    const entry=book.view().entries.find(item=>item.id==='C');book.save({revision:1,entry:{...entry,source:'trainmeet',stationId:'real-c'}},stations);
    assert.deepEqual(wanted().map(item=>item.number),['701','703']);
  });
  test('Träkvistas gamla orörda CDA-orter ersätts bara i minnet och kopplas aldrig till grannar',()=>{
    const {traffic}=rig(id),original=legacyBook(),storage=memory(original),book=new Destinations(storage,traffic);
    assert.deepEqual(book.view().entries.map(entry=>entry.id),['A','B','C']);assert.deepEqual(book.view().outgoing,{A:'A',B:'B',C:'C'});
    assert.ok(book.view().entries.every(entry=>entry.source==='local'&&entry.stationId===''));
    assert.equal(book.view().migration,undefined);assert.equal(storage.writes,0);assert.deepEqual(storage.data,original);
  });
  test('Träkvistas egna äldre namn, telefoner och TrainMeet-kopplingar bevaras synligt vid sparning och omstart',()=>{
    const {traffic}=rig(id),original=legacyBook();original.revision=8;original.entries[0]={...original.entries[0],name:'Bennys ort',phone:'555',source:'trainmeet',stationId:'gammal-station'};
    original.outgoing={C:'Cu',A:'An',B:'Bn',D:'D'};
    const storage=memory(original),book=new Destinations(storage,traffic);
    assert.equal(storage.writes,0);assert.deepEqual(storage.data,original);assert.deepEqual(book.view().migration.previous,original);
    assert.match(book.view().migration.message,/bevarade/);
    assert.ok(book.view().entries.every(entry=>entry.stationId===''));
    const saved=book.save({revision:8,entry:{...book.view().entries[0],name:'Linje A'}},[]);
    assert.deepEqual(saved.migration.previous,original);assert.deepEqual(new Destinations(storage,traffic).view(),saved);
    const invalid=structuredClone(original);invalid.entries[0].stationId='';
    assert.throws(()=>new Destinations(memory(invalid),traffic),/giltigt/);
    const unknown=structuredClone(original);unknown.entries[0].id='Okänd';assert.throws(()=>new Destinations(memory(unknown),traffic),/Ogiltiga sparade/);
  });
}
