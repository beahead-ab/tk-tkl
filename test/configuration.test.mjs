import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Configuration } from '../src/configuration.mjs';
import { Storage } from '../src/storage.mjs';
const profile={signals:{'1/1':{address:1501}},turnouts:{Vx100:{address:100,source:'LT100'}},blocks:{S100:{address:3001}},buttons:{htvCu:{label:'Cu'}},routes:[{id:'cu-1',label:'Cu → Spår 1'}]};
function rig(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tkl-config-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const storage=new Storage(dir); let allowed=true;
  const options={storage,canActivate:()=>allowed,now:()=>1234567};
  return {store:new Configuration(profile,options),storage,options,lock:()=>{allowed=false;},unlock:()=>{allowed=true;}};
}
const save=store=>store.save({revision:store.data.revision,key:'signals:1/1',name:'Infart från Cu',description:'Signal vid västra infarten.'});
test('drafts, activation, restart and reviewed rollback retain history and immutable bindings',t=>{
  const {store,options}=rig(t), original=structuredClone(profile);
  let view=save(store);assert.equal(view.changes.length,2);assert.deepEqual(store.presentation().overrides,{});
  let restarted=new Configuration(profile,options);assert.equal(restarted.view().draft.overrides['signals:1/1'].name,'Infart från Cu');
  restarted.activate({revision:1,reason:'Namn på infarten'});
  restarted=new Configuration(profile,options);assert.equal(restarted.presentation().activeVersion,1);
  assert.equal(restarted.presentation().overrides['signals:1/1'].name,'Infart från Cu');
  view=restarted.restore({revision:2,version:0});assert.equal(view.changes.length,2);assert.equal(restarted.presentation().activeVersion,1);
  view=restarted.activate({revision:3,reason:'Återställ originalnamnet'});assert.equal(view.history.length,3);assert.equal(view.active.activeVersion,2);assert.deepEqual(view.active.overrides,{});
  assert.equal(restarted.data.versions[1].overrides['signals:1/1'].name,'Infart från Cu');assert.deepEqual(profile,original);
});
test('stale editors cannot overwrite a draft, discard it or activate it',t=>{
  const {store}=rig(t); save(store);
  for(const fn of [()=>store.save({revision:0,key:'signals:1/1',name:'B',description:''}),()=>store.discard({revision:0}),()=>store.activate({revision:0,reason:'B'}),()=>store.restore({revision:0,version:0})]) assert.throws(fn,e=>e.status===409);
  assert.equal(store.data.revision,1);assert.equal(store.data.draft.overrides['signals:1/1'].name,'Infart från Cu');
  assert.throws(()=>store.restore({revision:1,version:0}),/Granska eller kasta/);
});
test('activation and rollback stay blocked while locks remain; drafts may still be saved',t=>{
  const {store,lock,unlock}=rig(t);lock();save(store);
  assert.equal(store.view().activationAllowed,false);assert.throws(()=>store.activate({revision:1,reason:'Test'}),/tågvägslås/);assert.equal(store.data.revision,1);
  unlock();store.activate({revision:1,reason:'Test'});store.restore({revision:2,version:0});lock();
  assert.throws(()=>store.activate({revision:3,reason:'Återställ'}),/tågvägslås/);assert.equal(store.presentation().activeVersion,1);
});
test('invalid object names, operational fields and malformed persisted settings fail closed',t=>{
  const {store,storage,options}=rig(t);
  for(const values of [{key:'signals:missing',name:'A',description:''},{key:'signals:1/1',name:'',description:''},{key:'signals:1/1',name:'A\nB',description:''},{key:'signals:1/1',name:'A',description:'x'.repeat(1001)},{key:'signals:1/1',name:'A',description:'',address:999}]) assert.throws(()=>store.save({revision:0,...values}));
  assert.equal(store.data.revision,0);
  assert.ok(store.validate({'signals:1/1':{address:999}}).length);
  storage.save('configuration.json',{schema:1,revision:4,activeVersion:3,versions:[],draft:null});assert.throws(()=>new Configuration(profile,options),/ogiltiga/);
});
test('failed durable writes never activate or lose the previous version or draft',t=>{
  const {store,storage}=rig(t);save(store);const before=structuredClone(store.data), oldSave=storage.save.bind(storage);
  storage.save=()=>{throw Error('Disk full');};assert.throws(()=>store.activate({revision:1,reason:'Test'}),/Disk full/);assert.deepEqual(store.data,before);
  assert.throws(()=>store.discard({revision:1}),/Disk full/);assert.deepEqual(store.data,before);
  storage.save=oldSave;store.activate({revision:1,reason:'Nu sparat'});assert.equal(store.presentation().activeVersion,1);
});
