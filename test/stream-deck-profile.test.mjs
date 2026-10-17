import test from 'node:test';
import assert from 'node:assert/strict';
import {MODELS,keyCount,modelFor,validateLayout,defaultLayout,layoutPages,fits} from '../public/stream-deck-profile.js';
import {StreamDeckLayouts} from '../src/stream-deck-layout.mjs';

const pluppar=[{id:'htvAu',label:'Au',kind:'main'},{id:'htvCu',label:'Cu',kind:'main'},{id:'htvSpIb',label:'Spår 1b',kind:'main'},{id:'tvv1',label:'Signal 1/5',kind:'shunt'}];
const lines=[{id:'cda-lek',neighborId:'lek',neighborName:'Lekby',neighborCode:'LEK'}];
const ids=pluppar.map(p=>p.id);

test('models, key counts and the automatic layout as an editable starting point',()=>{
  assert.equal(keyCount('mk2'),15);assert.equal(keyCount('xl'),32);assert.equal(keyCount('mini'),6);assert.equal(keyCount('nope'),0);
  assert.equal(modelFor(5,3),'mk2');assert.equal(modelFor(8,4),'xl');assert.equal(modelFor(9,9),'');
  const layout=defaultLayout('mini',pluppar,lines);
  assert.equal(layout.model,'mini');assert.ok(layout.pages.length>=2);assert.ok(layout.pages.every(p=>p.keys.length===6));
  assert.deepEqual(layout.pages[0].keys.slice(0,5).map(k=>k.type),['system','system','system','system','system']);
  assert.deepEqual(layout.pages[0].keys[5],{type:'train',role:'departure',lineId:'cda-lek'});
  assert.equal(layout.pages.flat().length,layout.pages.length);
  assert.equal(layout.pages.flatMap(p=>p.keys).filter(k=>k?.type==='plupp').length,4);
  assert.throws(()=>defaultLayout('nope',pluppar),/modell/);
  assert.equal(Object.keys(MODELS).length,5);
});

test('validation normalises pages, names and empty keys and rejects what the installation does not have',()=>{
  const ok=validateLayout({model:'mini',pages:[{name:'  Drift ',keys:[{type:'system',id:'all-stop'},null,{type:'plupp',id:'htvAu'},{type:'train',role:'arrival',lineId:'cda-lek'},{type:'page',target:1}]},{keys:[]}]},{pluppIds:ids});
  assert.equal(ok.pages[0].name,'Drift');assert.equal(ok.pages[1].name,'Sida 2');assert.equal(ok.pages[0].keys.length,6);assert.equal(ok.pages[0].keys[5],null);assert.equal(ok.pages[1].keys.every(k=>k===null),true);
  assert.deepEqual(ok.pages[0].keys[4],{type:'page',target:1});
  for(const [layout,re] of [
    [null,/saknas/],[{model:'giant',pages:[]},/modell/],[{model:'mini',pages:[]},/1–20 sidor/],[{model:'mini',pages:[{keys:Array(7).fill(null)}]},/Sidan 1/],
    [{model:'mini',pages:[{keys:[{type:'plupp',id:'nope'}]}]},/Pluppen nope på sida 1, knapp 1 finns inte/],
    [{model:'mini',pages:[{keys:[{type:'system',id:'launch'}]}]},/Okänd driftknapp/],
    [{model:'mini',pages:[{keys:[{type:'train',role:'up',lineId:'x'}]}]},/sträckknapp/],
    [{model:'mini',pages:[{keys:[{type:'page',target:3}]}]},/sida som inte finns/],
    [{model:'mini',pages:[{keys:[{type:'rocket'}]}]},/Okänd knapptyp/],
    [{model:'mini',pages:[{keys:['x']}]},/Ogiltig knapp/]])assert.throws(()=>validateLayout(layout,{pluppIds:ids}),re);
});

