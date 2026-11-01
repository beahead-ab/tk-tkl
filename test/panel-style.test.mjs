import test from 'node:test';
import assert from 'node:assert/strict';
import {PANEL_STYLES,createPanelStyle,panelStyleKey,readPanelStyle,savePanelStyle} from '../public/panel-style.js';
import {createModernSignal,modernSignalKind,modernSignalView,signalRotation} from '../public/panel-symbols.js';
import {createRouteConfirmation} from '../public/route-confirmation.js';
import fs from 'node:fs';

function memory(){const data=new Map();return {data,getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};}
test('två vyer, original som standard, separat val för varje station och webbläsare',()=>{
  const storage=memory(),otherBrowser=memory();
  assert.deepEqual(PANEL_STYLES.map(s=>s.id),['original','modern85']);
  assert.equal(readPanelStyle('charlottendal',storage),'original');
  savePanelStyle('charlottendal','modern85',storage);
  assert.equal(readPanelStyle('charlottendal',storage),'modern85');
  assert.equal(readPanelStyle('trakvista',storage),'original');
  assert.equal(readPanelStyle('charlottendal',otherBrowser),'original');
  storage.setItem(panelStyleKey('trakvista'),'<okänt>');
  assert.equal(readPanelStyle('trakvista',storage),'original');
  storage.setItem('charlottendal-skin','traffic');
  assert.equal(readPanelStyle('ny-station',storage),'original');
});
test('blockerad lagring ger original vid start och en misslyckad ändring lämnar vyn orörd',()=>{
  const storage={getItem(){throw Error('blockerad');},setItem(){throw Error('full');}},root={dataset:{}};
  const view=createPanelStyle({station:'a',root,storage,events:null,onChange(){throw Error('får inte köras');}});
  assert.equal(view.current,'original');
  assert.throws(()=>view.save('modern85'),/kunde inte spara/);
  assert.equal(root.dataset.panelStyle,'original');assert.equal(view.current,'original');
});
test('vybyte ändrar bara presentation och avbryter ett oskickat start/målval',()=>{
  const storage=memory(),root={dataset:{}},calls=[];let timer;
  const runtime={routes:[{id:'låst',state:'active'}],blocks:{S1:{occupied:true}},controls:{stopAll:true}};
  const before=structuredClone(runtime);
  const confirmation=createRouteConfirmation({submit:()=>calls.push('order'),valid:()=>true,onChange(){},setTimer:fn=>{timer=fn;return 1;},clearTimer:()=>{timer=null;}});
  confirmation.start({from:'a',to:'b'});
  let changes=0;
  const view=createPanelStyle({station:'a',root,storage,events:null,onChange:()=>{changes++;confirmation.cancel();}});
  view.save('modern85');
  assert.equal(timer,null);assert.equal(confirmation.selection,null);assert.equal(changes,1);
  assert.equal(root.dataset.panelStyle,'modern85');assert.deepEqual(calls,[]);assert.deepEqual(runtime,before);
  view.save('modern85');assert.equal(changes,1,'samma val avbryter inget på nytt');
  view.save('original');assert.deepEqual(runtime,before);assert.deepEqual(calls,[]);
});
test('lagringshändelser gäller bara den aktuella stationen och kan tas bort',()=>{
  const storage=memory(),root={dataset:{}};let listener;const events={addEventListener:(n,fn)=>{listener=fn;},removeEventListener:(n,fn)=>assert.equal(fn,listener)};
  const view=createPanelStyle({station:'a',root,storage,events});
  savePanelStyle('b','modern85',storage);listener({key:panelStyleKey('b')});assert.equal(view.current,'original');
  savePanelStyle('a','modern85',storage);listener({key:panelStyleKey('a')});assert.equal(view.current,'modern85');
  storage.data.clear();listener({key:null});assert.equal(view.current,'original');view.destroy();
});
test('signalsymboler täcker huvud- och dvärgtyper i båda stationerna utan att omtolka stopplyktor',()=>{
  // Träkvistas fristående installationspaket innehåller inte Charlottendals data.
  const panels=['public/data/panel.json','stations/trakvista/data/panel.json'].filter(file=>fs.existsSync(new URL('../'+file,import.meta.url)));
  assert.ok(panels.length>0,'minst paketets egen stationspanel finns');
  for(const file of panels){
    const panel=JSON.parse(fs.readFileSync(new URL('../'+file,import.meta.url)));
    for(const m of panel.micons){
      assert.ok(modernSignalKind(m.type)||['sly_2','ssi_2'].includes(m.type),m.type);
      assert.ok(Number.isFinite(signalRotation(m.deg)),m.mast+' har rotation');
    }
  }
  assert.equal(modernSignalKind('hsi_7'),'main');assert.equal(modernSignalKind('hdvsi_5'),'combined');
  assert.equal(modernSignalKind('hsi_3'),'main','Träkvistas infartssignal 1/2 i det rättade underlaget');
  assert.equal(modernSignalKind('dvsi_4'),'dwarf');assert.equal(modernSignalKind('ssi_2'),null);
  assert.equal(modernSignalKind('ny-typ'),null);
  assert.equal(signalRotation(90),0);assert.equal(signalRotation(270),180);assert.equal(signalRotation(0),-90);assert.equal(signalRotation(undefined),null);
});
const report=(extra={})=>({type:'hsi_5',name:'1/5',signal:{aspect:'stop',updatedAt:10},connected:true,connectionAt:5,...extra});
test('återrapport styr symbolen: normalt stopp och vanligt låsskydd grått, inte order',()=>{
  assert.equal(modernSignalView(report()).tone,'stop');
  assert.equal(modernSignalView(report({signal:{aspect:'stop',desired:'GO',updatedAt:10}})).tone,'stop');
  assert.equal(modernSignalView(report({signal:{aspect:'go',desired:'STOP',updatedAt:10},routes:[{signals:['1/5'],state:'cancelling'}]})).tone,'go','kör är kvar tills stopp rapporteras');
  assert.equal(modernSignalView(report({routes:[{guardSignals:['1/5'],state:'active'}]})).tone,'stop');
  assert.equal(modernSignalView(report({routes:[{signals:['1/5'],state:'cancelling'}]})).tone,'releasing');
  assert.equal(modernSignalView(report({routes:[{signals:['1/5'],state:'clearing'}]})).tone,'endpoint');
});
test('rött kräver låst egen signal eller entydig slutpunkt, inte motriktat sidoskydd',()=>{
  const route={state:'active',signals:['start'],guardSignals:['end','opposing','flank'],source:{nxButtons:['from','to']}};
  const sourceEndpoints={endpoints:[{sensor:'to',mast:'end'}]};
  const view=(name,extra={})=>modernSignalView(report({name,routes:[route],sourceEndpoints,...extra}));
  assert.equal(view('opposing').tone,'stop');assert.equal(view('flank').tone,'stop');
  assert.equal(view('end').tone,'endpoint');assert.match(view('end').description,/slutpunkt/);
  assert.equal(view('start').tone,'endpoint');assert.match(view('start').description,/utan körbesked/);
  assert.equal(view('start',{signal:{aspect:'go',updatedAt:10}}).tone,'go');
  assert.equal(view('end',{sourceEndpoints:{}}).tone,'stop','saknad bindning får inte gissas');
  assert.equal(view('end',{sourceEndpoints:{endpoints:[...sourceEndpoints.endpoints,{sensor:'to',mast:'other'}]}}).tone,'stop','tvetydig bindning får inte gissas');
  assert.equal(view('end',{routes:[]}).tone,'stop','slutpunkten återgår när låset tas bort');
  assert.equal(view('end',{routes:[{...route,state:'requested'}]}).tone,'stop','en begäran är inget lås');
  assert.equal(view('opposing',{signal:{aspect:'stop',desired:'STOP',updatedAt:10}}).tone,'stop','en stopporder är ingen stoppspärr');
});
test('AIS är en uttrycklig stoppspärr men körbesked och rapportkvalitet döljs inte',()=>{
  assert.equal(modernSignalView(report({stopBlocked:true})).tone,'blocked');
  assert.equal(modernSignalView(report({stopBlocked:true,signal:{aspect:'go',updatedAt:10}})).tone,'go');
  for(const extra of [{connected:false},{connectionAt:11},{configured:false},{signal:null}]){
    assert.equal(modernSignalView(report({stopBlocked:true,...extra})).tone,'unknown');
  }
  assert.equal(modernSignalView(report({stopBlocked:true,routes:[{signals:['1/5'],state:'cancelling'}]})).tone,'releasing');
});
test('Charlottendals infart behåller motriktade signaler grå och verklig slutpunkt röd',()=>{
  const file=new URL('../profiles/charlottendal-network.json',import.meta.url);
  if(!fs.existsSync(file))return; // Paketet för Träkvista har enbart sin egen profil.
  const config=JSON.parse(fs.readFileSync(file)),sourceEndpoints=JSON.parse(fs.readFileSync(new URL('../public/data/signal-endpoints.json',import.meta.url)));
  const route={...config.routes.find(r=>r.id==='htvAu--htvSpIA'),state:'active'};
  assert.ok(route.signals?.length);assert.ok(route.guardSignals.includes('1/7'));
  const view=name=>modernSignalView(report({name,routes:[route],sourceEndpoints}));
  assert.equal(view('1/7').tone,'endpoint');
  for(const name of route.guardSignals.filter(n=>n!=='1/7'))assert.equal(view(name).tone,'stop',name);
});
test('Träkvistas infart skiljer slutpunkt från motriktat skydd',()=>{
  const pairs=[['stations/trakvista/profiles/network.json','stations/trakvista/data/signal-endpoints.json'],['profiles/network.json','public/data/signal-endpoints.json']];
  const pair=pairs.find(([profile])=>fs.existsSync(new URL('../'+profile,import.meta.url)));
  if(!pair)return;
  const config=JSON.parse(fs.readFileSync(new URL('../'+pair[0],import.meta.url))),sourceEndpoints=JSON.parse(fs.readFileSync(new URL('../'+pair[1],import.meta.url)));
  const definition=config.routes.find(r=>r.id==='htvA--htvI');if(!definition)return;
  const route={...definition,state:'active'};
  const view=name=>modernSignalView(report({name,routes:[route],sourceEndpoints}));
  assert.equal(view('1/7').tone,'endpoint');
  for(const name of ['2/10','2/8','1/8']){assert.ok(route.guardSignals.includes(name));assert.equal(view(name).tone,'stop',name);}
});
test('Träkvistas infartssignal 1/2 (hsi_3 i det rättade underlaget) ritas som huvudsignal och visar kör',()=>{
  const panel=JSON.parse(fs.readFileSync(new URL('../stations/trakvista/data/panel.json',import.meta.url)));
  const icon=panel.micons.find(m=>m.mast==='1/2');
  assert.equal(icon?.type,'hsi_3');
  const nodes=[];const make=(tag,attrs,parent,value)=>{const n={tag,attrs:{...attrs},textContent:value??'',getAttribute(k){return this.attrs[k];},setAttribute(k,v){this.attrs[k]=v;},style:{},classList:{add(){}}};nodes.push(n);return n;};
  const symbol=createModernSignal({parent:{classList:{add(){}}},type:icon.type,degrees:icon.deg,scale:icon.scale,label:'Signal 1/2',make});
  assert.ok(symbol,'85-vyn ritar en egen symbol');
  assert.deepEqual(nodes.filter(n=>n.tag==='path').map(n=>n.attrs.class),['modern-signal-mark modern-signal-main']);
  const go=modernSignalView(report({type:'hsi_3',name:'1/2',signal:{aspect:'go',updatedAt:10}}));
  assert.equal(go.tone,'go');assert.equal(go.uncertain,false,'en huvudsignal har inget dolt dvärgbesked');
});
test('bruten kontakt, gammal anslutningsrapport och saknad bindning kan aldrig visa kör',()=>{
  const go={aspect:'go',updatedAt:10};
  for(const extra of [{connected:false},{connectionAt:11},{configured:false},{signal:null},{signal:{...go,aspect:'unknown'}},{signal:{...go,updatedAt:0}}]){
    assert.equal(modernSignalView(report({signal:go,...extra})).tone,'unknown');
  }
  assert.equal(modernSignalView(report({signal:go})).tone,'go');
});
test('tvålägesrapport gissar inte exakta dvärgbesked eller kombinationsbesked från en växeltågväg',()=>{
  for(const type of ['dvsi_4','hdvsi_8','hdvsi_5','hsi_3+dvsi']){
    const view=modernSignalView(report({type,signal:{aspect:'go',updatedAt:10},routes:[{kind:'shunt',signals:['1/5'],state:'active'}]}));
    assert.equal(view.tone,'unknown');assert.equal(view.uncertain,true);assert.match(view.description,/Kör återrapporterat.*exakt dvärgbesked saknas/);
    assert.equal(modernSignalView(report({type})).tone,'stop');
  }
});
test('telemetri och vybyte behåller samma symbolnoder och klickyta',()=>{
  const nodes=[];const make=(tag,attrs,parent,value)=>{const n={tag,attrs:{...attrs},textContent:value??'',getAttribute(k){return this.attrs[k];},setAttribute(k,v){this.attrs[k]=v;},style:{},classList:{add(){}}};nodes.push(n);return n;};
  const parent={classList:{add(){}}};
  const symbol=createModernSignal({parent,type:'hdvsi_5',degrees:270,label:'Signal 1',make});
  const count=nodes.length;
  for(const aspect of ['go','stop','unknown'])symbol.update(modernSignalView(report({type:'hdvsi_5',signal:{aspect,updatedAt:10}})));
  assert.equal(nodes.length,count);assert.equal(nodes.filter(n=>n.tag==='path').length,2);
  assert.equal(nodes.find(n=>n.tag==='g'&&n.attrs.transform)?.attrs.transform,'rotate(180) scale(1)');
  assert.equal(nodes.find(n=>n.attrs.class==='modern-signal').attrs['data-tone'],'unknown');
});
