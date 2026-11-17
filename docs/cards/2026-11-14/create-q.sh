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
Q=$(mk Q "Q · Paid checks on merged main (live plan timing, student-helper eval)" $E 90m blocked); echo "Q=$Q"
rm -rf "$TMP"
