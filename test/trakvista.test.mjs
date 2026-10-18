// Träkvista som andra station: profilen ur Bennys Trakvista.xml (LogixNG) och stationsfilen, provad i samma kärna
// och samma oberoende anläggningsmodell som Charlottendal. Inget här rör Charlottendals profil.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import { Engine } from '../src/engine.mjs';
import { Field } from '../src/field.mjs';
import { decode, sensorReport, switchReport } from '../src/protocol.mjs';
import { Topology } from '../src/topology.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL('../'+p,import.meta.url)));
const profile=read('stations/trakvista/profiles/network.json'),fieldProfile=read('stations/trakvista/profiles/field.json');
const source=read('stations/trakvista/data/operations-source.json'),panel=read('stations/trakvista/data/panel.json');
function rig(){
  let now=100000;const queue=[],commands=[];
  const field=new Field(fieldProfile,{now:()=>now,movementMs:100});
  const engine=new Engine(profile,{storage:null,now:()=>now,send:b=>{queue.push(['order',b]);commands.push(decode(b));}});
  field.on('frame',b=>queue.push(['report',b]));
  function drain(){let guard=20000;while(queue.length&&guard--){const [kind,b]=queue.shift();if(kind==='order')field.accept(b);else engine.receive(b);}assert.ok(guard>0,'återrapporterna ska lugna sig');}
  function advance(ms){for(let i=0;i<ms;i+=50){now+=50;field.tick();if(now%1000===0)field.allReports();drain();engine.tick();drain();}}
  engine.connection(true);field.allReports();drain();
  return {engine,field,commands,drain,advance,request:(a,b)=>engine.request(a,b)};
}
test('Träkvistas källregler: 27 huvudtågvägar och 30 växeltågvägar, alla med en väg i grafen',()=>{
  assert.equal(source.format,'logixng');
  assert.equal(source.mainRoutePolicies.length,27);assert.equal(source.shuntRoutePolicies.length,30);
  assert.ok([...source.mainRoutePolicies,...source.shuntRoutePolicies].every(r=>r.status==='allowed'),'inga oklara regler');
  assert.equal(profile.routes.filter(r=>r.kind==='main').length,27);assert.equal(profile.routes.filter(r=>r.kind==='shunt').length,30);
  assert.equal(profile.excluded.length,0);
  assert.equal(Object.keys(profile.turnouts).length,13);assert.equal(Object.keys(profile.signals).length,25);
});
test('korsningsväxeln 22a/23 läggs med båda växlarna enligt JMRI:s lägen',()=>{
  const b1=profile.routes.find(r=>r.id==='htvB--htvI'),c1=profile.routes.find(r=>r.id==='htvC--htvI'),b3=profile.routes.find(r=>r.id==='htvB--htvIII');
  assert.deepEqual([b1.turnouts.Vx22a,b1.turnouts.Vx23],['C','C']);    // B–D: rakt genom
  assert.deepEqual([c1.turnouts.Vx22a,c1.turnouts.Vx23],['C','T']);    // A–D: från C mot spår I och II
  assert.deepEqual([b3.turnouts.Vx22a,b3.turnouts.Vx23],['T','C']);    // B–C: från B mot spår III
  assert.deepEqual(b1.signals,['2/2','2/4','2/6']);assert.deepEqual(c1.signals,['1/2','1/4','2/6']);
  const topology=new Topology(panel);
  assert.equal(topology.turnouts.Vx22a.block,'S22a');assert.equal(topology.turnouts.Vx23.slip,'SL2');
});
test('C-linjen är lodrät: 1/2 är infart och 1/9 utfart enligt stationens riktning',()=>{
  const inn=profile.routes.find(r=>r.id==='htvC--htvII'),out=profile.routes.find(r=>r.id==='htvII--htvC');
  assert.equal(inn.signals[0],'1/2');assert.equal(out.exitSignal,'1/9');assert.equal(out.blocks.at(-1),'SC2');
});
test('blocklistorna stämmer med Bennys tågvägstabeller utom 2/3 → 3/7 (kopieringsfel) och 2/6 → 4v (signalen flyttad till före växel 13)',()=>{
  const all=[...profile.routes,...profile.routeAlternatives],sensor=x=>'tvs'+(/^\d\d$/.test(x)?x[0]+'/'+x[1]:/^\d\d\d$/.test(x)?x[0]+'/'+x.slice(1):x);
  const wrong=[];
  for(const [name,blocks] of Object.entries(source.tables)){
    const [a,b]=name.split('-'),rs=all.filter(r=>r.source.nxButtons[0]===sensor(a)&&r.source.nxButtons[1]===sensor(b));
    if(!rs.length)continue;   // 2/1 → 2/3 och 2/2 → 2/4 är inre steg i huvudtågvägarna
    if(!rs.some(r=>JSON.stringify([...r.blocks].sort())===JSON.stringify([...blocks].sort())))wrong.push(name);
  }
  assert.deepEqual(wrong.sort(),['23-37','26-4v']);
});
test('alla Träkvistas tågvägar läggs, klareras och löses upp efter tågets passage',{timeout:120000},()=>{
  for(const def of profile.routes){
    const r=rig(),route=r.request(def.from,def.to);r.advance(6500);assert.equal(route.state,'active',def.label+': '+route.reason);
    for(const s of def.signals)assert.equal(r.engine.signals[s].aspect,'go',def.label+': '+s+' kör');
    r.field.startTrain(def.id);r.advance((route.passage.length+3)*850);
    assert.equal(r.field.trains.length,0,def.label+': tåget stannade');
    assert.equal(r.engine.routes.length,0,def.label+': '+route.reason);
  }
});
test('en tågväg genom korsningsväxeln spärrar den korsande vägen',()=>{
  const r=rig(),b=r.request('htvB','htvI');r.advance(6500);assert.equal(b.state,'active');
  assert.throws(()=>r.request('htvC','htvII'));
  assert.throws(()=>r.request('htvIII','htvC'));
});
test('stationsvalet: paketets station är standard, Träkvista väljs med CHARLOTTENDAL_STATION och okända namn vägras',async()=>{
  const {currentStation,stateDirectory,stationIds,DEFAULT_STATION}=await import('../src/station.mjs');
  // cda-tkl har Charlottendal som standard; Tk-TKL saknar Charlottendals filer och har Träkvista.
  const withCharlottendal=fs.existsSync(new URL('../profiles/charlottendal-network.json',import.meta.url));
  assert.equal(DEFAULT_STATION,withCharlottendal?'charlottendal':'trakvista');
  assert.deepEqual(stationIds().filter(id=>['charlottendal','trakvista'].includes(id)),withCharlottendal?['charlottendal','trakvista']:['trakvista']);
  const tk=currentStation({CHARLOTTENDAL_STATION:'trakvista'});
  assert.equal(currentStation({}).id,DEFAULT_STATION);
  assert.equal(tk.title,'Träkvista');assert.match(tk.dataDir,/stations\/trakvista\/data$/);assert.match(tk.profile,/stations\/trakvista\/profiles\/network\.json$/);
  assert.throws(()=>currentStation({CHARLOTTENDAL_STATION:'../profiles'}),/Okänd station/);
  if(withCharlottendal){const cda=currentStation({});assert.equal(cda.builtIn,true);assert.match(cda.dataDir,/public\/data$/);assert.match(stateDirectory({},cda),/var$/);}
  else assert.throws(()=>currentStation({CHARLOTTENDAL_STATION:'charlottendal'}),/Okänd station/);
  assert.match(stateDirectory({},tk),/var\/trakvista$/);
  assert.equal(stateDirectory({CHARLOTTENDAL_STATE_DIR:'/tmp/x'},tk),'/tmp/x');
});
test('panelen visar korsningsväxelns förbindelse först när båda växlarna rapporterat',async()=>{
  const {slipDisplay}=await import('../public/turnout-display.js');
  const slip=panel.slips.SL2,at=1000;
  assert.deepEqual(slipDisplay(slip,{Vx22a:{position:'C'},Vx23:{position:'C'}},{fresh:true,now:at}).active,['B','D']);
  assert.deepEqual(slipDisplay(slip,{Vx22a:{position:'C'},Vx23:{position:'T'}},{fresh:true,now:at}).active,['A','D']);
  assert.equal(slipDisplay(slip,{Vx22a:{position:'C'},Vx23:{position:'unknown',desired:'T',commandAt:at-100}},{fresh:true,now:at}).phase,'waiting');
  assert.equal(slipDisplay(slip,{Vx22a:{position:'C'},Vx23:{position:'C'}},{fresh:false,now:at}).phase,'unknown');
});
test('tågspårningen går genom korsningsväxeln bara i det läge som leder dit',async()=>{
  const {buildTrackGraph}=await import('../src/train-tracking.mjs');
  const graph=buildTrackGraph(panel,profile);
  const fromB=graph.SB1.get('S22a');assert.ok(fromB.some(c=>c.some(x=>x.turnout==='Vx23'&&x.position==='C')));
  assert.ok(graph.SC1.get('S22a').every(c=>c.some(x=>x.turnout==='Vx23'&&x.position==='T')),'från C bara med 23 avvikande');
});
test('Bennys ofyllda spår är lokala; 22a och 23 är det inte',()=>{
  assert.deepEqual(profile.panelStyle.localBlocks,['L2','L3','LS1','LS2','S10','S11','S12','S13','SSI','SSII','TP']);
  assert.ok(!profile.panelStyle.localBlocks.includes('S22a'));
  for(const n of ['Vx10','Vx11','Vx12','Vx13'])assert.equal(profile.turnouts[n].local,true);
  assert.equal(profile.turnouts.Vx22a.address,1);assert.equal(profile.turnouts.Vx23.address,2);
});

