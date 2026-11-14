#!/usr/bin/env bash
# Round of 14 Nov 2026 on board silicusta-sprint. Copied from hermes-surface-ops templates/create_card_chain.sh.
# Producer engineer = nous/deepseek-v4-flash-0731; verifier = anthropic/claude-sonnet-5-5 (cross-family).
set -euo pipefail
ROOT=/Users/bonorinoa/Hermes/Projects/silicus-asfai-handoff
B=silicusta-sprint
D=$ROOT/docs/cards/2026-11-14
TMP=$(mktemp -d)

mk() { # key title assignee model provider runtime status [parents...]  -> prints the new id
  local key=$1 title=$2 who=$3 model=$4 prov=$5 rt=$6 st=$7; shift 7
  cat "$D/$key.md" "$D/common_rules.md" > "$TMP/$key.md"
  local pargs=(); for p in "$@"; do pargs+=(--parent "$p"); done
  local sargs=(); [ "$st" = blocked ] && sargs+=(--initial-status blocked)
  hermes kanban --board "$B" create "$title" --assignee "$who" --body-file "$TMP/$key.md" \
    --workspace "dir:$ROOT" --model "$model" --provider "$prov" --max-runtime "$rt" \
    --idempotency-key "$B-1114-$key" ${sargs[@]+"${sargs[@]}"} ${pargs[@]+"${pargs[@]}"} --json \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])'
}
W="writer claude-sonnet-5-5 anthropic"
E="engineer deepseek/deepseek-v4-flash-0731 nous"
V="verifier claude-sonnet-5-5 anthropic"
C="creative claude-opus-5-5 anthropic"
# Graph round (owner 14 Nov): G1 conditions -> recheck -> structured ages/anchor -> wizard -> graph on plan -> gate.
G1b=$(mk G1b "G1b · Marble: attribution exactly as upstream, fail-closed ages, small fixes" $E 2h ready);   echo "G1b=$G1b"
G1bV=$(mk G1bV "G1bV · Re-check G1 conditions" $V 90m ready "$G1b");                                       echo "G1bV=$G1bV"
G2a=$(mk G2a "G2a · Structured ages, skill-map anchor, relevance (host)" $E 3h ready "$G1bV");            echo "G2a=$G2a"
G2b=$(mk G2b "G2b · Wizard step 1: stage cards, age strip, anchor, consequence strip" $C 3h ready "$G2a"); echo "G2b=$G2b"
G2c=$(mk G2c "G2c · Graph on the plan: prerequisites, neighbourhood view, suggestions" $C 3h ready "$G2b"); echo "G2c=$G2c"
G2V=$(mk G2V "G2V · Verifier gate on feat/g2" $V 2h ready "$G2c");                                        echo "G2V=$G2V"
U1b=$(mk U1b "U1b · CORS branch: look-alike origin tests" $E 60m ready);                                   echo "U1b=$U1b"
rm -rf "$TMP"
