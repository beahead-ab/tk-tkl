import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const identity=()=>Object.fromEntries([...read('packaging/identity.env').matchAll(/^(TKL_\w+)=(.*)$/gm)].map(m=>[m[1],m[2]]));

test('the public installer fetches the package and hands it to the Raspberry Pi installer',()=>{
  const install=read('install.sh');
  assert.match(install,/INSTALLER="scripts\/install-raspberry-pi\.sh"/);
  assert.match(install,/github\.com\/\$\{REPOSITORY\}\/archive\/refs\/heads\/\$\{BRANCH\}\.tar\.gz/);
  assert.ok(install.includes(`REPOSITORY="${identity().TKL_REPOSITORY}"`),'installs from the repository named in packaging/identity.env');
  assert.ok(read('install.ps1').includes(`$Repository = '${identity().TKL_REPOSITORY}'`),'Windows installs from the same repository');
  assert.match(install,/CDA_TKL_TOKEN/,'a private fork can be read with a token');
});

test('every folder the server reads at run time is copied into a release',()=>{
  const script=read('scripts/install-raspberry-pi.sh');
  const copied=new Set(/for item in ([^;]+); do/.exec(script)[1].split(/\s+/));
  const used=new Set();
  for(const file of fs.readdirSync(new URL('../src/',import.meta.url)).filter(f=>f.endsWith('.mjs')))
    for(const m of read('src/'+file).matchAll(/new URL\(['`]\.\.\/([a-z-]+)/g))used.add(m[1]);
  used.delete('var');   // the default state folder; the installer points state at /var/lib/cda-tkl
  for(const dir of used)assert.ok(copied.has(dir)||copied.has(dir+'.json'),'release lacks '+dir);
  assert.ok(copied.has('package-lock.json'),'dependencies are installed from the lock file');
});

test('services run our own Node as the cda-tkl user, and settings are never overwritten',()=>{
  for(const unit of ['cda-tkl.service','cda-tkl-simulator.service']){
    const text=read('packaging/raspberry-pi/'+unit);
    assert.match(text,/^User=cda-tkl$/m);assert.match(text,/^ExecStart=\/opt\/cda-tkl\/node\/bin\/node src\//m);
    assert.match(text,/^EnvironmentFile=\/etc\/cda-tkl\/app\.env$/m);
  }
  assert.match(read('scripts/install-raspberry-pi.sh'),/if \[ ! -f "\$CONFIG_DIR\/app\.env" \]; then/);
  assert.match(read('packaging/raspberry-pi/app.env'),/^CHARLOTTENDAL_STATE_DIR=\/var\/lib\/cda-tkl$/m);
});

test('the Stream Deck is allowed for the panel without a dialog',()=>{
  const policy=JSON.parse(read('packaging/raspberry-pi/chromium-policy.json'));
  assert.equal(policy.WebHidAllowDevicesForUrls[0].devices[0].vendor_id,0x0fd9);
  assert.ok(policy.WebHidAllowDevicesForUrls[0].urls.includes('http://127.0.0.1:8910'));
  assert.match(read('packaging/raspberry-pi/50-cda-tkl-streamdeck.rules'),/ATTRS\{idVendor\}=="0fd9", TAG\+="uaccess"/);
  assert.match(read('packaging/raspberry-pi/cda-tkl-browser'),/--kiosk --app="\$URL"/);
});

test('the Mac and Windows installers copy the same folders as the Raspberry Pi installer',()=>{
  const pi=/for item in ([^;]+); do/.exec(read('scripts/install-raspberry-pi.sh'))[1].trim().split(/\s+/).sort();
  const mac=/for item in ([^;]+); do/.exec(read('scripts/install-mac.sh'))[1].trim().split(/\s+/).sort();
  const win=/foreach \(\$Item in ([^)]+)\)/.exec(read('install.ps1'))[1].split(',').map(s=>s.trim().replace(/'/g,'')).sort();
  assert.deepEqual(mac,pi);assert.deepEqual(win,pi);
});

test('install.sh hands a Mac to the per-user installer and refuses sudo there',()=>{
  const install=read('install.sh');
  assert.match(install,/Darwin\)[\s\S]*INSTALLER="scripts\/install-mac\.sh"[\s\S]*Kör installationen utan sudo på Mac/);
  assert.match(read('packaging/mac/launchd.plist'),/<key>KeepAlive<\/key><true\/>/);
  assert.match(read('packaging/mac/run.sh'),/exec "\$APP\/node\/bin\/node" scripts\/start\.mjs/);
});

test('the Windows installer never exits the user\'s PowerShell and starts TKL hidden at login',()=>{
  const ps=read('install.ps1');
  assert.doesNotMatch(ps,/^\s*exit\b/m,'exit would close the window opened for irm | iex');
  assert.match(ps,/GetFolderPath\('Startup'\)/);
  assert.match(ps,/--app=http:\/\/127\.0\.0\.1:8910\/#panel/);
  assert.match(read('packaging/windows/run.ps1'),/scripts\/start\.mjs/);
});

test('installed copies turn on the update notice, and only the Pi service may start its update',()=>{
  assert.match(read('packaging/raspberry-pi/app.env'),/^CHARLOTTENDAL_INSTALL_KIND=raspberry-pi$/m);
  assert.match(read('scripts/install-mac.sh'),/CHARLOTTENDAL_INSTALL_KIND=mac/);
  assert.match(read('install.ps1'),/CHARLOTTENDAL_INSTALL_KIND=windows/);
  const rule=read('packaging/raspberry-pi/50-cda-tkl-update.rules');
  assert.match(rule,/subject\.user === "cda-tkl"/);assert.match(rule,/"cda-tkl-update\.service"/);assert.match(rule,/lookup\("verb"\) === "start"/);
  assert.match(read('scripts/install-raspberry-pi.sh'),/50-cda-tkl-update\.rules/);
});

test('the Mac app goes in Program when it can, else Program in the home folder',()=>{
  const mac=read('scripts/install-mac.sh');
  assert.match(mac,/APPS=\/Applications\n\[ -w "\$APPS" \] \|\| \{ APPS="\$HOME\/Applications"/);
  assert.match(mac,/osacompile -o "\$APPS\/Charlottendal TKL\.app"/);
});

test('the Mac keeps its data in state although the path has a space, and re-registers launchd reliably',()=>{
  const mac=read('scripts/install-mac.sh');
  assert.match(mac,/CHARLOTTENDAL_STATE_DIR=\\"\$APP\/state\\"/,'the value is written quoted');
  assert.match(mac,/sed -i '' -E 's\|\^\(CHARLOTTENDAL_STATE_DIR\)=/,'older unquoted values are repaired');
  assert.match(mac,/cp -Rp "\$PREVIOUS\/var"\/\. "\$APP\/state"\//,'data kept in the old release is brought into state');
  assert.match(mac,/launchctl print "gui\/\$\(id -u\)\/\$LABEL" >\/dev\/null 2>&1 \|\| break/,'waits until the old agent is gone');
});

test('a rangerare\'s station: kiosk URL from app.env, Stream Deck allowed for that origin, no TKL of its own',()=>{
  const browser=read('packaging/raspberry-pi/cda-tkl-browser'),install=read('scripts/install-raspberry-pi.sh'),env=read('packaging/raspberry-pi/app.env');
  assert.match(browser,/CHARLOTTENDAL_KIOSK_URL=/);assert.match(browser,/--unsafely-treat-insecure-origin-as-secure=\$ORIGIN/);assert.match(browser,/\/api\/auth\/session/);
  assert.match(install,/KIOSK_URL=\$\{CDA_TKL_KIOSK_URL:-\}/);assert.match(install,/systemctl disable --now "\$TKL_ID-simulator\.service" "\$TKL_ID\.service"/);
  assert.match(install,/\$KIOSK_ORIGIN/);
  assert.match(env,/^# CHARLOTTENDAL_LISTEN=0\.0\.0\.0$/m);assert.match(env,/^# CHARLOTTENDAL_LAN_HOSTS=/m);
});

test('packaging/identity.env names the installation; Charlottendal\'s package installs as before',()=>{
  const id=identity(),script=read('scripts/install-raspberry-pi.sh');
  assert.match(id.TKL_ID,/^[a-z0-9-]+$/);assert.ok(id.TKL_NAME&&id.TKL_STATION&&id.TKL_REPOSITORY);
  assert.match(script,/\. "\$SOURCE_DIR\/packaging\/identity\.env"/);
  assert.match(script,/TKL_ID=cda-tkl TKL_NAME=Charlottendal TKL_STATION=charlottendal TKL_REPOSITORY=beahead-ab\/cda-tkl-install/,'defaults without the file');
  assert.ok(fs.existsSync(new URL('../stations/'+id.TKL_STATION+'/station.json',import.meta.url))||id.TKL_STATION==='charlottendal','the station exists');
});

test('a token for a private repository is readable by the TKL service group, so Uppdatering can see new versions',()=>{
  const script=read('scripts/install-raspberry-pi.sh');
  assert.match(script,/chown "root:\$TKL_ID" "\$CONFIG_DIR\/github-token" && chmod 0640 "\$CONFIG_DIR\/github-token"/);
  assert.match(script,/CHARLOTTENDAL_GITHUB_TOKEN_FILE=%s\\n' "\$CONFIG_DIR\/github-token"/);
  assert.match(read('packaging/raspberry-pi/cda-tkl-update'),/github-token \] && TOKEN=/,'the update service reads the same token');
});
