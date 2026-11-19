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
X="engineer gpt-5.6-sol openai-codex"; C="creative claude-opus-5-5 anthropic"; V="verifier claude-sonnet-5-5 anthropic"; VX="verifier gpt-5.6-sol openai-codex"
N6=$(mk N6 "N6 · The record says who wrote it (confirm-gate authorship, owner approved)" $X 3h blocked t_564e0679); echo "N6=$N6"
N6V=$(mk N6V "N6V · Gate on the trust-core change" $V 2h ready "$N6"); echo "N6V=$N6V"
D2=$(mk D2 "D2 · Design review against drift (creative)" $C 3h blocked "$N6V"); echo "D2=$D2"
REL=$(mk REL "REL · Release gate, cross-family (Codex)" $VX 4h blocked "$D2" t_1395a3be); echo "REL=$REL"
rm -rf "$TMP"
