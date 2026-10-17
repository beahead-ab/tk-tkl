import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
for (const dir of ['src', 'scripts', 'test', 'public']) for (const file of fs.readdirSync(dir).filter(f => /\.(mjs|js)$/.test(f))) {
  const r = spawnSync(process.execPath, ['--check', dir + '/' + file], { stdio: 'inherit' }); if (r.status) process.exit(r.status);
}
console.log('JavaScript syntax: OK');
