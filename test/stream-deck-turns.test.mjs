import test from 'node:test';
import assert from 'node:assert/strict';
import {turnList,turnAt,turnSpec,trackNumber} from '../public/stream-deck-turns.js';
import {keySpec,holdOf} from '../public/stream-deck-render.js';

const lek={id:'cda-lek',neighborId:'lek',neighborName:'Lekby',neighborCode:'LEK',state:'free',direction:'',trainNumber:''};
const vag={id:'cda-vag',neighborId:'vag',neighborName:'Vagnsta',neighborCode:'VAG',state:'free',direction:'',trainNumber:''};
function context({lines=[lek,vag],movements=[]}={}){
  return {
    trains:[
      {id:'t1',train_number:'4158',arrival_time:'14:53',departure_time:'',track:'12'},
      {id:'t2',train_number:'9920',arrival_time:'',departure_time:'15:20',track:'11'},
      {id:'t3',train_number:'3521',arrival_time:'15:00',departure_time:'15:05',track:'2'},
      {id:'t4',train_number:'4822',arrival_time:'15:42',departure_time:'',track:'13'},
      {id:'t5',train_number:'93',arrival_time:'',departure_time:'16:05',track:'1'}
    ],
    directions:{t1:{from:'lek',to:''},t2:{from:'',to:'vag'},t3:{from:'vag',to:'lek'},t4:{from:'',to:''},t5:{from:'',to:'lek'}},
    movements,lines
  };
}

test('the turn is the timetable order of every train still due, and a train leaves it when done',()=>{
  const list=turnList(context());
  assert.deepEqual(list.map(t=>t.train.train_number+':'+t.role),['4158:arrival','3521:arrival','9920:departure','4822:arrival','93:departure']);
  assert.equal(list[0].line.id,'cda-lek');assert.equal(list[3].line,null);assert.equal(list[0].track,'12');
  const later=turnList(context({movements:[{id:'t1',arrival:'arrived',departure:''},{id:'t3',arrival:'arrived',departure:'',track:'3'}]}));
  assert.deepEqual(later.map(t=>t.train.train_number+':'+t.role),['3521:departure','9920:departure','4822:arrival','93:departure'],'an arrived through train is next on turn for its departure');
  assert.equal(later[0].track,'3','the actual track wins over the planned one');
  assert.equal(turnList(null).length,0);
  assert.equal(trackNumber('RBG 12'),12);assert.ok(Number.isNaN(trackNumber('')));
});

test('filters and places pick the train a key follows',()=>{
  const list=turnList(context());
  assert.equal(turnAt(list,{slot:1,filter:'all'}).train.train_number,'4158');
  assert.equal(turnAt(list,{slot:2,filter:'all'}).train.train_number,'3521');
  assert.equal(turnAt(list,{slot:1,filter:'departures'}).train.train_number,'9920');
  assert.equal(turnAt(list,{slot:2,filter:'arrivals'}).train.train_number,'3521');
  assert.deepEqual([1,2,3].map(slot=>turnAt(list,{slot,filter:'yard'})?.train.train_number),['4158','9920','4822']);
  assert.deepEqual([1,2,3].map(slot=>turnAt(list,{slot,filter:'line',lineId:'cda-lek'})?.train.train_number),['4158','93',undefined]);
  assert.equal(turnAt(list,{slot:9,filter:'all'}),null);
});

test('an arrival walks väntas, anmält · godkänn, närmar sig and ankommit',()=>{
  const key={slot:1,filter:'all'};
  let s=turnSpec(key,context());assert.equal(s.number,'4158');assert.equal(s.role,'arrival');assert.equal(s.text,'väntas');assert.equal(s.short,null);assert.equal(s.track,'12');
  s=turnSpec(key,context({lines:[{...lek,state:'requested',direction:'in',trainNumber:'4158'},vag]}));
  assert.equal(s.step,'incoming-request');assert.equal(s.blink,true);assert.deepEqual(s.short,{type:'clearance',action:'accept'});assert.deepEqual(s.long,{type:'clearance',action:'reject'});assert.equal(s.lineId,'cda-lek');
  s=turnSpec(key,context({lines:[{...lek,state:'requested',direction:'in',trainNumber:'9999'},vag]}));assert.equal(s.step,'planned','a request for another train is not this key\'s');
  s=turnSpec(key,context({lines:[{...lek,state:'reserved',direction:'in',trainNumber:'4158'},vag]}));assert.equal(s.text,'klart · väntas');assert.equal(s.short,null);
  s=turnSpec(key,context({lines:[{...lek,state:'occupied',direction:'in',trainNumber:'4158'},vag]}));assert.deepEqual(s.short,{type:'movement',movementId:'t1',arrival:'approaching'});
  s=turnSpec(key,context({lines:[{...lek,state:'occupied',direction:'in',trainNumber:'4158'},vag],movements:[{id:'t1',arrival:'approaching'}]}));assert.deepEqual(s.short,{type:'clearance',action:'arrive'});assert.equal(s.text,'närmar sig · ankommit?');
  // From a siding: the operator reports the steps directly.
  s=turnSpec({slot:3,filter:'arrivals'},context());assert.equal(s.number,'4822');assert.deepEqual(s.short,{type:'movement',movementId:'t4',arrival:'approaching'});
  s=turnSpec({slot:3,filter:'arrivals'},context({movements:[{id:'t4',arrival:'approaching'}]}));assert.deepEqual(s.short,{type:'movement',movementId:'t4',arrival:'arrived'});
});

