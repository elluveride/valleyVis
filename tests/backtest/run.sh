#!/usr/bin/env bash
# Backtest the exporter against the real libraries.
#
# Generates random routines, exports them to Java, compiles them against the real
# Pedro Pathing 3.0.1 and ValleyLib 2.0.0 sources (with small stand-ins for the FTC SDK and
# the team classes), then builds every routine for both alliances the way the follower would
# and compares what happened with what the visualizer predicted.
#
# Needs: node 20+, a JDK (javac/java), python3, git, curl, unzip.
#   tests/backtest/run.sh            # 200 routines, seed 2844
#   N=500 SEED=7 tests/backtest/run.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
N="${N:-200}"
SEED="${SEED:-2844}"
WORK="${WORK:-$(mktemp -d)}"
echo "working in $WORK"

if [ ! -d "$WORK/pedro" ]; then
  mkdir -p "$WORK/pedro"
  curl -fsSL -o "$WORK/pedro-core-sources.jar" https://repo1.maven.org/maven2/com/pedropathing/core/3.0.1/core-3.0.1-sources.jar
  unzip -q "$WORK/pedro-core-sources.jar" -d "$WORK/pedro"
fi
if [ ! -d "$WORK/valleyLib" ]; then
  git clone -q --depth 1 --branch 2.0.0 https://github.com/ValleyX/valleyLib "$WORK/valleyLib"
fi

mkdir -p "$WORK/gen" "$WORK/out"
node "$HERE/fuzz-export.mjs" "$WORK/gen" "$SEED" "$N"

find "$HERE/stubs" "$WORK/gen" "$WORK/pedro/com" \
  "$WORK/valleyLib/valleyLib-core/src/main/java" \
  "$WORK/valleyLib/valleyLib-ftc/src/main/java/com/vcs/valleylib/ftc/pedro" \
  "$WORK/valleyLib/valleyLib-ftc/src/main/java/com/vcs/valleylib/ftc/hardware/FtcSubsystem.java" \
  -name '*.java' > "$WORK/files.txt"
javac -nowarn -d "$WORK/out" @"$WORK/files.txt"
echo "compiled $(grep -c "$WORK/gen" "$WORK/files.txt") generated files (both export layouts) against Pedro 3.0.1 + ValleyLib 2.0.0"

java -cp "$WORK/out" runner.RunAll "$N" > "$WORK/java.txt"
python3 "$HERE/compare.py" "$WORK"

echo "--- exported park route vs the visualizer"
node "$HERE/park-check.mjs" gen "$WORK"
find "$HERE/stubs/org/firstinspires/ftc/team2844simple/helpers/Constants.java" "$WORK/parkcheck" "$WORK/pedro/com" -name '*.java' > "$WORK/park-files.txt"
mkdir -p "$WORK/park-out"
javac -nowarn -d "$WORK/park-out" @"$WORK/park-files.txt"
java -cp "$WORK/park-out" parkcheck.Run > "$WORK/park.txt"
node "$HERE/park-check.mjs" compare "$WORK"

echo "--- jointSafe() wrapper on 100000 random multi-segment piecewise paths"
java -cp "$WORK/out" runner.JointSafe
