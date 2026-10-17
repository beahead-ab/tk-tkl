import test from 'node:test';
import assert from 'node:assert/strict';
import {TrainInformation} from '../src/train-information.mjs';
const profile={blocks:{A:{address:1},AliasA:{address:1},B:{address:2},C:{address:3}}};
const catalog={sourceHash:'test',fields:[{key:'incoming:in',kind:'incoming',name:'in'},...Object.keys(profile.blocks).map(name=>({key:'block:'+name,kind:'block',name}))],anchors:[{key:'block:A'},{key:'block:B'},{key:'block:C'}]};
function rig(){
  const disk=new Map(),storage={load:(n,f)=>structuredClone(disk.get(n)??f),save:(n,v)=>disk.set(n,structuredClone(v))};
  const book=new TrainInformation(catalog,profile,{storage,sessionId:'session'});
  const blocks=Object.fromEntries(Object.keys(profile.blocks).map(n=>[n,{occupied:false}]));
  const route={id:'route',definitionId:'definition',label:'A → C',blocks:['A','B','C'],autoRelease:true,state:'active',passage:[1,2,3].map(address=>({address,state:'pending'}))};
  const observe=()=>book.observe(blocks,true,[route]);observe();
  const request=keys=>({sessionId:book.sessionId,revision:book.data.revision,epochs:Object.fromEntries(keys.map(k=>[k,book.epochs[k]||0]))});
  const save=(key,value)=>book.save({...request([key]),key,value});
  const follow=key=>book.follow({...request([key]),key,routeId:'route'});
  const report=(index,occupied)=>{for(const [n,b] of Object.entries(profile.blocks))if(b.address===index+1)blocks[n].occupied=occupied;route.state='traversing';route.passage[index].state=occupied?'occupied':'clear';observe();};
  return {book,disk,storage,blocks,route,observe,request,save,follow,report};
}
test('explicit identity follows accepted ordered reports once; completion requires review and never writes field state',()=>{
  const r=rig();r.save('incoming:in','P421');r.follow('incoming:in');const initial=structuredClone(r.route);
  r.observe();assert.equal(r.book.data.revision,2);assert.equal(r.book.data.entries['incoming:in'].value,'P421');
  for(let i=0;i<3;i++){r.report(i,true);const key='block:'+['A','B','C'][i];assert.equal(r.book.data.entries[key].value,'P421');assert.equal(r.book.snapshot().entries[key].needsReview,false);const rev=r.book.data.revision;r.observe();assert.equal(r.book.data.revision,rev);r.report(i,false);}
  assert.equal(r.book.data.follows[0].status,'complete');assert.equal(r.book.snapshot().entries['block:C'].needsReview,true);
  assert.equal(r.book.data.entries['block:C'].source,'follow');assert.equal(r.book.data.history.filter(h=>h.kind==='follow-move').length,3);assert.equal(r.route.id,initial.id);assert.equal(r.route.state,'traversing');
  assert.deepEqual(r.disk.get('train-information.json'),r.book.data);
});
test('start rejects unconfirmed or duplicate identity, wrong starting block, aliases and non-ready routes',()=>{
  const r=rig();r.save('incoming:in','421');r.save('block:B','421');assert.throws(()=>r.follow('incoming:in'),/unikt/);r.save('block:B','');
  r.save('block:AliasA','X');assert.throws(()=>r.follow('incoming:in'),/redan tåginformation/);r.save('block:AliasA','');
  r.save('block:B','22');assert.throws(()=>r.follow('block:B'),/första detektor/);r.save('block:B','');
  r.route.state='setting';assert.throws(()=>r.follow('incoming:in'),/klar tågväg/);r.route.state='active';r.follow('incoming:in');assert.throws(()=>r.follow('incoming:in'),/redan en/);
});
test('a held route, skipped detector or an occupied information alias pauses without overwriting',()=>{
  for(const scenario of ['held','skip','alias']){const r=rig();r.save('incoming:in','421');r.follow('incoming:in');
    if(scenario==='held'){r.route.state='held';r.observe();}
    if(scenario==='skip')r.report(1,true);
    if(scenario==='alias'){r.save('block:AliasA','99');r.report(0,true);assert.equal(r.book.data.entries['block:AliasA'].value,'99');}
    assert.equal(r.book.data.follows[0].status,'paused',scenario);assert.equal(r.book.data.entries['incoming:in'].value,'421');assert.equal(r.book.snapshot().entries['incoming:in'].needsReview,true);
  }
});
test('disconnect and unknown detector pause durably; restored reports never resume',()=>{
  for(const disconnect of [true,false]){const r=rig();r.save('incoming:in','421');r.follow('incoming:in');r.report(0,true);
    if(disconnect)r.book.observe(r.blocks,false,[r.route]);else{r.blocks.C.occupied=null;r.observe();}
    assert.equal(r.book.data.follows[0].status,'paused');r.blocks.C.occupied=false;r.report(1,true);assert.equal(r.book.data.entries['block:A'].value,'421');assert.equal(r.book.data.entries['block:B'],undefined);
  }
});
test('restart preserves last identity and stops association even if same route is reported again',()=>{
  const r=rig();r.save('incoming:in','421');r.follow('incoming:in');r.report(0,true);
  const restarted=new TrainInformation(catalog,profile,{storage:r.storage,sessionId:'next'});
  assert.equal(restarted.snapshot().follows[0].status,'paused');assert.equal(restarted.snapshot().entries['block:A'].needsReview,true);
  restarted.observe(r.blocks,true,[r.route]);assert.equal(restarted.data.follows[0].status,'paused');assert.equal(r.disk.get('train-information.json').follows[0].status,'paused');
});
test('duplicate identity and manual edits detach or pause instead of stealing new information',()=>{
  const r=rig();r.save('incoming:in','421');r.follow('incoming:in');r.save('block:C','421');r.observe();assert.equal(r.book.data.follows[0].status,'paused');
  r.save('block:C','');r.save('incoming:in','422');assert.equal(r.book.data.follows[0].status,'stopped');r.follow('incoming:in');r.save('incoming:in','423');assert.equal(r.book.data.follows[0].status,'stopped');r.report(0,true);assert.equal(r.book.data.entries['incoming:in'].value,'423');
});
test('write failure leaves number and progress atomic, freezes following, and cannot affect route or detectors',()=>{
  const r=rig();r.save('incoming:in','421');r.follow('incoming:in');const before=structuredClone(r.book.data);
  r.storage.save=()=>{throw Error('disk full');};r.report(0,true);assert.deepEqual(r.book.data,before);assert.deepEqual(r.disk.get('train-information.json'),before);assert.match(r.book.snapshot().fault,/disk full/);assert.equal(r.book.snapshot().follows[0].status,'paused');
  assert.equal(r.book.snapshot().entries['incoming:in'].needsReview,true);assert.throws(()=>r.save('incoming:in','99'),/lagring/);r.report(1,true);assert.deepEqual(r.book.data,before);assert.equal(r.blocks.B.occupied,true);assert.equal(r.route.state,'traversing');
});
test('manual stop and stale revisions are enforced; schema1 migrates without losing entries',()=>{
  const r=rig();r.save('incoming:in','421');const old=r.request(['incoming:in']);r.follow('incoming:in');assert.throws(()=>r.book.follow({...old,key:'incoming:in',routeId:'route'}),e=>e.status===409);
  r.book.unfollow({...r.request([]),id:r.book.data.follows[0].id});assert.equal(r.book.data.follows[0].status,'stopped');r.report(0,true);assert.equal(r.book.data.entries['incoming:in'].value,'421');
  const legacy={schema:1,sourceHash:'test',revision:1,entries:{'incoming:in':{value:'old',source:'manual',updatedAt:1,sessionId:'old',epoch:0}},history:[]};r.disk.set('train-information.json',legacy);
  const migrated=new TrainInformation(catalog,profile,{storage:r.storage});assert.equal(migrated.data.schema,2);assert.equal(migrated.data.entries['incoming:in'].value,'old');assert.equal(migrated.snapshot().entries['incoming:in'].needsReview,true);assert.equal(r.disk.get('train-information.json').schema,1);
});
test('operator cancellation preserves last placement and route instances are never reused',()=>{
  for(const missing of [true,false]){const r=rig();r.save('incoming:in','421');r.follow('incoming:in');r.report(0,true);
    if(missing)r.book.observe(r.blocks,true,[{...r.route,id:'different-instance'}]);else{r.route.cancelRequested=true;r.route.state='cancelling';r.observe();}
    assert.equal(r.book.data.follows[0].status,'paused');assert.equal(r.book.data.entries['block:A'].value,'421');
    r.route.cancelRequested=false;r.report(1,true);assert.equal(r.book.data.entries['block:B'],undefined);
  }
});
test('stored malformed progress refuses startup instead of assuming a location',()=>{
  const r=rig();r.save('incoming:in','421');r.follow('incoming:in');
  for(const change of [d=>d.follows[0].path[0].address=0,d=>d.follows[0].index=999,d=>d.follows[0].path[0].key='incoming:in',d=>d.follows.push(structuredClone(d.follows[0]))]){
    const saved=structuredClone(r.book.data);change(saved);r.disk.set('train-information.json',saved);assert.throws(()=>new TrainInformation(catalog,profile,{storage:r.storage}),/ogiltig/);
  }
});
