import test from 'node:test';
import assert from 'node:assert/strict';
import {trackColorState} from '../public/track-colors.js';
import {createAppTheme,readTheme,THEME_KEY} from '../public/app-theme.js';

test('beläggning går före spärr, lokalstyrning och låst tågväg',()=>{
  for(const blocked of [false,true])for(const local of [false,true])for(const locked of [false,true]){
    assert.equal(trackColorState({occupied:true,blocked,local,locked}),'occupied');
  }
  assert.equal(trackColorState({blocked:true,local:true,locked:true}),'blocked');
  assert.equal(trackColorState({local:true,locked:true}),'local');
  assert.equal(trackColorState({locked:true}),'locked');
  assert.equal(trackColorState(), 'free');
});
test('temat är mörkt som standard och använder Studios befintliga sparade val',()=>{
  const values=new Map(),store={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
  const root={dataset:{}},events=new EventTarget();let updates=0;
  events.addEventListener('app-theme-change',()=>updates++);
  const theme=createAppTheme({root,store,events});
  assert.equal(theme.current,'dark');assert.equal(root.dataset.theme,'dark');
  theme.save('light');assert.equal(values.get(THEME_KEY),'light');assert.equal(root.dataset.theme,'light');
  assert.equal(readTheme(store),'light');assert.equal(updates,1);
  values.set(THEME_KEY,'dark');const event=new Event('storage');event.key=THEME_KEY;events.dispatchEvent(event);
  assert.equal(root.dataset.theme,'dark');assert.equal(theme.current,'dark');
  values.set(THEME_KEY,'ogiltigt');assert.equal(readTheme(store),'dark');
});
test('ett lagringsfel lämnar det tillämpade temat orört',()=>{
  const root={dataset:{}},store={getItem(){return 'dark';},setItem(){throw Error('fullt');}};
  const theme=createAppTheme({root,store,events:new EventTarget()});
  assert.throws(()=>theme.save('light'),/kunde inte spara/);assert.equal(root.dataset.theme,'dark');
});
