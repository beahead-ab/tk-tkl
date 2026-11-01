import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
  assert.ok(ps.includes(`-File "' + $RunScript + '"'`),'sökvägen till run.ps1 citeras, installationsmappen har blanksteg');
  assert.match(ps,/-ArgumentList \$RunArgs\b/);
  assert.doesNotMatch(ps,/\$args\s*=/i,'$args är en automatisk variabel i PowerShell');
  assert.match(ps,/Get-Content -Path \$TklLog -Tail 25/,'ett startfel visar de senaste loggraderna');
});

test('installed copies turn on the update notice, and only the Pi service may start its update',()=>{
  assert.match(read('packaging/raspberry-pi/app.env'),/^CHARLOTTENDAL_INSTALL_KIND=raspberry-pi$/m);
  assert.match(read('scripts/install-mac.sh'),/CHARLOTTENDAL_INSTALL_KIND=mac/);
  assert.match(read('install.ps1'),/CHARLOTTENDAL_INSTALL_KIND=windows/);
  const rule=read('packaging/raspberry-pi/50-cda-tkl-update.rules');
  assert.match(rule,/subject\.user === "cda-tkl"/);assert.match(rule,/"cda-tkl-update\.service"/);assert.match(rule,/lookup\("verb"\) === "start"/);
  assert.match(read('scripts/install-raspberry-pi.sh'),/50-cda-tkl-update\.rules/);
});

test('Mac och PC får installationens update-skript, som panelens Uppdatera nu startar',()=>{
  const mac=read('scripts/install-mac.sh'),ps=read('install.ps1');
  assert.match(mac,/cp "\$SOURCE_DIR\/packaging\/mac\/update\.sh" "\$APP\/update\.sh" && chmod \+x/);
  assert.match(mac,/CHARLOTTENDAL_UPDATE_COMMAND="%s"/,'vägen har mellanslag och måste citeras i app.env');
  assert.match(ps,/Copy-Item \(Join-Path \$Source 'packaging\\windows\\update\.ps1'\)/);
  assert.match(ps,/CHARLOTTENDAL_UPDATE_COMMAND/);
  // Skripten kör installationsraden igen; de installerar inte något eget.
  const update=read('packaging/mac/update.sh'),updatePs=read('packaging/windows/update.ps1');
  assert.match(update,/install\.sh/);assert.match(update,/github-token/);assert.match(update,/CHARLOTTENDAL_INSTALL_REPOSITORY/);
  assert.match(updatePs,/install\.ps1/);assert.match(updatePs,/Invoke-Expression \$Script/,'installeraren körs i samma process, annars stoppar dess uppstädning uppdateringen');
  assert.match(updatePs,/github-token/);
});

test('Mac och PC sparar installationens token, så att Uppdatering ser nya versioner i ett privat förråd',()=>{
  const mac=read('scripts/install-mac.sh'),ps=read('install.ps1');
  assert.match(mac,/printf '%s\\n' "\$CDA_TKL_TOKEN" > "\$APP\/github-token"/);
  assert.match(mac,/chmod 0600 "\$APP\/github-token"/,'bara den egna användaren läser token');
  assert.match(mac,/CHARLOTTENDAL_GITHUB_TOKEN_FILE="%s"/,'vägen har mellanslag och måste citeras i app.env');
  assert.match(ps,/\$Token = if \(\$env:TKL_TOKEN\) \{ \$env:TKL_TOKEN \} else \{ \$env:CDA_TKL_TOKEN \}/,'samma två namn som install.sh');
  assert.match(ps,/Set-Content -Path \$TokenFile/);
  assert.match(ps,/CHARLOTTENDAL_GITHUB_TOKEN_FILE/);
});

