import test from 'node:test';
import assert from 'node:assert/strict';
import {UpdateCheck,newer} from '../src/update-check.mjs';

test('versions compare by number, not by text',()=>{
  assert.equal(newer('0.48.1','0.48.0'),true);assert.equal(newer('0.49.0','0.48.9'),true);assert.equal(newer('0.10.0','0.9.9'),true);
  assert.equal(newer('0.48.0','0.48.0'),false);assert.equal(newer('0.47.9','0.48.0'),false);
});

test('a newer release in cda-tkl-install is offered; the same or an older one is not',async()=>{
  let version='0.49.0';const urls=[];
  const check=new UpdateCheck({current:'0.48.0',kind:'raspberry-pi',now:()=>1000,fetcher:async url=>{urls.push(url);return new Response(JSON.stringify({version}));}});
  assert.deepEqual(await check.check(),{kind:'raspberry-pi',repository:'beahead-ab/cda-tkl-install',product:'Charlottendal TKL',current:'0.48.0',latest:'0.49.0',available:true,newReleases:[],checkedAt:1000,error:'',canStart:true,run:null});
  assert.equal(urls[0],'https://raw.githubusercontent.com/beahead-ab/cda-tkl-install/main/package.json');
  version='0.48.0';assert.equal((await check.check()).available,false);
});

test('a failed check keeps the last answer and says why; a Mac or PC cannot start the update itself',async()=>{
  let fail=false;
  const check=new UpdateCheck({current:'0.48.0',kind:'mac',fetcher:async()=>{if(fail)throw Error('offline');return new Response('{"version":"0.48.2"}');}});
  await check.check();fail=true;const v=await check.check();
  assert.equal(v.available,true);assert.equal(v.latest,'0.48.2');assert.match(v.error,/offline/);assert.equal(v.canStart,false);
  await assert.rejects(async()=>new UpdateCheck({current:'1',kind:'linux'}),/Okänd installationstyp/);
});

test('what a newer release brings comes from its releases.json, newer entries only',async()=>{
  const releases=[{version:'0.58.0',date:'2026-10-05',notes:['Vad är nytt']},{version:'0.57.1',date:'2026-10-04',notes:['Äldre']}];
  const check=new UpdateCheck({current:'0.57.1',kind:'mac',fetcher:async url=>new Response(JSON.stringify(url.endsWith('releases.json')?releases:{version:'0.58.0'}))});
  assert.deepEqual((await check.check()).newReleases,[{version:'0.58.0',date:'2026-10-05',notes:['Vad är nytt']}]);
  const offline=new UpdateCheck({current:'0.57.1',kind:'mac',fetcher:async url=>{if(url.endsWith('releases.json'))throw Error('offline');return new Response('{"version":"0.58.0"}');}});
  const view=await offline.check();assert.equal(view.available,true);assert.deepEqual(view.newReleases,[]);assert.equal(view.error,'');
});

test('the web deployment can start its own update and reports the last run',async()=>{
  let text='{"phase":"failed","message":"0.58.0 startade inte. 0.57.1 är återställd.","at":"2026-10-05T18:00:00Z","from":"0.57.1","to":"0.58.0"}';
  const check=new UpdateCheck({current:'0.57.1',kind:'web',statusFile:'/state/update.json',readFile:()=>{if(text===null)throw Error('ENOENT');return text;},fetcher:async()=>new Response('{"version":"0.58.0"}')});
  const view=await check.check();
  assert.equal(view.canStart,true);
  assert.deepEqual(view.run,{phase:'failed',message:'0.58.0 startade inte. 0.57.1 är återställd.',at:'2026-10-05T18:00:00Z',from:'0.57.1',to:'0.58.0'});
  text=null;assert.equal(check.view().run,null,'no file, no last run');
  text='inte json';assert.equal(check.view().run,null);
  assert.equal(new UpdateCheck({current:'1.0.0',kind:'mac'}).view().canStart,false,'a Mac runs the line in Terminal');
});

