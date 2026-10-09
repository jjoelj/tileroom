#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Pull, rebuild and restart one checkout. Run from cron (see deploy/README.md).
#   staging tracks origin/master; prod tracks the newest v* tag.
# Logs one line per deploy, nothing when there's nothing new.

# Wrapped in main so sh parses it all before git checkout rewrites this file.
main() {
    case "$1" in
        staging|prod) ;;
        *) echo "usage: $0 staging|prod" >&2; return 2 ;;
    esac

    log() { echo "$(date '+%F %T') tileroom $1: $2"; }
    cd "$(dirname "$0")/.." || return 1
    old=$(git rev-parse --short HEAD)

    if [ "$1" = staging ]; then
        git fetch --quiet origin master || { log "$1" "fetch failed"; return 1; }
        ref=origin/master
    else
        git fetch --quiet --tags origin || { log "$1" "fetch failed"; return 1; }
        ref=$(git tag -l 'v*' --sort=-v:refname | head -1)
        [ -n "$ref" ] || { log "$1" "no v* tags found"; return 1; }
    fi
    new=$(git rev-parse --short "$ref^{commit}")

    [ "$old" = "$new" ] && return 0

    git checkout --quiet "$ref" || { log "$1" "checkout $ref failed"; return 1; }
    # Compose builds before replacing the container, so a failed build leaves the old one running.
    if docker compose up -d --build >/dev/null 2>&1; then
        log "$1" "$old -> $new deployed"
    else
        log "$1" "$old -> $new build failed, old container still running"
        git checkout --quiet "$old"
        return 1
    fi
}
main "$@"
exit