test('the Mac app goes in Program when it can, else Program in the home folder',()=>{
  const mac=read('scripts/install-mac.sh');
  assert.match(mac,/APPS=\/Applications\n\[ -w "\$APPS" \] \|\| \{ APPS="\$HOME\/Applications"/);
  assert.match(mac,/osacompile -o "\$APPS\/\$APP_NAME\.app"/);
});

test('Windows läser paketets identitet före installation och håller stationernas genvägar isär',()=>{
  const ps=read('install.ps1');
  assert.ok(ps.indexOf('$IdentityFile =')<ps.indexOf('$App ='),'identiteten läses innan installationskatalogen väljs');
  assert.ok(ps.indexOf('$App =')<ps.indexOf('# Node.js 22'),'även Node installeras i stationens egen katalog');
  assert.match(ps,/TKL_NAME = 'Charlottendal'/,'äldre paket utan identitetsfil behåller Charlottendals namn');
  assert.match(ps,/\$Name = \$Identity\['TKL_NAME'\] \+ ' TKL'/);
  assert.match(ps,/\$App = if \(\$env:CDA_TKL_HOME\) \{ \$env:CDA_TKL_HOME \} else \{ Join-Path \$env:LOCALAPPDATA \$Name \}/);
  for(const folder of ['Startup','Desktop'])assert.ok(ps.includes(`GetFolderPath('${folder}')) "$Name.lnk"`),'egen genväg i '+folder);
  assert.ok(ps.includes(`Start-Process (Join-Path ([Environment]::GetFolderPath('Desktop')) "$Name.lnk")`));
  assert.doesNotMatch(ps,/'Charlottendal TKL\.lnk'/,'Träkvista får inte skriva över Charlottendals genväg');
});

test('Mac installerar och uppdaterar varje station för sig och behåller Charlottendals äldre driftdata',
  {skip:process.platform!=='darwin'},()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tkl-mac-prov-'));
  const put=(name,content,mode)=>{fs.mkdirSync(path.dirname(name),{recursive:true});fs.writeFileSync(name,content,mode?{mode}:{});};
  try{
    const source=path.join(dir,'paket'),home=path.join(dir,'hem'),bin=path.join(dir,'bin'),log=path.join(dir,'kommandon');
    for(const name of ['scripts/install-mac.sh','packaging/raspberry-pi/app.env','packaging/mac/run.sh','packaging/mac/launchd.plist','packaging/mac/open-panel.applescript'])put(path.join(source,name),read(name));
    put(path.join(source,'src/server.mjs'),'// Installationsprov; servern startas inte.\n');
    put(path.join(source,'package.json'),'{\n  "version": "1.0.0"\n}\n');
    // Alla kommandon som når appar, autostart, nätet eller webbläsaren ersätts. Inget körs i den riktiga installationen.
    put(path.join(bin,'id'),'#!/bin/sh\necho 501\n',0o755);
    for(const cmd of ['rm','osacompile','launchctl','curl','open'])put(path.join(bin,cmd),
      `#!/bin/sh\nprintf '${cmd} %s\\n' "$*" >> "$TKL_TEST_LOG"\n${cmd==='launchctl'?'[ "$1" != print ]':'exit 0'}\n`,0o755);
    const apps={};
    for(const [id,name] of [['cda-tkl','Charlottendal'],['tk-tkl','Träkvista']]){
      const station=id==='cda-tkl'?'charlottendal':'trakvista',app=path.join(home,'Library/Application Support',name+' TKL');
      apps[id]=app;
      put(path.join(source,'packaging/identity.env'),`TKL_ID=${id}\nTKL_NAME=${name}\nTKL_STATION=${station}\nTKL_REPOSITORY=beahead-ab/${id==='cda-tkl'?'cda-tkl':'Tk-TKL'}\n`);
      put(path.join(app,'node/bin/node'),'#!/bin/sh\n[ "$1" != -p ] || echo 22.0.0\nexit 0\n',0o755);
      put(path.join(app,'node/bin/npm'),'#!/bin/sh\nexit 0\n',0o755);
      if(id==='cda-tkl'){
        const previous=path.join(app,'releases/aldre');
        for(const file of ['users.json','settings.json','locks.json'])put(path.join(previous,'var',file),`{"bevarad":"${file}"}\n`);
        fs.symlinkSync(previous,path.join(app,'current'));
        put(path.join(app,'app.env'),`CHARLOTTENDAL_STATE_DIR=${app}/state\nCHARLOTTENDAL_INSTALL_KIND=mac\nCHARLOTTENDAL_PROFILE=profiles/charlottendal.json\nEGEN_INSTALLNING=bevarad\nCHARLOTTENDAL_INSTALL_REPOSITORY=beahead-ab/cda-tkl-install\n`);
      }
      const run=()=>execFileSync('sh',[path.join(source,'scripts/install-mac.sh'),source],{encoding:'utf8',env:{...process.env,HOME:home,PATH:bin+':'+process.env.PATH,CDA_TKL_HOME:'',CDA_TKL_NO_LAUNCHD:'',TKL_TEST_LOG:log}});
      fs.writeFileSync(log,'');
      assert.match(run(),new RegExp(name+' TKL 1\\.0\\.0 är installerad'));
      const commands=fs.readFileSync(log,'utf8');
      assert.ok(commands.includes('/'+name+' TKL.app'),'appens eget namn');
      assert.ok(commands.includes('se.beahead.'+id),'egen launchd-agent');
      assert.ok(!commands.includes(id==='cda-tkl'?'Träkvista TKL.app':'Charlottendal TKL.app'),'den andra stationens app rörs inte');
      const plist=fs.readFileSync(path.join(home,'Library/LaunchAgents/se.beahead.'+id+'.plist'),'utf8');
      assert.ok(plist.includes(app+'/run.sh'));
      const env=fs.readFileSync(path.join(app,'app.env'),'utf8');
      assert.ok(env.includes(`CHARLOTTENDAL_STATE_DIR="${app}/state"`),'driftdata under stationens egen katalog');
      if(id==='cda-tkl'){
        assert.ok(env.includes('CHARLOTTENDAL_PROFILE=profiles/charlottendal.json'),'gammalt profilval behålls');
        assert.ok(env.includes('CHARLOTTENDAL_INSTALL_REPOSITORY=beahead-ab/cda-tkl\n'),'den gamla standardadressen flyttas');
        for(const file of ['users.json','settings.json','locks.json'])assert.equal(fs.readFileSync(path.join(app,'state',file),'utf8'),`{"bevarad":"${file}"}\n`);
      }else{
        assert.ok(env.includes('CHARLOTTENDAL_STATION=trakvista'));
        assert.ok(env.includes('CHARLOTTENDAL_INSTALL_REPOSITORY=beahead-ab/Tk-TKL'));
      }
      put(path.join(app,'state/prov.json'),'{"orört":true}\n');
      run();
      assert.equal(fs.readFileSync(path.join(app,'app.env'),'utf8'),env,'uppdateringen bevarar inställningarna');
      assert.equal(fs.readFileSync(path.join(app,'state/prov.json'),'utf8'),'{"orört":true}\n','uppdateringen bevarar driftdata');
    }
    assert.notEqual(apps['cda-tkl'],apps['tk-tkl']);
    assert.ok(fs.existsSync(path.join(apps['cda-tkl'],'state/users.json')),'Charlottendals användare finns kvar efter installation av Träkvista');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
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
  assert.match(script,/TKL_ID=cda-tkl TKL_NAME=Charlottendal TKL_STATION=charlottendal TKL_REPOSITORY=beahead-ab\/cda-tkl/,'defaults without the file');
  assert.ok(fs.existsSync(new URL('../stations/'+id.TKL_STATION+'/station.json',import.meta.url))||id.TKL_STATION==='charlottendal','the station exists');
});

test('a token for a private repository is readable by the TKL service group, so Uppdatering can see new versions',()=>{
  const script=read('scripts/install-raspberry-pi.sh');
  assert.match(script,/chown "root:\$TKL_ID" "\$CONFIG_DIR\/github-token" && chmod 0640 "\$CONFIG_DIR\/github-token"/);
  assert.match(script,/CHARLOTTENDAL_GITHUB_TOKEN_FILE=%s\\n' "\$CONFIG_DIR\/github-token"/);
  assert.match(read('packaging/raspberry-pi/cda-tkl-update'),/github-token \] && TOKEN=/,'the update service reads the same token');
});