test('Bennys rättelse: 4v står före växel 13, och 2/6 → 4v går varken genom 13 eller in på Timmerlossningen',()=>{
  const r=profile.routes.find(r=>r.id==='vtv2.6--vtv4v');
  assert.deepEqual(r.blocks,['S32','S34','S4/7']);assert.ok(!('Vx13' in r.turnouts));assert.ok(r.guardSignals.includes('S4v'));
  assert.deepEqual(source.corrections.map(c=>c.id),['4v-fore-vaxel-13']);
  assert.ok(source.turnoutEnds.some(e=>e.id==='TO9'&&e.leg==='C'&&e.mast==='S4v'&&e.sensor==='tvs4v'));
  assert.ok(!source.anchors.some(a=>a.ident==='EB4'));
  for(const t of ['Vx10','Vx11','Vx12','Vx13'])assert.equal(profile.manualPolicies.byTurnout[t].status,'unresolved');
  assert.ok([...profile.routes,...profile.routeAlternatives].every(r=>!Object.keys(r.turnouts).some(n=>profile.turnouts[n].local)));
});
test('växelmotorns två givare: läget när exakt en är aktiv, okänt medan växeln går, bekräftat direkt om den redan ligger rätt',()=>{
  const r=rig(),f=profile.turnouts.Vx22b.feedbackSensors;
  assert.deepEqual([f.thrown,f.closed],[255,256]);
  // Simulatorn: alla växlar ligger rakt och rapporterar via givarna, inte växelrapporten.
  assert.equal(r.engine.turnouts.Vx22b.position,'C');
  const before=r.commands.length;r.engine.turnoutOrder('Vx22b','C');
  assert.equal(r.engine.turnouts.Vx22b.position,'C','redan rakt: givarna bekräftar direkt');assert.ok(r.engine.turnoutConfirmed('Vx22b','C'));
  assert.equal(r.commands.length,before+1,'ordern skickas ändå');r.drain();
  r.engine.turnoutOrder('Vx22b','T');r.drain();assert.equal(r.engine.turnouts.Vx22b.position,'unknown');
  r.advance(800);assert.equal(r.engine.turnouts.Vx22b.position,'T');assert.ok(r.engine.turnoutConfirmed('Vx22b','T'));
  r.engine.receive(sensorReport(256,true));assert.equal(r.engine.turnouts.Vx22b.position,'unknown','båda aktiva = fel');
  r.engine.receive(sensorReport(255,false));assert.equal(r.engine.turnouts.Vx22b.position,'C');
  r.engine.receive(switchReport(3,'T'));assert.equal(r.engine.turnouts.Vx22b.position,'C','växelrapporten räknas inte för en växel med givare');
  assert.equal(profile.turnouts.Vx21a.feedbackSensors,undefined,'21a saknar givare i XML');
});

