import test from 'node:test';
import assert from 'node:assert/strict';
import {TrafficDepartures} from '../src/traffic-departures.mjs';
import {groupRows} from '../public/timetable-rows.js';
import {movementStatus,movementActions} from '../public/clearance-text.js';

function rig(){
  let now=1000,available=true;const calls=[];
  const meet={sessionId:'session',revision:1,origin:'https://example.test',paired:true,stale:false,context:{meetGeneration:1,publicationId:'pub',day:'Dagl',station:{id:'cda'},trains:[{id:'m92',train_number:'92',departure_time:'06:20'}],movements:[{id:'m92',departure:'positioned'}],lines:[{id:'line',neighborId:'vag',direction:'out',state:'reserved',trainNumber:'92'}]}};
  const reporter=new TrafficDepartures({available:()=>available,currentContext:()=>meet.context,now:()=>now,movement:async(data,{guard})=>{guard();calls.push(data);meet.context.movements[0].departure='departed';return structuredClone(meet);}});
  const standing={trains:[{id:'t1',number:'92',certain:true,state:'station'}],lines:[]};
  const left={trains:[],lines:[{id:'t1',number:'92',certain:true,direction:'out',stationId:'vag',since:1200}]};
  return {reporter,meet,standing,left,calls,advance:()=>{now+=5000;},disable:()=>{available=false;}};
}

test('tåg 92 lämnar banan, avgång anmäls en gång och tidtabell/klarering visar Avgått',async()=>{
  const r=rig();await r.reporter.tick(r.meet,r.standing);
  assert.deepEqual(r.calls,[],'uppställt eller lagd tågväg räcker inte');
  await r.reporter.tick(r.meet,r.left);
  assert.deepEqual(r.calls,[{sessionId:'session',revision:1,meetGeneration:1,movementId:'m92',departure:'departed'}]);
  assert.equal(r.reporter.view()[0].status,'confirmed');
  r.advance();await r.reporter.tick(r.meet,r.left);assert.equal(r.calls.length,1);
  const g=groupRows([{id:'m92',number:'92',departure:'06:20',movement:r.meet.context.movements[0],departureReport:r.reporter.view()[0]}],{minutes:628});
  assert.equal(g.done[0].lage,'Avgått');assert.equal(g.done[0].standing,false);assert.deepEqual(g.late,[]);
  assert.equal(movementStatus(r.meet.context.movements[0],r.meet.context.trains[0],r.reporter.view()[0]),'Avgått');
});

test('lokal utfart visar verifierad utpassage och anslutningsorsak, utan falsk avgång eller ny försening',async()=>{
  const r=rig();r.left.lines[0].stationId='';await r.reporter.tick(r.meet,r.standing);await r.reporter.tick(r.meet,r.left);
  const report=r.reporter.view()[0];assert.equal(report.status,'pending');assert.match(report.reason,/koppla utfarten/);assert.deepEqual(r.calls,[]);
  const train=r.meet.context.trains[0],m=r.meet.context.movements[0];
  assert.match(movementStatus(m,train,report),/^Lämnat ställverket/);assert.deepEqual(movementActions(m,train,false,report),[]);
  const g=groupRows([{id:train.id,number:'92',departure:'06:20',to:'Nävhyttan',track:'1a',movement:m,departureReport:report}],{minutes:628});
  assert.match(g.now[0].lage,/Lämnat ställverket/);assert.doesNotMatch(g.now[0].lage,/Uppställt|sen \d|tågväg ej lagd/);
  assert.equal(g.now[0].standing,false);assert.equal(g.now[0].activity,'departed');assert.equal(g.now[0].outState,'done');assert.equal(g.nextSummary,null);
  // Utpassagen försvinner ur spårningens korta historik, men rapporten ligger kvar.
  await r.reporter.tick(r.meet,{trains:[],lines:[]});assert.equal(r.reporter.view().length,1);
});

