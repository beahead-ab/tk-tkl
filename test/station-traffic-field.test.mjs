// Stationsbindningarna provas i kärna, fältmodell och spårning utan nätverk eller riktiga driftdata.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Engine } from '../src/engine.mjs';
import { Field } from '../src/field.mjs';
import { TrainTracker, EDGES, INCOMING_FIELDS, GRACE_MS } from '../src/train-tracking.mjs';
import { currentStation, stationData } from '../src/station.mjs';
import { stationTraffic } from '../src/station-traffic.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL('../'+p,import.meta.url)));
const profile=read('stations/trakvista/profiles/network.json'),fieldProfile=read('stations/trakvista/profiles/field.json');
const station=currentStation({CHARLOTTENDAL_STATION:'trakvista'}),panel=stationData('panel.json',station);
const traffic=stationTraffic(station,profile,panel);
function rig({edge='A',number='421',trafficModel=traffic,p=profile,plant=fieldProfile,pan=panel}={}){
  let now=100000;const queue=[];
  const field=new Field(plant,{traffic:trafficModel,now:()=>now,movementMs:100});
  const engine=new Engine(p,{storage:null,now:()=>now,send:b=>queue.push(['order',b])});
  field.on('frame',b=>queue.push(['report',b]));
  const tracker=new TrainTracker({profile:p,panel:pan,traffic:trafficModel,now:()=>now});
  const edgeInfo=Object.fromEntries(Object.keys(trafficModel.edgeLines).map(e=>[e,{name:'Granne '+e,stationId:'granne-'+e,incoming:true}]));
  const lines=[{id:'linje-'+edge,neighborId:'granne-'+edge,neighborName:'Granne '+edge,direction:'in',state:'occupied',trainNumber:number}];
  const track=()=>tracker.observe({blocks:engine.blocks,turnouts:engine.turnouts,routes:engine.routes,connected:true,lines,edgeInfo});
  const drain=()=>{let guard=20000;while(queue.length&&guard--){const [kind,b]=queue.shift();if(kind==='order')field.accept(b);else engine.receive(b);}assert.ok(guard>0,'återrapporterna ska lugna sig');};
  const advance=ms=>{for(let i=0;i<ms;i+=50){now+=50;field.tick();if(now%1000===0)field.allReports();drain();engine.tick();drain();track();}};
  engine.connection(true);field.allReports();drain();track();
  return {engine,field,tracker,advance,lines,edgeInfo};
}
for(const [edge,block,other] of [['A','SA2','B'],['B','SB2','C'],['C','SC2','A']]){
  test(`Träkvista ${edge}: rätt yttre block, numrerad infart till I och utfart mot ${other} lämnar fältmodellen`,()=>{
    const r=rig({edge});
    assert.equal(r.tracker.edgeBlock[edge],block);
    assert.deepEqual(r.field.spawnTrain({number:'421',at:'htv'+edge}),{number:'421',block});
    r.advance(2000);
    assert.equal(r.field.trains[0].standing,true,'väntar utan lagd infart');
    assert.equal(r.engine.blocks[block].occupied,true,'fältets beläggning når kärnan');
    assert.deepEqual(r.tracker.view().trains.map(t=>[t.number,t.head,t.source]),[['421',block,'TrainMeet']]);
    const into=r.engine.request('htv'+edge,'htvI');
    r.advance(7000+(into.passage.length+4)*900);
    assert.deepEqual(r.field.trains.map(t=>[t.number,t.standing,t.position,t.blocks]),[['421',true,'htvI',['SI']]],'ankommet tåg står kvar på I');
    assert.equal(r.engine.routes.length,0,'infartens lås frigivna efter ankomst');
    assert.deepEqual(r.tracker.view().trains.filter(t=>t.state==='station').map(t=>[t.number,t.head]),[['421','SI']]);
    r.lines.length=0;
    const out=r.engine.request('htvI','htv'+other);
    r.advance(7000+(out.passage.length+5)*900+GRACE_MS);
    assert.equal(r.field.trains.length,0,'tåget lämnar fältmodellen i stället för att bli uppställt på linjen');
    assert.equal(r.engine.routes.length,0,'utfartens lås frigivna efter passage');
    assert.equal(r.tracker.view().trains.length,0);
    assert.deepEqual(r.tracker.view().lines.map(l=>[l.number,l.edge,l.line,l.direction]),[['421',other,other,'out']]);
  });
}
test('Träkvistas spårning läser inga Charlottendalsfält, även när ett gammalt fält finns i anteckningsboken',()=>{
  const r=rig(),book={'incoming:AuppIn':{value:'CDA-401',updatedAt:100}};
  assert.deepEqual(r.tracker.incomingFields,{});
  r.lines.length=0;
  r.field.spawnTrain({number:'421',at:'htvA'});r.advance(2000);
  const observe=()=>r.tracker.observe({blocks:r.engine.blocks,turnouts:r.engine.turnouts,routes:[],connected:true,book,lines:[],edgeInfo:r.edgeInfo});
  observe();assert.equal(r.tracker.view().trains[0].number,'');
  book['incoming:AuppIn'].value='CDA-403';observe();assert.equal(r.tracker.view().trains[0].number,'');
});
test('en annan stations linjeknapp behöver inga namn inbyggda i fältmodellen',()=>{
  const renamed=JSON.parse(JSON.stringify(traffic));renamed.edgeLines={North:'N'};renamed.edgeBlocks={North:'SA2'};
  const plant=JSON.parse(JSON.stringify(fieldProfile));
  for(const s of [...plant.scenarios,...(plant.scenarioAlternatives||[])])s.id=s.id.replaceAll('htvA--','htvNorth--').replaceAll('--htvA','--htvNorth');
  const f=new Field(plant,{traffic:renamed,now:()=>100000});
  assert.deepEqual(f.spawnTrain({number:'N1',at:'htvNorth'}),{number:'N1',block:'SA2'});
  assert.throws(()=>f.spawnTrain({number:'N2',at:'htvA'}),/Okänt spår/,'en gammal stationsknapp blir inte linje i nästa station');
});
const cdaExists=fs.existsSync(new URL('../profiles/charlottendal-network.json',import.meta.url));
test('Charlottendals uttryckliga stationsmodell behåller samtliga äldre kant- och fältbindningar',{skip:!cdaExists},()=>{
  const cda=currentStation({CHARLOTTENDAL_STATION:'charlottendal'}),p=read('profiles/charlottendal-network.json'),pan=stationData('panel.json',cda);
  const model=stationTraffic(cda,p,pan),old=new TrainTracker({profile:p,panel:pan}),configured=new TrainTracker({profile:p,panel:pan,traffic:model});
  assert.deepEqual(model.edgeLines,EDGES);assert.deepEqual(model.incomingFields,INCOMING_FIELDS);
  for(const key of ['edgeLines','incomingFields','edgeOf','exitEdge','edgeBlock'])assert.deepEqual(configured[key],old[key],key+' är oförändrad');
});
test('Charlottendals samtliga tidigare uppställningsknappar ger samma block och fel med stationsmodell',{skip:!cdaExists},()=>{
  const cda=currentStation({CHARLOTTENDAL_STATION:'charlottendal'}),p=read('profiles/charlottendal-network.json'),plant=read('profiles/simulator-network.json'),model=stationTraffic(cda,p,stationData('panel.json',cda));
  const result=(f,at)=>{try{return f.spawnTrain({number:'CDA-421',at});}catch(e){return {error:e.message};}};
  const buttons=new Set([...plant.scenarios,...(plant.scenarioAlternatives||[])].flatMap(s=>s.id.split('--')));
  for(const at of buttons){
    const old=new Field(plant),configured=new Field(plant,{traffic:model});
    assert.deepEqual(result(configured,at),result(old,at),at+' är oförändrad');
  }
});
