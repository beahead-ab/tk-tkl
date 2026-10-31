// Driftprofil för en station i stations/<id>, ur stationens station.json, panel.json och operations-source.json.
//
//   node scripts/make-station-profile.mjs stations/trakvista [--check]
//
// Samma bibliotek som Charlottendals scripts/make-network-profile.mjs: spårgrafen (Topology), källans knappregler
// (RoutePolicy), signalplanen ur ankarpunkter och växelben, vägvalet (selectRoutePaths) och utfartens förlängning.
// Det Charlottendal har för hand (Spår 6, rangerbangården, programmeringsspåret, V1–V4, granskade listval) finns inte
// här; det som är stationens egna uppgifter står i station.json. Adresserna kommer ur JMRI-filen och är inte uppmätta.
import fs from 'node:fs';
import path from 'node:path';
import { Topology } from '../src/topology.mjs';
import { RoutePolicy, signalPlan, attachSourceEndpoints } from '../src/route-policy.mjs';
import { selectRoutePaths } from '../src/route-selection.mjs';
import { extendExitRoute } from '../src/exit-route.mjs';
import { parseLayoutXml } from '../src/studio/sources.mjs';

const dir = path.resolve(process.argv[2] || 'stations/trakvista'), check = process.argv.includes('--check');
const read = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
const write = (file, data) => {
  const target = path.join(dir, file), content = JSON.stringify(data, null, 2) + '\n';
  if (check) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) throw Error('Inaktuell stationsfil: ' + target); return; }
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content);
};
const station = read('station.json'), panel = read('data/panel.json'), source = read('data/operations-source.json');
const xml = parseLayoutXml(fs.readFileSync(path.join(dir, station.source), 'utf8'));
if (panel.importNotes.sourceHash !== source.sourceHash) throw Error('panel.json och operations-source.json hör till olika källversioner.');

const topology = new Topology(panel), policy = new RoutePolicy(source);
attachSourceEndpoints(topology, source);
// Huvudknapparna: stationsfilen säger vilket spår knappen hör till; segmentet är det närmaste av spårets segment.
const buttons = {};
for (const [id, b] of Object.entries(station.buttons)) {
  const icon = panel.sicons.find(s => s.sensor === id && !s.hidden);
  const segs = Object.values(topology.segments).filter(s => s.b === b.block);
  if (!icon || !segs.length) throw Error('Knappen saknar ikon eller spår: ' + id);
  const d = s => ((s.x1 + s.x2) / 2 - icon.x - 8) ** 2 + ((s.y1 + s.y2) / 2 - icon.y - 8) ** 2;
  segs.sort((a, c) => d(a) - d(c));
  topology.buttons[id] = { ...icon, segment: segs[0].id, label: b.label };
  buttons[id] = { label: b.label, segment: segs[0].id };
}
// Växeltågvägsknapparna (vtv1.4 …) står vid sin NX-knapp (tvs1/4); regeln säger vilken.
for (const r of source.shuntRoutePolicies) for (const [button, sensor] of [[r.fromButton, r.nxButtons[0]], [r.toButton, r.nxButtons[1]]]) {
  const endpoint = topology.buttons[sensor];
  if (!endpoint) throw Error('NX-knappen saknar plats i grafen: ' + sensor);
  if (buttons[button] && buttons[button].sensor !== sensor) throw Error('Växeltågvägsknappen hör till två NX-knappar: ' + button);
  const label = sensor.replace(/^tvs/, '');
  topology.buttons[button] = { ...endpoint, label }; buttons[button] = { label, segment: endpoint.segment, sensor };
}
for (const b of Object.values(buttons)) delete b.sensor;

const lineButtons = new Set(Object.values(station.lines).map(l => l.button));
const requests = policy.allowed().filter(p => topology.buttons[p.from] && topology.buttons[p.to]).map(p => ({ ...policy.inspect(p.from, p.to), ...p }));
const preferences = selectRoutePaths(topology, source, requests);
const routes = [], routeAlternatives = [], excluded = [];
const targetMastOf = sensor => source.anchors.flatMap(a => ['eastbound', 'westbound'].map(d => a[d + 'sensor'] === sensor ? a[d + 'signalmast'] : null)).find(Boolean)
  || source.turnoutEnds.find(e => e.sensor === sensor)?.mast;
