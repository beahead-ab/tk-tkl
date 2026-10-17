import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPages,pluppSpec,systemSpec,splitLabel,signature,SYSTEM_KEYS,COLORS} from '../public/stream-deck-layout.js';

const pluppar=[...['Spår 2c','Cu','Spår 11','Au','D','Spår 1b','Bn','An','Spår 12','Cn','Bu','Spår 1a','Spår 5b','Spår 2b','Spår 1c'].map(label=>({id:'m-'+label,label,kind:'main'})),{id:'tvv1',label:'Signal 1/5',kind:'shunt'}];

test('pages start with the operating keys, list lines before tracks and shunt pluppar last, and cover every plupp once',()=>{
  const pages=buildPages(pluppar,15);
  assert.equal(pages.length,2);
  assert.deepEqual(pages[0].slice(0,5).map(k=>k.id),SYSTEM_KEYS.filter(k=>!k.optional).map(k=>k.id),'Styra RBG is placed by hand, not on the automatic layout');
  assert.deepEqual(pages[0].slice(5).map(k=>k.label),['An','Au','Bn','Bu','Cn','Cu','D','Spår 1a','Spår 1b','Spår 1c']);
  assert.equal(pages[1][0].id,'page');
  assert.deepEqual(pages[1].slice(1).map(k=>k.label),['Spår 2b','Spår 2c','Spår 5b','Spår 11','Spår 12','Signal 1/5']);
  const all=pages.flat().filter(k=>k.type==='plupp').map(k=>k.id);
  assert.equal(new Set(all).size,pluppar.length);assert.equal(all.length,pluppar.length);
  assert.equal(buildPages(pluppar,32).length,1);assert.equal(buildPages([],6).length,1);
  assert.ok(buildPages(pluppar,6).every(p=>p.length<=6));
});

test('plupp appearance mirrors the track plan classes',()=>{
  const key={id:'m-Au',label:'Au',kind:'main'};
  assert.equal(pluppSpec(key,new Set(),'').fill,COLORS.free);
  assert.equal(pluppSpec(key,new Set(['in-route']),'active').fill,COLORS.route);
  assert.equal(pluppSpec(key,new Set(['in-route']),'held').fill,COLORS.held);
  assert.equal(pluppSpec(key,new Set(['in-route']),'occupied').fill,COLORS.occupied);
  assert.equal(pluppSpec(key,new Set(['route-choice-start']),'').ring,COLORS.choice);
  assert.equal(pluppSpec(key,new Set(['route-destination']),'').ring,COLORS.destination);
  assert.equal(pluppSpec(key,new Set(['choice-disabled']),'').dim,true);
  assert.equal(pluppSpec(key,new Set(['route-preparing']),'').blink,true);
  assert.equal(pluppSpec(key,new Set(['line-is-blocked']),'').blocked,true);
  assert.equal(pluppSpec({...key,kind:'shunt'},new Set(),'').caption,'växeltågväg');
  assert.deepEqual(pluppSpec({id:'x',label:'Spår 2c',kind:'main'},new Set(),'').lines,['Spår','2c']);
});

test('operating keys show their state and the blink phase only changes blinking keys',()=>{
  const key=id=>SYSTEM_KEYS.find(k=>k.id===id);
  assert.equal(systemSpec(key('all-stop'),{stopAll:true}).fill,COLORS.occupied);
  assert.equal(systemSpec(key('all-stop'),{stopAll:false}).fill,'');
  assert.equal(systemSpec(key('reset-ais'),{stopAll:false}).dim,true);
  assert.equal(systemSpec(key('cancel'),{chosen:false}).dim,true);
  assert.equal(systemSpec(key('cancel'),{chosen:true}).dim,false);
  assert.deepEqual(systemSpec(key('page'),{page:1,pages:3}).lines,['Sida','2 / 3']);
  assert.equal(systemSpec(key('page'),{page:0,pages:1}).dim,true);
  assert.equal(systemSpec(key('panel-reset'),{remote:true}).dim,true);
  const steady=pluppSpec({id:'a',label:'Au',kind:'main'},new Set(),''),blinking=pluppSpec({id:'a',label:'Au',kind:'main'},new Set(['route-preparing']),'');
  assert.equal(signature(steady,true),signature(steady,false));assert.notEqual(signature(blinking,true),signature(blinking,false));
  assert.deepEqual(splitLabel('Linjer och programmeringsspår'),['Linjer och','programmeringsspår']);
});

import {departureKey,arrivalKey,toMinutes} from '../public/stream-deck-trains.js';
import {routeDirections} from '../src/trainmeet.mjs';
const lek={id:'cda-lek',neighborId:'lek',neighborName:'Lekby',neighborCode:'LEK',state:'free',direction:'',trainNumber:''};
const trains=[{id:'m1',train_number:'3581',departure_time:'05:05'},{id:'m2',train_number:'93',departure_time:'05:15'},{id:'m3',train_number:'102',arrival_time:'05:48',departure_time:'05:50'},{id:'m4',train_number:'4152',departure_time:'05:30'}];
const directions={m1:{from:'',to:'lek'},m2:{from:'',to:'lek'},m3:{from:'lek',to:'vag'},m4:{from:'',to:'vag'}};
const ctx=(movements=[],extra={})=>({trains,directions,movements,...extra});

