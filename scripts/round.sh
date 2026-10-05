#!/bin/bash
# usage: round.sh <n> <shot1> [shot2 ...] -- <prompt>
N=$1; shift
SHOTS=()
while [ "$1" != "--" ]; do SHOTS+=("$1"); shift; done
shift
PROMPT="$*"
ARGS=()
for s in "${SHOTS[@]}"; do ARGS+=(-i "$s"); done
z-ai vision -p "$PROMPT" "${ARGS[@]}" 2>/dev/null | python3 -c "
import json,sys
raw = sys.stdin.read()
start = raw.find('{')
try:
    d = json.loads(raw[start:raw.rfind('}')+1])
    print(d['choices'][0]['message']['content'])
except Exception:
    print(raw[:3000])
"
