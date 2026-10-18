import test from 'node:test';
import assert from 'node:assert/strict';
import {TrainMeet,matchStation} from '../src/trainmeet.mjs';
import fs from 'node:fs';
import {readTimetable} from '../src/trainmeet-timetable.mjs';
test('accepts timetable emitted by the reviewed TrainMeet server itself',()=>{
  const data=JSON.parse(fs.readFileSync(new URL('./fixtures/trainmeet-timetable-v3.json',import.meta.url)));
  const result=readTimetable(data,{stationId:'station-a',publicationId:'publication-2026-08-11-a',day:'Lör',loadedAt:123});
  assert.deepEqual(result.trains.map(t=>t.train_number),['101']);
  assert.equal(result.trains[0].departure_time,'09:20');
  assert.deepEqual(result.tracks.map(t=>t.label),['1','2']);
  assert.equal(result.timetable.schemaVersion,3);
  assert.equal(result.timetable.loadedAt,123);
});
function rig(){let saved,now=100000;const calls=[],storage={load:(n,d)=>structuredClone(saved??d),save:(n,d)=>{saved=structuredClone(d);}};
  const context={protocol_version:1,publication_id:'meet-v1',active_day:'Dagl',station:{id:'cda',name:'Charlottendal'},shift:{shift_id:'rig',operator_name:'Rig'},movements:{m1:{revision:1,arrival:'WAITING',departure:'READY',actualTrack:'track1'}},connection_states:[{id:'line1',state:'free'}]};
  const display={protocol_version:1,publication_id:'meet-v1',active_day:'Dagl',revision:10,meet:{name:'Höstträffen'},clock:{time:'12:15:00',speed:4,running:true,configured:true},trains:[{id:'m1',station_id:'cda',train_number:'P123',track:'1',arrival_time:'12:20',departure_time:'12:22'},{id:'m2',station_id:'other',train_number:'P124'}],connection:{pairing_code:'NEVER EXPOSE'}};
  const timetable={schema_version:3,publication_id:'meet-v1',active_day:'Dagl',stations:[{id:'cda',name:'Charlottendal'}],tracks:[{id:'track1',station_id:'cda',display_label:'1',operating_point_id:null}],trains:[{...display.trains[0],track_id:'track1',note:'Kontrollera tågmöte',no_stop:false}],connection:{pairing_code:'NEVER EXPOSE'}};
  let error=false;const fetcher=async(url,options)=>{calls.push({url,options});if(error)throw Error('Network failure with secret metadata');const data=url.endsWith('/v1/pair')?{protocol_version:1,client_id:JSON.parse(options.body).client_id,access_token:'PRIVATE-TOKEN'}:url.includes('/v1/tkl/context?')?context:url.includes('/v1/timetable?')?timetable:display;return new Response(JSON.stringify(data),{status:200});};
  const service=new TrainMeet({origin:'https://trainmeet.example',storage,fetcher,now:()=>now});
  return {service,storage,calls,context,display,timetable,now:n=>{now=n;},fail:()=>{error=true;},saved:()=>saved,fetcher};
}
const pair=r=>r.service.pair({...r.service.view(),stationId:'cda',code:'PAIRING'});
test('station timetable is authoritative, cached between polls and reloaded on explicit refresh',async()=>{
  const r=rig();await pair(r);
  const reads=()=>r.calls.filter(c=>c.url.includes('/v1/timetable?')).length;
  assert.equal(reads(),1);assert.equal(r.service.view().context.trains[0].note,'Kontrollera tågmöte');
  r.timetable.trains[0].departure_time='25:10';
  await r.service.refresh();assert.equal(reads(),1);assert.equal(r.service.view().context.trains[0].departure_time,'12:22');
  await r.service.refresh(r.service.view());assert.equal(reads(),2);assert.equal(r.service.view().context.trains[0].departure_time,'25:10');
  assert.deepEqual(r.service.view().context.tracks,[{id:'track1',label:'1',operatingPointId:''}]);
  assert.equal(r.service.view().context.trains[0].train_number,'P123');
});
test('day/publication changes fetch a complete new timetable without mixing old rows and new live state',async()=>{
  const r=rig();await pair(r);const before=structuredClone(r.service.view().context);
  r.context.active_day=r.display.active_day='Sön';
  await r.service.refresh();assert.equal(r.service.view().stale,true);assert.deepEqual(r.service.view().context,before);
  r.timetable.active_day='Sön';r.timetable.trains=[];
  await r.service.refresh();assert.equal(r.service.view().stale,false);assert.equal(r.service.view().context.day,'Sön');assert.deepEqual(r.service.view().context.trains,[]);
  r.context.publication_id=r.display.publication_id=r.timetable.publication_id='meet-v2';
  r.display.revision=0;r.timetable.trains=[{id:'new',station_id:'cda',train_number:'P123',track_id:'track1'}];r.context.movements={};
  await r.service.refresh();assert.equal(r.service.view().stale,false);assert.equal(r.service.view().context.trains[0].id,'new');assert.deepEqual(r.service.view().context.movements,[]);
});
test('bad timetable never replaces last good context or accepts credentials on initial pairing',async()=>{
  for(const corrupt of [
    t=>{t.schema_version=2;},t=>{t.publication_id='other';},t=>{t.active_day='other';},t=>{t.stations=[];},
    t=>{t.trains[0].station_id='other';},t=>{t.trains.push({...t.trains[0]});},t=>{t.trains[0].arrival_time={invalid:true};},
    t=>{t.trains[0].track_id='missing';},t=>{t.tracks[0].station_id='other';},t=>{t.trains[0].no_stop='true';},
    t=>{t.trains[0].note={unsafe:true};},t=>{t.trains.push(null);},t=>{t.trains[0].operating_point_id='missing';},
    t=>{t.tracks.push({...t.tracks[0]});},t=>{t.trains=Array(5001).fill(t.trains[0]);}
  ]){
    const r=rig();await pair(r);const before=structuredClone(r.service.view().context);
    corrupt(r.timetable);await r.service.refresh(r.service.view());assert.equal(r.service.view().stale,true);assert.deepEqual(r.service.view().context,before);
    const initial=rig();corrupt(initial.timetable);await assert.rejects(()=>pair(initial),/tidtabell/);assert.equal(initial.saved(),undefined);
  }
});
test('multiple operating points keep track identities and repeated train numbers distinct',async()=>{
  const r=rig();r.timetable.stations[0].operating_points=[{id:'c',name:'Charlottendal',code:'C'},{id:'rbg',name:'Rangeringen',code:'RBG'}];
  r.timetable.tracks[0].operating_point_id='c';r.timetable.trains[0].operating_point_id='c';
  r.timetable.tracks.push({id:'yard1',station_id:'cda',display_label:'1',operating_point_id:'rbg'});
  r.timetable.trains.push({...r.timetable.trains[0],id:'yard-m1',track_id:'yard1',operating_point_id:'rbg',no_stop:true,note:'Rad ett\nRad två'});
  await pair(r);assert.equal(r.service.view().context.trains.length,2);assert.equal(r.service.view().context.trains[1].track,'1');assert.equal(r.service.view().context.operatingPoints[1].code,'RBG');
  r.timetable.trains[0].track_id='yard1';await r.service.refresh(r.service.view());assert.equal(r.service.view().stale,true);
});
test('normal v1 pairing keeps credentials server-side and reads exact station contract without writing movements',async()=>{const r=rig();await pair(r);assert.equal(r.service.view().status,'connected');assert.equal(r.service.view().context.trains.length,1);assert.equal(r.service.view().context.movements[0].track,'track1');assert.equal(r.saved().token,'PRIVATE-TOKEN');assert.ok(!JSON.stringify(r.service.view()).includes('PRIVATE'));assert.ok(!JSON.stringify(r.service.view()).includes('NEVER'));assert.ok(!JSON.stringify(r.saved()).includes('PAIRING'));assert.equal(r.calls[0].options.method,'POST');assert.ok(r.calls.slice(1).every(c=>c.options.method==='GET'));assert.ok(r.calls.every(c=>c.options.redirect==='error'));assert.equal(r.calls[1].options.headers.Authorization,'Bearer PRIVATE-TOKEN');});
test('duplicate snapshots replace by identity; reconnect never accumulates movements or fabricates field reports',async()=>{const r=rig();await pair(r);await r.service.refresh();await r.service.refresh();assert.equal(r.service.view().context.trains.length,1);assert.equal(r.service.view().context.movements.length,1);assert.ok(r.calls.filter(c=>c.options.method==='POST').every(c=>c.url.endsWith('/v1/pair')));assert.ok(!Object.hasOwn(r.service.view(),'blocks'));assert.ok(!Object.hasOwn(r.service.view(),'signals'));});
test('old revisions, wrong station/publication/day and invalid clocks preserve last good context as stale',async()=>{for(const corrupt of [r=>{r.display.revision=9;},r=>{r.context.station.id='other';},r=>{r.display.active_day='Dag2';},r=>{r.display.publication_id='other';},r=>{r.display.clock.time='99:00:00';},r=>{r.context.movements.m1.revision=0;},r=>{r.display.trains.push({...r.display.trains[0]});}]){const r=rig();await pair(r);const previous=structuredClone(r.service.view().context);corrupt(r);await r.service.refresh();assert.equal(r.service.view().stale,true);assert.deepEqual(r.service.view().context,previous);}});
test('timeout/network failure marks old data and restart requires a fresh snapshot',async()=>{const r=rig();await pair(r);r.now(116000);assert.equal(r.service.view().stale,true);r.fail();await r.service.refresh();assert.equal(r.service.view().status,'disconnected');assert.ok(!r.service.view().error.includes('secret'));const next=new TrainMeet({origin:'https://trainmeet.example',storage:r.storage,fetcher:r.fetcher});assert.equal(next.view().context,null);assert.equal(next.view().stale,true);});
test('stale sessions and busy pairing are refused; failed durable save never replaces existing credentials',async()=>{const r=rig(),old=r.service.view();await pair(r);await assert.rejects(()=>r.service.pair({...old,stationId:'cda',code:'A'}),/ändrats/);r.storage.save=()=>{throw Error('disk full with secret');};await assert.rejects(()=>pair(r),/kunde inte anslutas/);assert.equal(r.service.data.token,'PRIVATE-TOKEN');assert.equal(r.service.view().context.station.id,'cda');assert.equal(r.service.view().stale,true);});
test('credentials never move to another origin, insecure remote URL is refused and disconnect persists locally',async()=>{const r=rig();await pair(r);assert.throws(()=>new TrainMeet({origin:'https://different.example',storage:r.storage}),/adressen har ändrats/);assert.throws(()=>new TrainMeet({origin:'http://203.0.113.5',storage:r.storage}),/HTTPS/);await r.service.disconnect(r.service.view());assert.equal(r.saved().token,'');assert.equal(r.service.view().context,null);assert.equal(r.service.view().status,'unpaired');});
test('response size is bounded before parsing',async()=>{const r=rig();r.service.fetcher=async()=>new Response('{}',{headers:{'content-length':'2000001'}});await assert.rejects(()=>pair(r),/för stort/);assert.equal(r.saved(),undefined);});
test('operator-selected origin persists without sending a request or copying credentials',()=>{
  const r=rig(),service=new TrainMeet({storage:r.storage,fetcher:r.fetcher});
  assert.equal(service.view().origin,'');assert.equal(service.view().originLocked,false);
  service.configure({...service.view(),origin:'http://localhost:8787/'});
  assert.equal(service.view().origin,'http://localhost:8787');assert.equal(service.view().status,'unpaired');assert.equal(r.calls.length,0);
  const restarted=new TrainMeet({storage:r.storage,fetcher:r.fetcher});
  assert.equal(restarted.view().origin,'http://localhost:8787');assert.equal(restarted.view().paired,false);
  assert.equal(restarted.data.clientId,service.data.clientId);
});
test('changing origin keeps the old pairing saved for its own server and never redirects the token',async()=>{
  const r=rig(),service=new TrainMeet({storage:r.storage,fetcher:r.fetcher});
  service.configure({...service.view(),origin:'https://trainmeet.example'});
  await service.pair({...service.view(),stationId:'cda',code:'PAIRING'});
  service.configure({...service.view(),origin:'https://different.example'});
  assert.equal(service.view().origin,'https://different.example');assert.equal(service.view().paired,false);assert.equal(service.view().status,'unpaired');
  assert.equal(service.data.token,'');assert.equal(service.view().context,null);assert.equal(service.view().stationId,'');
  assert.deepEqual(service.view().savedServers,[{origin:'https://trainmeet.example',stationId:'cda'}]);
  assert.equal(r.saved().pairings['https://trainmeet.example'].token,'PRIVATE-TOKEN');assert.ok(!JSON.stringify(service.view()).includes('PRIVATE'));
  await service.refresh();assert.ok(r.calls.every(c=>c.url.startsWith('https://trainmeet.example/')),'nothing is sent to the new server without its own pairing');
  service.configure({...service.view(),origin:'https://trainmeet.example'});
  assert.equal(service.view().paired,true);assert.equal(service.view().status,'disconnected');assert.equal(service.view().stationId,'cda');
  await service.refresh();assert.equal(service.view().status,'connected');assert.ok(r.calls.filter(c=>c.options.method==='POST').length===1,'no new pairing needed');
  await service.disconnect(service.view());assert.deepEqual(service.view().savedServers,[]);assert.equal(r.saved().token,'');
});
test('stale, busy and installation-locked origin changes are refused',()=>{
  const r=rig();assert.throws(()=>r.service.configure({...r.service.view(),origin:'https://different.example'}),/fast TrainMeet/);
  const service=new TrainMeet({storage:r.storage}),old=service.view();
  service.configure({...old,origin:'https://trainmeet.example'});
  assert.throws(()=>service.configure({...old,origin:'https://different.example'}),/ändrats/);
  service.busy=true;assert.throws(()=>service.configure({...service.view(),origin:''}),/pågår/);
});
test('origin validation rejects unsafe or ambiguous destinations without saving them',()=>{
  for(const origin of ['http://203.0.113.5:8787','http://trainmeet.example:8787','http://172.32.0.1:8787','http://[2001:db8::1]:8787','https://name:password@trainmeet.example','https://trainmeet.example/path','https://trainmeet.example?token=x','https://trainmeet.example/#secret','file:///tmp/trainmeet',null,'not an address']){
    const r=rig(),service=new TrainMeet({storage:r.storage});
    assert.throws(()=>service.configure({...service.view(),origin}));assert.equal(r.saved(),undefined);assert.equal(service.view().origin,'');
  }
});
test('failed origin save preserves the old connection settings and revision',()=>{
  const r=rig(),service=new TrainMeet({storage:r.storage});service.configure({...service.view(),origin:'http://127.0.0.1:8787'});
  const old=service.view();r.storage.save=()=>{throw Error('disk path should not leak');};
  assert.throws(()=>service.configure({...service.view(),origin:'https://different.example'}),/tidigare inställningen/);
  assert.deepEqual(service.view(),old);assert.equal(r.saved().origin,old.origin);
});

