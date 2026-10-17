import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
// Inställningar → Uppdatering shows public/releases.json. Every release adds its
// heading there, so the running version is always the first entry.
const read=file=>JSON.parse(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'));
test('the running version has headings, newest first, in Swedish for the user',()=>{
  const releases=read('public/releases.json'),version=read('package.json').version;
  assert.equal(releases[0].version,version,'add the release to public/releases.json');
  assert.ok(releases.every(r=>/^\d+\.\d+\.\d+$/.test(r.version)&&/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&r.notes.length&&r.notes.every(n=>typeof n==='string'&&n.trim())));
  const key=v=>v.split('.').map(Number).reduce((a,b)=>a*1000+b,0);
  assert.deepEqual(releases.map(r=>r.version),[...releases].sort((a,b)=>key(b.version)-key(a.version)).map(r=>r.version));
});