test('a saved layout resolves against the panel, flags what is missing and fits only decks with enough keys',()=>{
  const layout=validateLayout({model:'mini',pages:[{name:'A',keys:[{type:'plupp',id:'htvAu'},{type:'plupp',id:'htvCu'},{type:'train',role:'departure',lineId:'cda-lek'},{type:'train',role:'arrival',lineId:'gone'},{type:'page',target:1},{type:'system',id:'cancel'}]},{name:'B',keys:[]}]},{pluppIds:ids});
  const pages=layoutPages(layout,{pluppar:pluppar.filter(p=>p.id!=='htvCu'),lines});
  assert.equal(pages.length,2);
  assert.deepEqual(pages[0].map(k=>k?.type),['plupp','missing','train','missing','page','system']);
  assert.equal(pages[0][0].label,'Au');assert.equal(pages[0][1].label,'htvCu');assert.equal(pages[0][2].neighborCode,'LEK');assert.equal(pages[0][3].title,'Sträcka saknas');
  assert.deepEqual(pages[0][4],{type:'page',target:1,title:'B'});assert.equal(pages[0][5].title,'Avbryt val');
  assert.equal(pages[1].every(k=>k===null),true);
  assert.equal(fits(layout,6),true);assert.equal(fits(layout,15),true);assert.equal(fits({model:'xl',pages:[]},15),false);assert.equal(fits(null,15),false);
});

test('the layout store keeps one layout per deck, known by serial, with drafts, revisions and restart',()=>{
  let saved;const storage={load:(n,d)=>structuredClone(saved??d),save:(n,v)=>{saved=structuredClone(v);}};
  let clock=Date.parse('2026-10-01T12:00:00Z');const now=()=>new Date(clock).toISOString();
  const store=new StreamDeckLayouts(storage,{pluppIds:ids,now});
  assert.deepEqual(store.view(),{version:2,revision:0,decks:{},legacy:null});
  assert.throws(()=>store.seen({serial:'',model:'mk2'}),/serienummer/);assert.throws(()=>store.seen({serial:'__proto__',model:'mk2'}),/serienummer/);assert.throws(()=>store.seen({serial:'A1',model:'giant'}),/modell/);
  // Decks report themselves without a revision and do not bump it.
  let view=store.seen({serial:'CL52K1A01234',model:'xl'});
  assert.equal(view.revision,0);assert.deepEqual(view.decks.CL52K1A01234,{name:'Stream Deck XL',model:'xl',lastSeen:'2026-10-01T12:00:00.000Z',active:null,draft:null,activeVersion:0,activatedAt:''});
  store.seen({serial:'AL31H2B05678',model:'mk2'});view=store.seen({serial:'AL31H2B09012',model:'mk2'});
  assert.equal(view.decks.AL31H2B05678.name,'Stream Deck MK.2');assert.equal(view.decks.AL31H2B09012.name,'Stream Deck MK.2 9012','a second deck of a model gets the end of its serial');
  clock+=30000;const writes=JSON.stringify(saved);store.seen({serial:'CL52K1A01234',model:'xl'});assert.equal(JSON.stringify(saved),writes,'seen again within a minute writes nothing');
  clock+=60000;store.seen({serial:'CL52K1A01234',model:'xl'});assert.equal(saved.decks.CL52K1A01234.lastSeen,'2026-10-01T12:01:30.000Z');
  // Editing one deck leaves the others alone.
  assert.throws(()=>store.save({revision:0,serial:'nope',layout:defaultLayout('xl',pluppar)}),/finns inte/);
  assert.throws(()=>store.save({revision:1,serial:'CL52K1A01234',layout:defaultLayout('xl',pluppar)}),/ändrats/);
  assert.throws(()=>store.save({revision:0,serial:'CL52K1A01234',layout:defaultLayout('mk2',pluppar)}),/gjord för Stream Deck MK.2/);
  assert.throws(()=>store.save({revision:0,serial:'CL52K1A01234',layout:{model:'xl',pages:[{keys:[{type:'plupp',id:'nope'}]}]}}),/Pluppen nope/);
  assert.throws(()=>store.activate({revision:0,serial:'CL52K1A01234'}),/inget utkast/);assert.throws(()=>store.reset({revision:0,serial:'CL52K1A01234'}),/gäller redan/);
  view=store.save({revision:0,serial:'CL52K1A01234',layout:defaultLayout('xl',pluppar,lines)});
  assert.equal(view.revision,1);assert.equal(view.decks.CL52K1A01234.draft.model,'xl');assert.equal(view.decks.AL31H2B05678.draft,null);
  clock=Date.parse('2026-10-03T10:14:00Z');
  view=store.activate({revision:1,serial:'CL52K1A01234'});
  assert.equal(view.decks.CL52K1A01234.activeVersion,1);assert.equal(view.decks.CL52K1A01234.draft,null);assert.equal(view.decks.CL52K1A01234.activatedAt,'2026-10-03T10:14:00.000Z');
  // Copy adapts the layout to the other model; the source's draft wins over its active layout.
  assert.throws(()=>store.copy({revision:2,serial:'AL31H2B09012',from:'AL31H2B05678'}),/standardlayouten/);
  assert.throws(()=>store.copy({revision:2,serial:'AL31H2B09012',from:'AL31H2B09012'}),/standardlayouten|annat deck/);
  view=store.copy({revision:2,serial:'AL31H2B09012',from:'CL52K1A01234'});
  assert.equal(view.decks.AL31H2B09012.draft.model,'mk2');assert.equal(view.decks.AL31H2B09012.draft.pages[0].keys.length,15);assert.equal(view.decks.AL31H2B09012.active,null);
  view=store.discard({revision:3,serial:'AL31H2B09012'});assert.equal(view.decks.AL31H2B09012.draft,null);
  assert.throws(()=>store.rename({revision:4,serial:'AL31H2B09012',name:'  '}),/1–40/);
  assert.throws(()=>store.rename({revision:4,serial:'AL31H2B09012',name:'Stream Deck XL'}),/redan/);
  view=store.rename({revision:4,serial:'AL31H2B09012',name:' Rangerbangården höger '});assert.equal(view.decks.AL31H2B09012.name,'Rangerbangården höger');
  // Survives restart, then reset and forget.
  const again=new StreamDeckLayouts(storage,{pluppIds:ids,now});
  assert.equal(again.view().revision,5);assert.equal(again.view().decks.CL52K1A01234.active.model,'xl');assert.equal(again.view().decks.AL31H2B09012.name,'Rangerbangården höger');
  view=again.reset({revision:5,serial:'CL52K1A01234'});assert.equal(view.decks.CL52K1A01234.active,null);assert.equal(view.decks.CL52K1A01234.activeVersion,2);
  view=again.remove({revision:6,serial:'AL31H2B05678'});assert.deepEqual(Object.keys(view.decks).sort(),['AL31H2B09012','CL52K1A01234']);
  storage.save=()=>{throw Error('disk');};assert.throws(()=>again.rename({revision:7,serial:'CL52K1A01234',name:'Huvudställverket'}),/kunde inte sparas/);assert.equal(again.view().revision,7);
  // A plupp a later release no longer has is shown as missing, not a reason to refuse to start.
  const gone={version:2,revision:3,decks:{A1:{name:'A',model:'mini',lastSeen:'',active:{model:'mini',pages:[{keys:[{type:'plupp',id:'gone'}]}]},draft:null,activeVersion:1,activatedAt:''}},legacy:null};
  assert.equal(new StreamDeckLayouts({load:()=>structuredClone(gone)},{pluppIds:ids}).view().decks.A1.active.pages[0].keys[0].id,'gone');
  assert.throws(()=>new StreamDeckLayouts({load:()=>({...gone,decks:{A1:{...gone.decks.A1,model:'giant'}}})},{pluppIds:ids}),/Ogiltig sparad Stream Deck-layout/);
  assert.throws(()=>new StreamDeckLayouts({load:()=>({...gone,decks:{A1:{...gone.decks.A1,active:{model:'mini',pages:[{keys:[{type:'rocket'}]}]}}}})},{pluppIds:ids}),/Ogiltig sparad Stream Deck-layout: Okänd knapptyp/);
});