test('readable client id is presented on pairing and persists through disconnect and restart',async()=>{
  const r=rig(),service=new TrainMeet({storage:r.storage,fetcher:r.fetcher});
  assert.equal(service.view().clientId,'cda-tkl');
  service.configure({...service.view(),origin:'https://trainmeet.example',clientId:'  cda-tkl-demo  '});
  assert.equal(service.view().clientId,'cda-tkl-demo');assert.equal(r.calls.length,0);
  await service.pair({...service.view(),stationId:'cda',code:'PAIRING'});
  const sent=JSON.parse(r.calls[0].options.body);
  assert.equal(sent.client_id,'cda-tkl-demo');assert.equal(sent.display_name,'cda-tkl-demo');assert.equal(sent.device_kind,'tkl_terminal');
  assert.throws(()=>service.configure({...service.view(),clientId:'other-tkl'}),/Koppla från/);
  assert.equal(new TrainMeet({storage:r.storage}).view().clientId,'cda-tkl-demo');
  await service.disconnect(service.view());assert.equal(service.view().clientId,'cda-tkl-demo');
  const next=new TrainMeet({storage:r.storage});assert.equal(next.view().clientId,'cda-tkl-demo');assert.equal(next.view().paired,false);
});
test('invalid or unsaved client ids never alter the previous identity or revision',()=>{
  const r=rig(),service=new TrainMeet({storage:r.storage});
  service.configure({...service.view(),origin:'https://trainmeet.example',clientId:'cda-tkl'});
  const previous=service.view();
  for(const clientId of ['',null,{},'ab','a'.repeat(65),'cda tkl','cda/tkl','cda@tkl','cda<tkl>','åäö']) {
    assert.throws(()=>service.configure({...service.view(),clientId}),/TKL-id/);
    assert.deepEqual(service.view(),previous);
  }
  service.configure({...service.view(),clientId:'Cda_tkl.demo:1-2'});
  const beforeFailure=service.view();r.storage.save=()=>{throw Error('disk');};
  assert.throws(()=>service.configure({...service.view(),clientId:'new-id'}),/tidigare inställningen/);
  assert.deepEqual(service.view(),beforeFailure);
});
test('installation-locked origin allows an unpaired id change; existing legacy identity is not silently renamed',()=>{
  const r=rig();r.service.configure({...r.service.view(),clientId:'cda-tkl-lab'});
  assert.equal(r.service.view().clientId,'cda-tkl-lab');
  const legacy={version:1,origin:'https://trainmeet.example',stationId:'cda',clientId:'cda-tkl-01234567-89ab-cdef-0123-456789abcdef',token:'saved-token'};
  const service=new TrainMeet({storage:{load:()=>structuredClone(legacy)}});
  assert.equal(service.view().clientId,legacy.clientId);assert.equal(service.view().paired,true);
  assert.equal(JSON.stringify(service.view()).includes('saved-token'),false);
});
test('station names refresh each poll; only public identity fields reach the panel',async()=>{
 const r=rig();r.display.stations=[{id:'other',name:'Lekby',code:'LEK',private_info:'NEVER EXPOSE'}];await pair(r);
 assert.deepEqual(r.service.view().context.stations,[{id:'other',name:'Lekby',code:'LEK'}]);
 r.display.stations[0].name='Ny ort';await r.service.refresh();assert.equal(r.service.view().context.stations[0].name,'Ny ort');
 r.display.stations.push({...r.display.stations[0]});await r.service.refresh();assert.equal(r.service.view().stale,true);assert.equal(r.service.view().context.stations.length,1);
});
test('plain HTTP is accepted on the meet network only: private, link-local and .local addresses',()=>{
  for(const origin of ['http://192.168.1.2:8787','http://10.0.0.5:8787','http://172.20.1.1:8787','http://169.254.10.10:8787','http://trainmeet.local:8787','http://[fe80::1]:8787','http://[fd12::1]:8787','http://localhost:8787']){
    const r=rig(),service=new TrainMeet({storage:r.storage});
    service.configure({...service.view(),origin});assert.equal(service.view().origin,origin.replace(/\/$/,''));assert.equal(service.view().status,'unpaired');
  }
});
test('a refused pairing code reports the server reason with a hint, as a refusal rather than a gateway error',async()=>{
  const r=rig();const inner=r.fetcher;
  r.service.fetcher=async(url,options)=>url.endsWith('/v1/pair')?new Response(JSON.stringify({message:'Parkopplingskoden är ogiltig eller har gått ut'}),{status:401}):inner(url,options);
  await assert.rejects(()=>pair(r),e=>e.status===409&&e.message==='Parkopplingskoden är ogiltig eller har gått ut. Koden finns i TrainMeet Server för den som är inloggad som administratör: Drift → Anslut en box, eller Inställningar → Anslutningskod. En ny träff ger en ny kod.');
  assert.equal(r.saved(),undefined);assert.equal(r.service.view().status,'unpaired');assert.match(r.service.view().error,/ogiltig eller har gått ut/);
  r.service.fetcher=async(url,options)=>url.endsWith('/v1/pair')?new Response('',{status:403}):inner(url,options);
  await assert.rejects(()=>pair(r),e=>e.status===409&&e.message==='TrainMeet godkände inte anslutningskoden. Koden finns i TrainMeet Server för den som är inloggad som administratör: Drift → Anslut en box, eller Inställningar → Anslutningskod. En ny träff ger en ny kod.');
});
test('upstream failures answer 503, never 502 or 504 which the public proxy replaces with its own page',async()=>{
  const r=rig();const inner=r.fetcher;
  r.service.fetcher=async(url,options)=>url.endsWith('/v1/pair')?new Response('<!DOCTYPE html>',{status:502}):inner(url,options);
  await assert.rejects(()=>pair(r),e=>e.status===503&&e.message==='TrainMeet svarade med fel 502.');
  r.service.fetcher=async(url,options)=>url.endsWith('/v1/pair')?new Response('{"protocol_version":1}',{status:200}):inner(url,options);
  await assert.rejects(()=>pair(r),e=>e.status===503&&/parkopplingsnyckel/.test(e.message));
  r.service.fetcher=inner;r.fail();
  await assert.rejects(()=>pair(r),e=>e.status===503&&e.message==='TrainMeet kunde inte anslutas. Kontrollera adress, kod och server.');
});
test('the pairing code is sent the way TrainMeet compares it: letters and digits only, upper case',async()=>{
  const r=rig();await r.service.pair({...r.service.view(),stationId:'cda',code:' 458-982 '});
  assert.equal(JSON.parse(r.calls.find(c=>c.url.endsWith('/v1/pair')).options.body).pairing_code,'458982');
  await r.service.disconnect(r.service.view());
  await assert.rejects(()=>r.service.pair({...r.service.view(),stationId:'cda',code:'-- --'}),/giltig anslutningskod/);
});
test('a station list that cannot be fetched is a readable upstream failure, never the raw network error',async()=>{const r=rig();r.fail();await assert.rejects(()=>r.service.stations(),e=>e.status===503&&e.message==='TrainMeet svarar inte. Stationslistan kunde inte hämtas.');});

