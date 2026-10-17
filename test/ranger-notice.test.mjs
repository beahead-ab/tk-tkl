import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {rangerView} from '../public/ranger-notice.js';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const groups=[{id:'right-11',label:'Höger 11',out:{Vx132:'T',Vx131:'T',Vx126:'C',Vx123:'C'}},{id:'left-11',label:'Vänster 11',out:{Vx103:'C',Vx112:'T',Vx113:'T',Vx102:'C'}}];

test('a request waiting for TKL comes first with Godkänn and Neka; groups lying out get Dra tillbaka',()=>{
  const open={id:'a',group:'right-11',state:'open',label:'Höger 11'},laid={id:'b',group:'left-11',state:'laid',label:'Vänster 11'};
  const v=rangerView({groups,requests:[laid,open]});
  assert.equal(v.text,'Rangeraren begär Höger 11');assert.equal(v.tone,'warn');
  assert.deepEqual(v.actions,[{label:'Godkänn',command:'answer',id:'a',approved:true},{label:'Neka',command:'answer',id:'a',approved:false}]);
  assert.equal(v.points.get('Vx131'),'ranger-request');assert.equal(v.points.get('Vx112'),'ranger-laid');assert.equal(v.points.has('Vx120'),false);
  const out=rangerView({groups,requests:[laid]});
  assert.equal(out.text,'Vänster 11 ligger ute för rangeraren');assert.equal(out.tone,'on');
  assert.deepEqual(out.actions,[{label:'Dra tillbaka',command:'withdraw',id:'b'}]);
  const two=rangerView({groups,requests:[laid,{...laid,id:'c',group:'right-11',label:'Höger 11'}]});
  assert.equal(two.text,'Vänster 11, Höger 11 ligger ute för rangeraren');assert.deepEqual(two.actions.map(a=>a.label),['Dra tillbaka Vänster 11','Dra tillbaka Höger 11']);
  assert.deepEqual(rangerView(null),{text:'',tone:'',actions:[],points:new Map()});
});
test('the status bar carries the answer buttons but sends nothing itself; the plan blinks the group yellow',()=>{
  const head=read('public/panel-head.js'),app=read('public/app.js'),css=read('public/panel-fixed.css');
  assert.match(head,/rangerNotice\(view\)/);assert.match(head,/onRanger\?\.\(action\)/);assert.doesNotMatch(head,/fetch\(/);
  assert.match(app,/onRanger:a=>api\('ranger\/'\+a\.command/);assert.match(app,/rangerNotice\(rangerMode\?rangerOwnView\(state\.yard\):rangerView\(state\.yard\)\)/);
  assert.match(app,/rangerPoints\.get\(t\.name\)/);
  assert.match(css,/@keyframes ranger-request/);assert.match(css,/\.rail\.ranger-laid/);assert.match(css,/prefers-reduced-motion:reduce\)\{#track-plan \.rail\.ranger-request\{animation:none\}/);
  assert.doesNotMatch(css,/yard-delegated|yard-authority/);
});
test('the ranger\'s own chip and bar: waiting with Ångra, lying out with Lägg tillbaka, buttons from the kernel\'s verdict',async()=>{
  const {rangerOwnView,GROUP_SHORT}=await import('../public/ranger-page.js');
  const open={id:'a',group:'right-11',state:'open',label:'Höger 11'},laid={id:'b',group:'left-11',state:'laid',label:'Vänster 11'};
  assert.deepEqual(rangerOwnView({requests:[laid,open]}),{text:'Höger 11 begärd · väntar på TKL',tone:'warn',actions:[{label:'Ångra',command:'return',id:'a'}]});
  assert.deepEqual(rangerOwnView({requests:[laid]}),{text:'Vänster 11 ligger ute',tone:'on',actions:[{label:'Lägg tillbaka',command:'return',id:'b'}]});
  assert.equal(rangerOwnView(null).text,'');
  assert.deepEqual(Object.keys(GROUP_SHORT),['left-11','left-12','left-13','right-11','right-12','right-13','six-154','3d-left']);
  const app=read('public/app.js'),css=read('public/panel-fixed.css');
  assert.match(app,/rangerMode\?'ranger\/turnout':'turnout'/);assert.match(app,/rangerMode\?'ranger\/route':'route'/);assert.match(app,/rangerMode\?'ranger\/cancel':'cancel'/);
  assert.match(app,/operator:'ranger'/);assert.match(app,/authSession\?\.user\?\.role==='ranger'\|\|location\.hash==='#ranger'\)rangerMode=true/);
  assert.match(css,/body\[data-role=ranger\] #track-plan \.rail\.outside/);assert.match(css,/body\[data-role=ranger\] #panel-bottom #trainmeet-timetable/);
});
