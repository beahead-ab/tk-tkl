import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const helper=fileURLToPath(new URL('../scripts/raspberry-pi-reboot.sh',import.meta.url));

function run({systemd='true',model='Raspberry Pi 5 Model B Rev 1.0',previous='',optOut=false,shutdownStatus=0}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tkl-omstart-'));
  const log=path.join(dir,'shutdown.log');
  try {
    // Skuggningen är en skalfunktion: inget riktigt shutdown-kommando kan köras i proven.
    const result=spawnSync('sh',['-c',`
      set -eu
      shutdown() { printf '%s\\n' "$*" >> "$TKL_REBOOT_TEST_LOG"; return "$TKL_REBOOT_TEST_STATUS"; }
      . "$1"
      schedule_pi_reboot "$2" "$3" "$4"
    `,'omstartsprov',helper,systemd,model,previous],{encoding:'utf8',env:{...process.env,CDA_TKL_REBOOT:optOut?'0':'1',TKL_REBOOT_TEST_LOG:log,TKL_REBOOT_TEST_STATUS:String(shutdownStatus)}});
    return {...result,scheduled:fs.existsSync(log)?fs.readFileSync(log,'utf8'):''};
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}

test('första installationen på en Pi beställer en fördröjd omstart och förklarar SSH-avbrottet',()=>{
  const result=run();
  assert.equal(result.status,0,result.stderr);
  assert.match(result.scheduled,/^-r \+1 TKL är installerat/);
  assert.equal(result.scheduled.trim().split('\n').length,1);
  assert.match(result.stdout,/om en minut/);
  assert.match(result.stdout,/SSH-förbindelsen bryts/);
  assert.match(result.stdout,/sudo shutdown -c/);
});

for(const [name,options] of [
  ['en befintlig installation',{previous:'/opt/cda-tkl/releases/aldre'}],
  ['en annan Linux-dator',{model:'Debian PC'}],
  ['en miljö utan systemd',{systemd:'false'}],
  ['en uttryckligen avstängd omstart',{optOut:true}],
])test(name+' beställer ingen omstart',()=>{
  const result=run(options);
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.scheduled,'');
  assert.doesNotMatch(result.stdout,/startar om automatiskt/);
});

test('misslyckad beställning redovisas med manuell omstart och utan falsk bekräftelse',()=>{
  const result=run({shutdownStatus:1});
  assert.equal(result.status,1);
  assert.match(result.stderr,/automatisk omstart kunde inte beställas.*sudo reboot/);
  assert.doesNotMatch(result.stdout,/startar om automatiskt/);
});

test('installeraren når omstarten först efter godkänd startkontroll, även för rangerarstationen',()=>{
  const script=fs.readFileSync(new URL('../scripts/install-raspberry-pi.sh',import.meta.url),'utf8');
  const tail=script.slice(script.indexOf('if [ "$SYSTEMD" = true ] && [ -n "$KIOSK_URL" ]; then'));
  assert.ok(tail.startsWith('if ['));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tkl-installationsslut-'));
  try {
    fs.mkdirSync(path.join(dir,'scripts'));
    // Bara en markör; ingen systemomstart är möjlig i detta prov.
    fs.writeFileSync(path.join(dir,'scripts/raspberry-pi-reboot.sh'),'schedule_pi_reboot() { echo kontrollerad >> "$TKL_REBOOT_TEST_LOG"; }\n');
    for(const [mode,kiosk,expected] of [['ok','',1],['fel','',0],['ok','http://annan-pi:8910/#ranger',1]]) {
      const log=path.join(dir,'slut.log');fs.rmSync(log,{force:true});
      const result=spawnSync('sh',['-c',`
        set -eu
        systemctl() { return 0; }
        curl() { [ "$TKL_REBOOT_TEST_MODE" = ok ]; }
        sleep() { :; }
        ${tail}
      `],{encoding:'utf8',env:{...process.env,SYSTEMD:'true',KIOSK_URL:kiosk,SOURCE_DIR:dir,TKL_ID:'cda-tkl',TKL_NAME:'Charlottendal',VERSION:'1.0.0',PREVIOUS:'',BROWSER_ENABLED:'true',TKL_REBOOT_TEST_LOG:log,TKL_REBOOT_TEST_MODE:mode}});
      assert.equal(result.status,mode==='fel'?1:0,result.stderr);
      assert.equal(fs.existsSync(log)?fs.readFileSync(log,'utf8').trim().split('\n').length:0,expected);
    }
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
