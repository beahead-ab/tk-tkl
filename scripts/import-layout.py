#!/usr/bin/env python3
"""Spårplan ur JMRI:s LayoutEditor, utan att köra JMRI eller källans regler.

Läser en JMRI-panelfil (layout-config) och skriver samma struktur som public/data/panel.json:
segment med beräknade ändpunkter, växlar, korsningar, vändskiva, texter, sensor-, signal-, block- och
minnesikoner, layoutblock och namntabeller. Geometrin är JMRI:s egen; ingen adress gissas.

    python3 scripts/import-layout.py public/data/source/Cda60.xml --compare public/data/panel.json
    python3 scripts/import-layout.py <Träkvista.xml> --panel Träkvista --out <panel.json>

Charlottendals panel.json kom från den ursprungliga designexporten; --compare visar att den här
konverteraren ger samma geometri, så att en annan stations ritning kan tas in samma väg.
"""
import argparse, collections, hashlib, json, math, re, sys
from pathlib import Path
import xml.etree.ElementTree as ET

ICON_PREFIX = re.compile(r'^(?:preference|program):resources/icons/')

def num(value):
    if value is None: return None
    f = float(value)
    return int(f) if f.is_integer() else f

def yes(value): return value == 'yes'

def color(el, prefix=''):
    return {prefix + 'r': num(el.get(prefix + 'red')) if prefix else num(el.get('red')),
            prefix + 'g': num(el.get(prefix + 'green')) if prefix else num(el.get('green')),
            prefix + 'b': num(el.get(prefix + 'blue')) if prefix else num(el.get('blue'))}

def icon_path(url): return ICON_PREFIX.sub('', url) if url else None

def mast_type(system):
    m = re.match(r'^IF\$[a-z]+:[^:]+:([^(]+)\(', system or '')
    return m.group(1) if m else None