test('the clock reading is dated to the middle of its request and the view says how old it is',async()=>{
  const r=rig();await pair(r);
  let t=200000;r.now(t);
  // Each call to now() inside the request advances the fake clock: asked at 200000, answered at 200400.
  r.service.now=()=>t;const fetcher=r.service.fetcher;r.service.fetcher=async(url,o)=>{if(url.includes('/v1/display'))t+=400;return fetcher(url,o);};
  await r.service.refresh();
  assert.equal(r.service.view().context.clock.readAt,200200);
  t=201200;assert.equal(r.service.view().clockAgeMs,1000);
  assert.equal(r.service.view().context.clock.time,'12:15:00');
});

test('the change feed asks for a read at once on a clock change or a new stream, not on traffic',()=>{
  const r=rig();
  r.service.feedEvent('event: change\ndata: {"seq":3,"topics":["traffic"]}');assert.equal(r.service.urgent,false);
  r.service.feedEvent('event: change\ndata: {"seq":4,"topics":["clock","traffic"]}');assert.equal(r.service.urgent,true);
  r.service.urgent=false;r.service.feedEvent('retry: 2000\nevent: hello\ndata: {"boot":"ab12","seq":4}');assert.equal(r.service.urgent,true);
  r.service.urgent=false;r.service.feedEvent(': ping');r.service.feedEvent('event: change\ndata: not json');assert.equal(r.service.urgent,false);
});

