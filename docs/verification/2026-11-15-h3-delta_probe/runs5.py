exec(open("overlap.py").read().split("for name,txt in srcs.items():")[0])
b=words(srcs["2026-11-14-rubric-v0.3.md"])
ENUM=("form recall without support near transfer far transfer explain to absent","helpafter none peer teacher textbook worked example ai","speaking drawing writing handling discussion diagram enactment")
for k in (5,):
    r=runs(pw,b,k); seen={}
    for i,l in r:
        t=" ".join(pw[i:i+l]); seen[t]=seen.get(t,0)+1
    for t,c in sorted(seen.items(), key=lambda x:-len(x[0].split())):
        enum=any(t in e for e in ENUM)
        print(len(t.split()),"x",c,"ENUM" if enum else "PROSE","|",t)