class Layout:
    def __init__(self, root, panel_name=None):
        editors = root.findall('LayoutEditor')
        if not editors: raise SystemExit('Filen har ingen LayoutEditor-panel.')
        self.editor = next((e for e in editors if e.get('name') == panel_name), None) if panel_name else editors[0]
        if self.editor is None: raise SystemExit('Panelen saknas: ' + panel_name + '. Finns: ' + ', '.join(e.get('name') for e in editors))
        self.root = root
        e = self.editor
        self.points = {p.get('ident'): p for p in e.findall('positionablepoint')}
        self.turnouts = {t.get('ident'): t for t in e.findall('layoutturnout')}
        self.slips = {s.get('ident'): s for s in e.findall('layoutSlip')}
        self.xings = {x.get('ident'): x for x in e.findall('levelxing')}
        self.turntables = {t.get('ident'): t for t in e.findall('layoutturntable')}
        self.sensor_user = {}; self.sensor_sys = {}
        for s in root.findall('./sensors/sensor'):
            sys_, user = s.findtext('systemName'), s.findtext('userName')
            if sys_: self.sensor_user[sys_] = user; 
            if user: self.sensor_sys[user] = sys_
        self.masts = {}
        for m in root.findall('./signalmasts/*'):
            user = m.findtext('userName'); sys_ = m.findtext('systemName')
            if user: self.masts[user] = m
            if sys_: self.masts.setdefault(sys_, m)

    # Ändpunkten för en anslutning, som JMRI ritar den.
    def coords(self, name, kind):
        if kind == 'POS_POINT':
            p = self.points.get(name)
            return (num(p.get('x')), num(p.get('y'))) if p is not None else (None, None)
        m = re.match(r'^TURNOUT_([ABCD])$', kind)
        if m:
            t = self.turnouts.get(name)
            if t is None: return (None, None)
            leg = m.group(1).lower()
            return (num(t.get('x' + leg)), num(t.get('y' + leg)))
        m = re.match(r'^SLIP_([ABCD])$', kind)
        if m:
            s = self.slips.get(name)
            if s is None: return (None, None)
            cx, cy = num(s.get('xcen')), num(s.get('ycen'))
            ax, ay, bx, by = (num(s.get(k)) for k in ('xa', 'ya', 'xb', 'yb'))
            return {'A': (ax, ay), 'B': (bx, by), 'C': (2 * cx - ax, 2 * cy - ay), 'D': (2 * cx - bx, 2 * cy - by)}[m.group(1)]
        m = re.match(r'^LEVEL_XING_([ABCD])$', kind)
        if m:
            # Panelen ritar ingen egen korsning: segmenten möts i korsningens centrum, som i designexporten. Armarna sparas i xings.
            x = self.xings.get(name)
            if x is None: return (None, None)
            return (num(x.get('xcen')), num(x.get('ycen')))
        m = re.match(r'^TURNTABLE_RAY_(\d+)$', kind)
        if m:
            t = self.turntables.get(name)
            if t is None: return (None, None)
            ray = next((r for r in t.findall('raytrack') if r.get('index') == m.group(1)), None)
            if ray is None: return (None, None)
            cx, cy, r, a = float(t.get('xcen')), float(t.get('ycen')), float(t.get('radius')), math.radians(float(ray.get('angle')))
            return (num(cx + r * math.sin(a)), num(cy - r * math.cos(a)))
        return (None, None)

    def build(self, source_hash):
        e = self.editor; notes = collections.OrderedDict()
        segs = []
        for s in e.findall('tracksegment'):
            x1, y1 = self.coords(s.get('connect1name'), s.get('type1')); x2, y2 = self.coords(s.get('connect2name'), s.get('type2'))
            if None in (x1, y1, x2, y2): notes.setdefault('unresolvedSegments', []).append(s.get('ident'))
            segs.append(dict(id=s.get('ident'), x1=x1, y1=y1, x2=x2, y2=y2, b=s.get('blockname'), m=yes(s.get('mainline')), d=yes(s.get('dashed')),
                             c1=s.get('connect1name'), t1=s.get('type1'), c2=s.get('connect2name'), t2=s.get('type2'), hide=yes(s.get('hidden'))))
            if yes(s.get('arc')) or yes(s.get('bezier')): notes.setdefault('curvedSegmentsDrawnStraight', []).append(s.get('ident'))
        turnouts = {}
        for ident, t in self.turnouts.items():
            turnouts[ident] = dict(type=t.get('type'), name=t.get('turnoutname'), name2=t.get('secondturnoutname'), block=t.get('blockname'),
                blockb=t.get('blockbname'), blockc=t.get('blockcname'), blockd=t.get('blockdname'), continuing=num(t.get('continuing')),
                cx=num(t.get('xcen')), cy=num(t.get('ycen')), ax=num(t.get('xa')), ay=num(t.get('ya')), bx=num(t.get('xb')), by=num(t.get('yb')),
                ccx=num(t.get('xc')), ccy=num(t.get('yc')), dx=num(t.get('xd')), dy=num(t.get('yd')),
                ca=t.get('connectaname'), cb=t.get('connectbname'), cc=t.get('connectcname'), cd=t.get('connectdname'), hidden=t.get('hidden'))
        slips = {}
        for ident, s in self.slips.items():
            cx, cy = num(s.get('xcen')), num(s.get('ycen')); ax, ay, bx, by = (num(s.get(k)) for k in ('xa', 'ya', 'xb', 'yb'))
            states = {st.tag: {'turnout': num(st.findtext('turnout')), 'turnoutB': num(st.findtext('turnoutB'))} for st in s.findall('states/*')}
            slips[ident] = dict(type=s.get('slipType'), name=s.findtext('turnout'), name2=s.findtext('turnoutB'), block=s.get('blockname'),
                cx=cx, cy=cy, ax=ax, ay=ay, bx=bx, by=by, ccx=2 * cx - ax, ccy=2 * cy - ay, dx=2 * cx - bx, dy=2 * cy - by,
                ca=s.get('connectaname'), cb=s.get('connectbname'), cc=s.get('connectcname'), cd=s.get('connectdname'), hidden=s.get('hidden'),
                states=states, signals={k[6]: s.findtext(k) for k in ('signalAMast', 'signalBMast', 'signalCMast', 'signalDMast') if s.findtext(k)},
                sensors={k[6]: s.findtext(k) for k in ('sensorA', 'sensorB', 'sensorC', 'sensorD') if s.findtext(k)})
        xings = {}
        for ident, x in self.xings.items():
            cx, cy = num(x.get('xcen')), num(x.get('ycen')); ax, ay, bx, by = (num(x.get(k)) for k in ('xa', 'ya', 'xb', 'yb'))
            xings[ident] = dict(cx=cx, cy=cy, bac=x.get('blocknameac'), bbd=x.get('blocknamebd'), ca=x.get('connectaname'), cb=x.get('connectbname'),
                                cc=x.get('connectcname'), cd=x.get('connectdname'), ax=ax, ay=ay, bx=bx, by=by, ccx=2 * cx - ax, ccy=2 * cy - ay, dx=2 * cx - bx, dy=2 * cy - by)
        turntables = [dict(id=ident, cx=num(t.get('xcen')), cy=num(t.get('ycen')), r=num(t.get('radius')),
                           rays=[dict(angle=num(r.get('angle')), connect=r.get('connectname'), index=num(r.get('index'))) for r in t.findall('raytrack')]) for ident, t in self.turntables.items()]
        labels = [dict(text=l.get('text'), x=num(l.get('x')), y=num(l.get('y')), size=num(l.get('size')), style=num(l.get('style')), hidden=yes(l.get('hidden')),
                       **color(l), just=l.get('justification'), **(dict(br=num(l.get('redBack')), bg=num(l.get('greenBack')), bb=num(l.get('blueBack'))) if yes(l.get('hasBackground')) else {}))
                  for l in e.findall('positionablelabel')]
        sicons = []
        for s in e.findall('sensoricon'):
            act, inact = s.find('active'), s.find('inactive')
            sicons.append(dict(sensor=s.get('sensor'), x=num(s.get('x')), y=num(s.get('y')), momentary=s.get('momentary') == 'true', hidden=yes(s.get('hidden')),
                act=icon_path(act.get('url')) if act is not None else None, inact=icon_path(inact.get('url')) if inact is not None else None,
                deg=num(act.get('degrees')) if act is not None else 0, scale=num(act.get('scale')) if act is not None else 1))
        micons = []
        for m in e.findall('signalmasticon'):
            mast = self.masts.get(m.get('signalmast'))
            micons.append(dict(mast=m.get('signalmast'), type=mast_type(mast.findtext('systemName')) if mast is not None else None,
                               x=num(m.get('x')), y=num(m.get('y')), deg=num(m.get('degrees')), scale=num(m.get('scale')), imageset=m.get('imageset')))
        bicons = [dict(block=b.get('blockcontents'), x=num(b.get('x')), y=num(b.get('y')), size=num(b.get('size')), **color(b)) for b in e.findall('BlockContentsIcon')]
        memicons = [dict(mem=m.get('memory'), x=num(m.get('x')), y=num(m.get('y')), **{'def': None}, size=num(m.get('size')), **color(m),
                         br=None, bg=None, bb=None) for m in e.findall('memoryicon')]
        lblocks = []
        for b in self.root.findall('./layoutblocks/layoutblock'):
            sensor = b.get('occupancysensor')
            lblocks.append(dict(user=b.findtext('userName'), sensor=self.sensor_user.get(sensor) or sensor))
        masts = [dict(sys=m.findtext('systemName'), user=m.findtext('userName')) for m in self.root.findall('./signalmasts/*') if m.findtext('systemName')]
        tdefs = [dict(sys=t.findtext('systemName'), user=t.findtext('userName')) for t in self.root.findall('./turnouts/turnout') if t.findtext('systemName') and t.findtext('userName')]
        sensors = [dict(sys=s.findtext('systemName'), user=s.findtext('userName')) for s in self.root.findall('./sensors/sensor') if s.findtext('systemName')]
        aspects = collections.OrderedDict()
        for m in self.root.findall('./signalmasts/turnoutsignalmast'):
            kind = mast_type(m.findtext('systemName'))
            disabled = {d.text for d in m.findall('disabledAspects/disabledAspect')}
            for a in m.findall('aspect'):
                name = a.get('defines')
                if name in disabled: continue
                lst = aspects.setdefault(kind, [])
                if name not in lst: lst.append(name)
        inverted = [t.findtext('userName') or t.findtext('systemName') for t in self.root.findall('./turnouts/turnout') if t.get('inverted') == 'true']
        prefixes = sorted({re.match(r'^[A-Z0-9]*?[A-Z]+(?=\d)', t['sys']).group(0) for t in tdefs if re.match(r'^[A-Z0-9]*?[A-Z]+(?=\d)', t['sys'])})
        importNotes = dict(invertedTurnouts=inverted, sourcePrefixes=prefixes, panel=e.get('name'), jmriVersion='.'.join(self.root.findtext('jmriversion/' + k) or '' for k in ('major', 'minor', 'test')),
                           sourceHash=source_hash, otherPanels=[x.get('name') for x in self.root.findall('LayoutEditor') if x is not self.editor],
                           edgeConnectors=[dict(id=p.get('ident'), linkedPanel=p.get('linkedpanel'), linkPoint=p.get('linkpointid')) for p in self.points.values() if p.get('type') == 'EDGE_CONNECTOR'],
                           **notes)
        return dict(w=num(e.get('panelwidth')), h=num(e.get('panelheight')), segs=segs, turnouts=turnouts, slips=slips, xings=xings,
                    turntable=turntables[0] if turntables else None, turntables=turntables, labels=labels, sicons=sicons, micons=micons, bicons=bicons,
                    memicons=memicons, lblocks=lblocks, masts=masts, tdefs=tdefs, sensors=sensors, aspectsByType=aspects, importNotes=importNotes)

