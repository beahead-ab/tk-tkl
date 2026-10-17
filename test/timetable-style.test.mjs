import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {groupRows,lineStates,routeSides,stationSides,toMinutes} from '../public/timetable-rows.js';
import {CELLS,FALLBACK,GLYPHS,LEG_COLORS,STYLES,STYLE_KEY,cellsHTML,labelsHTML,lageHTML,legendHTML,previewHTML,readStyle,routePicture,routePictureHTML,rowHTML,sampleRows,saveStyle,validStyle} from '../public/timetable-style.js';
import {destinationDefaults,destinationLines} from '../public/destination-data.js';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');

// Tidtabellens stil (0.80.0): som i TrainMeet-appen för iPhone. Samma rader, fyra sätt att visa dem.
const row=(number,extra={})=>({id:'m'+number,number,slag:'Pt',arrival:'',departure:'',from:'',to:'',track:'1a',trackLabel:'1a',planned:'1a',changed:false,noStop:false,note:'',movement:null,sortTime:'',inLine:'',outLine:'',...extra});
const strip=html=>html.replace(/<svg[^]*?<\/svg>/g,'[svg]').replace(/<[^>]+>/g,'');
const memory=(initial={})=>{const data={...initial};return {data,getItem:k=>k in data?data[k]:null,setItem:(k,v)=>{data[k]=String(v);}};};

test('fyra stilar, ord som standard; valet sparas per webbläsare och ett okänt värde blir ord',()=>{
  assert.deepEqual(STYLES.map(s=>s.title),['Ord','Symboler','Linjebild','Linjebild + symboler']);
  assert.equal(FALLBACK,'words');assert.equal(STYLE_KEY,'charlottendal-timetable-style');
  assert.equal(readStyle(memory()),'words');assert.equal(readStyle(memory({[STYLE_KEY]:'line'})),'line');assert.equal(readStyle(memory({[STYLE_KEY]:'<x>'})),'words');
  assert.equal(readStyle({getItem(){throw Error('blockerad');}}),'words','utan lagring visas orden');
  const storage=memory();assert.equal(saveStyle('lineSymbols',storage),'lineSymbols');assert.equal(storage.data[STYLE_KEY],'lineSymbols');
  assert.equal(saveStyle('gissning',storage),'words');assert.equal(validStyle(undefined),'words');
});

test('grannarnas sidor kommer från orterna; utan känd sida går tåget från vänster till höger',()=>{
  assert.deepEqual(destinationLines.map(l=>l.id+':'+l.side),['C:left','A:left','B:right','D:right']);
  const destinations={entries:destinationDefaults.map(d=>({...d,source:['Au','An'].includes(d.id)||d.id==='Bu'?'trainmeet':'local',stationId:['Au','An'].includes(d.id)?'kfs':d.id==='Bu'?'vag':''}))};
  const sides=stationSides(destinations);
  assert.deepEqual([...sides],[['kfs','left'],['vag','right']]);
  assert.deepEqual(routeSides({from:'Kungsfors',to:'Vagnsta',fromId:'kfs',toId:'vag'},sides),{fromSide:'left',toSide:'right'});
  assert.deepEqual(routeSides({from:'Vagnsta',to:'Okänd',fromId:'vag',toId:'x'},sides),{fromSide:'right',toSide:'left'},'en okänd granne hamnar mittemot');
  assert.deepEqual(routeSides({from:'A',to:'B'}),{fromSide:'left',toSide:'right'});
  assert.deepEqual(routeSides({from:'',to:'Vagnsta',toId:'vag'},sides),{fromSide:'',toSide:'right'});
  assert.deepEqual(routeSides({from:'Vagnsta',to:'Vagnsta',fromId:'vag',toId:'vag'},sides),{fromSide:'right',toSide:'right'},'vänder');
});

