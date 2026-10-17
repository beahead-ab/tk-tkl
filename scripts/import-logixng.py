#!/usr/bin/env python3
"""Driftfakta ur en JMRI-fil med LogixNG, utan att köra JMRI eller källans regler.

Charlottendals Cda60.xml har Logix-conditionals och läses av scripts/import-operations.py. Bennys stationer
(Träkvista) har LogixNG: reglerna är socketträd över LogixNGDigitalActions och LogixNGDigitalExpressions. Den här
importören följer träden deterministiskt och skriver samma kontrakt som operations-source.json:

  mainRoutePolicies, shuntRoutePolicies  knapp → knapp med de två NX-knappar regeln vänder (Toggle)
  anchors, turnoutEnds                   signal och NX-sensor per ankarpunkt, växelben och korsningsväxelben
  nxPairs, signalRelations, sensors      NX-par, signalmastlogik, alla sensorer
  detection                              spårledning ← LocoNet-ingång ur gruppen för spårledningar
  tables                                 blocklistorna per tågväg ur stationens CSV-tabeller (kontrollunderlag)

    python3 scripts/import-logixng.py stations/trakvista [--check]

Gruppernas namn och panelens namn står i stationens station.json. Ingenting här aktiverar en funktion.
"""
import argparse, csv, collections, hashlib, json, re, sys
from pathlib import Path
import xml.etree.ElementTree as ET

class Rules:
    def __init__(self, root):
        self.nodes = {}
        for manager in ('LogixNGDigitalActions', 'LogixNGDigitalExpressions'):
            for el in (root.find(manager) if root.find(manager) is not None else []):
                name = el.findtext('systemName')
                if name: self.nodes[name] = el
        self.conditionals = {c.findtext('systemName'): c for c in (root.find('LogixNGConditionalNGs') if root.find('LogixNGConditionalNGs') is not None else []) if c.tag == 'ConditionalNG'}
        self.groups = [g for g in (root.find('LogixNGs') if root.find('LogixNGs') is not None else []) if g.tag == 'LogixNG']

    def children(self, el):
        for part in el:
            sockets = [part] if part.tag == 'Socket' else part.findall('Socket') if part.tag in ('Expressions', 'Actions') else []
            for socket in sockets:
                child = socket.findtext('systemName')
                if child and child in self.nodes: yield child

    def tree(self, name, seen=None):
        """Noderna i trädet i ordning, med djup och väg (vilken socket i IfThenElse)."""
        seen = seen or set(); out = []
        def walk(n, depth, branch):
            if n in seen: return
            seen.add(n); el = self.nodes[n]; out.append((depth, branch, el))
            if el.tag == 'IfThenElse':
                for part in el:
                    for socket in ([part] if part.tag == 'Socket' else part.findall('Socket') if part.tag in ('Expressions', 'Actions') else []):
                        child = socket.findtext('systemName')
                        if child in self.nodes: walk(child, depth + 1, socket.findtext('socketName'))
            else:
                for child in self.children(el): walk(child, depth + 1, branch)
        walk(name, 0, None)
        return out

    def group(self, title):
        g = next((g for g in self.groups if g.findtext('userName') == title), None)
        if g is None: raise SystemExit('LogixNG-gruppen saknas: ' + title)
        return [self.conditionals[s.text] for s in g.find('ConditionalNGs') if s.text in self.conditionals]

def bean(el): return el.findtext('namedBean/name')
def state(el): return el.findtext('state/enum')

def read_table(path):
    with open(path, newline='', encoding='utf-8-sig') as f: return list(csv.DictReader(f))

