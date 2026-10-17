import test from 'node:test';
import assert from 'node:assert/strict';
import {alarmCount,category,eventKey,filterEvents,latestAlarm,tone,visibleEvents} from '../public/panel-events-model.js';

const e=(id,kind,message='x')=>({id,at:1000+id,kind,message});

test('tones map the core kinds without changing them',()=>{
  assert.deepEqual(['error','unexpected-go','bad-frame','emergency'].map(tone),['alarm','alarm','alarm','alarm']);
  assert.deepEqual(['all-stop','route-held','line-block','permission'].map(tone),['warn','warn','warn','warn']);
  assert.deepEqual(['established','route-active','released','panel-reset-complete'].map(tone),['ok','ok','ok','ok']);
  assert.deepEqual(['route-request','trainmeet','clock','startup','whatever'].map(tone),['info','info','info','info','info']);
  assert.deepEqual(['route-request','train-entered','clock'].map(category),['route','train','other']);
});

test('filters hide field-level rows (reports, transport, orders, permissions) and count open alarms',()=>{
  const events=[e(5,'error','Block 3b osäker'),e(4,'report'),e(3,'transport'),e(2,'established'),e(1,'train-entered'),e(0,'route-held'),e(-1,'permission','Signal 1/1: begär körmedgivande.'),e(-2,'order','Vx142: begär rakt.'),e(-3,'streamdeck')];
  assert.deepEqual(visibleEvents(events).map(x=>x.id),[5,2,1,0]);
  assert.deepEqual(filterEvents(events,'alarm').map(x=>x.id),[5]);
  assert.deepEqual(filterEvents(events,'route').map(x=>x.id),[2,0]);
  assert.deepEqual(filterEvents(events,'train').map(x=>x.id),[1]);
  assert.deepEqual(filterEvents(events,'all').map(x=>x.id),[5,2,1,0]);
  assert.equal(alarmCount(events,new Set()),1);
  assert.equal(latestAlarm(events,new Set()).message,'Block 3b osäker');
  const acked=new Set([eventKey(events[0])]);
  assert.equal(alarmCount(events,acked),0);assert.equal(latestAlarm(events,acked),null);
  assert.equal(eventKey({at:7,kind:'error',message:'m'}),'7\u0000error\u0000m');
  assert.deepEqual(filterEvents(undefined,'all'),[]);
});