test('klareringen på linjerna hör till tåget med samma nummer och, när den är känd, samma granne',()=>{
  const lines=[{direction:'out',state:'requested',trainNumber:'41',neighborId:'vag'},{direction:'in',state:'occupied',trainNumber:'93',neighborId:'vag'},{direction:'in',state:'free',trainNumber:'7',neighborId:'kfs'},{direction:'in',state:'reserved',trainNumber:'93',neighborId:'kfs'}];
  assert.deepEqual(lineStates(lines,'41',{to:'vag'}),{inLine:'',outLine:'requested'});
  assert.deepEqual(lineStates(lines,'93',{from:'vag'}),{inLine:'occupied',outLine:''});
  assert.deepEqual(lineStates(lines,'93',{from:'kfs'}),{inLine:'reserved',outLine:''});
  assert.deepEqual(lineStates(lines,'7'),{inLine:'',outLine:''},'en fri linje gäller inget tåg');
  assert.deepEqual(lineStates(lines,''),{inLine:'',outLine:''});
});

test('raderna bär läget, linjerna och om tåget står inne; orden är desamma som förut',()=>{
  const rows=[
    row('4152',{departure:'11:30',to:'Lekby',toSide:'left',movement:{arrival:'none',departure:'departed'},sortTime:'11:30'}),
    row('3581',{departure:'11:50',to:'Kungsfors',toSide:'left',track:'2a',movement:{arrival:'none',departure:'ready'},sortTime:'11:50'}),
    row('41',{arrival:'12:20',departure:'12:38',from:'Kungsfors',to:'Vagnsta',fromSide:'left',toSide:'right',track:'2b',movement:{arrival:'arrived',departure:'ready'},outLine:'requested',sortTime:'12:20'}),
    row('93',{arrival:'12:40',departure:'12:43',from:'Vagnsta',to:'Lekby',fromSide:'right',toSide:'left',movement:{arrival:'approaching',departure:'none'},inLine:'occupied',sortTime:'12:40'}),
    row('421',{arrival:'12:44',departure:'12:46',from:'Kungsfors',to:'Vagnsta',fromSide:'left',toSide:'right',track:'1b',inLine:'requested',sortTime:'12:44'}),
    row('77',{arrival:'12:50',from:'Lekby',fromSide:'left',track:'3',movement:{arrival:'arrived',departure:'none'},sortTime:'12:50'}),
  ];
  const g=groupRows(rows,{minutes:toMinutes('12:36'),routes:[{state:'active',label:'Spår 2b → Bu'},{state:'active',label:'Bu → Spår 1a'},{state:'active',label:'Spår 2a → An'},{state:'active',label:'Cu → Spår 3'}]});
  const by=Object.fromEntries(g.all.map(r=>[r.number,r]));
  assert.deepEqual(g.all.map(r=>[r.number,r.group,r.activity,r.standing,r.inState,r.outState].join(':')),[
    '4152:done:departed:false::done','3581:now:standing:true::planned','41:now:waiting:true:done:requested','93:now:approaching:false:onLine:planned','77:now:arrived:true:done:','421:next:request:false:requested:planned']);
  assert.equal(by['3581'].lage,'Redo · sen 46 min');assert.equal(by['3581'].lateMinutes,46);
  assert.equal(by['41'].lage,'Redo');assert.equal(by['93'].lage,'Närmar sig');assert.equal(by['77'].lage,'Ankommet');
  assert.equal(by['421'].lage,'om 8 min');assert.equal(by['421'].countdownMinutes,8);
  assert.deepEqual(by['3581'].parts.map(p=>p.kind),['status','late']);
});

