import test from 'node:test';
import assert from 'node:assert/strict';
import {labelClass,objectFromMessage} from '../public/plan-objects.js';

test('plan labels are typeset by kind: track designations, road marks, place names',()=>{
  assert.deepEqual(['1a','2c','11','3d','10'].map(labelClass),['lbl-track','lbl-track','lbl-track','lbl-track','lbl-track']);
  assert.deepEqual(['V1','v4'].map(labelClass),['lbl-road','lbl-road']);
  assert.deepEqual(['Godsspår 51','Kolgård','Stationshus','Spår 6','Lastspår 1','3e '].map(labelClass),['lbl-place','lbl-place','lbl-place','lbl-place','lbl-place','lbl-track']);
});

test('journal rows name the plan object they concern',()=>{
  assert.deepEqual(objectFromMessage('Signal 2a/11 rapporterar kör utan medgivande. Begär stopp.'),{kind:'signal',name:'2a/11'});
  assert.deepEqual(objectFromMessage('Vx162 ligger kvar i fel läge.'),{kind:'turnout',name:'Vx162'});
  assert.deepEqual(objectFromMessage('Tågväg väntar på växel 162.'),{kind:'turnout',name:'Vx162'});
  assert.deepEqual(objectFromMessage('Au → Spår 1c: växlarna återrapporterar rätt läge.'),{kind:'route',name:'Au → Spår 1c'});
  assert.deepEqual(objectFromMessage('SIIIB: administrativ spärr lagd. Detektorns återrapport är oförändrad.'),{kind:'block',name:'SIIIB'});
  assert.equal(objectFromMessage('Modellklockan är pausad med hastighet 1×.'),null);
  assert.equal(objectFromMessage(''),null);
});
