import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import net from 'node:net';
import {once} from 'node:events';
import {SerialPortMock} from 'serialport';
import {ConnectionMode} from '../src/connection-mode.mjs';
import {isComPort, listWindowsSerialDevices, loadSerialPort, startWindowsGateway} from '../src/windows-serial.mjs';
import {LineReader, hex, switchOrder, switchReport} from '../src/protocol.mjs';

const until = async predicate => {
  for (let i=0;i<200;i++) { if (predicate()) return; await new Promise(r=>setTimeout(r,10)); }
  throw Error('Provet väntade för länge');
};
function connection(options={}) {
  const files={}, calls=[], timers=[];
  const storage={load:(n,f)=>structuredClone(files[n]??f), save:(n,v)=>{files[n]=structuredClone(v);}};
  const spawn=(...args)=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{child.killed=true;};calls.push({args,child});return child;};
  const c=new ConnectionMode({storage,platform:'win32',env:{},root:'/test',spawn,
    listWindowsDevices:async()=>[{path:'COM7',label:'COM7 · Bluetooth'}],
    setTimer:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimer:()=>{},...options});
  return {c, calls, timers, storage};
}

test('Windows använder en sparad COM-port, aldrig MAC-adress eller Linux-enhet',()=>{
  const {c,calls,storage}=connection();
  c.setAdapter({adapter:'btlocobridge',btlocobridge:{target:'AA:BB:CC:DD:EE:FF',channel:1}});
  assert.match(c.liveReason(),/utgående Bluetooth-COM-port/);
  assert.throws(()=>c.switch('live'),{status:409});assert.equal(calls.length,0);
  for(const bad of ['COM0','COM01','COM7.exe','COM7:','COM7\\file','\\\\.\\COM7','CON','COM7\nxx'])
    assert.throws(()=>c.setAdapter({btlocobridge:{target:bad}}),{status:400},bad);
  c.setAdapter({btlocobridge:{target:' com17 ',channel:1}});
  assert.equal(c.connector,'COM17');assert.equal(c.liveReason(),'');c.switch('live');
  assert.ok(calls[0].args[1].includes('COM17'));assert.equal(storage.load('connection.json').mode,'live');
  const restarted=connection({storage}).c;
  assert.equal(restarted.mode,'live');assert.equal(restarted.connector,'COM17');
  c.switch('offline');assert.equal(calls[0].child.killed,true);
});

test('Windows återansluter efter portfel utan att ändra det sparade valet',()=>{
  const {c,calls,timers}=connection();
  c.setAdapter({adapter:'btlocobridge',btlocobridge:{target:'COM7'}});c.switch('live');
  calls[0].child.stderr.emit('data','COM7 kan inte öppnas. Stäng JMRI.\n');calls[0].child.emit('exit',1);
  assert.equal(c.view().gateway.state,'failed');assert.match(c.view().gateway.error,/Stäng JMRI/);
  assert.equal(c.mode,'live');assert.equal(timers[0].ms,2000);timers[0].fn();assert.equal(calls.length,2);
  calls[1].child.stdout.emit('data','LocoNet-gateway: 127.0.0.1:8913\n');assert.equal(c.view().gateway.state,'running');
  // Ett otillgängligt anslutningssätt får inte ändra det körande läget i smyg.
  assert.throws(()=>c.setAdapter({btlocobridge:{target:'AA:BB:CC:DD:EE:FF'}}),/Koppla från LocoNet/);
  assert.equal(calls[1].child.killed,undefined);assert.equal(c.mode,'live');assert.equal(c.connector,'COM7');
  c.switch('offline');assert.equal(calls[1].child.killed,true);assert.equal(calls.length,2);
});

test('USB på Windows och COM på Mac/Pi förblir spärrade; Render saknar fysisk anslutning',()=>{
  for(const options of [{}, {platform:'linux'}, {platform:'darwin'}, {env:{CHARLOTTENDAL_INSTALL_KIND:'render'}}]) {
    const {c}=connection(options);c.setAdapter({adapter:'btlocobridge',btlocobridge:{target:'COM7'}});
    assert.equal(c.view().live.available,!options.platform&&!options.env);
  }
  assert.match(connection().c.liveReason(),/LocoBuffer på USB stöds inte/);
});

test('COM-sökning sker bara på begäran och ett sökfel hindrar inte manuellt portval',async()=>{
  let scans=0;
  const {c}=connection({listWindowsDevices:async()=>{scans++;throw Error('Sökningen misslyckades');}});
  c.view();c.view({devices:true});assert.equal(scans,0);
  await c.refreshDevices();assert.equal(scans,1);assert.deepEqual(c.view({devices:true}).devices,[]);
  assert.match(c.view({devices:true}).devicesError,/misslyckades/);
  c.setAdapter({adapter:'btlocobridge',btlocobridge:{target:'COM7'}});assert.equal(c.liveReason(),'');
  c.listWindowsDevices=async()=>[{path:'COM7',label:'COM7'}];await c.refreshDevices();
  assert.equal(c.view({devices:true}).devicesError,'');assert.equal(c.view({devices:true}).devices.length,1);
});

