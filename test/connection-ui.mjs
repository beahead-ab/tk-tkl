// Riktig webbläsare, syntetiskt API. Ingen inloggad installation eller fysisk port används.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import {once} from 'node:events';
const {chromium}=await import(process.env.TKL_PLAYWRIGHT_MODULE || 'playwright');
let view={platform:'win32',mode:'offline',chosen:'offline',adapter:'btlocobridge',locked:false,
  live:{available:true},locobuffer:{device:'',baud:'57600',flow:'rtscts'},btlocobridge:{target:'COM7',channel:1},
  gateway:{state:'stopped',error:''},port:8913,switch:{live:{allowed:true},offline:{allowed:true}},
  devices:[{path:'COM7',label:'COM7 · Bluetooth'},{path:'COM17',label:'COM17'}]};
const server=http.createServer(async(req,res)=>{
  if(req.url==='/api/connection/adapter') {
    let data='';for await(const chunk of req)data+=chunk;view={...view,...JSON.parse(data)};
  }
  if(req.url.startsWith('/api/')) {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(view));return;}
  if(req.url==='/') {res.setHeader('Content-Type','text/html');res.end('<meta charset="utf-8"><div id="root"></div><script type="module">import {createConnectionSettings} from "/connection-mode.js";window.ui=createConnectionSettings(document.querySelector("#root"),{api:()=>{}});</script>');return;}
  if(['/connection-mode.js','/admin-ui.js'].includes(req.url)) {res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(new URL('../public'+req.url,import.meta.url)));return;}
  res.writeHead(404);res.end();
});
server.listen(0,'127.0.0.1');await once(server,'listening');
let browser;
try {
  browser=await chromium.launch({headless:true,...(process.env.TKL_CHROMIUM_EXECUTABLE?{executablePath:process.env.TKL_CHROMIUM_EXECUTABLE}:{})});const page=await browser.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByLabel('Utgående Bluetooth-COM-port').waitFor();
  assert.equal(await page.locator('[data-target]').inputValue(),'COM7');
  assert.equal(await page.locator('[data-channel]').isVisible(),false);
  assert.match(await page.locator('[data-bt-help]').textContent(),/Stäng JMRI/);
  await page.locator('[data-target]').fill('COM17');
  await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/connection')),page.getByRole('button',{name:'Sök enheter igen'}).click()]);
  assert.equal(await page.locator('[data-target]').inputValue(),'COM17','sökning ska behålla osparat portval');
  await Promise.all([page.waitForResponse(r=>r.url().endsWith('/adapter')),page.getByRole('button',{name:'Spara anslutningen'}).click()]);
  assert.equal(view.btlocobridge.target,'COM17');
  view={...view,mode:'live',gateway:{state:'failed',error:'COM17 kan inte öppnas. Stäng JMRI.'}};
  await page.evaluate(v=>window.ui.update({connectionMode:v}),view);
  assert.match(await page.locator('[data-gateway]').textContent(),/Stäng JMRI/);
  // Samma komponent ska fortfarande visa Linux-/Mac-inställningen med adress och kanal.
  view={...view,platform:'linux',mode:'offline',btlocobridge:{target:'AA:BB:CC:DD:EE:FF',channel:2}};
  await page.reload();await page.getByLabel('Kortets adress').waitFor();
  assert.equal(await page.locator('[data-channel]').isVisible(),true);
  assert.equal(await page.locator('[data-channel]').inputValue(),'2');
  assert.deepEqual(errors,[]);console.log('Webbläsarprov: Windows-COM, spara/sök, fel och Linux-regression godkända.');
} finally {await browser?.close();server.close();}