for (const pair of policy.allowed()) {
  const kind = pair.from.startsWith('htv') ? 'main' : 'shunt', decision = policy.inspect(pair.from, pair.to);
  const provenance = { rules: decision.rules.map(r => r.rule), nxButtons: decision.nxButtons };
  const options = preferences.get(decision.nxButtons.join('\0')) || [];
  if (!options.length) { excluded.push({ ...pair, ...provenance, reason: 'Ingen väg mellan NX-knapparna i den importerade grafen.' }); continue; }
  for (const [variant, preferred] of options.entries()) {
    let path = preferred.path, plan = signalPlan(topology, source, path);
    const target = decision.nxButtons[1], targetMast = targetMastOf(target);
    if (!plan.signals.length || plan.boundaries[0]?.sensor !== decision.nxButtons[0]) { excluded.push({ ...pair, ...provenance, reason: 'Signalriktning och start stämmer inte med regelns NX-start.' }); continue; }
    if (targetMast && !plan.guardSignals.includes(targetMast)) { excluded.push({ ...pair, ...provenance, reason: 'Målets signalgräns kan inte bekräftas.' }); continue; }
    if (kind === 'main' && lineButtons.has(pair.to)) {
      path = extendExitRoute(topology, source, path, target, pair.to); plan = signalPlan(topology, source, path);
      if (plan.signals.at(-1) !== path.exitSignal) throw Error('Utfartssignalen saknas i den utökade vägen: ' + pair.from + ' → ' + pair.to);
    }
    const sensors = [...new Set([...plan.boundaries.map(b => b.sensor), target])];
    const requestedNxIds = source.nxPairs.filter(p => p.fromSensor === decision.nxButtons[0] && p.toSensor === decision.nxButtons[1]).map(p => p.id);
    const nxIds = [...new Set([...requestedNxIds, ...sensors.slice(0, -1).flatMap((s, i) => source.nxPairs.filter(p => p.fromSensor === s && p.toSensor === sensors[i + 1]).map(p => p.id))])];
    const label = topology.buttons[pair.from].label + ' → ' + topology.buttons[pair.to].label;
    (variant ? routeAlternatives : routes).push({ id: pair.from + '--' + pair.to, ...(variant ? { variantId: pair.from + '--' + pair.to + '@' + variant } : {}), ...pair, label, kind,
      source: { ...provenance, requestedNxIds }, nxIds, blocks: path.blocks, turnouts: path.settings, crossings: path.crossings, segments: path.used, flow: path.flow,
      ...(path.exitSignal ? { exitSignal: path.exitSignal } : {}), signals: plan.signals, guardSignals: plan.guardSignals, boundaries: plan.boundaries, path: path.path,
      routePreference: preferred.preference, autoRelease: true });
  }
}
const allRoutes = [...routes, ...routeAlternatives];

const lsOf = name => source.sensors.find(s => s.name === name)?.system;
// Växlar: LT-adressen ur JMRI. Interna växlar (IT) är manuella och har ingen LocoNet-adress; de får ett
// internt id från 1001 för modellens kompatibilitet, och märks local. Id:t får aldrig skickas på LocoNet.
const sourceTurnouts = Object.fromEntries(source.turnouts.filter(t => t.name).map(t => [t.name, t]));
let localAddress = 1001;
const turnouts = Object.fromEntries(Object.keys(topology.turnouts).sort().map(name => {
  const t = sourceTurnouts[name], block = topology.turnouts[name].block;
  if (t && /^LT\d+$/.test(t.system)) {
    // Växelmotorerna har inbyggda lägesgivare (Benny 17 oktober, svar 2), men alla är inte inställda i JMRI. Givarna tas
    // därför efter namn, vx<nr>-t för avvikande och vx<nr>-c för rakt, inte efter växelns sensor1/sensor2 i XML.
    const id = name.replace(/^Vx/, '').toLowerCase(), thrown = lsOf('vx' + id + '-t'), closed = lsOf('vx' + id + '-c');
    const sensors = /^LS\d+$/.test(thrown) && /^LS\d+$/.test(closed) ? { thrown: Number(thrown.slice(2)), closed: Number(closed.slice(2)), thrownSensor: 'vx' + id + '-t', closedSensor: 'vx' + id + '-c' } : null;
    const xmlSensors = t.feedback === 'TWOSENSOR' ? t.sensors.join('/') : t.feedback;
    const differs = sensors && t.feedback === 'TWOSENSOR' && (t.sensors[0] !== sensors.thrownSensor || t.sensors[1] !== sensors.closedSensor);
    return [name, { address: Number(t.system.slice(2)), inverted: t.inverted, source: t.system, block, ...(sensors ? { feedbackSensors: sensors } : {}),
      provenance: `JMRI ${t.system} (${t.comment || 'utan kommentar'}). ` + (sensors ? `Läget från motorns givare ${sensors.thrownSensor} (${thrown}) och ${sensors.closedSensor} (${closed})` +
        (differs ? `; XML anger ${xmlSensors}, som Benny säger inte är färdigställt.` : '.') : `Givare vx${id}-t och vx${id}-c saknas i XML; läget väntas som växelrapport tills givarna är inställda.`) + ' Ej uppmätt.' }];
  }
  if (t && /^IT\d+$/.test(t.system)) return [name, { address: localAddress++, inverted: t.inverted, source: t.system, block, local: true,
    provenance: `Intern JMRI-växel ${t.system}, helt manuell utan LocoNet-anslutning. Modellens interna id är ingen fysisk adress. TKL varken beordrar eller läser återrapport för växeln.` }];
  throw Error('Växeln saknar adress i källan: ' + name);
}));

