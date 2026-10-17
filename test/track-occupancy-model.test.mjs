import test from 'node:test';
import assert from 'node:assert/strict';
import {barSpan,hhmm,occupancyModel} from '../public/track-occupancy-model.js';

const row=(i,number,track,arrival,departure,group='next')=>({i,number,track,arrival,departure,group});

test('a bar runs from arrival to departure; trains that start or end here get the design margins',()=>{
  assert.deepEqual(barSpan({arrival:'06:17',departure:'06:20'}),{start:377,end:380,open:false});
  assert.deepEqual(barSpan({arrival:'',departure:'05:27'}),{start:321,end:327,open:false});
  assert.deepEqual(barSpan({arrival:'06:35',departure:''}),{start:395,end:423,open:true});
  assert.deepEqual(barSpan({arrival:'23:50',departure:'00:10'}),{start:1430,end:1450,open:false});
  assert.equal(barSpan({arrival:'',departure:''}),null);
});

test('the window follows the clock in ten-minute steps: 50 back, 100 ahead',()=>{
  const m=occupancyModel([row(0,'3510','C · 1a','06:17','06:20','now'),row(1,'4142','RBG · 12','06:35','','next'),row(2,'4821','RBG · 13','','05:27','done'),row(3,'104','C · 1a','09:40','09:42')],{minutes:6*60+12});
  assert.equal(m.label,'05:20 – 07:50 · planerad');
  assert.deepEqual(m.ticks.map(t=>t.label),['05:30','06:00','06:30','07:00','07:30']);
  assert.equal(m.now,'34.67%');
  assert.deepEqual(m.tracks.map(t=>t.name),['C · 1a','RBG · 12','RBG · 13']);
  const bar=m.tracks[0].bars[0];
  assert.equal(bar.number,'3510');assert.equal(bar.group,'now');assert.equal(bar.left,'38.00%');assert.equal(bar.width,'2.00%');
  assert.equal(bar.title,'3510 · 06:17 – 06:20 · C · 1a');
  assert.equal(m.tracks[1].bars[0].open,true);
  assert.equal(m.tracks[1].bars[0].title,'4142 · 06:35 – slutar · RBG · 12');
  assert.ok(!m.tracks.some(t=>t.bars.some(b=>b.number==='104')),'a train outside the window is not drawn');
});

test('without a clock the window spans the whole timetable in half hours',()=>{
  const m=occupancyModel([row(0,'101','1a','06:06','06:08'),row(1,'104','2a','07:44','07:46')]);
  assert.equal(m.label,'06:00 – 08:00 · planerad');
  assert.equal(m.now,null);
  assert.deepEqual(m.ticks.map(t=>t.label),['06:30','07:00','07:30']);
});

test('tracks are sorted naturally and rows without track or times are skipped',()=>{
  const m=occupancyModel([row(0,'1','Spår 10','06:00','06:05'),row(1,'2','Spår 2','06:00','06:05'),row(2,'3','','06:00','06:05'),row(3,'4','Spår 3','','')],{minutes:360});
  assert.deepEqual(m.tracks.map(t=>t.name),['Spår 2','Spår 10']);
});

test('an empty timetable gives an empty model',()=>{
  assert.deepEqual(occupancyModel([],{minutes:360}).empty,true);
  assert.deepEqual(occupancyModel([]).empty,true);
  assert.equal(hhmm(1450),'00:10');
});
