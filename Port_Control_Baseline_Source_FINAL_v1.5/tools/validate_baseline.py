import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator
from validation_common import *
root=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[1]
cfg=root/'src/config'; sch=root/'schemas'; errors=[]
def err(x): errors.append(x)
def schema_check(data,schema,label):
    for e in Draft202012Validator(load(schema)).iter_errors(load(data)):
        err(f"{label}: schema {'.'.join(map(str,e.absolute_path))}: {e.message}")
mapping=[('ships.json','ships.schema.json'),('balance.json','balance.schema.json'),('ports.json','ports.schema.json'),('challenges.json','challenges.schema.json'),('events.json','events.schema.json'),('upgrades.json','upgrades.schema.json'),('perks.json','perks.schema.json'),('assets.catalog.json','assets.schema.json'),('audio.json','audio.schema.json'),('editor_blocks.json','editor_blocks.schema.json'),('modes.json','modes.schema.json'),('meta_layouts.json','meta_layouts.schema.json'),('platform.json','platform.schema.json'),('screen_flow.json','screen_flow.schema.json'),('analytics_events.json','analytics_events.schema.json'),('profile.default.json','profile.schema.json'),('localization/ru.json','localization.schema.json'),('localization/en.json','localization.schema.json'),('localization.required_keys.json','localization_keys.schema.json'),('levels.semantic_manifest.json','semantic_manifest.schema.json')]
for f,s in mapping: schema_check(cfg/f,sch/s,f)
level_schema=load(sch/'level.schema.json'); levels={}
for p in sorted((cfg/'levels').glob('*.json')):
    for e in Draft202012Validator(level_schema).iter_errors(load(p)):
        err(f"{p.name}: schema {'.'.join(map(str,e.absolute_path))}: {e.message}")
    d=load(p); levels[d['id']]=d
ships=load(cfg/'ships.json')['ships']; ports=load(cfg/'ports.json')['ports']; upgrades=load(cfg/'upgrades.json')['upgrades']; perks=load(cfg/'perks.json')['perks']; assets=load(cfg/'assets.catalog.json')['assets']; ed=load(cfg/'editor_blocks.json'); ru=load(cfg/'localization/ru.json')['strings']; en=load(cfg/'localization/en.json')['strings']; req=load(cfg/'localization.required_keys.json')['keys']; platform=load(cfg/'platform.json'); screen_flow=load(cfg/'screen_flow.json'); analytics=load(cfg/'analytics_events.json'); audio=load(cfg/'audio.json')
if len(levels)!=40: err(f'expected 40 levels, found {len(levels)}')
idx=load(cfg/'levels.index.json')['levels']; ids=[x['id'] for x in idx]
if set(ids)!=set(levels) or len(ids)!=len(set(ids)): err('levels.index mismatch/duplicates')
if sorted(d['order'] for d in levels.values())!=list(range(1,41)): err('level order must be 1..40')
# exact i18n
if set(ru)!=set(en) or set(ru)!=set(req): err('RU/EN/required-key parity mismatch')
# coordinate/editor fixed conventions
cr=ed['coordinateRules']
expected={'worldOrigin':'top_left','positiveX':'right','positiveY':'down','rotationZeroDeg':'positive_x_right','positiveRotation':'clockwise','canonicalPolygonWinding':'visual_clockwise','defaultGridSnapLogicalUnits':10,'defaultRotationSnapDeg':15,'coarseRotationSnapDeg':90}
for k,v in expected.items():
    if cr.get(k)!=v: err(f'editor coordinate rule {k} != {v}')