test('a departure walks ej uppställt, uppställt, redo · begär, klart · avgå and leaves when it has gone',()=>{
  const key={slot:1,filter:'departures'};
  let s=turnSpec(key,context());assert.equal(s.number,'9920');assert.equal(s.text,'ej uppställt');assert.deepEqual(s.short,{type:'movement',movementId:'t2',departure:'positioned'});
  s=turnSpec(key,context({movements:[{id:'t2',departure:'positioned'}]}));assert.equal(s.text,'uppställt · förare?');assert.deepEqual(s.short,{type:'movement',movementId:'t2',departure:'ready'});
  s=turnSpec(key,context({movements:[{id:'t2',departure:'ready'}]}));assert.equal(s.text,'redo · begär?');assert.deepEqual(s.short,{type:'clearance',action:'request',trainNumber:'9920'});assert.equal(s.lineId,'cda-vag');
  s=turnSpec(key,context({lines:[lek,{...vag,state:'occupied',direction:'in',trainNumber:'1'}],movements:[{id:'t2',departure:'ready'}]}));assert.equal(s.dim,true);assert.equal(s.short,null);
  s=turnSpec(key,context({lines:[lek,{...vag,state:'requested',direction:'out',trainNumber:'9920'}],movements:[{id:'t2',departure:'ready'}]}));assert.equal(s.blink,true);assert.deepEqual(s.long,{type:'clearance',action:'cancel'});assert.equal(s.short,null);
  s=turnSpec(key,context({lines:[lek,{...vag,state:'reserved',direction:'out',trainNumber:'9920'}],movements:[{id:'t2',departure:'ready'}]}));assert.deepEqual(s.short,{type:'clearance',action:'depart'});assert.equal(s.text,'klart · avgå?');
  s=turnSpec(key,context({movements:[{id:'t2',departure:'departed'}]}));assert.equal(s.number,'93','the next departure moves up: 3521 has not arrived yet, so it is on turn for its arrival');
  s=turnSpec({slot:1,filter:'line',lineId:'none'},context());assert.equal(s.text,'inget tåg i tur');assert.equal(s.dim,true);
  assert.equal(turnSpec(key,null).text,'TrainMeet ej ansluten');
});

test('a key spec carries the key\'s own text, icon and hold but keeps the colours of its state',()=>{
  const env={plupp:k=>({kind:'plupp',title:k.label,lines:[k.label],caption:'',fill:'#d8d6cc',ring:'',dim:false,blink:false,blocked:false}),train:()=>({kind:'train',number:'1'}),turn:k=>turnSpec(k,context()),system:{stopAll:true,page:1,pages:3,yard:{open:'Höger 11',laid:''}},online:true};
  assert.deepEqual(keySpec({type:'system',id:'all-stop',text:'Alla stopp',icon:'stop'},env).lines,['Alla','stopp']);
  assert.equal(keySpec({type:'system',id:'all-stop',icon:'stop'},env).fill,'#ff6067','an active stop stays red');
  assert.equal(keySpec({type:'system',id:'all-stop',icon:'stop'},env).icon,'stop');
  assert.equal(keySpec({type:'system',id:'panel-reset',title:'Återställ panel',caption:'håll 1 s',hold:2000},env).caption,'håll 2 s');
  assert.equal(holdOf({type:'system',id:'panel-reset'}),1000);assert.equal(holdOf({type:'system',id:'panel-reset',hold:2000}),2000);assert.equal(holdOf({type:'plupp',id:'x'}),0);
  assert.equal(keySpec({type:'plupp',id:'x',label:'1c',text:'Spår 1c',hold:1000},env).caption,'håll 1 s');
  const yard=keySpec({type:'system',id:'yard-authority',title:'Rangerbegäran'},env);assert.equal(yard.blink,true);assert.equal(yard.caption,'Höger 11');
  assert.equal(keySpec({type:'system',id:'yard-authority',title:'Rangerbegäran'},{...env,system:{...env.system,yard:{open:'',laid:''}}}).dim,true);
  const nav=keySpec({type:'nav',to:'next'},env);assert.equal(nav.icon,'next');assert.equal(nav.caption,'2 / 3');
  const turn=keySpec({type:'turn',slot:1,filter:'all',text:'RBG',details:true},env);assert.equal(turn.number,'4158');assert.equal(turn.label,'RBG');assert.equal(turn.slot,1);
  assert.equal(keySpec({type:'system',id:'cancel',title:'Avbryt val'},{...env,online:false}).dim,true);
  assert.equal(keySpec(null,env).kind,'empty');
});
