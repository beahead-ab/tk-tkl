import test from 'node:test';
import assert from 'node:assert/strict';
import {MIN_BOTTOM,planHeight,readSplit,splitBounds} from '../public/panel-split-model.js';

test('on a wide screen the plan can only shrink: it already spans the width',()=>{
  const b=splitBounds({width:1920,height:1080,insetX:16,insetTop:10});
  assert.equal(b.max,623,'(1920 − 16) / 3.0552');
  assert.equal(b.min,280,'about 45 % of the full width');
  assert.equal(planHeight(0.9,1080,b),623,'dragging further down stops at the sides');
  assert.equal(planHeight(0.1,1080,b),280,'and further up at the smallest plan');
});

test('on a short wide window the plan can grow until the bottom row is at its smallest',()=>{
  const b=splitBounds({width:1920,height:760,insetX:16,insetTop:10});
  assert.equal(b.max,760-10-MIN_BOTTOM);
  assert.equal(planHeight(0.75,760,b),570);
});

test('on a portrait tablet the plan pans sideways, so it may grow to the bottom row limit',()=>{
  const b=splitBounds({width:834,height:1194,insetX:0,insetTop:6,portrait:true});
  assert.equal(b.min,273,'whole plan in the width');
  assert.equal(b.max,1194-6-MIN_BOTTOM);
});

test('a saved choice is read only when it is a share between 0 and 1',()=>{
  assert.equal(readSplit('0.55'),0.55);
  for(const bad of [null,'','x','0','1','-0.2','1.4'])assert.equal(readSplit(bad),null,String(bad));
});
