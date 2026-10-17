import test from 'node:test';
import assert from 'node:assert/strict';
import {turnoutDisplay} from '../public/turnout-display.js';
const options={fresh:true,now:5000,timeout:6000};
test('manual and route orders cannot illuminate the requested branch until confirmed',()=>{
 const report={position:'unknown',desired:'T',commandAt:4800};
 assert.deepEqual(turnoutDisplay({continuing:2},report,options),{active:null,phase:'waiting'});
 assert.deepEqual(turnoutDisplay({continuing:2},{...report,position:'T'},options),{active:'C',phase:'confirmed'});
 assert.equal(turnoutDisplay({continuing:1},{...report,position:'T'},options).active,'B');
});
test('lost contact, expired orders and initial unknown reports never retain an animated confirmed leg',()=>{
 const turnout={continuing:2},report={position:'C',desired:'C',commandAt:4800};
 assert.equal(turnoutDisplay(turnout,report,{...options,fresh:false}).phase,'unknown');
 assert.equal(turnoutDisplay(turnout,{...report,position:'unknown'}, {...options,now:12000}).phase,'unknown');
 assert.equal(turnoutDisplay(turnout,{position:'unknown'}, options).phase,'unknown');
 assert.equal(turnoutDisplay(turnout,{...report,position:'unknown'}, {...options,now:4700}).phase,'unknown');
});
