#!/usr/bin/env python3
"""Deterministic, complete JMRI source import. Never execute source rules."""
import argparse, collections, hashlib, json
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
CATEGORIES = {
 'signals':'Signaler', 'layoutTurnouts':'Växlar i spårplan', 'turnouts':'Alla växelobjekt',
 'sensors':'Sensorer', 'blocks':'Block', 'layoutBlocks':'Layoutblock', 'memories':'Minnen',
 'signalLogics':'Signalmastlogik', 'signalDestinations':'Signalrelationer', 'logix':'Logikgrupper',
 'conditionals':'Villkor och åtgärder', 'eePairs':'Start- och målpar', 'segments':'Spårsegment',
 'points':'Anslutningspunkter', 'crossings':'Korsningar', 'turntables':'Vändskivor',
 'labels':'Texter', 'sensorIcons':'Sensorindikeringar', 'signalIcons':'Signalikoner',
 'blockIcons':'Blockinnehåll', 'memoryIcons':'Minnesvisning', 'locoIcons':'Lokmarkörer',
 'controlPanel':'Andra panelen · CDA CPE', 'audio':'Ljud', 'settings':'Inställningar och historik'
}
TAGS = {'sensor':'sensors','turnout':'turnouts','memory':'memories','turnoutsignalmast':'signals',
 'virtualsignalmast':'signals','block':'blocks','layoutblock':'layoutBlocks','signalmastlogic':'signalLogics',
 'logix':'logix','conditional':'conditionals','layoutturnout':'layoutTurnouts','tracksegment':'segments',
 'positionablepoint':'points','levelxing':'crossings','layoutturntable':'turntables',
 'positionablelabel':'labels','sensoricon':'sensorIcons','signalmasticon':'signalIcons',
 'BlockContentsIcon':'blockIcons','memoryicon':'memoryIcons','locoicon':'locoIcons'}

def convert(element, location):
    tag = element.tag if isinstance(element.tag,str) else '#comment' if element.tag is ET.Comment else '#processing-instruction'
    counts = collections.Counter(); children = []
    for child in element:
        name = child.tag if isinstance(child.tag,str) else '#comment' if child.tag is ET.Comment else '#processing-instruction'
        counts[name] += 1
        children.append(convert(child, f'{location}/{name}[{counts[name]}]'))
    return dict(path=location, tag=tag, attrs=dict(element.attrib), text=element.text, tail=element.tail, children=children)

def descendants(node):
    yield node
    for child in node['children']: yield from descendants(child)

def value(node, tag):
    return next((c['text'] for c in node['children'] if c['tag']==tag), None)

def name(node):
    a=node['attrs']
    return value(node,'userName') or a.get('userName') or a.get('turnoutname') or a.get('sensor') or a.get('signalmast') or a.get('memory') or a.get('blockcontents') or value(node,'systemName') or a.get('systemName') or a.get('source') or a.get('item') or a.get('name') or a.get('ident') or a.get('text') or node['tag']

def search_text(node):
    return ' '.join(str(v) for n in descendants(node) for v in [n['tag'],*(n['attrs'].keys()),*(n['attrs'].values()),n['text'] or ''] if str(v).strip())