used=set()
for lid,d in levels.items():
    pid=d['portId'];
    if pid not in ports: err(f'{lid}: unknown port {pid}')
    # director inequalities
    dr=d['director']; w=dr['wave']
    if dr['startInterval'] < dr['minimumInterval']: err(f'{lid}: startInterval < minimumInterval')
    if w['burstMax'] < w['burstMin']: err(f'{lid}: burstMax < burstMin')
    if w['breathMax'] < w['breathMin']: err(f'{lid}: breathMax < breathMin')
    if d.get('shipWeights') and sum(d['shipWeights'].values())<=0: err(f'{lid}: shipWeights sum <=0')
    if sum(d['cargoGeneration']['weights'].values())<=0: err(f'{lid}: cargo weights sum <=0')
    blocks=d['layout']['blocks']; b_ids=[b['id'] for b in blocks]
    if len(b_ids)!=len(set(b_ids)): err(f'{lid}: duplicate block IDs')
    docks=[]; spawns=[]; exits=[]
    for b in blocks:
        used.add(b['blockType']); bt=b['blockType']; pr=b['props']
        if not (0 <= b['rotation'] < 360): err(f'{lid}:{b["id"]}: rotation not [0,360)')
        if bt=='dock': docks.append(b)
        if bt=='spawn_point': spawns.append(b)
        if bt=='exit_zone': exits.append(b)
        if 'assetKey' in pr and pr['assetKey'] not in assets: err(f'{lid}:{b["id"]}: missing assetKey')
        if 'visualVariant' in pr and pr['visualVariant'] not in assets: err(f'{lid}:{b["id"]}: missing visualVariant')
        if bt in ('navigation_zone','shore_polygon','current_zone'):
            pts=pr['points']
            if len({tuple(x) for x in pts}) != len(pts): err(f'{lid}:{b["id"]}: duplicate polygon vertex')
            if signed_area(pts)<=0: err(f'{lid}:{b["id"]}: polygon must be visual-clockwise (positive screen-coordinate area)')
            if self_intersects(pts): err(f'{lid}:{b["id"]}: self-intersecting polygon')
            xs=[x[0] for x in pts]; ys=[x[1] for x in pts]; cx=(min(xs)+max(xs))/2; cy=(min(ys)+max(ys))/2
            if abs(b['x']-cx)>1e-6 or abs(b['y']-cy)>1e-6: err(f'{lid}:{b["id"]}: polygon x/y != bbox center')
        if bt=='storm_path':
            if [b['x'],b['y']] != pr['waypoints'][0]: err(f'{lid}:{b["id"]}: path x/y != first waypoint')
        if bt in ('exit_zone','fog_zone'):
            hw=pr['width']/2; hh=pr['height']/2
            if b['x']-hw<0 or b['x']+hw>1000 or b['y']-hh<0 or b['y']+hh>1000: err(f'{lid}:{b["id"]}: rect extents outside world')
    if not spawns: err(f'{lid}: no spawn')
    if not exits: err(f'{lid}: no exit')
    if sum(float(b['props'].get('weight',1)) for b in spawns if b.get('enabled',True))<=0: err(f'{lid}: spawn weights sum <=0')
    for sid in d['allowedShips']:
        if sid not in ships: err(f'{lid}: unknown ship {sid}')
    for ct in d['cargoTypes']:
        if not any(ct in x['props']['cargoTypes'] for x in docks if x.get('enabled',True)): err(f'{lid}: no dock accepts {ct}')
    for st in d['starConditions']:
        if 'shipId' in st and st['shipId'] not in d['allowedShips']: err(f'{lid}: star shipId not allowed')
        for sid in st.get('shipIds',[]):
            if sid not in d['allowedShips']: err(f'{lid}: star shipIds contains non-allowed ship')
# editor registry exactly supports used runtime block types
if not used.issubset(ed['blocks']): err(f'editor registry missing {sorted(used-set(ed["blocks"]))}')
# port refs, access gates, localization, assets
for pid,p in ports.items():
    if p['displayNameKey'] not in ru: err(f'{pid}: missing localization')
    if p['assetBundleKey'] not in assets: err(f'{pid}: missing asset bundle')
    for u in p['localUpgrades']:
        if u not in upgrades: err(f'{pid}: unknown upgrade {u}')
    for pool in p['chapterPerkPools']:
        for q in pool:
            if q not in perks: err(f'{pid}: unknown perk {q}')
    for st in p.get('visualStages',[]):
        for uid in st.get('requiredUpgrades',[]):
            if uid not in upgrades: err(f'{pid}: visual stage {st.get("id")} references unknown upgrade {uid}')
        if st.get('minOwnedUpgrades',0) > len(p.get('localUpgrades',[])): err(f'{pid}: visual stage minOwnedUpgrades exceeds local upgrade count')
    for lid,reqs in p.get('levelGates',{}).items():
        for uid in reqs:
            u=upgrades[uid]
            if u['family']=='access' and u['applyPortMultiplier']: err(f'{pid}:{lid}: mandatory access gate {uid} must be fixed-price/no multiplier')
            if u['baseCosts'][0] > 2000: err(f'{pid}:{lid}: mandatory access gate {uid} exceeds 2000 baseline safety cap')
