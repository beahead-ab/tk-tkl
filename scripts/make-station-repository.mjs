// Ger ett paket en stations identitet, till exempel Träkvista i beahead-ab/Tk-TKL.
//
//   node scripts/make-station-repository.mjs trakvista
//
// deploy/publish-station.sh kör det på programmet och stationens katalog ur cda-tkl. Allt program är detsamma; bara
// installationens identitet byts, ur "installation" i stations/<id>/station.json: packaging/identity.env, förrådet i
// install.sh och install.ps1, paketets namn och npm start, och README.md från stations/<id>/README.md. Går att köra igen.
import fs from 'node:fs';

const root = new URL('..', import.meta.url), file = name => new URL(name, root);
const read = name => fs.readFileSync(file(name), 'utf8');
const id = process.argv[2];
if (!/^[a-z0-9-]+$/.test(id || '')) throw Error('Ange stationen: node scripts/make-station-repository.mjs trakvista');
// Aldrig i cda-tkl självt: där skulle Charlottendals installation få stationens namn och förråd.
if (fs.existsSync(file('profiles/charlottendal-network.json'))) throw Error('Det här är cda-tkl. Stationens förråd byggs med deploy/publish-station.sh ' + id + '.');
const station = JSON.parse(read(`stations/${id}/station.json`)), target = station.installation;
if (!target || !/^[a-z0-9-]+$/.test(target.id) || !target.name || !/^[\w.-]+\/[\w.-]+$/.test(target.repository))
  throw Error(`stations/${id}/station.json saknar "installation": { "id", "name", "repository" }.`);

const identity = Object.fromEntries([...read('packaging/identity.env').matchAll(/^(TKL_\w+)=(.*)$/gm)].map(m => [m[1], m[2]]));
const values = { TKL_ID: target.id, TKL_NAME: target.name, TKL_STATION: id, TKL_REPOSITORY: target.repository };
const changed = [];
const write = (name, content) => { if (!fs.existsSync(file(name)) || read(name) !== content) { fs.writeFileSync(file(name), content); changed.push(name); } };
const replaceAll = (text, from, to) => text.split(from).join(to);

write('packaging/identity.env', read('packaging/identity.env').replace(/^(TKL_\w+)=.*$/gm, (line, key) => key in values ? `${key}=${values[key]}` : line));
// Förrådet att hämta från och adresserna i kommentarerna; jämförelserna med Charlottendals förråd står kvar.
for (const name of ['install.sh', 'install.ps1']) write(name, replaceAll(read(name), `githubusercontent.com/${identity.TKL_REPOSITORY}/`, `githubusercontent.com/${target.repository}/`)
  .replace(/^REPOSITORY=".*"$/m, `REPOSITORY="${target.repository}"`).replace(/^NAME=".*"$/m, `NAME="${target.name} TKL"`)
  .replace(/^\$Repository = '.*'$/m, `$Repository = '${target.repository}'`));
const pkg = JSON.parse(read('package.json'));
// npm-skript som pekar på filer som inte finns i stationens förråd (Charlottendals källor och generatorer) tas bort.
const scripts = Object.fromEntries(Object.entries(pkg.scripts).filter(([, command]) =>
  (command.match(/\b(?:scripts|test|public|profiles|stations)\/[\w.\/-]+/g) || []).every(f => fs.existsSync(file(f)))));
write('package.json', JSON.stringify({ ...pkg, name: target.id, scripts: { ...scripts, start: `node scripts/start.mjs ${id}` } }, null, 2) + '\n');
let n = 0;
write('package-lock.json', read('package-lock.json').replace(new RegExp(`"name": "${pkg.name}"`, 'g'), match => n++ < 2 ? `"name": "${target.id}"` : match));
if (fs.existsSync(file(`stations/${id}/README.md`))) write('README.md', read(`stations/${id}/README.md`));

console.log(changed.length ? `${target.name} TKL (${target.repository}): ${changed.join(', ')}` : `${target.name} TKL är redan inställd.`);