def build(source):
    raw=source.read_bytes()
    parser=ET.XMLParser(target=ET.TreeBuilder(insert_comments=True,insert_pis=True))
    tree=convert(ET.fromstring(raw,parser=parser),'/layout-config[1]')
    nodes=list(descendants(tree)); records=[]
    # Charlottendals äldre adminanteckningar knyts till posterna; en annan stations fil har inga.
    legacy=json.loads((ROOT/'public/data/admin.json').read_text()) if source.name=='Cda60.xml' else {}
    previous=collections.defaultdict(collections.deque)
    for kind in ['signals','layoutTurnouts','turnouts','sensors','blocks','layoutBlocks','conditionals']:
        for i,obj in enumerate(legacy.get(kind,[])):
            identity=obj.get('sys') or (obj.get('id') if kind=='conditionals' else obj.get('id') or obj.get('name'))
            previous[(kind,identity)].append(f'{kind}:{i}')
    def add(node,category,title=None,context=None,recursive=True):
        system=value(node,'systemName') or node['attrs'].get('systemName') or ''
        title=title or name(node)
        identity=system or title
        old=previous[(category,identity)]
        record=dict(key=hashlib.sha256(node['path'].encode()).hexdigest()[:20],category=category,path=node['path'],name=title,
                    system=system,element=node['tag'],comment=value(node,'comment') or '',context=context or '',
                    search=search_text(node) if recursive else ' '.join([title,node['path'],node['text'] or '',*node['attrs'].keys(),*node['attrs'].values()]))
        if old: record['noteKey']=old.popleft()
        records.append(record)
    add(tree,'settings','Dokument och XML-rot',recursive=False)
    for section in tree['children']:
        add(section,'settings',section['tag']+' · '+str(section['attrs'].get('name') or section['attrs'].get('class','').split('.')[-1]),recursive=False)
        for node in section['children']:
            if section['tag']=='paneleditor': add(node,'controlPanel',context='CDA CPE')
            elif section['tag']=='audio': add(node,'audio')
            elif node['tag'] in TAGS: add(node,TAGS[node['tag']])
            elif section['tag']!='entryexitpairs': add(node,'settings',context=section['tag'])
        if section['tag']=='entryexitpairs':
            for panel in section['children']:
                if panel['tag']!='layoutPanel': add(panel,'settings',context='entryexitpairs'); continue
                for start in panel['children']:
                    for target in start['children']:
                        if target['tag']=='destination': add(target,'eePairs',f"{start['attrs'].get('item','?')} → {target['attrs'].get('item','?')}",json.dumps(dict(panel=panel['attrs'],source=start['attrs']),ensure_ascii=False))
        if section['tag']=='signalmastlogics':
            for logic in section['children']:
                for target in logic['children']:
                    if target['tag']=='destinationMast': add(target,'signalDestinations',f"{logic['attrs'].get('source','?')} → {target['attrs'].get('destination','?')}",logic['path'])
    node_by_path={n['path']:n for n in nodes}
    aliases=collections.defaultdict(set)
    for record in records:
        if record['category']=='settings': continue
        node=node_by_path[record['path']]
        for alias in [record['name'],record['system'],node['attrs'].get('ident')]:
            if alias: aliases[alias].add(record['key'])
    for record in records:
        if record['category']=='settings': continue
        refs=set()
        for node in descendants(node_by_path[record['path']]):
            for candidate in [*node['attrs'].values(),node['text'] or '']:
                refs.update(aliases.get(candidate.strip(),[]))
        record['refs']=sorted(refs-{record['key']})
    counts=collections.Counter(r['category'] for r in records)
    meta=dict(file=source.name,sha256=hashlib.sha256(raw).hexdigest(),bytes=len(raw),nodeCount=len(nodes),attributeCount=sum(len(n['attrs']) for n in nodes),
              sectionCount=sum(not n['tag'].startswith('#') for n in tree['children']),recordCount=len(records),sections=[dict(path=n['path'],tag=n['tag'],attributes=n['attrs'],children=len(n['children'])) for n in tree['children'] if not n['tag'].startswith('#')],
              categories=[dict(key=k,label=v,count=counts[k]) for k,v in CATEGORIES.items()],
              status='Komplett källimport. Importerade JMRI-regler körs inte automatiskt av TKL-kärnan.')
    return dict(meta=meta,records=records),tree

def enriched_admin(index, tree):
    admin=json.loads((ROOT/'public/data/admin.json').read_text())
    nodes={n['path']:n for n in descendants(tree)}
    for record in index['records']:
        if 'noteKey' not in record: continue
        kind,position=record['noteKey'].split(':')
        item=admin[kind][int(position)]; node=nodes[record['path']]
        item['sourcePath']=record['path']; item['sourceKey']=record['key']
        item['sourceAttributes']=node['attrs']
        if kind=='conditionals':
            item['vars']=[dict(n=c['attrs'].get('systemName'),op=c['attrs'].get('operator'),neg=c['attrs'].get('negated'),**c['attrs']) for c in node['children'] if c['tag']=='conditionalStateVariable']
            item['acts']=[dict(n=c['attrs'].get('systemName'),**c['attrs']) for c in node['children'] if c['tag']=='conditionalAction']
    return admin

def main():
    # Utan argument: Charlottendals Cda60.xml i public/data/source. --source och --out: en annan stations JMRI-fil, till
    # exempel stations/trakvista/Trakvista.xml till stations/trakvista/data/source (bara index.json och tree.json).
    parser=argparse.ArgumentParser(); parser.add_argument('--check',action='store_true'); parser.add_argument('--source'); parser.add_argument('--out')
    args=parser.parse_args()
    if args.source:
        source=(Path.cwd()/args.source).resolve(); out=(Path.cwd()/(args.out or source.parent)).resolve(); index,tree=build(source)
        files=[('index.json',index),('tree.json',tree)]
    else:
        source=ROOT/'public/data/source/Cda60.xml'; out=source.parent; index,tree=build(source)
        files=[('index.json',index),('tree.json',tree),('../admin.json',enriched_admin(index,tree)),('signals.json',dict(signals=enriched_admin(index,tree)['signals']))]
    for file,data in files:
        content=json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n'; target=out/file
        if args.check:
            if target.read_text()!=content: raise SystemExit(f'Stale source import: {file}')
        else: target.write_text(content)
    print(json.dumps(index['meta'],ensure_ascii=False,indent=2))
if __name__=='__main__': main()