test('the single layout of version 1 moves to the first deck of its model',()=>{
  let saved={revision:4,active:{model:'mk2',pages:[{name:'Drift',keys:[{type:'system',id:'all-stop'}]}]},draft:null,activeVersion:3,activatedAt:'2026-09-30T08:00:00Z'};
  const storage={load:(n,d)=>structuredClone(saved??d),save:(n,v)=>{saved=structuredClone(v);}};
  const store=new StreamDeckLayouts(storage,{pluppIds:ids,now:()=>'2026-10-03T10:00:00.000Z'});
  assert.equal(store.view().version,2);assert.equal(store.view().revision,4);assert.equal(store.view().legacy.layout.pages[0].name,'Drift');
  let view=store.seen({serial:'XL1',model:'xl'});assert.equal(view.decks.XL1.active,null,'an XL does not take an MK.2 layout');
  view=store.seen({serial:'MK1',model:'mk2'});assert.equal(view.decks.MK1.active.pages[0].name,'Drift');assert.equal(view.decks.MK1.activeVersion,1);assert.equal(view.decks.MK1.activatedAt,'2026-09-30T08:00:00Z');
  assert.equal(saved.version,2);
  assert.deepEqual(new StreamDeckLayouts({load:()=>({revision:0,active:null,draft:null,activeVersion:0,activatedAt:''})},{pluppIds:ids}).view(),{version:2,revision:0,decks:{},legacy:null});
});

