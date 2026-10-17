import test from 'node:test';
import assert from 'node:assert/strict';
import {Destinations} from '../src/destinations.mjs';
import {destinationDisplay} from '../public/destination-data.js';
function store(){let saved;return {load:(_key,defaults)=>structuredClone(saved??defaults),save:(_key,data)=>{saved=structuredClone(data);}};}
test('local names and phone formatting survive restart, without touching other destinations',()=>{
 const storage=store(),book=new Destinations(storage);const old=book.view();
 const entry={...old.entries[0],name:'Ny ort',phone:'+46 (0) 70-123'};
 const result=book.save({revision:0,entry});assert.equal(result.entries[0].phone,entry.phone);assert.deepEqual(result.entries.slice(1),old.entries.slice(1));assert.deepEqual(new Destinations(storage).view(),result);
 assert.throws(()=>book.save({revision:0,entry}),/ändrats/);
 assert.throws(()=>book.save({revision:1,entry:{...entry,phone:'<script>'}}),/giltigt/);
});
test('explicit station binding updates names, keeps local phone, and makes stale or missing data explicit',()=>{
 const book=new Destinations(store());const entry={...book.view().entries[0],source:'trainmeet',stationId:'s1'};
 assert.throws(()=>book.save({revision:0,entry},[]),/finns inte/);
 book.save({revision:0,entry},[{id:'s1',name:'Nytt namn'}]);
 const trainMeet={stale:false,context:{stations:[{id:'s1',name:'Nytt namn'}]}};
 assert.equal(destinationDisplay(entry,trainMeet).name,'Nytt namn');assert.equal(destinationDisplay(entry,trainMeet).phone,'72');
 trainMeet.context.stations[0].name='Uppdaterat';assert.equal(destinationDisplay(entry,trainMeet).name,'Uppdaterat');
 assert.match(destinationDisplay(entry,{...trainMeet,stale:true}).sourceLabel,/senaste/);
 assert.equal(destinationDisplay(entry,null).name,'Lekby');assert.match(destinationDisplay(entry,null).sourceLabel,/reservnamn/);
 assert.equal(destinationDisplay({...entry,source:'local'},trainMeet).name,'Lekby');
});
test('failed storage cannot change displayed destination settings',()=>{
 const storage=store(),book=new Destinations(storage),old=book.view();storage.save=()=>{throw Error('disk');};
 assert.throws(()=>book.save({revision:0,entry:{...old.entries[0],phone:''}}),/disk/);assert.deepEqual(book.view(),old);
});
test('legacy destination files default to left-hand exits without changing names or writing on load',()=>{
 const original=new Destinations(store()).view();delete original.outgoing;
 original.entries[1].name='Eget namn';original.entries[1].phone='123';
 let writes=0;const storage={load:()=>structuredClone(original),save:()=>writes++};
 const migrated=new Destinations(storage).view();
 assert.deepEqual(migrated.outgoing,{C:'Cn',A:'An',B:'Bu',D:'D'});
 assert.deepEqual(migrated.entries,original.entries);assert.equal(migrated.revision,original.revision);assert.equal(writes,0);
});
test('one normal exit per line is persisted, validated and shared independently of TrainMeet',()=>{
 const storage=store(),book=new Destinations(storage),initial=book.view();
 const entry=initial.entries.find(d=>d.id==='Cn');
 const updated=book.save({revision:0,entry,outgoing:'Cu'});
 assert.deepEqual(updated.outgoing,{C:'Cu',A:'An',B:'Bu',D:'D'});
 assert.deepEqual(updated.entries,initial.entries);
 assert.deepEqual(new Destinations(storage).view(),updated);
 for(const outgoing of ['Bu','unknown','',null,true,['Cn']])assert.throws(()=>book.save({revision:1,entry,outgoing}),/utgående spår/);
 assert.deepEqual(book.view(),updated);
 assert.throws(()=>book.save({revision:0,entry,outgoing:'Cn'}),/ändrats/);
 // An older client can still edit a name without resetting the chosen track.
 assert.deepEqual(book.save({revision:1,entry:{...entry,name:'Nytt namn'}}).outgoing,updated.outgoing);
 storage.save=()=>{throw Error('disk');};const before=book.view();
 assert.throws(()=>book.save({revision:2,entry,outgoing:'Cn'}),/disk/);assert.deepEqual(book.view(),before);
});
test('all label elements share the configured exit visibility, with no train state dependency',async()=>{
 const {isOutgoingDestination,destinationDefaults}=await import('../public/destination-data.js');
 const visible=outgoing=>destinationDefaults.filter(d=>isOutgoingDestination(d.id,outgoing)).map(d=>d.id);
 assert.deepEqual(visible(),['Cn','An','Bu','D']);
 assert.deepEqual(visible({C:'Cu',A:'Au',B:'Bn',D:'D'}),['Cu','Au','Bn','D']);
 assert.equal(isOutgoingDestination('unknown'),false);
 const bad=new Destinations(store()).view();bad.outgoing.C='Bu';
 assert.throws(()=>new Destinations({load:()=>bad}),/utgående spår/);
});
