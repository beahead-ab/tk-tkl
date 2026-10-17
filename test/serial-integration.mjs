import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {LineReader,hex,switchOrder,switchReport} from '../src/protocol.mjs';
const cwd=fileURLToPath(new URL('..',import.meta.url));
const until=async fn=>{for(let i=0;i<250;i++){const result=fn();if(result)return result;await new Promise(r=>setTimeout(r,20));}throw Error('Virtual serial test timed out');};
test('real POSIX serial helper and TCP gateway preserve fragmented echo, independent reports and timeout isolation',{timeout:15000},async()=>{
  const python=spawn(process.env.PYTHON||'python3',['-u','test/fixtures/pty-locobuffer.py'],{cwd});let device,raw=Buffer.alloc(0),errors='',gateway,socket,port;const lines=[];
  const read=new LineReader(line=>{const msg=JSON.parse(line);if(msg.device)device=msg.device;if(msg.bytes)raw=Buffer.concat([raw,Buffer.from(msg.bytes,'base64')]);});python.stdout.on('data',data=>read.push(data));python.stderr.on('data',data=>{errors+=data;});
  try {
    await until(()=>device);
    gateway=spawn(process.execPath,['scripts/locobuffer-gateway.mjs','--device',device,'--baud','57600','--flow','none','--port','0'],{cwd});
    gateway.stdout.on('data',chunk=>{const m=chunk.toString().match(/127\.0\.0\.1:(\d+)/);if(m)port=Number(m[1]);});gateway.stderr.on('data',chunk=>{errors+=chunk;});
    await until(()=>port);socket=net.createConnection(port,'127.0.0.1');socket.on('error',()=>{});const reader=new LineReader(line=>lines.push(line));socket.on('data',data=>reader.push(data));await until(()=>lines.some(l=>l.startsWith('VERSION')));
    const order=switchOrder(123,'C');socket.write('SEND '+hex(order)+'\r\n');await until(()=>raw.length===order.length);assert.deepEqual(raw,order);assert.ok(!lines.includes('SENT OK'));
    const write=bytes=>python.stdin.write(JSON.stringify({bytes:bytes.toString('base64')})+'\n');
    write(order.subarray(0,2));await new Promise(r=>setTimeout(r,40));assert.ok(!lines.includes('SENT OK'));write(order.subarray(2));await until(()=>lines.includes('SENT OK'));
    assert.equal(lines[lines.indexOf('SENT OK')-1],'RECEIVE '+hex(order));const report=switchReport(123,'C');write(report);await until(()=>lines.includes('RECEIVE '+hex(report)));
    socket.write('SEND '+hex(switchOrder(124,'T'))+'\n');await until(()=>raw.length===8);await until(()=>lines.some(l=>l.includes('Serial echo timeout')));await until(()=>gateway.exitCode!==null);assert.equal(raw.length,8,'no automatic replay');assert.equal(errors,'');
  } finally {socket?.destroy();gateway?.kill('SIGTERM');python.kill('SIGTERM');}
});