test('COM-listan sorteras numeriskt och gör inget försök att öppna en port',async()=>{
  const result=await listWindowsSerialDevices(async()=>({list:async()=>[
    {path:'COM17',manufacturer:'Bluetooth'},{path:'COM2',friendlyName:'Utgående'}, {path:'LPT1'}, {path:'COM0'}]}));
  assert.deepEqual(result,[{path:'COM2',label:'COM2 · Utgående'},{path:'COM17',label:'COM17 · Bluetooth'}]);
  assert.equal(isComPort('COM100'),true);
});

test('det låsta native-biblioteket laddas och enhetslistan kan läsas utan hårdvaruskrivning',async()=>{
  const SerialPort=await loadSerialPort();
  assert.equal(typeof SerialPort,'function');
  if(process.platform==='win32') assert.ok(Array.isArray(await SerialPort.list()));
});

async function mockGateway(t,options={}) {
  SerialPortMock.binding.reset();SerialPortMock.binding.createPort('COM7',{record:true,echo:false,maxReadSize:2});
  const r=startWindowsGateway({device:'COM7',port:0,SerialPort:SerialPortMock,...options});
  t.after(()=>r.gateway.close());
  const port=await r.ready;
  const socket=net.createConnection(port,'127.0.0.1');socket.on('error',()=>{});t.after(()=>socket.destroy());
  const lines=[];socket.on('data',data=>reader.push(data));const reader=new LineReader(line=>lines.push(line));
  await until(()=>lines.some(l=>l.startsWith('VERSION')));
  return {...r,socket,lines};
}

test('verklig TCP-gateway och SerialPort-mock bevarar byte, fragmenterat eko och oberoende återrapport',async t=>{
  const r=await mockGateway(t);const order=switchOrder(123,'C'),report=switchReport(123,'C');
  assert.equal(r.serial.settings.rtscts,false);assert.equal(r.serial.settings.baudRate,115200);
  r.socket.write('SEND '+hex(order)+'\r\n');await until(()=>r.serial.port.recording.length===order.length);
  assert.deepEqual(r.serial.port.recording,order);assert.ok(!r.lines.includes('SENT OK'));
  r.serial.port.emitData(report);await until(()=>r.lines.includes('RECEIVE '+hex(report)));
  assert.ok(!r.lines.includes('SENT OK'),'en återrapport är inte orderns eko');
  r.serial.port.emitData(order.subarray(0,2));await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(!r.lines.includes('SENT OK'));r.serial.port.emitData(order.subarray(2));await until(()=>r.lines.includes('SENT OK'));
  assert.equal(r.lines[r.lines.indexOf('SENT OK')-1],'RECEIVE '+hex(order));
});

test('förlorad kvittens stänger COM-porten utan att skicka ordern igen',async t=>{
  const r=await mockGateway(t);r.gateway.echoTimeoutMs=30;
  const order=switchOrder(7,'T');r.socket.write('SEND '+hex(order)+'\n');
  const binding=r.serial.port;await until(()=>r.lines.some(l=>l.includes('Serial echo timeout')));
  await until(()=>!r.serial.isOpen);assert.deepEqual(binding.recording,order);assert.equal(r.gateway.closed,true);
});

test('Bluetooth-avbrott stänger TCP, visar portfelet och skickar ingen extra order',async t=>{
  const errors=[];const r=await mockGateway(t,{onError:message=>errors.push(message)});
  r.serial.emit('error',Error('Device disconnected'));
  await until(()=>r.gateway.closed&&!r.serial.isOpen);assert.match(errors[0],/COM7.*disconnected/);
});

test('upptagen eller saknad COM-port öppnar ingen TCP-lyssnare',async()=>{
  for(const message of ['Access denied','File not found']) {
    class BadPort extends EventEmitter {constructor(){super();this.isOpen=false;}open(cb){queueMicrotask(()=>cb(Error(message)));}}
    const errors=[];const r=startWindowsGateway({device:'COM7',port:0,SerialPort:BadPort,onError:m=>errors.push(m)});
    await assert.rejects(r.ready,/COM7/);assert.equal(r.gateway.server.listening,false);assert.equal(errors.length,1);
    if(message==='Access denied')assert.match(errors[0],/Stäng JMRI/);
  }
});

test('en försenad portöppning efter tidsgräns eller avbryt stängs utan TCP-lyssnare',async()=>{
  for(const cancel of [false,true]) {
    class SlowPort extends EventEmitter {constructor(){super();this.isOpen=false;}open(cb){this.done=cb;}close(cb){this.isOpen=false;cb();}}
    const r=startWindowsGateway({device:'COM7',port:0,SerialPort:SlowPort,openTimeoutMs:10});
    if(cancel)r.gateway.close();await assert.rejects(r.ready);
    r.serial.isOpen=true;r.serial.done();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(r.serial.isOpen,false);assert.equal(r.gateway.server.listening,false);
  }
});

test('en upptagen lokal TCP-port stänger den redan öppnade COM-porten',async()=>{
  const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  SerialPortMock.binding.reset();SerialPortMock.binding.createPort('COM7');
  const r=startWindowsGateway({device:'COM7',port:server.address().port,SerialPort:SerialPortMock});
  try {await assert.rejects(r.ready,/EADDRINUSE|address already in use/);await until(()=>!r.serial.isOpen);}
  finally {server.close();r.gateway.close();}
});
