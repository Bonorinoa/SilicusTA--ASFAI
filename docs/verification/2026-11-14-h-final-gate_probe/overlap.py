import re,zipfile,glob,os
T=os.environ['TMPDIR']
def words(s): return re.findall(r"[a-z0-9']+",s.lower())
prompt=" ".join(open(f"{T}/hvprobe/{f}").read() for f in ["prompt_base.txt","prompt_s1.txt","prompt_s2.txt","prompt_s3.txt","prompt_s4.txt","prompt_anch.txt"])
# strip the shared JSON-shape lines? keep everything; use only NL-bearing lines (>=8 words) of the prompt
pw=words(prompt)
def docx(p):
    x=zipfile.ZipFile(p).read('word/document.xml').decode('utf8','ignore')
    x=re.sub(r'</w:p>',' ',x); return re.sub(r'<[^>]+>','',x)
srcs={}
for p in sorted(glob.glob('/Users/bonorinoa/Hermes/Projects/silicus-private/sarah/*.docx')): srcs[os.path.basename(p)]=docx(p)
for p in sorted(glob.glob('/Users/bonorinoa/Hermes/Projects/silicus-private/plan-rubric/*v0.3*.md'))+['/Users/bonorinoa/Hermes/Projects/silicus-private/plan-rubric/2026-11-14-rubric-v0.2.md']: srcs[os.path.basename(p)]=open(p).read()
def runs(a,b,minlen):
    # all maximal common runs >= minlen words (a=prompt words, b=source words) via 'ngram index'
    k=minlen; idx={}
    for i in range(len(b)-k+1): idx.setdefault(tuple(b[i:i+k]),[]).append(i)
    out=[];i=0
    while i<=len(a)-k:
        t=tuple(a[i:i+k])
        if t in idx:
            best=0
            for j in idx[t]:
                l=k
                while i+l<len(a) and j+l<len(b) and a[i+l]==b[j+l]: l+=1
                best=max(best,l)
            out.append((i,best)); i+=best
        else: i+=1
    return out
for name,txt in srcs.items():
    b=words(txt); r=runs(pw,b,6)
    print(f"{name:55s} source_words={len(b):6d} runs>=6w: {len(r)}  longest={max([l for _,l in r],default=0)}")
    print("    run lengths >=6:", sorted([l for _,l in r],reverse=True)[:10])
    r4=runs(pw,b,4); print("    longest run at 4w threshold:", max([l for _,l in r4],default=0), " count>=4:", len(r4))