# upgrades shapes/loc
for uid,u in upgrades.items():
    if len(u['baseCosts'])!=u['maxLevel']: err(f'{uid}: baseCosts length != maxLevel')
    vals=u['effect'].get('values')
    if vals is not None and len(vals) not in (1,u['maxLevel']): err(f'{uid}: effect values length mismatch')
    if u['nameKey'] not in ru or u['descKey'] not in ru: err(f'{uid}: missing localization')
for perk_id,p in perks.items():
    if p['nameKey'] not in ru or p['descKey'] not in ru: err(f'{perk_id}: missing localization')
    comp=p.get('compatibility',{})
    uid=comp.get('requiresUpgradeNotOwned')
    if uid is not None and uid not in upgrades: err(f'{perk_id}: requiresUpgradeNotOwned references unknown upgrade {uid}')
# Perk choice must always have at least 2 compatible non-active candidates.
# Conservative check treats requiresUpgradeNotOwned perks as potentially unavailable.
for port_id,port in ports.items():
    states={frozenset()}
    for chapter_i,pool in enumerate(port['chapterPerkPools'],1):
        next_states=set()
        for active in states:
            candidates=[q for q in pool if q not in active and not perks[q].get('compatibility',{}).get('requiresUpgradeNotOwned')]
            if len(candidates)<2:
                err(f'{port_id}: chapter {chapter_i} can have <2 compatible non-active perk candidates; active={sorted(active)} candidates={candidates}')
            for q in candidates:
                next_states.add(frozenset(set(active)|{q}))
        states=next_states
# asset metadata pre-production contract
for aid,a in assets.items():
    for k in ('path','sourceSize','density','pivot','preloadGroup','deliveryStatus','requiredForRelease'):
        if k not in a: err(f'asset {aid}: missing {k}')
# platform release contract
if platform['auth']['unlockAfterLevel'] not in levels: err('platform auth unlockAfterLevel unknown')
if platform['releaseFeatures']['campaignLevelCount'] != len(levels): err('platform campaignLevelCount mismatch')
if platform['releaseFeatures']['leaderboardsEnabled'] or platform['releaseFeatures']['iapEnabled'] or platform['releaseFeatures']['stickyBannerEnabled'] or platform['releaseFeatures']['dailyWeeklySurfaceEnabled']: err('Release 1.0 optional commercial surfaces must remain OFF in frozen baseline')
if platform['releaseFeatures']['editorEnabledInProduction']: err('editor must be disabled in production')
# screen flow refs / reachability / return paths
screens=screen_flow['screens']
transitions=screen_flow['transitions']
for tr in transitions:
    if tr['from'] not in screens or tr['to'] not in screens: err(f'screen_flow transition references unknown screen: {tr}')
# exact duplicate transitions are forbidden
seen_tr=set()
for tr in transitions:
    key=(tr['from'],tr['action'],tr['to'],tr.get('condition'),tr.get('payload'))
    if key in seen_tr: err(f'screen_flow duplicate transition: {tr}')
    seen_tr.add(key)
# first-launch action must exist on Menu and point to declared target payload
fl=screen_flow['firstLaunch']; target_screen,target_payload=fl['target'].split(':',1)
if not any(t['from']=='menu' and t['action']==fl['menuAction'] and t['to']==target_screen and t.get('payload')==target_payload for t in transitions):
    err('screen_flow firstLaunch menuAction/target has no matching transition')
# every declared screen must be graph-reachable from boot when conditions are ignored
reachable={'boot'}
changed=True
while changed:
    changed=False
    for tr in transitions:
        if tr['from'] in reachable and tr['to'] not in reachable:
            reachable.add(tr['to']); changed=True
for sid in screens:
    if sid not in reachable: err(f'screen_flow unreachable screen: {sid}')
# every overlay/modal must define at least one outgoing action so it cannot become a dead-end
for sid,meta in screens.items():
    if meta['kind'] in ('overlay','modal') and not any(t['from']==sid for t in transitions):
        err(f'screen_flow {sid}: overlay/modal has no outgoing transition')
# frozen v1 critical return paths
required_flow=[
 ('perk_choice','select','port_meta'),
 ('campaign_complete','endless','harbor'),
 ('campaign_complete','port','port_meta'),
 ('endless_result','rewarded_rewind_success','harbor'),
 ('settings','close','menu'),
 ('settings','close','port_meta'),
 ('settings','close','pause'),
]
for a,b,c in required_flow:
    if not any(t['from']==a and t['action']==b and t['to']==c for t in transitions): err(f'screen_flow missing required transition {a}:{b}->{c}')
