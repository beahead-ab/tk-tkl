import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeZoom,zoomGeometry} from '../public/panel-layout.js';

test('fit keeps the complete original plan visible, including phone and short screens',()=>{
  for(const [w,h] of [[1280,496],[1920,808],[390,520],[900,250]]){
    const g=zoomGeometry(w,h,2102,688,100);
    assert.ok(g.width<=w+.001&&g.height<=h+.001);
    assert.ok(Math.abs(g.width/g.height-2102/688)<1e-9);
    assert.equal(g.stageWidth,w);assert.equal(g.stageHeight,h);
    assert.ok(Math.abs(g.width-w)<.001||Math.abs(g.height-h)<.001);
  }
});
test('manual zoom scales both axes equally and adds scroll space only where needed',()=>{
  const fit=zoomGeometry(1280,496,2102,688,100);
  const enlarged=zoomGeometry(1280,496,2102,688,175);
  assert.equal(enlarged.width,fit.width*1.75);assert.equal(enlarged.height,fit.height*1.75);
  assert.equal(enlarged.stageWidth,enlarged.width);assert.equal(enlarged.stageHeight,enlarged.height);
  const small=zoomGeometry(1280,496,2102,688,50);
  assert.equal(small.width,fit.width/2);assert.equal(small.stageWidth,1280);assert.equal(small.stageHeight,496);
  assert.equal(zoomGeometry(0,0,2102,688,175),null);
});
test('missing or corrupt local preferences fall back safely; supported values are bounded',()=>{
  for(const value of [undefined,null,'','  ','invalid',NaN,Infinity,{},true])assert.equal(normalizeZoom(value),100);
  assert.equal(normalizeZoom('175'),175);assert.equal(normalizeZoom(173),175);
  assert.equal(normalizeZoom(500),300);assert.equal(normalizeZoom(-10),50);
});
