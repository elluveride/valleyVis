#!/usr/bin/env bash
# Backtest the HuskyLens pickup against the real libraries.
#
# Writes the Vision setup files and routines with pickups, compiles them against Pedro Pathing
# 3.0.1 and ValleyLib 2.0.0 (with stand-ins for the FTC SDK 12.0.0 classes they touch, same
# signatures), then runs the generated VisionPickupCmd closed-loop on a simulated robot and
# camera and checks it ends where the visualizer's preview said it would.
#
#   tests/backtest/vision/run.sh                  # 300 scenarios, 20 routines, seed 2844
#   N=1000 SEED=7 tests/backtest/vision/run.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STUBS="$HERE/../stubs"
N="${N:-300}"
R="${R:-20}"
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

rm -rf "$WORK/gen" "$WORK/out"
mkdir -p "$WORK/gen" "$WORK/out"
node "$HERE/vision-check.mjs" gen "$WORK" "$SEED" "$N" "$R"

# the team stand-ins, minus the three files this test replaces (HardwareMap, Constants, Subsystems)
find "$STUBS" -name '*.java' \
  ! -path '*/robotcore/hardware/HardwareMap.java' ! -path '*/helpers/Constants.java' ! -path '*/helpers/Subsystems.java' \
  ! -path '*/stubs/runner/*' > "$WORK/files.txt"
find "$HERE/stubs" "$WORK/gen" "$WORK/pedro/com" \
  "$WORK/valleyLib/valleyLib-core/src/main/java" \
  "$WORK/valleyLib/valleyLib-ftc/src/main/java/com/vcs/valleylib/ftc/pedro" \
  "$WORK/valleyLib/valleyLib-ftc/src/main/java/com/vcs/valleylib/ftc/hardware/FtcSubsystem.java" \
  -name '*.java' >> "$WORK/files.txt"
javac -nowarn -d "$WORK/out" @"$WORK/files.txt"
echo "compiled the Vision setup files and $(find "$WORK/gen/org/firstinspires/ftc/team2844simple/autos" -name '*.java' | wc -l) routine files against Pedro 3.0.1 + ValleyLib 2.0.0"

java -cp "$WORK/out" visionsim.VisionSim "$WORK/scenarios.txt" $(cat "$WORK/geometries.txt") > "$WORK/java.txt"
node "$HERE/vision-check.mjs" compare "$WORK"
