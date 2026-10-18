// Automatens beslut måste fortfarande gälla när TrainMeet-kön når POST: rätt dag, revision, tåg och åtgärd.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TrainMeet } from '../src/trainmeet.mjs';
const copy=value=>structuredClone(value);
const deferred=()=>{let resolve;const promise=new Promise(ok=>{resolve=ok;});return {promise,resolve};};
function rig({state='requested',direction='in',number='401'}={}){
  let saved,now=100000,gate=null;const calls=[];
  const train={id:'m401',station_id:'tk',train_number:'401',track_id:'i',arrival_time:'05:00',departure_time:'05:05'};
  const display={protocol_version:1,publication_id:'pub',active_day:'day',revision:7,meet:{name:'Prov'},clock:{time:'08:00:00',speed:4,running:true,configured:true},
    stations:[{id:'tk',name:'Träkvista'},{id:'neighbor',name:'Granne'}],connections:[{id:'line',station_a_id:'neighbor',station_b_id:'tk',track_type:'single'}],trains:[train]};
  const context={protocol_version:1,publication_id:'pub',active_day:'day',station:{id:'tk',name:'Träkvista'},movements:{},
    connection_states:[{id:'line',state,from_station_id:direction==='in'?'neighbor':direction==='out'?'tk':null,to_station_id:direction==='in'?'tk':direction==='out'?'neighbor':null,train_number:number||null}]};
  const timetable={schema_version:3,publication_id:'pub',active_day:'day',stations:display.stations,tracks:[{id:'i',station_id:'tk',display_label:'I',operating_point_id:null}],trains:[train]};
  const fetcher=async(url,options={})=>{
    const path=new URL(url).pathname,method=options.method||'GET',body=options.body?JSON.parse(options.body):null;calls.push({path,method,body});
    if(path==='/v1/tkl/context'&&gate){const waiting=gate;gate=null;await waiting.promise;}
    if(method==='POST'&&path==='/v1/tkl/clearance'){
      const line=context.connection_states[0];display.revision++;
      if(body.action==='accept')line.state='reserved';
      if(body.action==='depart')line.state='occupied';
      if(body.action==='arrive')Object.assign(line,{state:'free',from_station_id:null,to_station_id:null,train_number:null});
      if(body.action==='request')Object.assign(line,{state:'requested',from_station_id:'tk',to_station_id:'neighbor',train_number:body.train_number});
    }
    if(method==='POST'&&path==='/v1/tkl/movement'){
      context.movements[body.movement_id]={revision:(context.movements[body.movement_id]?.revision||0)+1,arrival:body.arrival,departure:body.departure,actualTrack:body.actual_track};display.revision++;
    }
    const value=path==='/v1/pair'?{protocol_version:1,client_id:'tk-tkl',access_token:'TEST-TOKEN'}:path==='/v1/tkl/context'?context:path==='/v1/display'?display:path==='/v1/timetable'?timetable:{ok:true};
    return new Response(JSON.stringify(value),{status:200});
  };
  const storage={load:(name,fallback)=>copy(saved??fallback),save:(name,value)=>{saved=copy(value);}};
  const service=new TrainMeet({origin:'https://trainmeet.example',storage,fetcher,now:()=>now,changeFeed:false,station:'Träkvista',clientId:'tk-tkl'});
  const snapshot=()=>{const view=service.view();return {sessionId:view.sessionId,revision:view.revision,contextRevision:view.context.revision,
    contextIdentity:{stationId:view.context.station.id,publicationId:view.context.publicationId,day:view.context.day}};};
  const pair=()=>service.pair({...service.view(),stationId:'tk',code:'458982'});
  const posts=()=>calls.filter(c=>c.method==='POST'&&c.path!=='/v1/pair');
  const pausePoll=(reloadTimetable=false)=>{const waiting=deferred();gate=waiting;const poll=service.refresh(reloadTimetable?service.view():undefined);assert.equal(service.busy,true);return {poll,release:waiting.resolve};};
  return {service,context,display,timetable,calls,posts,snapshot,pair,pausePoll,old:()=>{now+=16001;}};
}
const command=(r,action='accept',extra={})=>({...r.snapshot(),connectionId:'line',action,trainNumber:'401',...extra});
async function queued({change,action='accept',extra={},options={},method='clearance',reloadTimetable=false}){
  const r=rig(options);await r.pair();const data=method==='movement'?{...r.snapshot(),movementId:'m401',trainNumber:'401',arrival:'arrived',actualTrack:'i',...extra}:command(r,action,extra);
  const {poll,release}=r.pausePoll(reloadTimetable),sent=r.service[method](data);const rejected=assert.rejects(sent,e=>e.status===409);
  change(r);release();await poll;await rejected;assert.equal(r.posts().length,0,'inget POST får lämna TKL med det äldre beslutet');
  return r;
}
test('automatens köade accept stoppas när poll ändrar trafikrevision',async()=>{
  await queued({change:r=>{r.display.revision++;}});
});
test('samma trafikrevision räcker inte om linjens tåg bytts i väntande poll',async()=>{
  await queued({change:r=>{r.context.connection_states[0].train_number='402';}});
});
test('samma trafikrevision räcker inte om klareringen återtas eller riktningen byts',async()=>{
  for(const change of [
    r=>Object.assign(r.context.connection_states[0],{state:'free',train_number:null,from_station_id:null,to_station_id:null}),
    r=>Object.assign(r.context.connection_states[0],{state:'requested',from_station_id:'tk',to_station_id:'neighbor'})
  ])await queued({change});
});
test('köat beslut till en annan trafikdag eller publikation skickas aldrig',async()=>{
  for(const field of ['active_day','publication_id'])await queued({change:r=>{for(const object of [r.context,r.display,r.timetable])object[field]='ny-'+field;}});
});
test('köat beslut måste fortfarande ha samma anslutningssession och revision',async()=>{
  await queued({change:r=>{r.service.sessionId='new-session';}});
  await queued({change:r=>{r.service.revision++;}});
});
test('en utebliven poll efter ändrad stationsidentitet stoppar automaten',async()=>{
  await queued({change:r=>{r.context.station.id='another-station';}});
});
test('för gammalt trafikläge, fel context-identitet eller saknad context-identitet skickas aldrig',async()=>{
  for(const change of [r=>r.old(),(r,data)=>{data.contextIdentity.stationId='other';},(r,data)=>{delete data.contextIdentity;}]){
    const r=rig();await r.pair();const data=command(r);change(r,data);
    await assert.rejects(()=>r.service.clearance(data),e=>e.status===409);assert.equal(r.posts().length,0);
  }
});
test('ett köat beslut med oförändrad färsk poll får skickas en gång',async()=>{
  const r=rig();await r.pair();const data=command(r),{poll,release}=r.pausePoll();const sent=r.service.clearance(data);
  release();await poll;await sent;assert.equal(r.posts().length,1);assert.equal(r.posts()[0].body.action,'accept');
});
for(const [action,state,direction] of [['request','free',''],['accept','requested','in'],['depart','reserved','out'],['arrive','occupied','in']]){
  test(`färsk ${action} behåller det etablerade TrainMeet-protokollets payload`,async()=>{
    const r=rig({state,direction,number:state==='free'?'':'401'});await r.pair();await r.service.clearance(command(r,action));
    assert.deepEqual(r.posts(),[{path:'/v1/tkl/clearance',method:'POST',body:{station_id:'tk',connection_id:'line',action,train_number:action==='request'?'401':''}}]);
  });
}
test('movement i kön avvisar ändrat tåg även om trafikrevision och movement-id behållits',async()=>{
  await queued({method:'movement',reloadTimetable:true,change:r=>{r.timetable.trains[0].train_number='402';r.display.trains[0].train_number='402';}});
});
test('movement i kön avvisar ny trafikrevision eller dag innan något POST skickas',async()=>{
  await queued({method:'movement',change:r=>{r.display.revision++;}});
  await queued({method:'movement',change:r=>{for(const object of [r.context,r.display,r.timetable])object.active_day='next-day';}});
});
test('färsk ankomst och avgång deklarerar exakt tåg, spår-id och behåller tidigare fält',async()=>{
  const r=rig();await r.pair();await r.service.movement({...r.snapshot(),movementId:'m401',trainNumber:'401',arrival:'arrived',actualTrack:'i'});
  assert.deepEqual(r.posts()[0],{path:'/v1/tkl/movement',method:'POST',body:{station_id:'tk',movement_id:'m401',departure:'none',arrival:'arrived',event_type:'tkl_arrived',actual_track:'i'}});
  await r.service.movement({...r.snapshot(),movementId:'m401',trainNumber:'401',departure:'departed'});
  assert.deepEqual(r.posts()[1],{path:'/v1/tkl/movement',method:'POST',body:{station_id:'tk',movement_id:'m401',departure:'departed',arrival:'arrived',event_type:'tkl_departed',actual_track:'i'}});
});