test('Tk-TKL: make-station-repository gives Träkvista its own installation, and a second run changes nothing',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tk-tkl-'));
  for(const f of ['packaging/identity.env','install.sh','install.ps1','package.json','package-lock.json','stations/trakvista/station.json','stations/trakvista/README.md','scripts/make-station-repository.mjs','scripts/start.mjs','packaging/render/render.yaml','packaging/render/Dockerfile']){
    fs.mkdirSync(path.dirname(path.join(dir,f)),{recursive:true});fs.copyFileSync(new URL('../'+f,import.meta.url),path.join(dir,f));
  }
  fs.writeFileSync(path.join(dir,'README.md'),'# Charlottendal TKL\n');
  const run=()=>execFileSync(process.execPath,[path.join(dir,'scripts/make-station-repository.mjs'),'trakvista'],{encoding:'utf8'}),at=f=>fs.readFileSync(path.join(dir,f),'utf8');
  run();
  assert.match(at('packaging/identity.env'),/^TKL_ID=tk-tkl\nTKL_NAME=Träkvista\nTKL_STATION=trakvista\nTKL_REPOSITORY=beahead-ab\/Tk-TKL$/m);
  assert.match(at('install.sh'),/^REPOSITORY="beahead-ab\/Tk-TKL"\nNAME="Träkvista TKL"$/m);
  assert.match(at('install.ps1'),/^\$Repository = 'beahead-ab\/Tk-TKL'$/m);
  assert.doesNotMatch(at('install.sh')+at('install.ps1'),/githubusercontent\.com\/beahead-ab\/cda-tkl-install/);
  assert.match(at('install.ps1'),/-ne 'beahead-ab\/cda-tkl-install'/,'the comparison with Charlottendal\'s repository is kept');
  const pkg=JSON.parse(at('package.json')),lock=JSON.parse(at('package-lock.json'));
  assert.equal(pkg.name,'tk-tkl');assert.equal(pkg.scripts.start,'node scripts/start.mjs trakvista');
  assert.equal(pkg.scripts['verify:layout'],undefined,'scripts for files the station repository lacks are left out');assert.equal(pkg.scripts.backend,'node src/server.mjs');
  assert.equal(lock.name,'tk-tkl');assert.equal(lock.packages[''].name,'tk-tkl');assert.equal(lock.version,pkg.version);
  assert.equal(at('README.md'),at('stations/trakvista/README.md'));
  // Webbdriften på Render: Blueprint och Dockerfile med Träkvistas namn, station och förråd.
  assert.match(at('render.yaml'),/^    name: tk-tkl$/m);assert.match(at('render.yaml'),/key: CHARLOTTENDAL_STATION\n        value: trakvista/);
  assert.match(at('render.yaml'),/key: CHARLOTTENDAL_INSTALL_REPOSITORY\n        value: beahead-ab\/Tk-TKL/);assert.doesNotMatch(at('render.yaml'),/__/);
  assert.equal(at('Dockerfile.render'),at('packaging/render/Dockerfile'));assert.match(at('Dockerfile.render'),/COPY stations \.\/stations/);
  assert.match(run(),/redan inställd/);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('Träkvistas server och anläggning startar som processer, har Studio och lägger A → Spår II, utan Charlottendals filer',{timeout:60000},async()=>{
  const freePort=()=>new Promise((ok,no)=>{const s=net.createServer();s.once('error',no);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>ok(p));});});
  const [port,simPort,wirePort]=await Promise.all([freePort(),freePort(),freePort()]),dir=fs.mkdtempSync(path.join(os.tmpdir(),'trakvista-'));
  const env={...process.env,CHARLOTTENDAL_STATION:'trakvista',CHARLOTTENDAL_CONNECTION_MODE:'simulator',CHARLOTTENDAL_WIRE_HOST:'127.0.0.1',
    CHARLOTTENDAL_PORT:String(port),CHARLOTTENDAL_SIM_PORT:String(simPort),CHARLOTTENDAL_WIRE_PORT:String(wirePort),CHARLOTTENDAL_STATE_DIR:dir};
  let output='';const children=['src/simulator.mjs','src/server.mjs'].map(file=>{const c=spawn(process.execPath,[file],{cwd:new URL('..',import.meta.url),env});c.stdout.on('data',d=>output+=d);c.stderr.on('data',d=>output+=d);return c;});
  const api=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${port}${p}`,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});return r.json();};
  const until=async(fn,ms=20000)=>{const end=Date.now()+ms;while(Date.now()<end){try{const v=await fn();if(v)return v;}catch{}await new Promise(r=>setTimeout(r,200));}throw Error('Tidsgräns. '+output.slice(-2000));};
  try{
    const config=await until(()=>api('/api/config'));
    assert.equal(config.station.id,'trakvista');assert.equal(config.routes.length,57);
    assert.deepEqual({studio:config.station.studio,source:config.station.source,register:config.station.register,migration:config.station.migration},{studio:true,source:'Trakvista.xml',register:true,migration:false});
    const studio=await api('/api/studio');assert.equal(studio.counts.turnouts,13);assert.equal(studio.counts.routes,57);
    const original=await fetch(`http://127.0.0.1:${port}/data/source/Trakvista.xml`);assert.equal(original.status,200);assert.match((await original.text()).slice(0,200),/<\?xml/);
    assert.equal((await fetch(`http://127.0.0.1:${port}/data/source/station.json`)).status,404,'only the JMRI file is served from the station folder');
    await until(async()=>(await api('/api/state')).connection==='connected');
    // Direkt efter anslutningen har spårledningarna inte rapporterat än; begäran nekas tills de har det.
    await until(async()=>(await api('/api/route',{from:'htvA',to:'htvII'})).ok);
    await until(async()=>(await api('/api/state')).routes.some(r=>r.from==='htvA'&&r.to==='htvII'&&r.state==='active'));
  }finally{await Promise.all(children.map(c=>new Promise(r=>{c.once('exit',r);c.kill('SIGTERM');})));fs.rmSync(dir,{recursive:true,force:true});}
});

