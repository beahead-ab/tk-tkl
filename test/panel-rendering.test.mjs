import test from 'node:test';
import assert from 'node:assert/strict';
import {attribute,style,text,flowProgress,createPanelFrames,preparingEndpoints} from '../public/panel-rendering.js';

test('bursts render the latest state once per frame; idle panels stop scheduling',()=>{
  const callbacks=new Map();let id=0,renders=0,animations=0,latest=0,shown=0,moving=false;
  const frames=createPanelFrames({request:fn=>{callbacks.set(++id,fn);return id;},cancel:id=>callbacks.delete(id),render:()=>{renders++;shown=latest;},animate:()=>{animations++;return moving;}});
  const tick=()=>{const [id,fn]=callbacks.entries().next().value;callbacks.delete(id);fn(100);};
  for(let n=1;n<=100;n++){latest=n;frames.paint();}
  assert.equal(callbacks.size,1);tick();assert.equal(shown,100);assert.equal(renders,1);assert.equal(callbacks.size,0);
  moving=true;frames.paint();tick();assert.equal(callbacks.size,1);tick();assert.equal(renders,2);assert.equal(animations,3);
  moving=false;tick();assert.equal(callbacks.size,0);
  frames.paint();frames.stop();assert.equal(callbacks.size,0);frames.paint();tick();assert.equal(renders,3);
});

test('light front follows a monotonic clock, never a later network or wall-clock jump',()=>{
  const route={state:'establishing',establishedAt:10000,flowDuration:1200},timing={};
  assert.equal(flowProgress(route,timing,500,10300),.25);
  assert.equal(flowProgress(route,timing,800,10000),.5);
  assert.equal(flowProgress(route,timing,700,50000),.5);
  assert.equal(flowProgress(route,timing,5000,0),1);
  assert.equal(flowProgress(route,{},500,10300,true),1);
  const preferenceChange={};flowProgress(route,preferenceChange,500,10300,true);
  assert.equal(flowProgress(route,preferenceChange,600,10400,false),1);
  assert.equal(flowProgress({...route,state:'held'},{},500,10000),1);
});

test('unchanged telemetry preserves attributes, style and text nodes',()=>{
  const values=new Map();let writes=0,current='';
  const node={getAttribute:k=>values.get(k),setAttribute(k,v){writes++;values.set(k,v);},style:{},get textContent(){return current;},set textContent(v){writes++;current=v;}};
  attribute(node,'visibility','visible');text(node,'Stopp');style(node,'visibility','visible');
  for(let n=0;n<100;n++){attribute(node,'visibility','visible');text(node,'Stopp');style(node,'visibility','visible');}
  assert.equal(writes,2);assert.equal(node.style.visibility,'visible');
  attribute(node,'visibility','hidden');text(node,'Okänt');assert.equal(writes,4);
});

test('preparation endpoint roles survive stage changes and stop on ready, failure or lost contact',()=>{
  const route={id:'one',from:'A',to:'B'};
  for(const state of ['setting','establishing','clearing']) {
    assert.deepEqual([...preparingEndpoints([{...route,state}])],[['A','start'],['B','end']]);
    assert.equal(preparingEndpoints([{...route,state}],false).size,0);
  }
  for(const state of ['active','traversing','held','occupied','cancelling','unknown'])assert.equal(preparingEndpoints([{...route,state}]).size,0);
  assert.equal(preparingEndpoints([]).size,0);
  const simultaneous=[{...route,state:'clearing'},{from:'C',to:'D',state:'setting'},{from:'E',to:'F',state:'active'}];
  assert.deepEqual([...preparingEndpoints(simultaneous)],[['A','start'],['B','end'],['C','start'],['D','end']]);
  assert.deepEqual([...preparingEndpoints([{...route,state:'clearing'},{from:'B',to:'C',state:'setting'}])],[['A','start'],['B','end'],['C','end']]);
});
