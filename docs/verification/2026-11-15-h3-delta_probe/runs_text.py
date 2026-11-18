import re,os
exec(open("overlap.py").read().split("for name,txt in srcs.items():")[0])
b=words(srcs["2026-11-14-rubric-v0.3.md"])
r=runs(pw,b,6)
seen={}
for i,l in r:
    seen.setdefault(" ".join(pw[i:i+l]),0); seen[" ".join(pw[i:i+l])]+=1
for t,c in sorted(seen.items(), key=lambda x:-len(x[0].split())):
    print(len(t.split()),"words x",c,"|",t)
