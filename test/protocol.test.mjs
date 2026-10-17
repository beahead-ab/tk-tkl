import test from 'node:test';
import assert from 'node:assert/strict';
import { fromHex, hex, decode, frame, switchOrder, switchReport, sensorReport, signalReport, FrameReader, LineReader } from '../src/protocol.mjs';

test('published byte fixtures decode and encode independently', () => {
  const cases = [
    ['B0 7A 30 05', switchOrder(123, 'C'), { kind: 'order', address: 123, position: 'C', on: true }],
    ['B0 7A 10 25', switchOrder(123, 'T'), { kind: 'order', address: 123, position: 'T', on: true }],
    // Ingångsformatet, som MGP-korten rapporterar (Bennys monitorering 9 oktober 2026); utgångsformatet avkodas också.
    ['B1 7A 70 44', switchReport(123, 'C'), { kind: 'turnout', address: 123, position: 'C', input: true }],
    ['B1 7A 60 54', switchReport(123, 'T'), { kind: 'turnout', address: 123, position: 'T', input: true }],
    ['B1 7A 00 34', switchReport(123, 'unknown'), { kind: 'turnout', address: 123, position: 'unknown' }],
    ['B2 3B 75 03', sensorReport(1400, true), { kind: 'sensor', address: 1400, active: true }],
    ['B2 3B 65 13', sensorReport(1400, false), { kind: 'sensor', address: 1400, active: false }],
    ['E4 09 06 2E 00 01 00 00 3B', signalReport(815, 0), { kind: 'signal', address: 815, code: 0 }],
    ['E4 09 06 2E 00 01 12 00 29', signalReport(815, 18), { kind: 'signal', address: 815, code: 18 }]
  ];
  for (const [wire, encoded, value] of cases) { assert.equal(hex(encoded), wire); assert.deepEqual(decode(fromHex(wire)), value); }
  assert.deepEqual(decode(fromHex('B1 7A 20 14')), { kind: 'turnout', address: 123, position: 'C' }, 'utgångsformat CLOSED');
  assert.deepEqual(decode(fromHex('B1 7A 10 24')), { kind: 'turnout', address: 123, position: 'T' }, 'utgångsformat THROWN');
});
test('bad checksum, lengths and addresses fail closed', () => {
  for (const s of ['B0 7A 30 04', 'B0 7A 30', 'B0 7A FF 05', 'E4 09 00', '??']) assert.throws(() => fromHex(s));
  assert.throws(() => switchOrder(2049, 'C')); assert.throws(() => sensorReport(0, true));
  assert.equal(decode(frame([0xb1, 0, 0x40])).kind, 'unsupported', 'hjälpingången är inget läge');
  assert.equal(decode(frame([0xb1, 0, 0x30])).position, 'unknown');
});
test('serial chunks and garbage resynchronize without invented frames', () => {
  const frames = [], errors = [], reader = new FrameReader(x => frames.push(hex(x)), x => errors.push(x));
  reader.push(Buffer.from([0, 5, 0xb0, 0x7a])); reader.push(Buffer.from([0x30, 0x05, 0xb1, 0, 0xb1, 0x7a, 0x20, 0x14]));
  assert.deepEqual(frames, ['B0 7A 30 05', 'B1 7A 20 14']); assert.equal(errors.length, 1);
});
test('LocoNet-over-TCP fragmented lines and CR/LF combinations', () => {
  const lines = [], errors = [], r = new LineReader(s => lines.push(s), e => errors.push(e));
  r.push(Buffer.from('RECE')); r.push(Buffer.from('IVE B0 7A 30 05\r')); r.push(Buffer.from('\n\nSENT OK\n\rVERSION field\r\n'));
  assert.deepEqual(lines, ['RECEIVE B0 7A 30 05', 'SENT OK', 'VERSION field']);
  r.push(Buffer.from('X'.repeat(4097))); assert.equal(errors.length, 1);
});