// Spårledningar: LS-ingångarna ur LogixNG. Block utan sensor är interna objekt, inte spårledningar.
// Interna id:n från 3001 behåller modellens blockreferenser men används aldrig som LocoNet-adresser.
const blocks = {}; let bench = 3001;
for (const b of panel.lblocks) {
  const rule = source.detection.find(d => d.sets.includes(b.sensor));
  const inputs = (rule?.inputs || []).map(lsOf);
  if (rule && inputs.length && inputs.every(s => /^LS\d+$/.test(s))) {
    const list = inputs.map(s => ({ address: Number(s.slice(2)), activeMeansOccupied: true }));
    blocks[b.user] = { address: list[0].address, activeMeansOccupied: true, ...(list.length > 1 ? { inputs: list, logic: rule.logic } : {}), sourceSensor: b.sensor, sourceInputs: inputs,
      provenance: `${rule.name}: ${rule.inputs.join(rule.logic === 'all' ? ' och ' : ' eller ')} (${inputs.join(', ')}) ur LogixNG. Polaritet antagen (aktiv = belagd). Ej uppmätt.` };
  } else if (!b.sensor) blocks[b.user] = { address: bench++, activeMeansOccupied: true, internal: true, sourceSensor: null,
    provenance: 'Internt JMRI-block utan sensor, inte ett spårblock. Modellens interna id är ingen fysisk adress.' };
  else throw Error('Spårblockets sensor saknar LS-bindning i källan: ' + b.user);
}
for (const r of allRoutes) for (const b of r.blocks) if (!blocks[b] || blocks[b].internal) throw Error('Spårledning utan fysisk bindning: ' + b);
const blockOf = (route, part) => part.kind === 'segment' ? topology.segments[part.id].b : topology.turnouts[part.name].block;
for (const route of allRoutes) {
  const addresses = [...new Set(route.blocks.map(b => blocks[b].address))];
  route.signalEntries = route.boundaries.map(boundary => {
    const index = addresses.indexOf(blocks[blockOf(route, route.path[boundary.index])]?.address);
    if (index < 0) throw Error(`Passagegräns saknas: ${route.id} ${boundary.mast}`);
    return { signal: boundary.mast, index };
  });
}