// Casper 17 oktober: Uppdatering på Render sa Misslyckades om ett försök den 6 oktober på den gamla servern
// (0.59.1 → 0.68.0) fast 0.81.0 var installerad och senaste versionen.
test('a run between two older versions is left out; one that concerns the running version stays',()=>{
  let text='{"phase":"failed","message":"0.68.0 startade inte. 0.59.1 är återställd; säkerhetskopia i /var/backups.","at":"2026-10-06T15:57:00Z","from":"0.59.1","to":"0.68.0"}';
  const at=current=>new UpdateCheck({current,kind:'render',statusFile:'/data/state/update.json',readFile:()=>text});
  assert.equal(at('0.81.0').view().run,null,'0.81.0 is newer than both versions in the run');
  assert.equal(at('0.81.0').run().phase,'failed','the file is still read, only not shown');
  assert.equal(at('0.59.1').view().run.phase,'failed','still on the version it fell back to');
  assert.equal(at('0.68.0').view().run.phase,'failed','on the version it tried');
  text='{"phase":"done","message":"Version 0.72.0 är installerad. Föregående version: 0.71.1.","at":"2026-10-08T10:05:00Z","from":"0.71.1","to":"0.72.0"}';
  assert.equal(at('0.72.0').view().run.phase,'done');assert.equal(at('0.73.0').view().run,null,'Render built 0.73.0 by itself');
  text='{"phase":"failed","message":"Kunde inte hämta.","at":"2026-10-08T10:05:00Z","from":"","to":""}';
  assert.equal(at('0.81.0').view().run.phase,'failed','without versions it cannot be judged, so it stays');
});

test('on Render the Deploy Hook starts a build, and the next version settles the run',async()=>{
  const HOOK='https://api.render.com/deploy/srv-d3abc123?key=Xy_9-z';let file=null,now=Date.parse('2026-10-08T10:00:00Z');const calls=[];
  const io={statusFile:'/data/state/update.json',readFile:()=>{if(file===null)throw Error('ENOENT');return file;},writeFile:(_,text)=>{file=text;},now:()=>now};
  const fetcher=async(url,options)=>{calls.push([url,options?.method||'GET']);return new Response(url===HOOK?'{"deploy":{"id":"dep-1"}}':'{"version":"0.72.0"}');};
  assert.equal(new UpdateCheck({current:'0.71.1',kind:'render',hook:'https://example.test/deploy?key=1'}).view().canStart,false,'only a Render Deploy Hook is used');
  assert.equal(new UpdateCheck({current:'0.71.1',kind:'render'}).view().canStart,false,'no hook: Render builds main by itself');
  const check=new UpdateCheck({current:'0.71.1',kind:'render',hook:HOOK,fetcher,...io});
  await check.check();assert.equal(check.view().canStart,true);
  await check.startRender();
  assert.deepEqual(calls.at(-1),[HOOK,'POST']);
  assert.equal(check.view().run.phase,'restarting');assert.equal(check.view().run.to,'0.72.0');
  assert.equal(JSON.stringify(check.view()).includes('key=Xy'),false,'the hook never leaves the server');
  // The container restarts on the new version: it reads the file and marks the run done.
  const after=new UpdateCheck({current:'0.72.0',kind:'render',hook:HOOK,fetcher,...io});after.settle();
  assert.equal(after.view().run.phase,'done');assert.match(after.view().run.message,/0\.72\.0 är installerad\. Föregående version: 0\.71\.1/);
  // A build that never replaced the running version is reported after 30 minutes.
  await check.startRender();now+=31*60000;check.settle();
  assert.equal(check.view().run.phase,'failed');assert.match(check.view().run.message,/Render har inte bytt version/);
  await assert.rejects(()=>new UpdateCheck({current:'0.71.1',kind:'render',...io}).startRender(),/Ingen Deploy Hook/);
});

test('an installation of another station reads its own repository (Träkvista: beahead-ab/Tk-TKL)',async()=>{
  const {installRepository}=await import('../src/update-check.mjs');
  assert.equal(installRepository({}),'beahead-ab/cda-tkl-install');
  assert.equal(installRepository({CHARLOTTENDAL_INSTALL_REPOSITORY:'beahead-ab/Tk-TKL'}),'beahead-ab/Tk-TKL');
  assert.equal(installRepository({CHARLOTTENDAL_INSTALL_REPOSITORY:'../../etc'}),'beahead-ab/cda-tkl-install');
  const urls=[];const check=new UpdateCheck({current:'0.81.0',kind:'raspberry-pi',repository:'beahead-ab/Tk-TKL',product:'Träkvista TKL',fetcher:async url=>{urls.push(url);return new Response('{"version":"0.81.0"}');}});
  const view=await check.check();assert.equal(urls[0],'https://raw.githubusercontent.com/beahead-ab/Tk-TKL/main/package.json');
  assert.equal(view.repository,'beahead-ab/Tk-TKL');assert.equal(view.product,'Träkvista TKL');
});

