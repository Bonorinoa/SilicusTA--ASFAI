import json,hashlib,gzip,sys
D='/Users/bonorinoa/.hermes/profiles/verifier/cache/scratch/g1v-data/'
S='/Users/bonorinoa/Hermes/Projects/silicus-wt/G1V/host/data/marble/marble-snapshot.json'
raw=open(S,'rb').read(); snap=json.loads(raw)
print('snapshot bytes',len(raw),'gzip',len(gzip.compress(raw,9)))
print('top-level keys',list(snap.keys()))
print('source',snap['source'])
t=json.load(open(D+'topics.json')); d=json.load(open(D+'dependencies.json'))
print('upstream counts',len(t['topics']),t['topicCount'],len(d['dependencies']),d['edgeCount'])
print('snap counts',len(snap['topics']),len(snap['dependencies']),snap['topicCount'],snap['edgeCount'])
TF=["id","type","subject","domain","name","description","evidence","ageRangeStart","ageRangeEnd"]
EF=["topicId","prerequisiteId","strength","reason"]
from collections import Counter
print('topic key sets',Counter(tuple(x.keys()) for x in snap['topics']))
print('edge key sets',Counter(tuple(x.keys()) for x in snap['dependencies']))
exp_t=[{k:x.get(k) for k in TF} for x in t['topics']]
exp_d=[{k:x.get(k) for k in EF} for x in d['dependencies']]
print('topics == own re-trim (order+values):',exp_t==snap['topics'])
print('deps == own re-trim:',exp_d==snap['dependencies'])
print('upstream extra topic fields dropped:',sorted(set(t['topics'][0].keys())-set(TF)))
print('upstream extra edge fields dropped:',sorted(set(d['dependencies'][0].keys())-set(EF)))
print('missing evidence field in snapshot topics:',sum(1 for x in snap['topics'] if 'evidence' not in x))
print('age min/max',min(x['ageRangeStart'] for x in snap['topics']),max(x['ageRangeEnd'] for x in snap['topics']))
print('hash fields match raw:',snap['topicsSha256']==hashlib.sha256(open(D+'topics.json','rb').read()).hexdigest(),snap['dependenciesSha256']==hashlib.sha256(open(D+'dependencies.json','rb').read()).hexdigest())
ids={x['id'] for x in snap['topics']}
print('dangling edge ends',sum(1 for e in snap['dependencies'] if e['topicId'] not in ids or e['prerequisiteId'] not in ids))
byid={x['id']:x for x in snap['topics']}
for i in ['mt_WRRv1ABECC','mt_AzTrT5ySCx','mt_u6SYiVx7FX','mt_kH1DzOPsXG']:
    x=byid[i];print(i,x['name'],x['ageRangeStart'],x['ageRangeEnd'])
for e in snap['dependencies']:
    if {e['topicId'],e['prerequisiteId']}<= {'mt_WRRv1ABECC','mt_AzTrT5ySCx','mt_u6SYiVx7FX','mt_kH1DzOPsXG'}:
        print('EDGE',e['topicId'],'<-',e['prerequisiteId'],e['strength'])