// Signaler: TurnoutSignalMast lägger sin utgång THROWN för stopp och CLOSED för kör, som i Charlottendal.
const output = name => xml.turnouts.find(t => t.user === name || t.system === name);
const signals = Object.fromEntries([...new Set(panel.micons.map(m => m.mast))].sort().map(name => {
  const mast = xml.signalMasts.find(m => m.user === name), sourceType = panel.micons.find(m => m.mast === name).type;
  if (!mast) throw Error('Signalmast saknas: ' + name);
  if (mast.virtual) return [name, { virtual: true, sourceType, provenance: 'VirtualSignalMast: ingen utgång.' }];
  const stop = mast.aspects.find(a => a.state === 'thrown'), out = stop && output(stop.turnout);
  if (!out || !/^LT\d+$/.test(out.system)) throw Error('Signalens stopputgång saknas: ' + name);
  const address = Number(out.system.slice(2));
  return [name, { address, reportAddress: address, stopCodes: [0], goCodes: [8, 18], sourceType, sourceOutput: out.system, sourceOutputName: out.user || null,
    provenance: `Utgången ${out.system} (${out.comment || out.user}): ${stop.name} = THROWN, kör = CLOSED. Ej uppmätt.` }];
}));
const names = Object.keys(turnouts);
const coupled = Object.fromEntries(names.map(name => [name, Object.keys(topology.expand({ [name]: 'C' })).sort()]));
const protection = Object.fromEntries(Object.keys(signals).map(name => [name, { alternatives: [] }]));
for (const route of allRoutes) for (let i = 0; i < route.boundaries.length; i++) {
  const boundary = route.boundaries[i], next = route.boundaries[i + 1];
  const section = route.path.slice(boundary.index, next?.index ?? route.path.length);
  const sectionBlocks = [...new Set(section.map(p => blockOf(route, p)).filter(Boolean))];
  const settings = {}; for (const p of section) if (p.kind === 'turnout') { settings[p.name] = route.turnouts[p.name]; const t = topology.turnouts[p.name]; if (t.slip) for (const n of [panel.slips[t.slip].name, panel.slips[t.slip].name2]) settings[n] = route.turnouts[n]; }
  const option = { blocks: sectionBlocks, turnouts: topology.expand(settings), nextSignal: next?.mast || null };
  const list = protection[boundary.mast].alternatives;
  if (!list.some(o => JSON.stringify(o) === JSON.stringify(option))) list.push(option);
}
// Manöver av en enskild växel: härledd regel, inte ur källan. Växelns spårledning fri, signalerna vars skyddsområde
// berör växeln i stopp och ingen tågväg genom den. Benny har gruppen Spärra växlar; den är inte översatt än.
const manualRules = names.map(name => {
  const group = coupled[name], blockNames = [...new Set(group.map(n => turnouts[n].block))];
  const addresses = new Set(blockNames.map(n => blocks[n].address));
  const sig = Object.entries(protection).filter(([, p]) => p.alternatives.some(a => a.blocks.some(n => addresses.has(blocks[n]?.address)) || Object.keys(a.turnouts).some(n => group.includes(n)))).map(([n]) => n).sort();
  const inactiveNX = [...new Set(allRoutes.filter(r => group.some(n => r.turnouts[n])).flatMap(r => r.nxIds))].sort();
  return { rule: 'härledd', button: name, names: group, freeSensors: [], blocks: blockNames.sort(), inactiveNX, signals: sig, status: 'ready', reason: '',
    provenance: 'Härledd ur grafen: spårledningen fri, skyddande signaler i stopp, ingen tågväg genom växeln. Ej ur källans Spärra växlar.' };
});
// En lokalt styrd växel läggs om elektriskt på plats (Benny 17 oktober, svar 4). TKL lägger den aldrig, varken i en tågväg
// eller som enskild manöver.
for (const r of manualRules) if (r.names.some(n => turnouts[n].local)) Object.assign(r, { status: 'unresolved', reason: 'Lokalt styrd växel: den läggs om på plats, inte från TKL.' });
for (const r of allRoutes) if (Object.keys(r.turnouts).some(n => turnouts[n].local)) throw Error('Tågvägen går genom en lokalt styrd växel: ' + r.id);
// Som manual-policy.mjs: boundaryOverrides bara när det finns gränsväxlar (rangerbangården).
const manualPolicies = { rules: manualRules, byTurnout: Object.fromEntries(manualRules.map(r => [r.button, r])) };
// Linjerna: knappen och spårledningen vid den. Linjespärren motsvarar källans Spärra spår (ssA, ssB, ssC).
const lines = Object.fromEntries(Object.entries(station.lines).map(([id, l]) => {
  const block = topology.segments[buttons[l.button].segment].b;
  return [id, { id, label: l.label, button: l.button, sourceSensor: 'ss' + id, blocks: [block], side: l.side, neighbour: l.neighbour, singleTrack: !!l.singleTrack,
    entrySignal: l.entrySignal, exitSignal: l.exitSignal }];
}));

// Lokalt styrda spår: Benny ritar dem ofyllda, i JMRI är de dolda segment och växlar. Ett block är lokalt när alla dess
// segment är dolda; en lokal växel (intern i JMRI) gör sitt block lokalt. Bara märkning: kärnan hindrar ännu inget.
const hiddenTurnouts = new Set(Object.values(panel.turnouts).filter(t => t.hidden === 'yes').map(t => t.name));
const segsOf = b => panel.segs.filter(s => s.b === b);
const localBlocks = Object.keys(blocks).filter(b => (segsOf(b).length && segsOf(b).every(s => s.hide)) || Object.values(turnouts).some(t => t.local && t.block === b)).sort();
const localSegments = panel.segs.filter(s => s.hide && (localBlocks.includes(s.b) || (!s.b && [1, 2].every(e => s['t' + e].startsWith('TURNOUT_') && hiddenTurnouts.has(panel.turnouts[s['c' + e]]?.name))))).map(s => s.id);
for (const b of localBlocks) blocks[b].local = true;
const profile = { id: station.id + '-network-v1', station: station.id, title: station.title, signature: station.signature, commissioned: false, sourceHash: source.sourceHash,
  signalReport: { kind: 'switch', provenance: 'Växelrapport B1 som i Charlottendal (MGP-korten enligt Bennys monitorering 9 oktober 2026). Ej uppmätt på stationen.' },
  description: `${station.title} ur ${station.source}: källstyrda tågvägar ur LogixNG, signalriktningar ur ankarpunkter och växelben. Fysiska bindningar återstår att verifiera.`,
  transport: station.transport, staleMs: 40000, interrogateMs: 15000, interrogateStepMs: 1000, commandTimeoutMs: 6000, signalStepMs: 300,
  turnouts, blocks, signals, routes, routeAlternatives, coupled, manualPolicies, operatingControls: { lines, programming: null }, buttons,
  panelStyle: { ...(station.panelStyle || {}), localBlocks, localSegments, localTurnouts: [...hiddenTurnouts].sort() },
  sourcePolicy: [...source.mainRoutePolicies, ...source.shuntRoutePolicies], excluded, releasePolicy: 'whole-route-after-ordered-passage-and-stop-feedback' };
