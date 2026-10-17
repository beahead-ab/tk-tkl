import test from 'node:test';
import assert from 'node:assert/strict';
import {createRouteTargets} from '../public/route-targets.js';
const settle=()=>new Promise(r=>setImmediate(r));
function rig(){const loads=[],changes=[];let tick;
 const c=createRouteTargets({load:(from,kind)=>new Promise((resolve,reject)=>loads.push({from,kind,resolve,reject})),onChange:()=>changes.push(1),setTimer:f=>{tick=f;return 1;},clearTimer:()=>{tick=null;}});
 return {c,loads,changes,tick:()=>tick?.()};
}
test('targets stay disabled until checked; refresh removes unavailable targets and fails closed',async()=>{
 const r=rig();r.c.select('a','main');assert.equal(r.c.loading,true);assert.equal(r.c.has('b'),false);
 r.loads[0].resolve({targets:[{id:'b',action:'build'},{id:'c',action:'cancel'}]});await settle();
 assert.equal(r.c.has('b'),true);assert.equal(r.c.action('c'),'cancel');
 r.tick();r.loads[1].resolve({targets:[{id:'c',action:'cancel'}]});await settle();assert.equal(r.c.has('b'),false);
 r.tick();r.loads[2].reject(Error('offline'));await settle();assert.equal(r.c.has('c'),false);
 r.c.clear();
});
test('old preview responses cannot unlock targets after cancel, switching start or route kind',async()=>{
 const r=rig();r.c.select('a','main');r.c.select('s','shunt');
 r.loads[0].resolve({targets:[{id:'b',action:'build'}]});await settle();assert.equal(r.c.has('b'),false);
 r.loads[1].resolve({targets:[{id:'t',action:'build'}]});await settle();assert.equal(r.c.has('t'),true);
 r.tick();r.c.clear();r.loads[2].resolve({targets:[{id:'u',action:'build'}]});await settle();
 assert.equal(r.c.has('u'),false);assert.equal(r.c.has('t'),false);assert.equal(r.tick(),undefined);
});
