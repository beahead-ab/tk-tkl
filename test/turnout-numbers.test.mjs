import test from 'node:test';
import assert from 'node:assert/strict';
import {createTurnoutNumbers,readTurnoutNumbers,turnoutNumbersKey} from '../public/turnout-numbers.js';
const memory=()=>{const data=new Map();return {getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),clear:()=>data.clear()};};
test('85-vyn har släckta nummer, originalet tända; valet överlever omladdning per vy och station',()=>{
  const storage=memory(),root={dataset:{}},panelStyle={current:'modern85'},events=new EventTarget();
  const view=createTurnoutNumbers({station:'a',root,panelStyle,storage,events});
  assert.equal(view.visible,false);assert.equal(root.dataset.turnoutNumbers,'false');
  view.save(true);assert.equal(root.dataset.turnoutNumbers,'true');
  assert.equal(readTurnoutNumbers('a','modern85',storage),true);
  assert.equal(readTurnoutNumbers('b','modern85',storage),false);
  assert.equal(readTurnoutNumbers('a','modern85',memory()),false);
  panelStyle.current='original';events.dispatchEvent(new Event('panel-style-change'));
  assert.equal(view.visible,true);view.save(false);
  panelStyle.current='modern85';events.dispatchEvent(new Event('panel-style-change'));
  assert.equal(root.dataset.turnoutNumbers,'true');
  view.destroy();
  const reloaded=createTurnoutNumbers({station:'a',root,panelStyle,storage,events});
  assert.equal(reloaded.visible,true);reloaded.destroy();
});
test('lagringshändelser uppdaterar rätt vy, rensning återställer standarden och destroy tar bort lyssnarna',()=>{
  const storage=memory(),root={dataset:{}},panelStyle={current:'modern85'},events=new EventTarget();
  const view=createTurnoutNumbers({station:'a',root,panelStyle,storage,events});
  const storageEvent=key=>{const e=new Event('storage');e.key=key;events.dispatchEvent(e);};
  storage.setItem(turnoutNumbersKey('a','modern85'),'true');storageEvent(turnoutNumbersKey('b','modern85'));
  assert.equal(root.dataset.turnoutNumbers,'false');
  storageEvent(turnoutNumbersKey('a','modern85'));assert.equal(root.dataset.turnoutNumbers,'true');
  storage.clear();storageEvent(null);assert.equal(root.dataset.turnoutNumbers,'false');
  view.destroy();panelStyle.current='original';events.dispatchEvent(new Event('panel-style-change'));
  assert.equal(root.dataset.turnoutNumbers,'false');
});
test('blockerad lagring behåller vyns standard och visar ett begripligt sparfel',()=>{
  const storage={getItem(){throw Error();},setItem(){throw Error();}},root={dataset:{}},panelStyle={current:'modern85'};
  const view=createTurnoutNumbers({station:'a',root,panelStyle,storage,events:null});
  assert.equal(view.visible,false);assert.throws(()=>view.save(true),/kunde inte spara/);
  assert.equal(root.dataset.turnoutNumbers,'false');
  assert.equal(readTurnoutNumbers('a','original',storage),true);
});