const scenario = r => ({ id: r.id, ...(r.variantId ? { variantId: r.variantId } : {}), label: r.label, blocks: r.blocks, signal: r.signals[0], signals: r.signals, signalEntries: r.signalEntries, turnouts: r.turnouts });
const field = { id: station.id + '-independent-network-field', turnouts, blocks, signals, coupled, protection, programming: null, signalReport: { kind: 'switch' },
  scenarios: routes.map(scenario), scenarioAlternatives: routeAlternatives.map(scenario), modules: [],
  note: 'Oberoende anläggningsmodell. Bara LocoNet-telegram tas emot från TKL. Scenarierna är inte TKL:s drifttillstånd.' };
write('profiles/network.json', profile); write('profiles/field.json', field);

// Panelens underlag i data/: NX-knapparnas signaler, signalregistret, informationsfälten och (tomma) vägindikeringar.
const endpoints = [];
for (const a of source.anchors) for (const d of ['eastbound', 'westbound']) if (a[d + 'sensor'] && a[d + 'signalmast']) endpoints.push({ sensor: a[d + 'sensor'], mast: a[d + 'signalmast'] });
for (const e of source.turnoutEnds) if (e.sensor && e.mast) endpoints.push({ sensor: e.sensor, mast: e.mast });
write('data/signal-endpoints.json', { sourceHash: source.sourceHash, endpoints });
write('data/source/signals.json', { signals: xml.signalMasts.map(m => {
  const icon = panel.micons.find(i => i.mast === m.user);
  return { id: m.user, sys: m.system, type: m.type, comment: null, cls: m.virtual ? 'VirtualSignalMastXml' : 'TurnoutSignalMastXml', aspects: m.aspects.map(a => a.name),
    turnoutRefs: [...new Set(m.aspects.map(a => a.turnout))], x: icon?.x ?? null, y: icon?.y ?? null, deg: icon?.deg ?? null };
}) });
const fields = panel.lblocks.map(b => ({ key: 'block:' + b.user, kind: 'block', name: b.user, label: b.user, sourceSystem: null, memorySystem: null, anchors: [] }));
const anchors = panel.bicons.map((b, i) => ({ id: 'block-icon-' + i, key: 'block:' + b.block, block: b.block, x: b.x, y: b.y, sourceHidden: false, duplicate: false }));
for (const a of anchors) fields.find(f => f.key === a.key)?.anchors.push(a.id);
write('data/train-fields.json', { sourceHash: source.sourceHash, fields, anchors });
write('data/indications.json', { sourceHash: source.sourceHash, group: null, indicators: [], note: `${station.title} har inga beräknade vägindikeringar i profilen.` });
// Tågvägstäckningen, som Studio visar: varje NX-par i källan med de tågvägar som använder det, och de undantagna.
write('data/route-coverage.json', { sourceHash: source.sourceHash,
  nx: source.nxPairs.map(n => ({ ...n, routes: routes.filter(r => r.nxIds.includes(n.id)).map(r => r.id) })),
  excluded: excluded.map(e => ({ from: e.from, to: e.to, rules: e.rules || [], nxButtons: e.nxButtons || [], reason: e.reason })) });
console.log(JSON.stringify({ station: station.id, routes: routes.length, main: routes.filter(r => r.kind === 'main').length, shunt: routes.filter(r => r.kind === 'shunt').length,
  alternatives: routeAlternatives.length, excluded: excluded.length, excludedReasons: excluded.map(e => e.from + '→' + e.to + ': ' + e.reason), turnouts: names.length,
  blocks: Object.keys(blocks).length, detected: Object.values(blocks).filter(b => b.address < 3000).length, signals: Object.keys(signals).length, localBlocks, localSegments: localSegments.length }, null, 2));