test('the departure key walks the TMBox sequence for the next train toward the neighbour and follows the line once requested',()=>{
  let k=departureKey(lek,ctx());assert.deepEqual([k.number,k.time,k.step,k.short.departure,k.long],['3581','05:05','unprepared','positioned',null]);
  k=departureKey(lek,ctx([{id:'m1',departure:'positioned'}]));assert.equal(k.step,'positioned');assert.equal(k.short.departure,'ready');
  k=departureKey(lek,ctx([{id:'m1',departure:'ready'}]));assert.equal(k.step,'ready');assert.deepEqual(k.short,{type:'clearance',action:'request',trainNumber:'3581'});
  k=departureKey({...lek,state:'occupied',direction:'in',trainNumber:'7'},ctx([{id:'m1',departure:'ready'}]));assert.equal(k.step,'ready');assert.equal(k.short,null);assert.equal(k.dim,true);
  k=departureKey({...lek,state:'requested',direction:'out',trainNumber:'3581'},ctx([{id:'m1',departure:'ready'}]));assert.equal(k.step,'requested');assert.equal(k.blink,true);assert.equal(k.short,null);assert.equal(k.long.action,'cancel');
  k=departureKey({...lek,state:'reserved',direction:'out',trainNumber:'3581'},ctx());assert.equal(k.step,'cleared');assert.equal(k.short.action,'depart');assert.equal(k.long.action,'cancel');
  k=departureKey({...lek,state:'occupied',direction:'out',trainNumber:'3581'},ctx());assert.equal(k.step,'on-line');assert.equal(k.short,null);
  k=departureKey(lek,ctx([{id:'m1',departure:'departed'}]));assert.equal(k.number,'93','departed trains are skipped');
  k=departureKey(lek,ctx([{id:'m1',departure:'departed'},{id:'m2',departure:'departed'}]));assert.equal(k.step,'none');assert.equal(k.dim,true);
  assert.equal(departureKey({...lek,neighborId:'vag',neighborCode:'VAG'},ctx()).number,'4152','direction decides the line');
  assert.ok(toMinutes('25:10')>toMinutes('23:59'));
});

test('the arrival key answers requests, declares approaching and confirms arrival, and otherwise shows the next planned arrival',()=>{
  let k=arrivalKey(lek,ctx());assert.deepEqual([k.number,k.time,k.step,k.short],['102','05:48','planned',null]);
  k=arrivalKey({...lek,state:'requested',direction:'in',trainNumber:'102'},ctx());assert.equal(k.step,'incoming-request');assert.equal(k.blink,true);assert.equal(k.short.action,'accept');assert.equal(k.long.action,'reject');
  k=arrivalKey({...lek,state:'reserved',direction:'in',trainNumber:'102'},ctx());assert.equal(k.step,'cleared-in');assert.equal(k.short,null);
  k=arrivalKey({...lek,state:'occupied',direction:'in',trainNumber:'102'},ctx());assert.equal(k.step,'on-line-in');assert.deepEqual(k.short,{type:'movement',movementId:'m3',arrival:'approaching'});
  k=arrivalKey({...lek,state:'occupied',direction:'in',trainNumber:'102'},ctx([{id:'m3',arrival:'approaching'}]));assert.equal(k.step,'approaching');assert.equal(k.short.action,'arrive');
  k=arrivalKey({...lek,state:'occupied',direction:'in',trainNumber:'999'},ctx());assert.equal(k.step,'approaching','an unknown train can still be received');assert.equal(k.number,'999');
  k=arrivalKey(lek,ctx([{id:'m3',arrival:'arrived'}]));assert.equal(k.step,'none');
  assert.equal(buildPages([],15,[lek]).flat().filter(k=>k.type==='train').map(k=>k.role).join(),'departure,arrival');
});

test('directions come from the service stop lists by service and times, with the station block collapsed',()=>{
  const routes=[
    {id:'s1-1',service_id:'s1',station_id:'vag',stop_order:1,departure_time:'05:00'},{id:'s1-2',service_id:'s1',station_id:'cda',stop_order:2,arrival_time:'05:48',departure_time:'05:50'},{id:'s1-3',service_id:'s1',station_id:'cda',stop_order:3,arrival_time:'05:51',departure_time:'05:55'},{id:'s1-4',service_id:'s1',station_id:'lek',stop_order:4,arrival_time:'06:10'},
    {id:'s2-1',service_id:'s2',station_id:'cda',stop_order:1,departure_time:'05:05'},{id:'s2-2',service_id:'s2',station_id:'kuf',stop_order:2,arrival_time:'05:30'},
    {id:'bad',service_id:'s3',station_id:'cda',stop_order:'x'}];
  const live=[{id:'m1',station_id:'cda',service_id:'s1',train_number:'102',arrival_time:'05:48',departure_time:'05:50'},{id:'m2',station_id:'cda',service_id:'s2',train_number:'3581',arrival_time:null,departure_time:'05:05'},{id:'m3',station_id:'lek',service_id:'s1',train_number:'102'},{id:'m4',station_id:'cda',service_id:'s9',train_number:'1'}];
  const d=routeDirections(routes,live,'cda');
  assert.deepEqual(d.m1,{from:'vag',to:'lek'});assert.deepEqual(d.m2,{from:'',to:'kuf'});assert.equal(d.m3,undefined);assert.equal(d.m4,undefined);
  assert.deepEqual(d['#102'],{from:'vag',to:'lek'});
  assert.deepEqual(routeDirections(undefined,live,'cda'),{});assert.deepEqual(routeDirections(routes,[],'cda'),{});
});
