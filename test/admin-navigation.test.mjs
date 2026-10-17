import test from 'node:test';
import assert from 'node:assert/strict';
import {NAVIGATION_GROUPS,NAVIGATION_SECTIONS,REDIRECTS,STUDIO_ROUTES,studioTarget,resolveNavigation} from '../public/admin-navigation-model.js';
import {parseHash} from '../public/studio-model.js';
import {isLegacyView} from '../public/studio-legacy-views.js';

const registered=['#trainmeet','#tools/appearance','#tools/streamdeck','#tools/streamdeck/layout','#tools/journal',
  '#advanced/start','#advanced/protocol','#advanced/ai','#advanced/users','#advanced/update'];

test('Inställningar has ten entries in three groups; Anläggningen is one link to Studio',()=>{
  // Drift is the bottom row's tab in the signal box, not a page here (docs/installningar-plan.md).
  assert.deepEqual(NAVIGATION_GROUPS.map(g=>g.label),['Träffen','Den här datorn','Anläggningen']);
  assert.deepEqual(NAVIGATION_SECTIONS.map(s=>[s.group,s.label]),[
    ['traffen','TrainMeet'],['traffen','Händelser'],
    ['datorn','Kom igång'],['datorn','Utseende och ljud'],['datorn','Stream Deck'],['datorn','Banan (LocoNet)'],['datorn','AI-tjänst'],['datorn','Användare'],['datorn','Uppdatering'],
    ['anlaggningen','Studio']]);
  const studio=NAVIGATION_SECTIONS.at(-1);assert.equal(studio.href,'/studio.html');assert.equal(studio.hash,undefined);assert.deepEqual(studio.tabs,[]);
  // A group's entries stand together, so the rail shows each heading once.
  const order=NAVIGATION_SECTIONS.map(s=>s.group);assert.deepEqual([...new Set(order)],NAVIGATION_GROUPS.map(g=>g.key));
  assert.ok(order.every((g,i)=>!i||g===order[i-1]||!order.slice(0,i).includes(g)));
  for(const section of NAVIGATION_SECTIONS){
    for(const tab of section.tabs){
      assert.ok(!tab.external,"simulatorns sida länkas bara från Studio (0.75.0)");
      assert.ok(tab.hash===section.hash||tab.hash.startsWith(section.hash+'/'),`${tab.hash} belongs to ${section.hash}`);
      assert.ok(registered.includes(tab.hash),`${tab.hash} is a registered workspace`);
    }
  }
  const ids=NAVIGATION_SECTIONS.map(s=>s.id);
  assert.equal(new Set(ids).size,ids.length);
});

test('every registered address resolves to one section with a page title of its own',()=>{
  const titles=new Map();
  for(const hash of registered){
    const r=resolveNavigation(hash);
    assert.ok(r.section,`${hash} has a section`);
    assert.ok(r.title&&!r.title.includes('·'),`${hash} has a plain title`);
    titles.set(hash,r.title);
  }
  assert.equal(titles.get('#tools/appearance'),'Utseende och ljud');
  assert.equal(titles.get('#tools/journal'),'Händelser');
  assert.equal(titles.get('#advanced/protocol'),'Protokollinspelning');
  assert.equal(resolveNavigation('#advanced/protocol').section.label,'Banan (LocoNet)');
  assert.equal(resolveNavigation('#advanced/update').section.label,'Uppdatering');
  assert.equal(resolveNavigation('#tools/operations/blocks').section,null);
  const trainmeet=resolveNavigation('#trainmeet');
  assert.equal(trainmeet.section.status,'menu-trainmeet-status');assert.equal(trainmeet.title,'TrainMeet');
  assert.equal(resolveNavigation('#import/upload').section,null,'no page of the local timetable is left');
});

test('every old Anläggning address opens its page in Studio, and Studio knows that page',()=>{
  const cases={'#register':'#data/kalla','#register/station':'#konfigurera','#register/destinations':'#konfigurera/orter','#register/presentation':'#konfigurera/visning',
    '#register/bindings':'#driftsattning/bindningar','#register/bindings?x=1':'#driftsattning/bindningar','#advanced/xml':'#data/kalla','#advanced/migration':'#genomgang/inforande',
    '#register/object?record=signals%3A1%2F5':'#data/kalla?post=signals%3A1%2F5','#register/station?object=signals:1/5':'#konfigurera?objekt=1%2F5'};
  for(const [from,to] of Object.entries(cases))assert.equal(studioTarget(from),'/studio.html'+to,from);
  for(const [,to] of STUDIO_ROUTES){const p=parseHash(to);assert.equal('#'+p.tab+(p.view?'/'+p.view:''),to);if(p.view)assert.ok(isLegacyView(p.tab,p.view)||['regler','ovriga'].includes(p.view),to);}
  for(const hash of ['#panel','#advanced/start','#advanced/ai','#trainmeet','#registerx','',undefined])assert.equal(studioTarget(hash),null,String(hash));
});

test('the panel and unknown addresses never activate a section',()=>{
  for(const hash of ['#panel','',undefined,null]){const r=resolveNavigation(hash);assert.equal(r.section,null);assert.equal(r.title,'Ställverk');}
  for(const hash of ['#tools','#tools/zoom','#unknown/page','#registerx','#register']){const r=resolveNavigation(hash);assert.equal(r.section,null);assert.equal(r.title,'Inställningar');}
});

test('pages that only led on to others open their first real page',()=>{
  assert.deepEqual(REDIRECTS,{'#advanced':'#advanced/start','#tools':'#tools/appearance'});
  for(const to of Object.values(REDIRECTS))assert.ok(resolveNavigation(to).section);
});