test('the feed is read as a stream, retried after it ends and backed off when the server has none',async()=>{
  let now=1000;const storage={load:(n,d)=>({...d,token:'KEY',stationId:'cda',origin:'https://trainmeet.example',pairings:{'https://trainmeet.example':{stationId:'cda',token:'KEY'}}}),save(){}};
  const encoder=new TextEncoder(),calls=[];
  const stream=chunks=>new ReadableStream({start(c){for(const s of chunks)c.enqueue(encoder.encode(s));c.close();}});
  let answer=()=>new Response(stream(['retry: 2000\nevent: hel','lo\ndata: {"boot":"x","seq":1}\n\n','event: change\ndata: {"seq":2,"topics":["clock"]}\n\n']),{headers:{'Content-Type':'text/event-stream'}});
  const service=new TrainMeet({origin:'https://trainmeet.example',storage,now:()=>now,fetcher:async(url,o)=>{calls.push({url,accept:o.headers.Accept,auth:o.headers.Authorization});return answer();}});
  await service.follow();
  assert.equal(calls[0].url,'https://trainmeet.example/v1/events');assert.equal(calls[0].accept,'text/event-stream');assert.equal(calls[0].auth,undefined,'the feed never carries the key');
  assert.equal(service.urgent,true);assert.equal(service.feed,null);assert.equal(service.feedRetryAt,3000);
  answer=()=>new Response('{}',{status:404});await service.follow();assert.equal(service.feedRetryAt,1000+300000);
});