test('Tk-TKL: publiceringen lägger in en GitHub-kontroll som kör proven och stationens kontroll på varje pull request',()=>{
  const workflow=fs.readFileSync(new URL('../packaging/github/station-tests.yml',import.meta.url),'utf8');
  assert.match(workflow,/^on:\n  pull_request:/m);assert.match(workflow,/- run: npm test$/m);assert.match(workflow,/verify:\$\(sed -n 's\/\^TKL_STATION=\/\/p' packaging\/identity\.env\)/);
  // cda-tkl har publiceringen, Tk-TKL har kontrollen som publiceringen lade in.
  const publish=new URL('../deploy/publish-station.sh',import.meta.url),installed=new URL('../.github/workflows/prov.yml',import.meta.url);
  if(fs.existsSync(publish))assert.match(fs.readFileSync(publish,'utf8'),/cp packaging\/github\/station-tests\.yml \.github\/workflows\/prov\.yml/);
  else assert.equal(fs.readFileSync(installed,'utf8'),workflow);
});

test('Träkvistas Studio: källorna ur stationens katalog och Trakvista.xml, LogixNG-avkänningen och regler som kompileras tillbaka oförändrade',async()=>{
  const {currentStation}=await import('../src/station.mjs'),{loadSources}=await import('../src/studio/sources.mjs'),{studioData}=await import('../src/studio/index.mjs');
  const sources=loadSources(undefined,currentStation({CHARLOTTENDAL_STATION:'trakvista'}));
  assert.deepEqual(sources.station,{id:'trakvista',title:'Träkvista',sourceName:'Trakvista.xml'});assert.equal(sources.migration,null);
  const data=studioData(sources);
  assert.deepEqual({...data.counts,measured:undefined},{turnouts:13,signals:25,blocks:36,routes:57,modules:0,measured:undefined});
  // LogixNG: importören har följt reglerna till ingångarna, så varje spårledning med sensor har sina LS-ingångar.
  assert.deepEqual(data.detection.shapes,{single:22,any:3,noSensor:11});assert.deepEqual(data.detection.undetected.noRule,[]);
  assert.ok(data.detection.sections.filter(s=>s.sourceSensor).every(s=>s.inputs.length&&s.inputs.every(i=>/^LS\d+$/.test(i))));
  // Regler härledda ur profilen ger exakt profilen tillbaka: en aktivering i Studio ändrar inget som inte ändrats i Studio.
  assert.equal(data.rules.compiledIdentical,true);assert.deepEqual(data.rules.baseDiff,{fragments:0,routes:0});assert.deepEqual(data.rules.problems,[]);
  // Inget i avvikelselistan förutsätter Charlottendal: rangerbangården, vändskivan och programmeringsspåret räknas som noll.
  const dev=Object.fromEntries(data.deviations.map(r=>[r.id,r.count]));
  assert.equal(dev['yard-boundaries'],0);assert.equal(dev.turntable,0);assert.equal(dev['programming-relay'],0);assert.equal(dev['nx-without-route'],0);
  assert.equal(dev['turnout-unmeasured'],13);assert.equal(dev['manual-groups'],4,'de fyra lokala växlarna');
});

