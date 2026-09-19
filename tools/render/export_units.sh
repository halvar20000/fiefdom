#!/bin/bash
# Export every human body for the 3D renderer, one Blender process each.
#   tools/render/export_units.sh [--src /path/to/0ad-daes] [body ...]
cd "$(dirname "$0")/../.."
SRC=/tmp/0ad-eval
if [ "$1" = "--src" ]; then SRC="$2"; shift 2; fi
if [ $# -gt 0 ]; then
  BODIES="$*"
else
  BODIES="peasant $(blender -b --python-expr "
import sys; sys.path.insert(0, 'tools/render')
import render_units; print('BODIES', ' '.join(render_units.SOLDIERS))" 2>/dev/null | grep '^BODIES' | cut -d' ' -f2-)"
fi
fail=""
for b in $BODIES; do
  ok=0
  for try in 1 2 3; do
    out=$(blender -b -P tools/render/export_units.py -- --body "$b" --src "$SRC" 2>&1)
    if echo "$out" | grep -q -e "-> $b in"; then ok=1; echo "$b: ok"; break; fi
    echo "$out" | grep -E "rror|Exit|!!" | head -3
  done
  [ $ok = 1 ] || { echo "$b: FAILED"; fail="$fail $b"; }
done
[ -z "$fail" ] || { echo "FAILED:$fail"; exit 1; }