// Casper 17 oktober: "Det ska bara behövas mata in adress + kod i tkl - inget mer." TrainMeet har en kod för hela
// träffen; TKL väljer sin station själv ur träffens stationer.
test('Anslut tar adress och kod och väljer ställverkets station själv',async()=>{
  const r=rig(),service=new TrainMeet({storage:r.storage,fetcher:r.fetcher,now:()=>100000});
  r.display.stations=[{id:'kfs',name:'Kungsfors',code:'KF'},{id:'cda',name:'Charlottendal',code:'CDA'}];
  await assert.rejects(()=>service.connect({origin:'',code:'123-456'}),/adress/);
  await assert.rejects(()=>service.connect({origin:'https://trainmeet.example',code:'12'}),/sex tecken/);
  const view=await service.connect({origin:' https://trainmeet.example ',code:'123-456'});
  assert.equal(view.status,'connected');assert.equal(view.stationId,'cda');assert.equal(view.origin,'https://trainmeet.example');
  const pair=r.calls.find(c=>c.url.endsWith('/v1/pair'));assert.equal(JSON.parse(pair.options.body).pairing_code,'123456');
  assert.equal(r.saved().pairings['https://trainmeet.example'].stationId,'cda');
});

test('saknar träffen ställverkets station väljer operatören, och en fast adress går inte att byta',async()=>{
  const r=rig(),service=new TrainMeet({storage:r.storage,fetcher:r.fetcher,now:()=>100000,station:'Charlottendal'});
  r.display.stations=[{id:'kfs',name:'Kungsfors',code:'KF'},{id:'cda',name:'Charlottendal C',code:'CDA'},{id:'cdb',name:'Charlottendal Norra',code:'CDN'}];
  const asked=await service.connect({origin:'https://trainmeet.example',code:'123456'});
  assert.equal(asked.status,'unpaired');assert.deepEqual(asked.choose.stations.map(s=>s.id),['kfs','cda','cdb']);assert.match(asked.choose.reason,/ingen station som heter Charlottendal/);
  assert.equal(r.calls.some(c=>c.url.endsWith('/v1/pair')),false,'koden används inte förrän stationen är vald');
  assert.equal((await service.connect({origin:'https://trainmeet.example',code:'123456',stationId:'cda'})).status,'connected');
  await assert.rejects(()=>r.service.connect({origin:'https://different.example',code:'123456'}),/fast TrainMeet-adress/);
});