test('webbdrift på Render för en ny station: ägaren skapas en gång, lösenordet byts, Träkvista svarar; flyttläget väntar som förut',{timeout:90000},async()=>{
  const freePort=()=>new Promise((ok,no)=>{const s=net.createServer();s.once('error',no);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>ok(p));});});
  const host='tk-tkl.example.test',origin='https://'+host;
  const launch=async extra=>{
    const [port,tkl,sim,wire]=await Promise.all([freePort(),freePort(),freePort(),freePort()]),dir=fs.mkdtempSync(path.join(os.tmpdir(),'render-'));
    for(const d of ['state','auth'])fs.mkdirSync(path.join(dir,d));
    const env={...process.env,RENDER_EXTERNAL_URL:origin,CDA_RENDER_DATA_DIR:dir,PORT:String(port),CDA_RENDER_LISTEN:'127.0.0.1',CDA_RENDER_TKL_PORT:String(tkl),CDA_RENDER_SIM_PORT:String(sim),CDA_RENDER_WIRE_PORT:String(wire),CHARLOTTENDAL_STATION:'trakvista',...extra};
    let output='';const child=spawn(process.execPath,['deploy/render/start.mjs'],{cwd:new URL('..',import.meta.url),env});child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
    return {port,dir,child,log:()=>output};
  };
  const call=(port,method,p,{body,cookie}={})=>new Promise((ok,no)=>{const data=body?JSON.stringify(body):'';
    const req=http.request({hostname:'127.0.0.1',port,method,path:p,headers:{host,origin,'content-type':'application/json','content-length':Buffer.byteLength(data),...(cookie?{cookie}:{})}},res=>{let t='';res.on('data',c=>t+=c);res.on('end',()=>{let json=null;try{json=JSON.parse(t);}catch{}ok({status:res.statusCode,json,cookie:(res.headers['set-cookie']||[])[0]?.split(';')[0]});});});
    req.on('error',no);req.end(data);});
  const until=async(fn,log,ms=40000)=>{const end=Date.now()+ms;while(Date.now()<end){try{const v=await fn();if(v)return v;}catch{}await new Promise(r=>setTimeout(r,250));}throw Error('Tidsgräns. '+log().slice(-1500));};
  const stop=async g=>{await new Promise(r=>{if(g.child.exitCode!==null)return r();g.child.once('exit',r);g.child.kill('SIGTERM');});fs.rmSync(g.dir,{recursive:true,force:true});};
  const fresh=await launch({TKL_RENDER_NEW:'1',TKL_OWNER_EMAIL:'benny@example.test',TKL_OWNER_PASSWORD:'tillfalligt-123'});
  try{
    await until(async()=>(await call(fresh.port,'GET','/healthz')).json?.status==='running',fresh.log);
    const users=JSON.parse(fs.readFileSync(path.join(fresh.dir,'auth','users.json'),'utf8')).users;
    assert.deepEqual(users.map(u=>[u.username,u.role,u.mustChange]),[['benny@example.test','owner',true]]);
    const login=await until(async()=>{const r=await call(fresh.port,'POST','/api/auth/login',{body:{username:'benny@example.test',password:'tillfalligt-123'}});return r.status===200&&r;},fresh.log);
    assert.equal(login.json.mustChange,true);
    assert.equal((await call(fresh.port,'GET','/api/config',{cookie:login.cookie})).status,428,'the temporary password must be changed first');
    const changed=await call(fresh.port,'POST','/api/auth/password',{cookie:login.cookie,body:{currentPassword:'tillfalligt-123',newPassword:'bennys-eget-456'}});
    assert.equal(changed.status,200);
    const config=await call(fresh.port,'GET','/api/config',{cookie:changed.cookie});
    assert.equal(config.json.station.id,'trakvista');assert.equal(config.json.routes.length,57);
    assert.equal((await call(fresh.port,'GET','/api/config')).status,401,'nothing without logging in');
  }finally{await stop(fresh);}
  // Utan TKL_RENDER_NEW är det Charlottendals flyttade webbdrift: inget startar förrän återställningen är gjord.
  const moved=await launch({});
  try{
    await until(async()=>(await call(moved.port,'GET','/healthz')).json?.status==='waiting-for-restore',moved.log,15000);
    assert.equal(fs.existsSync(path.join(moved.dir,'auth','users.json')),false);
  }finally{await stop(moved);}
});
