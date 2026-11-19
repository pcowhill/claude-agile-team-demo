#!/usr/bin/env bash
# The e2e job's system packages, kept as .deb files so a normal run never
# touches the apt mirror (#714). The mirror has hung the install for minutes
# at a time (#85, #714): twice it cost the job its 30-minute budget and a
# manual re-run, and once the retry hit its own cap and Chromium never ran.
#
# The cache holds exactly what the network steps installed on a cache miss:
# Playwright's system dependencies and PulseAudio, about 64 packages and
# 61 MB on ubuntu-26.04. It is keyed on the runner image's version and on
# Playwright's (ci.yml), because what is missing from an image — and the
# versions that fit it — change with both.
#
# Usage:
#   apt-debs.sh snapshot FILE      record the installed packages in FILE
#   apt-debs.sh collect FILE DIR   download into DIR every package that is
#                                  installed now but was not, at that version,
#                                  in FILE (needs a fresh `apt-get update`,
#                                  which install-deps has just run)
#   apt-debs.sh install DIR        install DIR's .deb files with dpkg alone, no
#                                  mirror; on failure, purge what it added so
#                                  the network steps start from a clean dpkg
set -euo pipefail
export LC_ALL=C

installed() {
  dpkg-query -W -f='${db:Status-Abbrev} ${binary:Package}=${Version}\n' \
    | awk '$1 == "ii" { print $2 }' | sort
}

case "${1:-}" in
  snapshot)
    installed > "$2"
    echo "$(wc -l < "$2") packages installed"
    ;;

  collect)
    before="$2"
    dir="$3"
    mkdir -p "$dir"
    mapfile -t added < <(comm -13 "$before" <(installed))
    if [ "${#added[@]}" -eq 0 ]; then
      echo 'Nothing was installed since the snapshot; nothing to cache.' >&2
      exit 1
    fi
    echo "Downloading ${#added[@]} packages for the cache"
    (cd "$dir" && apt-get download "${added[@]}")
    du -sh "$dir"
    ;;

  install)
    dir="$2"
    shopt -s nullglob
    debs=("$dir"/*.deb)
    if [ "${#debs[@]}" -eq 0 ]; then
      echo "No .deb files in $dir" >&2
      exit 1
    fi
    before="$(mktemp)"
    installed | sed 's/=.*//' > "$before"
    echo "Installing ${#debs[@]} cached packages"
    if sudo dpkg -i "${debs[@]}" > "$before.log" 2>&1; then
      tail -n 3 "$before.log"
      exit 0
    fi
    cat "$before.log"
    # Leave dpkg as it was, so the network steps after this one install
    # into a consistent system rather than one with half-configured packages.
    mapfile -t ours < <(for deb in "${debs[@]}"; do dpkg-deb -f "$deb" Package; done | sort -u \
      | comm -23 - <(sed 's/:.*//' "$before" | sort -u))
    if [ "${#ours[@]}" -gt 0 ]; then
      sudo dpkg --purge --force-depends "${ours[@]}" || true
    fi
    sudo dpkg --configure -a || true
    echo 'dpkg could not install the cached packages; the network steps will.' >&2
    exit 1
    ;;

  *)
    echo "usage: $0 snapshot FILE | collect FILE DIR | install DIR" >&2
    exit 2
    ;;
esac
