#!/usr/bin/env bash
# Leaves dpkg unlocked and consistent after an apt step that was killed
# part-way: CI's e2e job runs it before any apt work that follows one.
#
# A step timeout kills only the step's leader process (#85). The apt-get
# under it is orphaned and keeps the apt lock (#89), and the dpkg that
# apt-get spawned can outlive both, still holding the dpkg lock (#643).
# So, in order:
#
# 1. Kill apt-get and apt, so they start no further dpkg run.
# 2. Wait for a running dpkg to exit, up to the bound, because it may be
#    doing real work. Kill it only if it is still there at the bound.
# 3. Run `dpkg --configure -a`. An orphaned dpkg dies part-way once its
#    apt-get is gone (measured on #643), and until this repair runs, apt
#    refuses every install with "dpkg was interrupted".
#
# Usage: settle-dpkg.sh [seconds to wait for dpkg, default 120]
set -euo pipefail

bound="${1:-120}"

sudo pkill -9 -x apt-get || true
sudo pkill -9 -x apt || true

wait_for_dpkg() { timeout "$1" bash -c 'while pgrep -x dpkg >/dev/null; do sleep 2; done'; }
if ! wait_for_dpkg "$bound"; then
  echo "dpkg still running after ${bound} s; killing it"
  sudo pkill -9 -x dpkg || true
  wait_for_dpkg 10 || true
fi

sudo dpkg --configure -a
