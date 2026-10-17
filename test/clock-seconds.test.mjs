import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CLOCK_SECONDS_KEY,clockHint,clockSecondsShown,clockText,setClockSeconds,toggleClockSeconds} from '../public/clock-seconds.js';
import {clockAt} from '../public/timetable-rows.js';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const memory=(initial={})=>{const data={...initial};return {data,getItem:k=>k in data?data[k]:null,setItem:(k,v)=>{data[k]=String(v);}};};

// Snabbinställningen för träffklockans sekunder (0.81.0): ett tryck på klockan visar eller döljer dem, per webbläsare.
test('sekunderna visas tills någon trycker bort dem, och valet sparas i webbläsaren',()=>{
  const storage=memory();
  assert.equal(CLOCK_SECONDS_KEY,'charlottendal-clock-seconds');
  assert.equal(clockSecondsShown(storage),true,'utan val visas sekunderna, som förut');
  assert.equal(toggleClockSeconds(storage),false);assert.equal(storage.data[CLOCK_SECONDS_KEY],'off');assert.equal(clockSecondsShown(storage),false);
  assert.equal(toggleClockSeconds(storage),true);assert.equal(storage.data[CLOCK_SECONDS_KEY],'on');
  assert.equal(setClockSeconds(false,storage),false);assert.equal(clockSecondsShown(storage),false);
  assert.equal(clockSecondsShown({getItem(){throw Error('blockerad');}}),true,'utan lagring visas sekunderna');
});

test('klockan visar 12:36:41 eller 12:36, och pekaren säger vad ett tryck gör',()=>{
  const now=clockAt({time:'12:36:41',rate:1,running:false},0);
  assert.equal(clockText(now,true),'12:36:41');assert.equal(clockText(now,false),'12:36');assert.equal(clockText(null,true),'');
  assert.equal(clockHint(true),'Tryck för att dölja sekunderna');assert.equal(clockHint(false),'Tryck för att visa sekunderna');
});

test('tidtabellens klocka, telefonraden och miniraden tar trycket',()=>{
  const timetable=read('public/trainmeet-timetable.js');
  assert.ok(timetable.includes("import {CLOCK_SECONDS_KEY,clockHint,clockSecondsShown,clockText,toggleClockSeconds} from './clock-seconds.js';"));
  assert.ok(timetable.includes("clockButton.setAttribute('role','button');clockButton.tabIndex=0;"));
  assert.ok(timetable.includes("document.getElementById('panel-phone-clock')?.addEventListener('click',toggleSeconds);"));
  assert.ok(timetable.includes("if(e.target.closest('.tt-mini-clock'))toggleSeconds();"));
  assert.ok(!/\$\('clock-time'\)\.textContent=now\.text/.test(timetable),'klockan ritas bara genom paintClock');
  assert.match(read('public/panel-fixed.css'),/#tt-clock-time,#panel-phone-clock,\.tt-mini-clock\{cursor:pointer/);
});