test('ställverkets station: samma namn, annars den enda som innehåller namnet',()=>{
  const list=[{id:'a',name:'Charlottendal Norra'},{id:'b',name:'charlottendal'},{id:'c',name:'Kungsfors'}];
  assert.equal(matchStation(list,'Charlottendal').id,'b');assert.equal(matchStation(list.slice(0,1),'Charlottendal').id,'a');
  assert.equal(matchStation([list[0],{id:'d',name:'Charlottendal Södra'}],'Charlottendal'),null);assert.equal(matchStation(list,''),null);
});

test('en ny installation får installationens TKL-id; ett sparat id står kvar',async()=>{
  const r=rig(),fresh=new TrainMeet({storage:r.storage,fetcher:r.fetcher,clientId:'cda-tkl-pi'});
  assert.equal(fresh.view().clientId,'cda-tkl-pi');
  r.display.stations=[{id:'cda',name:'Charlottendal'}];await fresh.connect({origin:'https://trainmeet.example',code:'123-456'});
  assert.equal(JSON.parse(r.calls.find(c=>c.url.endsWith('/v1/pair')).options.body).client_id,'cda-tkl-pi');
  assert.equal(new TrainMeet({storage:r.storage,fetcher:r.fetcher,clientId:'cda-tkl-mac'}).view().clientId,'cda-tkl-pi','sparat id ändras inte');
});

test('Anslut väntar ut en pågående läsning i stället för att neka',async()=>{
  const r=rig();r.display.stations=[{id:'cda',name:'Charlottendal'}];
  let release;const slow=new Promise(resolve=>{release=resolve;});
  r.service.busy=true;r.service.current=slow;
  const pending=r.service.connect({origin:'https://trainmeet.example',code:'123-456'});
  setTimeout(()=>{r.service.busy=false;r.service.current=null;release();},20);
  assert.equal((await pending).status,'connected');
});
