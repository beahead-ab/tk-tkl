import test from 'node:test';
import assert from 'node:assert/strict';
import {formatPairingCode} from '../public/pairing-code.js';
test('pairing code is shown as 123-456 while typing, the way TrainMeet shows it',()=>{
  assert.equal(formatPairingCode(''),'');
  assert.equal(formatPairingCode('45'),'45');
  assert.equal(formatPairingCode('458'),'458');
  assert.equal(formatPairingCode('4589'),'458-9');
  assert.equal(formatPairingCode('458982'),'458-982');
  assert.equal(formatPairingCode('458-982'),'458-982');
  assert.equal(formatPairingCode(' 458 982 '),'458-982');
  assert.equal(formatPairingCode('abc-def'),'ABC-DEF');
  assert.equal(formatPairingCode(null),'');
});
