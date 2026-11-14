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
G2a=t_b2752563; G2c=t_b6c08525
P2=$(mk P2 "P2 · Plan schema v2 + learning-design prompt (host)" $E 3h ready "$G2a");           echo "P2=$P2"
P2V=$(mk P2V "P2V · Verifier gate on feat/p2" $V 90m ready "$P2");                              echo "P2V=$P2V"
P3a=$(mk P3a "P3a · v2 plans + blind set + judge A (paid, small)" $E 2h ready "$P2V");          echo "P3a=$P3a"
P3b=$(mk P3b "P3b · Judge B, agreement, before/after result" $V 90m ready "$P3a");              echo "P3b=$P3b"
P2ui=$(mk P2ui "P2ui · Show the learning design on the plan" $C 3h ready "$G2c" "$P2V");        echo "P2ui=$P2ui"
rm -rf "$TMP"