test('a private repository (Tk-TKL) is read through GitHub\'s API with the installation\'s token, which never reaches the panel',async()=>{
  const {readToken}=await import('../src/update-check.mjs');
  const token='github_pat_0123456789abcdefABCDEF_xyz',calls=[];
  const check=new UpdateCheck({current:'0.81.0',kind:'raspberry-pi',repository:'beahead-ab/Tk-TKL',product:'Träkvista TKL',token:()=>token,
    fetcher:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(url.includes('releases.json')?[{version:'0.82.0',notes:['Nytt']}]:{version:'0.82.0'}));}});
  const view=await check.check();
  assert.equal(calls[0].url,'https://api.github.com/repos/beahead-ab/Tk-TKL/contents/package.json?ref=main');
  assert.equal(calls[0].options.headers.Authorization,'Bearer '+token);assert.equal(calls[0].options.headers.Accept,'application/vnd.github.raw+json');
  assert.equal(calls[1].url,'https://api.github.com/repos/beahead-ab/Tk-TKL/contents/public/releases.json?ref=main');
  assert.equal(view.available,true);assert.deepEqual(view.newReleases.map(r=>r.version),['0.82.0']);
  assert.ok(!JSON.stringify(view).includes(token),'the token is not in the view');
  // Without a token a private repository answers 404, and the panel says what is missing.
  const bare=new UpdateCheck({current:'0.81.0',kind:'raspberry-pi',repository:'beahead-ab/Tk-TKL',fetcher:async()=>new Response('',{status:404})});
  assert.match((await bare.check()).error,/svar 404; är förrådet privat behöver installationen en token/);
  const refused=new UpdateCheck({current:'0.81.0',kind:'raspberry-pi',repository:'beahead-ab/Tk-TKL',token:()=>token,fetcher:async()=>new Response('',{status:401})});
  assert.match((await refused.check()).error,/GitHub godtar inte installationens token/);
  // The token file: read at every check, trimmed, and only a token-shaped value is used.
  const files={'/etc/tk-tkl/github-token':token+'\n','/etc/tk-tkl/bad':'token\r\nX-Injected: 1'};
  const read=f=>{if(!(f in files))throw Object.assign(Error('ENOENT'),{code:'ENOENT'});return files[f];};
  assert.equal(readToken({CHARLOTTENDAL_GITHUB_TOKEN_FILE:'/etc/tk-tkl/github-token'},read),token);
  assert.equal(readToken({CHARLOTTENDAL_GITHUB_TOKEN_FILE:'/etc/tk-tkl/bad'},read),'');
  assert.equal(readToken({CHARLOTTENDAL_GITHUB_TOKEN_FILE:'/etc/tk-tkl/missing'},read),'');
  assert.equal(readToken({},read),'');
});

// Uppdatera nu på en Mac eller PC (0.84.0): installeraren lägger ett update-skript i installationens mapp och
// skriver vägen i app.env. Panelen startar skriptet fristående; TKL för anteckningarna själv, som på Render.
test('en Mac eller PC med installationens update-skript startar uppdateringen härifrån', () => {
  let file=null,now=1000;
  const io={statusFile:'/state/update.json',readFile:()=>{if(file===null)throw Error('ENOENT');return file;},writeFile:(_,text)=>{file=text;},now:()=>now};
  const check=new UpdateCheck({current:'0.83.0',kind:'mac',command:'/Users/casper/Library/Application Support/Charlottendal TKL/update.sh',...io});
  check.latest='0.84.0';
  assert.equal(check.view().canStart,true);
  check.startLocal();
  assert.equal(check.view().run.phase,'fetching');
  assert.match(check.view().run.message,/0\.84\.0/);
  // Nästa process läser filen: har versionen bytts är uppdateringen klar.
  const after=new UpdateCheck({current:'0.84.0',kind:'mac',command:'/x/update.sh',...io});
  after.settle();
  assert.equal(after.view().run.phase,'done');
  assert.match(after.view().run.message,/Föregående version: 0\.83\.0/);
});

test('en uppdatering som inte bytt version på tjugo minuter rapporteras som misslyckad', () => {
  let file=null,now=1000;
  const io={statusFile:'/state/update.json',readFile:()=>{if(file===null)throw Error('ENOENT');return file;},writeFile:(_,text)=>{file=text;},now:()=>now};
  const check=new UpdateCheck({current:'0.83.0',kind:'windows',command:'C:\\Users\\Casper\\update.ps1',...io});
  check.latest='0.84.0';check.startLocal();
  now+=19*60000;check.settle();
  assert.equal(check.view().run.phase,'fetching','en pågående uppdatering får ta sin tid');
  now+=2*60000;check.settle();
  assert.equal(check.view().run.phase,'failed');
  assert.match(check.view().run.message,/0\.83\.0 kör fortfarande/);
  // Utan skript finns ingen knapp, och ingenting kan startas.
  const plain=new UpdateCheck({current:'0.83.0',kind:'windows'});
  assert.equal(plain.view().canStart,false);
  assert.throws(()=>plain.startLocal(),/inget uppdateringsskript/);
});

