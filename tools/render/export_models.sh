#!/bin/bash
# Export every static model, one Blender process per model with retries.
#
# One process each because this headless Blender build segfaults now and then
# inside Cycles bake (roughly one run in three, on no particular model), and
# a crash in one model must not take the rest of the run down with it. The
# manifest is merged, so a partial run can simply be re-run.
#
#   tools/render/export_models.sh              # everything
#   tools/render/export_models.sh keep hovel   # just these
cd "$(dirname "$0")/../.."
if [ $# -gt 0 ]; then
  MODELS="$*"
else
  MODELS=$(blender -b --python-expr "
import sys, os; sys.path.insert(0, 'tools/render')
import buildings, props, piles
print('MODELS', ' '.join({**buildings.REGISTRY, **props.REGISTRY, **piles.REGISTRY}.keys()))" 2>/dev/null | grep '^MODELS' | cut -d' ' -f2-)
fi
fail=""
for n in $MODELS; do
  ok=0
  for try in 1 2 3 4 5; do
    out=$(blender -b -P tools/render/export_glb.py -- --only "$n" 2>&1)
    if echo "$out" | grep -q -e "-> $n.glb"; then ok=1; echo "$n: ok (try $try)"; break; fi
  done
  [ $ok = 1 ] || { echo "$n: FAILED after 5 tries"; fail="$fail $n"; }
done
[ -z "$fail" ] || { echo "FAILED:$fail"; exit 1; }