test('Ord ritar som förut; Symboler byter läget mot tecken och behåller orden som saknar tecken',()=>{
  const g=groupRows([
    row('41',{arrival:'12:20',departure:'12:38',from:'Kungsfors',to:'Vagnsta',fromSide:'left',toSide:'right',track:'2b',movement:{arrival:'arrived',departure:'ready'},outLine:'requested',sortTime:'12:20',note:'Vagnar till Lastspår 1\nandra raden'}),
    row('3581',{departure:'11:50',to:'Kungsfors',toSide:'left',track:'2a',movement:{arrival:'none',departure:'ready'},sortTime:'11:50'}),
    row('421',{arrival:'12:44',departure:'12:46',from:'Kungsfors',to:'Vagnsta',fromSide:'left',toSide:'right',inLine:'requested',sortTime:'12:44'}),
    row('4152',{departure:'11:30',to:'Lekby',toSide:'left',movement:{arrival:'none',departure:'departed'},sortTime:'11:30'})
  ],{minutes:toMinutes('12:36')});
  const by=Object.fromEntries(g.all.map(r=>[r.number,r]));
  const words=cellsHTML(by['41'],'words');
  assert.equal(words.lage,'Redo · tågväg ej lagd');assert.equal(words.la,'Redo · tågväg ej lagd · Vagnar till Lastspår 1');assert.equal(words.fr,'Kungsfors');assert.equal(words.frtill,'Kungsfors → Vagnsta');
  assert.equal(words.spar,'<span class="tt-track-frame" title="Tåget står inne på spåret">2b</span>','spåret i en ram när tåget står inne, i alla stilar');
  assert.equal(cellsHTML(by['421'],'words').spar,'1a');
  const symbols=cellsHTML(by['41'],'symbols');
  assert.match(symbols.lage,/title="Begärt, väntar på svar"/);assert.equal(strip(symbols.lage),'[svg]tågväg ej lagd','Redo ryms i timglaset');
  assert.equal(strip(cellsHTML(by['3581'],'symbols').lage),'+46′Redo · tågväg ej lagd','Redo har inget tecken och står kvar');
  assert.match(cellsHTML(by['421'],'symbols').lage,/class="tt-request"[^]*title="om 8 min"/);
  assert.match(cellsHTML(by['4152'],'symbols').lage,/title="Avgått"[^]*translate\(18 0\) scale\(-1 1\)/,'avgått åt vänster pekar åt vänster');
  assert.match(cellsHTML(by['3581'],'symbols').fr,/title="Den här stationen"/,'börjar här: stationens tecken i stället för —');
  assert.equal(strip(cellsHTML(by['41'],'symbols').frtill),'Kungsfors→Vagnsta');
  assert.match(rowHTML(by['41'],'symbols'),/<span class="tt-lage" title="Redo · tågväg ej lagd">/,'orden finns kvar som förklaring vid pekaren');
  assert.match(rowHTML(by['41'],'words'),/^<button type="button" class="tt-entry tt-now" data-timetable-row="0" aria-haspopup="dialog" aria-label="Visa tidtabellsuppgifter för tåg 41">/);
});

test('Linjebilden: grannen på sin sida, linjen som det som händer på den, pilen åt tågets håll',()=>{
  const g=groupRows([
    row('93',{arrival:'12:40',departure:'12:43',from:'Vagnsta',to:'Lekby',fromSide:'right',toSide:'left',fromCode:'VA',toCode:'LK',movement:{arrival:'approaching',departure:'none'},inLine:'occupied',sortTime:'12:40'}),
    row('105',{arrival:'13:05',departure:'13:07',from:'Vagnsta',to:'Vagnsta',fromSide:'right',toSide:'right',fromCode:'VA',toCode:'VA',sortTime:'13:05'}),
    row('41',{arrival:'12:20',departure:'12:38',from:'Kungsfors',to:'Vagnsta',fromSide:'left',toSide:'right',fromCode:'KF',toCode:'VA',movement:{arrival:'arrived',departure:'ready'},outLine:'reserved',sortTime:'12:20'})
  ],{minutes:toMinutes('12:36')});
  const by=Object.fromEntries(g.all.map(r=>[r.number,r]));
  assert.deepEqual(routePicture(by['93']),{left:{out:'planned'},right:{in:'onLine'},leftCode:'LK',rightCode:'VA',node:'open'});
  assert.deepEqual(routePicture(by['105']),{left:null,right:{turns:true,in:'planned',out:'planned'},leftCode:'',rightCode:'VA',node:'open'});
  assert.deepEqual(routePicture(by['41']),{left:{in:'done'},right:{out:'cleared'},leftCode:'KF',rightCode:'VA',node:'standing'});
  const pic=routePictureHTML(by['93']);
  assert.match(pic,/^<span class="tt-route-pic"><b>LK<\/b><svg class="tt-line-pic" width="84" height="16"/);
  assert.ok(pic.includes(`stroke="${LEG_COLORS.onLine}"`)&&pic.includes('<rect'),'tåget ritat på linjen in');
  assert.ok(pic.includes('M36 8H2"')&&pic.includes('stroke-dasharray="3 3"'),'linjen ut till vänster, streckad som planerad');
  assert.ok(routePictureHTML(by['41']).includes(`fill="#f5c518"`),'gul prick: tåget står inne');
  const cells=cellsHTML(by['93'],'line');assert.equal(cells.fr,pic);assert.equal(cells.till,'');assert.equal(cells.frtill,pic);
  assert.equal(lageHTML(by['93'],'line'),'tågväg ej lagd'.replace(/^/,'<span class="tt-words">')+'</span>','Närmar sig syns i bilden');
  assert.equal(strip(lageHTML(by['41'],'line')),'tågväg ej lagd','klart syns i bilden, och då också Redo');
});

