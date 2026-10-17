import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionInfo,commandExpectations,protocolObjects} from '../src/communication-diagnostics.mjs';
import {switchOrder,switchReport,hex,decode} from '../src/protocol.mjs';
const profile={transport:{host:'127.0.0.1',port:8912},staleMs:7000,commandTimeoutMs:6000,turnouts:{Vx131:{address:131,inverted:true}},blocks:{},signals:{S:{address:1501,reportAddress:1502,stopCodes:[0],goCodes:[8,18]}}};
const state=()=>({connection:'connected',serverTime:1100,turnouts:{Vx131:{commandAt:1000,commandSequence:5,desired:'C',position:'C',updatedAt:1000,reportSequence:6}},signals:{}});
test('mode is explicit, never guessed from loopback transport, and physical gateway can be selected',()=>{
  assert.equal(connectionInfo(profile,{}).mode,'unspecified');
  assert.equal(connectionInfo(profile,{CHARLOTTENDAL_CONNECTION_MODE:'simulator'}).mode,'simulator');
  const hardware=connectionInfo(profile,{CHARLOTTENDAL_CONNECTION_MODE:'hardware',CHARLOTTENDAL_WIRE_HOST:'gateway.local',CHARLOTTENDAL_WIRE_PORT:'1234'});assert.equal(hardware.host,'gateway.local');assert.equal(hardware.port,1234);
  assert.throws(()=>connectionInfo(profile,{CHARLOTTENDAL_CONNECTION_MODE:'guess'}));
});
test('inverted turnout expectation uses the physical address and polarity exactly once',()=>{
  const row=commandExpectations(profile,state())[0];assert.equal(row.status,'confirmed');assert.equal(row.order,hex(switchOrder(131,'T')));assert.deepEqual(row.expected,[hex(switchReport(131,'T'))]);
  assert.deepEqual(protocolObjects(profile,decode(switchOrder(131,'T')))[0].expected,row.expected);
});
test('pre-command, stale, wrong and disconnected reports cannot satisfy an order',()=>{
  const s=state();s.turnouts.Vx131.reportSequence=5;assert.equal(commandExpectations(profile,s)[0].status,'waiting');
  s.serverTime=10000;assert.equal(commandExpectations(profile,s)[0].status,'timeout');
  s.connection='disconnected';assert.equal(commandExpectations(profile,s)[0].status,'disconnected');
  const wrong=state();wrong.turnouts.Vx131.position='T';assert.equal(commandExpectations(profile,wrong)[0].status,'waiting');
});
test('signal transport acknowledgement cannot replace a newer aspect report; report address and all allowed codes are retained',()=>{
  const s=state();s.signals.S={desired:'GO',commandAt:1000,commandSequence:8,updatedAt:999,reportSequence:7,aspect:'go'};
  let row=commandExpectations(profile,s).find(r=>r.name==='S');assert.equal(row.status,'waiting');assert.equal(row.reportAddress,1502);assert.equal(row.expected.length,2);assert.equal(row.provisional,true);
  s.signals.S.updatedAt=1050;s.signals.S.reportSequence=9;row=commandExpectations(profile,s).find(r=>r.name==='S');assert.equal(row.status,'confirmed');
  assert.deepEqual(protocolObjects(profile,{kind:'signal',address:1501}),[]);assert.equal(protocolObjects(profile,{kind:'signal',address:1502})[0].name,'S');
});