# analytics required/optional params must exist and not overlap
aparams=set(analytics['parameters'])
for evname,ev in analytics['events'].items():
    if set(ev['required']) & set(ev['optional']): err(f'analytics {evname}: param both required and optional')
    for k in ev['required']+ev['optional']:
        if k not in aparams: err(f'analytics {evname}: unknown param {k}')
# audio delivery metadata
if not audio['autoplayRequiresUserGesture']: err('audio autoplay user-gesture contract must remain true')
for aid,a in audio['assets'].items():
    if not a['path'].startswith('assets/audio/'): err(f'audio {aid}: path outside assets/audio')
# exact stage gate contract
expected_stage_reqs={'calm_bay':['deep_water_berth'],'river_junction':[],'storm_harbor':[],'industrial_channel':['oil_safety_dock']}
for pid,need in expected_stage_reqs.items():
    spec=[x for x in ports[pid]['visualStages'] if x['id']=='specialized'][0]
    if spec['requiredUpgrades']!=need: err(f'{pid}: specialized stage requiredUpgrades mismatch')
# semantic hashes
sem=load(cfg/'levels.semantic_manifest.json')['levels']
for lid,d in levels.items():
    if sem.get(lid)!=sha(d): err(f'{lid}: semantic baseline hash mismatch')
# exact critical baseline
bal=load(cfg/'balance.json')
critical_ok = (
    bal['simulation']['fixedHz']==60
    and bal['route']['sampleDistance']==8
    and bal['route']['simplifyEpsilon']==3.5
    and bal['docking']['baseSnapDurationMs']==350
    and bal['collision']['warningRearmOutsideMs']==700
    and bal['score']=={'cargoUnit':100,'shipExit':20,'campaignCompletionBonus':250}
    and bal['spawnDirector']=={'occupiedDockPressureWeight':0.45,'activeStormCellPressureWeight':1.0,'unsafeSpawnRetryDelayMs':250,'spawnRequiresOutsideCombinedWarningRadii':True}
    and bal['simulation']['postMovementPriority']==['ship_collision','grounding','dock','cargo','exit','objective']
    and bal['route']['navigationClearanceExtra']==4
    and bal['docking']['reservationTieBreak']=='distance_then_spawn_sequence'
    and bal['docking']['collisionEnabledUntilSnapComplete'] is True
    and bal['cargoGeneration']['spawnAtFullCapacity'] is True
    and bal['economy']['upgradeCostRounding']=='nearest_integer'
    and bal['economy']['coinRewardRounding']=='floor'
    and bal['presentation']['crashSlowMotionMs']==150
    and bal['hazards']['storm']=={'shipSpeedMultiplier':0.65,'turnRateMultiplier':0.5,'effectDurationMs':1500,'inputLockMs':1000}
    and bal['rewind']['restoreOffsetMs']==2000
)
if not critical_ok: err('critical baseline numeric mismatch')
# profile fixture crossrefs
prof=load(cfg/'profile.default.json')
if prof['currentPortId'] not in ports: err('profile.default currentPortId invalid')
status='PASS' if not errors else 'FAIL'
report=[f'Port Control Baseline Source v1.5',f'STATUS: {status}',f'Schemas: {len(list(sch.glob("*.schema.json")))}',f'Campaign Level JSON: {len(levels)}/40','Schema validation: '+('PASS' if not any('schema' in x for x in errors) else 'FAIL'),'Semantic validation: '+('PASS' if not errors else 'FAIL'),'Geometry/winding/rect bounds: '+('PASS' if not any(any(k in x for k in ['polygon','rect extents','rotation']) for x in errors) else 'FAIL'),'Localization exact parity: '+('PASS' if set(ru)==set(en)==set(req) else 'FAIL'),'Mandatory access gate pricing: '+('PASS' if not any('access gate' in x for x in errors) else 'FAIL'),'Semantic manifest: '+('PASS' if not any('semantic baseline hash' in x for x in errors) else 'FAIL'),'Screen flow semantic validation: '+('PASS' if not any('screen_flow' in x for x in errors) else 'FAIL'),'','NOTE: runtime ship-route reachability/fairness, human Core Feel, real-device touch UX, production asset delivery and cohort retention/monetization remain implementation/QA evidence gates; they are not missing design rules.']
if errors: report += ['', 'ERRORS:']+[f'- {x}' for x in errors]
(root/'VALIDATION_REPORT.txt').write_text('\n'.join(report)+'\n',encoding='utf-8')
print('\n'.join(report))
if errors: sys.exit(1)