import {setKey,swapKeys,addPage,renamePage,removePage,changeModel,keyLabel} from '../public/stream-deck-profile.js';
test('editing helpers return new layouts and keep page targets valid',()=>{
  let layout=validateLayout({model:'mini',pages:[{name:'A',keys:[{type:'page',target:1},{type:'page',target:2},{type:'plupp',id:'htvAu'}]},{name:'B',keys:[]},{name:'C',keys:[{type:'system',id:'cancel'}]}]},{pluppIds:ids});
  const original=structuredClone(layout);
  layout=setKey(layout,1,0,{type:'train',role:'arrival',lineId:'cda-lek'});assert.equal(layout.pages[1].keys[0].role,'arrival');
  layout=swapKeys(layout,0,0,2);assert.equal(layout.pages[0].keys[0].type,'plupp');assert.equal(layout.pages[0].keys[2].type,'page');
  layout=renamePage(layout,2,'  Klarering ');assert.equal(layout.pages[2].name,'Klarering');layout=renamePage(layout,2,' ');assert.equal(layout.pages[2].name,'Sida 3');
  layout=addPage(layout,'Norr');assert.equal(layout.pages.length,4);assert.equal(layout.pages[3].name,'Norr');assert.equal(layout.pages[3].keys.length,6);
  layout=removePage(layout,1);assert.equal(layout.pages.length,3);
  assert.equal(layout.pages[0].keys[2],null,'a jump to the removed page is cleared');assert.deepEqual(layout.pages[0].keys[1],{type:'page',target:1},'later targets shift down');
  assert.throws(()=>removePage({model:'mini',pages:[{name:'A',keys:[]}]},0),/minst en sida/);
  assert.equal(changeModel(layout,'mk2').pages[0].keys.length,15);
  const grid=changeModel({model:'mini',pages:[{name:'A',keys:[{type:'system',id:'cancel'},null,null,{type:'plupp',id:'htvAu'},null,null]}]},'mk2');
  assert.deepEqual(grid.pages[0].keys[5],{type:'plupp',id:'htvAu'},'a key keeps its row and column on a wider deck');
  assert.deepEqual(changeModel(grid,'mini').pages[0].keys[3],{type:'plupp',id:'htvAu'},'and back');assert.equal(changeModel(changeModel(layout,'mk2'),'mini').pages[0].keys.length,6);assert.throws(()=>changeModel(layout,'nope'),/modell/);
  assert.deepEqual(original.pages[0].keys[0],{type:'page',target:1},'the original is untouched');
  assert.equal(keyLabel({type:'plupp',id:'htvAu'},{pluppar}),'Au');assert.equal(keyLabel({type:'train',role:'departure',lineId:'cda-lek'},{lines}),'→ LEK');assert.equal(keyLabel({type:'page',target:2}),'Sida → 3');assert.equal(keyLabel({type:'system',id:'all-stop'}),'Alla signaler i stopp');assert.equal(keyLabel(null),'');
  // a layout with 20 pages cannot grow
  let big={model:'mini',pages:Array.from({length:20},()=>({name:'',keys:[]}))};assert.throws(()=>addPage(big),/högst 20/);
});