test('kolumnrubriker, teckenförklaring och förhandsvisning följer stilen',()=>{
  assert.equal(CELLS.length,11);
  assert.equal(strip(labelsHTML('words')),'TågSlagFrånTillFrån → tillAnkAvgSpårLägeAnmärkningLäge · anmärkning');
  assert.equal(strip(labelsHTML('line')),'TågSlagLinjeLinjeAnkAvgSpårLägeAnmärkningLäge · anmärkning');
  assert.ok(labelsHTML('symbols').includes(GLYPHS.arrivalHeader())&&labelsHTML('lineSymbols').includes(GLYPHS.departureHeader()));
  assert.match(legendHTML('words'),/Spåret i en ram/);assert.ok(!/Streckad/.test(legendHTML('words')));
  assert.match(legendHTML('line'),/Streckad gul: begärt/);assert.ok(!/Närmar sig/.test(legendHTML('line')));
  assert.match(legendHTML('symbols'),/Närmar sig[^]*Grannen begär klarering/);assert.match(legendHTML('lineSymbols'),/Grön: klart[^]*Minuter sen/);
  assert.deepEqual(sampleRows().map(r=>r.number+':'+r.activity),['41:waiting','93:approaching','3510:planned']);
  for(const s of STYLES){const html=previewHTML(s.id);assert.match(html,new RegExp(`^<span class="tt-preview" data-tt-style="${s.id}" aria-hidden="true">`));assert.ok(!html.includes('<button'),'förhandsvisningen går inte att trycka på');}
});

test('namn och koder från TrainMeet skrivs aldrig ut som kod',()=>{
  const evil='<img src=x onerror=alert(1)>';
  const g=groupRows([row('6',{arrival:'12:00',departure:'12:01',from:evil,to:evil,fromSide:'left',toSide:'right',fromCode:evil,toCode:evil,note:evil,sortTime:'12:00'})],{minutes:600});
  for(const style of STYLES.map(s=>s.id)){const html=rowHTML(g.all[0],style);assert.ok(!html.includes('<img'),style);}
});

test('tidtabellen, inställningarna och teckenförklaringen använder stilen',()=>{
  const timetable=read('public/trainmeet-timetable.js');
  assert.ok(timetable.includes("import {STYLE_KEY,labelsHTML,readStyle,rowHTML as styledRow,validStyle} from './timetable-style.js';"));
  assert.ok(timetable.includes("window.addEventListener('timetable-style',e=>useStyle(e.detail));"));
  assert.ok(timetable.includes('stationSides(panel?.destinations)'));
  assert.ok(read('public/app.js').includes('trainMeet?.update(state.trainMeet,online,{routes:state.routes||[],destinations:state.destinations});'));
  const appearance=read('public/admin-appearance.js');
  assert.ok(appearance.includes('<fieldset class="tt-style-choice"><legend>Tidtabellens stil</legend>'));
  assert.ok(appearance.includes("window.dispatchEvent(new CustomEvent('timetable-style',{detail:style}))"));
  assert.ok(read('public/index.html').includes('<div id="timetable-legend"></div>'));
  assert.match(read('public/panel-fixed.css'),/:is\(\[data-tt-style=line\],\[data-tt-style=lineSymbols\]\) \.tt-fr\{grid-column:span 2\}/);
});
