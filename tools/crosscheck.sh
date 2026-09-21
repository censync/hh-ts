#!/bin/sh
# Differential test of hh-ts against hh-cpp: two batches go through hh_cli of hh-cpp and through
# the command line tool here, first pseudo-random cases, valid and invalid, then the hand-made
# cases of tools/edge-cases.txt. Every printed value and every written file (PNG, BMP, JPEG, raw
# pixels) must be identical.
#
# usage: tools/crosscheck.sh <path to hh_cli> [case count] [seed]
set -eu

here=$(cd "$(dirname "$0")/.." && pwd)
hh_cli=${1:?usage: tools/crosscheck.sh <path to hh_cli> [case count] [seed]}
count=${2:-400}
seed=${3:-1}
work=$here/build/crosscheck
rm -rf "$work"
mkdir -p "$work"

(cd "$here" && npm run --silent build:dev)
ts_cli=$here/build/cli/hh-cli.js

# compare <name> <case file>: runs both tools and sets $ok and $files for the final line.
compare() {
    "$hh_cli" --batch "$2" "$work/$1-cpp" > "$work/$1-cpp.txt"
    node "$ts_cli" --batch "$2" "$work/$1-ts" > "$work/$1-ts.txt"
    if ! diff "$work/$1-cpp.txt" "$work/$1-ts.txt" > "$work/$1-values.diff"; then
        echo "crosscheck: the printed values of the $1 cases differ, see $work/$1-values.diff" >&2
        head -n 20 "$work/$1-values.diff" >&2
        exit 1
    fi
    if ! diff -r "$work/$1-cpp" "$work/$1-ts" > "$work/$1-files.diff"; then
        echo "crosscheck: the written files of the $1 cases differ, see $work/$1-files.diff" >&2
        head -n 20 "$work/$1-files.diff" >&2
        exit 1
    fi
    total=$(wc -l < "$work/$1-cpp.txt" | tr -d ' ')
    ok=$(grep -c "	ok	" "$work/$1-cpp.txt" || true)
    files=$(find "$work/$1-cpp" -type f | wc -l | tr -d ' ')
}

node "$ts_cli" --generate "$count" "$seed" > "$work/cases.txt"
compare generated "$work/cases.txt"
generated="$total generated cases (seed $seed, $ok rendered, $files files)"
compare edge "$here/tools/edge-cases.txt"
echo "crosscheck: $generated and $total edge cases ($ok rendered, $files files) agree byte for byte"
