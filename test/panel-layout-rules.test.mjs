import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');

// Layout rules of the bottom-row design (1 October 2026). The geometry itself is
// checked in a browser at the listed viewports; these guard the sources.
test('the plan scales to the width in its 2102:688 proportion and the bottom row keeps at least 300 px',()=>{
  const css=read('public/panel-fixed.css');
  assert.match(css,/--plan-h:min\(calc\(\(100vw - 16px\)\s*\/\s*3\.0552\),var\(--plan-user,calc\(100dvh - [^)]*300px\)\)\)/);
  assert.match(css,/grid-template-rows:var\(--plan-row\) minmax\(0,1fr\)/);
  assert.ok(!css.includes('--panel-bottom-height'),'the fixed bottom height is gone');
  assert.match(css,/html:has\(body\.panel-app\)\{overflow:hidden\}/);
});

test('the pagination is gone and the bottom row holds timetable and events',()=>{
  for(const file of ['public/index.html','public/trainmeet-timetable.js','public/panel-fixed.css','public/workspace.css'])assert.ok(!read(file).includes('tt-pagination'),file+' has no pagination');
  const html=read('public/index.html');
  assert.ok(html.includes('<section id="panel-events"'));
  assert.ok(html.includes('href="/fonts/fonts.css"'),'IBM Plex is served locally');
  assert.ok(!/googleapis/.test(html));
  assert.match(read('src/http.mjs'),/'\.woff2': 'font\/woff2'/);
});

test('phone widths read only: no touch targets on the plan, timetable tabs instead of columns',()=>{
  const css=read('public/panel-fixed.css');
  const phone=css.slice(css.indexOf('@media(max-width:500px)'));
  assert.match(phone,/#track-plan \.touch-target,#track-plan \.signal-target\{pointer-events:none\}/);
  assert.match(css,/@media\(orientation:portrait\) and \(max-width:900px\)/);
  assert.match(css,/@media\(max-height:430px\)/);
});

test('the event column reads the journal and hides the field-level rows',()=>{
  const app=read('public/app.js');
  assert.ok(app.includes("state.events.filter(e=>!['report','transport'].includes(e.kind))"),'the journal page keeps its own filter');
  assert.match(read('public/panel-events-model.js'),/HIDDEN_KINDS=\['report','transport','order','permission'/);
  assert.ok(app.includes('panelEvents?.update(state,online)'));
  assert.ok(read('public/panel-events.js').includes('state?.operatingEvents'),'the column reads the operating events');
  assert.ok(!/api\('events|api\("events/.test(read('public/panel-events.js')),'no new API calls');
});

test('the harmonised plan reads its colours from scoped tokens and only restyles',()=>{
  const tokens=read('public/tokens.css'),css=read('public/panel-fixed.css'),html=read('public/index.html');
  assert.ok(html.includes('href="/tokens.css"'));
  assert.ok(!/^:root\s*\{/m.test(tokens),'tokens are scoped to the panel, not :root');
  assert.ok(tokens.includes('body.panel-app .panel-shell {'));
  assert.match(css,/#track-plan \.rail\.main\{stroke:var\(--track-main\)/);
  assert.match(css,/#track-plan \.turnout-number\.locked\{fill:var\(--yellow\)/);
  assert.match(css,/#track-plan \.hilite\{fill:none;stroke:var\(--yellow\)/);
  assert.ok(!read('public/panel-head.js').includes('fetch('),'the status bar sends nothing');
});

test('the page footer names the version in package.json',()=>{
  const version=JSON.parse(read('package.json')).version;
  assert.match(read('public/index.html'),new RegExp(`<footer>Charlottendal TKL · version ${version.replace(/\./g,'\\.')}</footer>`),'bump the footer in public/index.html with the version');
});