def compare(ours, theirs):
    """Fältvis jämförelse mot en befintlig panel.json. Nycklar som bara finns hos oss räknas inte som avvikelser."""
    report = []
    def rows(name, a, b, key):
        A = {key(x): x for x in a}; B = {key(x): x for x in b}
        missing = [k for k in B if k not in A]; extra = [k for k in A if k not in B]
        diffs = []
        for k in B:
            if k not in A: continue
            for field, value in B[k].items():
                mine = A[k].get(field)
                if isinstance(value, float) or isinstance(mine, float):
                    same = mine is not None and value is not None and abs(float(mine) - float(value)) < 1e-6
                else: same = mine == value
                if not same: diffs.append((k, field, value, mine))
        report.append(f'{name}: {len(A)} hos oss, {len(B)} i filen; saknas {len(missing)}, extra {len(extra)}, fältavvikelser {len(diffs)}')
        for k in missing[:8]: report.append(f'  saknas: {k}')
        for k in extra[:8]: report.append(f'  extra: {k}')
        for d in diffs[:12]: report.append(f'  avvikelse {d[0]} {d[1]}: filen {d[2]!r}, vi {d[3]!r}')
        return not missing and not diffs
    ok = True
    ok &= ours['w'] == theirs['w'] and ours['h'] == theirs['h']; report.append(f"storlek: {ours['w']}×{ours['h']} mot {theirs['w']}×{theirs['h']}")
    ok &= rows('segs', ours['segs'], theirs['segs'], lambda s: s['id'])
    ok &= rows('turnouts', [dict(id=k, **v) for k, v in ours['turnouts'].items()], [dict(id=k, **v) for k, v in theirs['turnouts'].items()], lambda t: t['id'])
    ok &= rows('xings', [dict(id=k, **v) for k, v in ours['xings'].items()], [dict(id=k, **v) for k, v in theirs['xings'].items()], lambda t: t['id'])
    ok &= rows('turntable', [ours['turntable']] if ours['turntable'] else [], [theirs['turntable']] if theirs.get('turntable') else [], lambda t: t['id'])
    # Texterna avgör inte utfallet: designexporten tog bort 16 dekorativa texter och dolde sju växelnummer för hand.
    rows('labels (rapporteras, avgör inte)', ours['labels'], theirs['labels'], lambda l: (l['text'], l['x'], l['y']))
    ok &= rows('sicons', ours['sicons'], theirs['sicons'], lambda s: (s['sensor'], s['x'], s['y']))
    ok &= rows('micons', ours['micons'], theirs['micons'], lambda s: s['mast'])
    ok &= rows('bicons', ours['bicons'], theirs['bicons'], lambda s: (s['block'], s['x'], s['y']))
    ok &= rows('memicons', ours['memicons'], theirs['memicons'], lambda s: (s['mem'], s['x'], s['y']))
    ok &= rows('lblocks', ours['lblocks'], theirs['lblocks'], lambda s: s['user'])
    ok &= rows('masts', ours['masts'], theirs['masts'], lambda s: s['sys'])
    ok &= rows('tdefs', ours['tdefs'], theirs['tdefs'], lambda s: s['sys'])
    ok &= rows('sensors', ours['sensors'], theirs['sensors'], lambda s: s['sys'])
    same_aspects = ours['aspectsByType'] == theirs.get('aspectsByType'); ok &= same_aspects
    report.append('aspectsByType: ' + ('lika' if same_aspects else f"olika: {json.dumps(ours['aspectsByType'], ensure_ascii=False)[:300]} mot {json.dumps(theirs.get('aspectsByType'), ensure_ascii=False)[:300]}"))
    return ok, report

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('source', type=Path); parser.add_argument('--panel', help='LayoutEditor-panelens namn (standard: den första)')
    parser.add_argument('--out', type=Path); parser.add_argument('--compare', type=Path, help='befintlig panel.json att jämföra med')
    parser.add_argument('--check', action='store_true', help='med --out: kontrollera att filen är aktuell i stället för att skriva den')
    parser.add_argument('--station', type=Path, help='stationens station.json: dess rättelser flyttar ikoner (signal, knapp, text)')
    args = parser.parse_args()
    raw = args.source.read_bytes(); root = ET.fromstring(raw)
    panel = Layout(root, args.panel).build(hashlib.sha256(raw).hexdigest())
    if args.station:
        station = json.loads(args.station.read_text())
        for c in station.get('corrections', []):
            icons, applied = c.get('icons', {}), []
            for key, items, match in (('signal', panel['micons'], lambda i, v: i['mast'] == v['mast']), ('button', panel['sicons'], lambda i, v: i['sensor'] == v['sensor']),
                                      ('label', panel['labels'], lambda i, v: i['text'] == v['text'])):
                if key not in icons: continue
                found = [i for i in items if match(i, icons[key])]
                if len(found) != 1: raise SystemExit(f"Rättelsen {c['id']}: {key} finns inte exakt en gång i panelen.")
                found[0].update({k: v for k, v in icons[key].items() if k in ('x', 'y', 'deg')}); applied.append(key)
            panel['importNotes'].setdefault('corrections', []).append(dict(id=c['id'], icons=applied, source=c.get('source')))
    summary = dict(panel=panel['importNotes']['panel'], jmri=panel['importNotes']['jmriVersion'], size=[panel['w'], panel['h']], segs=len(panel['segs']), turnouts=len(panel['turnouts']),
                   slips=len(panel['slips']), xings=len(panel['xings']), turntables=len(panel['turntables']), labels=len(panel['labels']), sicons=len(panel['sicons']),
                   micons=len(panel['micons']), lblocks=len(panel['lblocks']), masts=len(panel['masts']), tdefs=len(panel['tdefs']), sensors=len(panel['sensors']),
                   otherPanels=panel['importNotes']['otherPanels'], unresolvedSegments=len(panel['importNotes'].get('unresolvedSegments', [])))
    print(json.dumps(summary, ensure_ascii=False))
    if args.out:
        content = json.dumps(panel, ensure_ascii=False, separators=(',', ':')) + '\n'
        if args.check:
            if not args.out.exists() or args.out.read_text() != content: raise SystemExit('Inaktuell spårplan: ' + str(args.out))
        else: args.out.parent.mkdir(parents=True, exist_ok=True); args.out.write_text(content); print('skrev', args.out)
    if args.compare:
        ok, report = compare(panel, json.loads(args.compare.read_text()))
        print('\n'.join(report)); print('JÄMFÖRELSE:', 'samma geometri' if ok else 'avvikelser finns')
        sys.exit(0 if ok else 1)