import {moveKey,movePage,missingPluppar,differences,firstFree,TURN_SLOTS} from '../public/stream-deck-profile.js';
test('keys carry their own text, an icon on operating keys and a hold; trains on turn and page navigation are keys too',()=>{
  const ok=validateLayout({model:'mini',pages:[{keys:[
    {type:'system',id:'panel-reset',label:' Återställ ',icon:'reset',hold:2000},
    {type:'plupp',id:'htvAu',label:'Spår 1c',icon:'stop',hold:1000},
    {type:'turn',slot:1,filter:'yard',details:false,label:'RBG'},
    {type:'turn',slot:12,filter:'line',lineId:'cda-lek'},
    {type:'nav',to:'next',icon:'next'},
    {type:'train',role:'departure',lineId:'cda-lek',icon:'train',hold:1000,label:'Lekby ut'}]}]},{pluppIds:ids});
  const keys=ok.pages[0].keys;
  assert.deepEqual(keys[0],{type:'system',id:'panel-reset',label:'Återställ',icon:'reset',hold:2000});
  assert.deepEqual(keys[1],{type:'plupp',id:'htvAu',label:'Spår 1c',hold:1000},'a route keeps its lamp: no icon');
  assert.deepEqual(keys[2],{type:'turn',slot:1,filter:'yard',details:false,label:'RBG'});
  assert.deepEqual(keys[3],{type:'turn',slot:12,filter:'line',lineId:'cda-lek'});
  assert.deepEqual(keys[4],{type:'nav',to:'next',icon:'next'});
  assert.deepEqual(keys[5],{type:'train',role:'departure',lineId:'cda-lek',label:'Lekby ut'},'a line key has no icon and no hold: its long press cancels');
  assert.equal(validateLayout({model:'mini',pages:[{keys:[{type:'turn',slot:2}]}]},{pluppIds:ids}).pages[0].keys[0].filter,'all');
  for(const [key,re] of [
    [{type:'system',id:'cancel',label:'x'.repeat(25)},/högst 24 tecken/],[{type:'system',id:'cancel',icon:'rocket'},/Okänd bild/],[{type:'system',id:'cancel',hold:500},/hålltid/],
    [{type:'turn',slot:0},/giltig plats/],[{type:'turn',slot:TURN_SLOTS+1},/giltig plats/],[{type:'turn',slot:1,filter:'some'},/urval/],[{type:'turn',slot:1,filter:'line'},/saknar sträcka/],
    [{type:'nav',to:'up'},/sidknapp/]])assert.throws(()=>validateLayout({model:'mini',pages:[{keys:[key]}]},{pluppIds:ids}),re);
  const pages=layoutPages(ok,{pluppar,lines});
  assert.deepEqual(pages[0][0],{type:'system',id:'panel-reset',title:'Återställ panel',caption:'håll 1 s',text:'Återställ',icon:'reset',hold:2000});
  assert.equal(pages[0][1].text,'Spår 1c');assert.equal(pages[0][2].details,false);assert.equal(pages[0][3].lineId,'cda-lek');assert.equal(pages[0][4].title,'Nästa sida');
  assert.equal(keyLabel(keys[0]),'Återställ');assert.equal(keyLabel({type:'turn',slot:3,filter:'arrivals'}),'Tåg 3 · bara ankomster');assert.equal(keyLabel({type:'nav',to:'home'}),'Första sidan');
});

test('keys move between places and pages, pages reorder, and a draft counts its differences',()=>{
  let layout=validateLayout({model:'mini',pages:[{name:'A',keys:[{type:'page',target:1},{type:'page',target:2},{type:'plupp',id:'htvAu'}]},{name:'B',keys:[{type:'system',id:'cancel'}]},{name:'C',keys:[]}]},{pluppIds:ids});
  const original=structuredClone(layout);
  let moved=moveKey(layout,{page:0,index:2},{page:1,index:5});
  assert.equal(moved.pages[0].keys[2],null);assert.deepEqual(moved.pages[1].keys[5],{type:'plupp',id:'htvAu'});
  moved=moveKey(moved,{page:1,index:5},{page:1,index:0});assert.deepEqual(moved.pages[1].keys[0],{type:'plupp',id:'htvAu'});assert.deepEqual(moved.pages[1].keys[5],{type:'system',id:'cancel'},'a key already there takes the other place');
  assert.equal(moveKey(layout,{page:0,index:1},{page:0,index:1}),layout);
  assert.equal(firstFree(layout,0),3);assert.equal(firstFree({model:'mini',pages:[{keys:Array(6).fill({type:'system',id:'cancel'})}]},0),-1);
  const reordered=movePage(layout,2,0);
  assert.deepEqual(reordered.pages.map(p=>p.name),['C','A','B']);
  assert.deepEqual(reordered.pages[1].keys.slice(0,2),[{type:'page',target:2},{type:'page',target:0}],'page keys follow their pages');
  assert.deepEqual(missingPluppar(layout,pluppar).map(p=>p.id),['htvCu','htvSpIb','tvv1']);
  assert.equal(differences(layout,layout),0);assert.equal(differences(layout,moved),3);assert.equal(differences(layout,reordered)>0,true);assert.equal(differences(null,null),0);
  assert.deepEqual(layout,original,'the original is untouched');
});
