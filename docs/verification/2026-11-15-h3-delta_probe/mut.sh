#!/bin/bash
# usage: mut.sh NAME file 'old' 'new' testcmd
cd $TMPDIR/h3v/tree-mut
name=$1; f=$2; old=$3; new=$4; shift 4
cp "$f" "$f.orig"
python3 - "$f" "$old" "$new" <<'PY'
import sys
f,o,n=sys.argv[1:4]; s=open(f).read()
assert s.count(o)==1, f"pattern count {s.count(o)} for {o!r}"
open(f,"w").write(s.replace(o,n))
PY
pe=$?; [ $pe -ne 0 ] && { echo "$name PATCH_FAILED"; mv "$f.orig" "$f"; exit 9; }
"$@" > ../mut-$name.log 2>&1; s=$?
echo "$name test-exit=$s"; grep -E "^# (pass|fail)|Tests +[0-9]|failed|✗|FAIL" ../mut-$name.log | head -6
mv "$f.orig" "$f"
