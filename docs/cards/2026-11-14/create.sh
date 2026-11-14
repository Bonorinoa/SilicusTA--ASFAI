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
E="engineer deepseek/deepseek-v4-flash-0731 nous"
V="verifier claude-sonnet-5-5 anthropic"
W="writer claude-sonnet-5-5 anthropic"

G1=$(mk G1 "G1 · Marble as a local knowledge graph, both hosts" $E 3h ready);              echo "G1=$G1"
G1V=$(mk G1V "G1V · Verifier gate on G1 (Marble source)" $V 2h ready "$G1");               echo "G1V=$G1V"
U1=$(mk U1 "U1 · CORS allow-list PR branch on a fork of asfai-education" $E 2h ready);     echo "U1=$U1"
U1V=$(mk U1V "U1V · Verifier gate on U1 (CORS fork branch)" $V 90m ready "$U1");           echo "U1V=$U1V"
F0=$(mk F0 "F0 · Re-freeze: suites on main, dated record" $E 90m ready);                   echo "F0=$F0"
P1=$(mk P1 "P1 · Plan-quality rubric from Sarah's framework (private draft)" $W 60m ready); echo "P1=$P1"
S0=$(mk S0 "S0 · Email to Sarah (draft; Augusto sends)" $W 30m ready "$P1");               echo "S0=$S0"
B1=$(mk B1 "B1 · Baseline plans from today's prompt (paid, needs host/.env.worker)" $E 60m blocked); echo "B1=$B1"
rm -rf "$TMP"