test('ingen automatisk rapport vid okänt/delat tåg, saknad klarering, fel granne eller bortkoppling',async()=>{
  for(const scenario of ['uncertain','split','unknown','ambiguous','free','neighbor','stale','live']){
    const r=rig();
    if(scenario==='uncertain')r.left.lines[0].certain=false;
    if(scenario==='unknown')r.standing.trains[0].number='';
    if(scenario==='ambiguous')r.meet.context.trains.push({...r.meet.context.trains[0],id:'m92b'}),r.meet.context.movements.push({id:'m92b',departure:'positioned'});
    if(scenario==='split')r.left.trains.push({...r.standing.trains[0],id:'t2'});
    if(scenario==='free')r.meet.context.lines[0].state='free';
    if(scenario==='neighbor')r.meet.context.lines[0].neighborId='other';
    if(scenario==='stale')r.meet.stale=true;
    if(scenario==='live')r.disable();
    await r.reporter.tick(r.meet,r.standing);await r.reporter.tick(r.meet,r.left);assert.equal(r.calls.length,0,scenario);
  }
});

test('rapporten följer inte med till ny träff, dag, station eller parkoppling',async()=>{
  for(const field of ['meetGeneration','publicationId','day','station','revision','origin']){
    const r=rig();r.meet.context.lines=[];await r.reporter.tick(r.meet,r.standing);await r.reporter.tick(r.meet,r.left);
    assert.equal(r.reporter.view().length,1);
    if(field==='station')r.meet.context.station={id:'other'};
    else if(field==='revision'||field==='origin')r.meet[field]='other';
    else r.meet.context[field]='other';
    await r.reporter.tick(r.meet,r.left);assert.deepEqual(r.reporter.view(),[],field);assert.equal(r.calls.length,0);
  }
});

test('serverfel behåller väntande status, bromsar återförsök och kräver bekräftad driftpost',async()=>{
  const r=rig();let attempts=0;
  r.reporter.movement=async()=>{attempts++;throw Error('Servern svarar inte');};
  await r.reporter.tick(r.meet,r.standing);await r.reporter.tick(r.meet,r.left);
  assert.equal(r.reporter.view()[0].status,'pending');assert.match(r.reporter.view()[0].reason,/Servern svarar inte/);
  await r.reporter.tick(r.meet,r.left);assert.equal(attempts,1);
  r.advance();r.reporter.movement=async()=>structuredClone(r.meet);await r.reporter.tick(r.meet,r.left);
  assert.equal(r.reporter.view()[0].status,'pending');assert.match(r.reporter.view()[0].reason,/inte bekräftat/);
  r.meet.context.movements[0].departure='departed';await r.reporter.tick(r.meet,r.left);assert.equal(r.reporter.view()[0].status,'confirmed');
});

test('köad rapport kontrollerar aktuell klarering och driftläge före skrivning',async()=>{
  const r=rig();let guard;
  r.reporter.movement=async(data,options)=>{guard=options.guard;return structuredClone(r.meet);};
  await r.reporter.tick(r.meet,r.standing);await r.reporter.tick(r.meet,r.left);
  r.meet.context.lines[0].state='free';assert.throws(guard,/underlag har ändrats/);
  r.meet.context.lines[0].state='reserved';r.disable();assert.throws(guard,/underlag har ändrats/);
});

test('väntande lokal avgång kan rapporteras när operatören kopplat den faktiska utfarten',async()=>{
  const r=rig();let neighbor='';r.left.lines[0].edge='Bu';r.reporter.edgeInfo=()=>({Bu:{stationId:neighbor}});
  await r.reporter.tick(r.meet,r.standing);await r.reporter.tick(r.meet,r.left);
  assert.equal(r.calls.length,0);assert.equal(r.reporter.view()[0].status,'pending');
  neighbor='vag';r.advance();await r.reporter.tick(r.meet,r.left);
  assert.equal(r.calls.length,1);assert.equal(r.reporter.view()[0].status,'confirmed');
});