def build(station_dir, station):
    source = station_dir / station['source']
    raw = source.read_bytes(); root = ET.fromstring(raw); rules = Rules(root)
    editor = next(e for e in root.findall('LayoutEditor') if e.get('name') == station['panel'])
    g = station['groups']

    def first_and_toggles(c):
        nodes = rules.tree(c.findtext('Socket/systemName'))
        # Villkoret: den andra knappen aktiv och minnet med den först tryckta knappen (huvudtågväg), eller två aktiva knappar (växeltågväg).
        pressed = [bean(el) for _, branch, el in nodes if el.tag == 'ExpressionSensor' and state(el) == 'Active' and branch == 'If']
        first = [el.findtext('constant') for _, branch, el in nodes if el.tag == 'ExpressionMemory' and branch == 'If' and el.findtext('memoryOperation') == 'Equal']
        toggles = [bean(el) for _, branch, el in nodes if el.tag == 'ActionSensor' and state(el) == 'Toggle' and (bean(el) or '').startswith('tvs')]
        return pressed, first, toggles

    main = []
    for c in rules.group(g['main']):
        pressed, first, toggles = first_and_toggles(c)
        if len(toggles) != 2: continue                      # TvA tryckt, fellägen och liknande hör till knapphanteringen
        name = c.findtext('userName'); problems = []
        if len(first) != 1 or len(pressed) != 1: problems.append('Regeln har inte exakt en först tryckt och en andra knapp.')
        frm, to = (first[0] if first else None), (pressed[0] if pressed else None)
        expected = '-'.join(x.replace('htvIIIA', 'SpIIIa').replace('htvIIIC', 'SpIIIc').replace('htvIII', 'SpIII').replace('htvII', 'SpII').replace('htvI', 'SpI').replace('htv', '') for x in (frm or '', to or ''))
        if expected != name: problems.append(f'Regelnamnet {name} stämmer inte med knapparna ({expected}).')
        main.append(dict(rule=c.findtext('systemName'), name=name, fromButton=frm, toButton=to, status='unresolved' if problems else 'allowed', nxButtons=toggles, problems=problems))

    nx = [dict(id=d.get('uniqueid'), fromSensor=s.get('item'), toSensor=d.get('item'), type=d.get('nxType'))
          for s in root.findall('./entryexitpairs/layoutPanel/source') for d in s.findall('destination')]
    shunt = []
    for c in rules.group(g['shunt']):
        pressed, _, toggles = first_and_toggles(c)
        name = c.findtext('userName'); problems = []
        # Knapparna i den ordning villkoret läser dem; namnet (vtv3/7:3ö) kontrolleras mot dem. Sensorn för 3ö heter vtv3o.
        buttons = pressed[:2] if len(pressed) >= 2 else []
        m = re.match(r'^vtv(.+):(.+)$', name or '')
        plain = lambda x: x.replace('/', '.').replace('ö', 'o')
        if len(toggles) != 2: problems.append('Exakt två NX-knappar saknas.')
        if not m or len(buttons) != 2 or ['vtv' + plain(x) for x in m.groups()] != buttons: problems.append('Regelnamnet stämmer inte med knapparna i villkoret.')
        ids = [p['id'] for p in nx if toggles and p['fromSensor'] == toggles[0] and p['toSensor'] == toggles[-1]]
        if len(ids) != 1: problems.append('NX-paret är inte entydigt i källan.')
        shunt.append(dict(rule=c.findtext('systemName'), name=name, fromButton=buttons[0] if buttons else None, toButton=buttons[1] if len(buttons) > 1 else None,
            status='unresolved' if problems else 'allowed', nxButtons=toggles, nxIds=ids, problems=problems))

    anchors = [dict(p.attrib) for p in editor.findall('positionablepoint') if any('signal' in k or 'sensor' in k for k in p.attrib)]
    ends = []
    for t in editor.findall('layoutturnout'):
        for leg in 'ABCD':
            mast, sensor = t.findtext('signal' + leg + 'Mast'), t.findtext('sensor' + leg)
            if mast or sensor: ends.append(dict(turnout=t.get('turnoutname'), id=t.get('ident'), leg=leg, mast=mast, sensor=sensor, segment=t.get('connect' + leg.lower() + 'name')))
    for s in editor.findall('layoutSlip'):
        for leg in 'ABCD':
            mast, sensor = s.findtext('signal' + leg + 'Mast'), s.findtext('sensor' + leg)
            if mast or sensor: ends.append(dict(turnout=s.findtext('turnout'), id=s.get('ident'), leg=leg, mast=mast, sensor=sensor, segment=s.get('connect' + leg.lower() + 'name'), slip=True))

    # Stationens rättelser (station.json → corrections): en signal och dess NX-knapp som Benny bett oss flytta. Källfilen
    # lämnas orörd; rättelsen syns i operations-source.json med sin källa.
    corrections = []
    for c in station.get('corrections', []):
        if 'signal' not in c: continue
        frm, to = c['from'], c['to']
        point = next((a for a in anchors if a.get('ident') == frm['point']), None)
        if point is None or point.get(frm['direction'] + 'signalmast') != c['signal'] or point.get(frm['direction'] + 'sensor') != c['sensor']:
            raise SystemExit('Rättelsen stämmer inte längre med källan: ' + c['id'])
        del point[frm['direction'] + 'signalmast'], point[frm['direction'] + 'sensor']
        t = next(t for t in editor.findall('layoutturnout') if t.get('ident') == to['turnout'])
        if t.findtext('signal' + to['leg'] + 'Mast') or t.findtext('sensor' + to['leg']): raise SystemExit('Växelbenet har redan en signal: ' + c['id'])
        ends.append(dict(turnout=t.get('turnoutname'), id=t.get('ident'), leg=to['leg'], mast=c['signal'], sensor=c['sensor'], segment=t.get('connect' + to['leg'].lower() + 'name'), correction=c['id']))
        corrections.append(dict(id=c['id'], source=c['source'], signal=c['signal'], sensor=c['sensor'], moved=f"{frm['point']} {frm['direction']} → {to['turnout']} ben {to['leg']}"))
    anchors = [a for a in anchors if any('signal' in k or 'sensor' in k for k in a if k not in ('class',))]

    detection = []
    for c in rules.group(g['detection']):
        nodes = rules.tree(c.findtext('Socket/systemName'))
        inputs = [bean(el) for _, branch, el in nodes if el.tag == 'ExpressionSensor' and branch == 'If']
        sets = sorted({bean(el) for _, branch, el in nodes if el.tag == 'ActionSensor' and branch == 'Then' and state(el) == 'Active'})
        logic = 'all' if any(el.tag == 'And' for _, branch, el in nodes if branch == 'If') and len(inputs) > 1 else 'any'
        detection.append(dict(rule=c.findtext('systemName'), name=c.findtext('userName'), inputs=inputs, sets=sets, logic=logic))

    relations = [dict(source=s.get('source'), destination=d.get('destination')) for s in root.findall('./signalmastlogics/signalmastlogic') for d in s.findall('destinationMast')]
    sensors = [dict(system=s.findtext('systemName'), name=s.findtext('userName'), comment=s.findtext('comment')) for s in root.findall('./sensors/sensor') if s.findtext('systemName')]
    turnouts = [dict(system=t.findtext('systemName'), name=t.findtext('userName'), feedback=t.get('feedback'), sensors=[t.get('sensor1'), t.get('sensor2')],
                     inverted=t.get('inverted') == 'true', comment=t.findtext('comment')) for t in root.findall('./turnouts/turnout') if t.findtext('systemName')]
    tables = {}
    csv_dir = station_dir / 'csv'
    for f in sorted(csv_dir.glob('*.csv')) if csv_dir.exists() else []:
        rows = read_table(f)
        if rows and 'Block' in rows[0] and 'ShuntingSpeed' in rows[0]: tables[f.stem] = [r['Block'] for r in rows]
    groups = [dict(id=x.findtext('systemName'), name=x.findtext('userName'), enabled=x.get('enabled') == 'yes', conditionals=len(x.find('ConditionalNGs')) if x.find('ConditionalNGs') is not None else 0) for x in rules.groups]
    return dict(sourceHash=hashlib.sha256(raw).hexdigest(), format='logixng', station=station['id'], panel=station['panel'], groups=groups,
                mainRoutePolicies=main, shuntRoutePolicies=shunt, anchors=anchors, turnoutEnds=ends, nxPairs=nx, signalRelations=relations,
                sensors=sensors, turnouts=turnouts, detection=detection, tables=tables, corrections=corrections, verticalEastbound=station.get('verticalEastbound'),
                note='Källfakta ur LogixNG. Importerade regler är inte automatiskt aktiverade funktioner. Adresserna är inte uppmätta.')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('station', type=Path); parser.add_argument('--check', action='store_true'); args = parser.parse_args()
    station = json.loads((args.station / 'station.json').read_text())
    data = build(args.station, station)
    target = args.station / 'data' / 'operations-source.json'; content = json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n'
    if args.check:
        if not target.exists() or target.read_text() != content: raise SystemExit('Stationens driftfakta är inaktuella: ' + str(target))
    else: target.parent.mkdir(parents=True, exist_ok=True); target.write_text(content)
    count = collections.Counter
    print(json.dumps(dict(main=dict(count(r['status'] for r in data['mainRoutePolicies'])), shunt=dict(count(r['status'] for r in data['shuntRoutePolicies'])),
        anchors=len(data['anchors']), turnoutEnds=len(data['turnoutEnds']), nx=len(data['nxPairs']), detection=len(data['detection']), tables=len(data['tables']),
        problems=[(r['name'], r['problems']) for r in data['mainRoutePolicies'] + data['shuntRoutePolicies'] if r['problems']]), ensure_ascii=False))
