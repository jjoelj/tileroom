#!/usr/bin/env sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Regenerates wordlists/scowl-80.txt (words) and wordlists/scowl-80-abbr.txt (abbreviations) from the
# English Speller Database (ESDB/SCOWL) at a pinned commit.
# Needs git and Python 3.7+ (with sqlite3). Takes ~2 minutes. Then run: bun wordlists/build.ts
set -eu
COMMIT=1e5b7d3a72f47a71da5d28686c1dd4b397178485
DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
git clone -q https://github.com/en-wl/wordlist "$TMP/wl"
cd "$TMP/wl"
git checkout -q "$COMMIT"
export PYTHONUTF8=1 # Windows: the data files are UTF-8
PY=python3; $PY -c '' 2>/dev/null || PY=python # Windows has a fake python3 alias
$PY combine.py create-db scowl.db > /dev/null 2>&1

# Size 80 = "a valid word in current usage" (the word-game size, see the ESDB README).
# All spellings (US, GB -ise/-ize, CA, AU), variants up to 6 "acceptable", hacker words, no accents,
# no word parts or non-words (roman numerals).
list() { $PY scowl word-list 80 A,B,Z,C,D 6 --wo-pos-categories nonword,wordpart --categories hacker \
  --deaccent --apostrophe False "$@" 2>/dev/null; }
# Proper nouns by POS class; `upper`/`upper?` are SCOWL's unclassified capitalized words (Paris, NASA).
NAMES=name,name?,person,place,surname,demonym,trademark,upper,upper?

# Words: no prefixes/suffixes, no proper nouns, no abbreviations (by POS or by class).
list --wo-poses abbr,pre,suf --wo-pos-classes "$NAMES,abbr,abbr?" > "$DIR/scowl-80.txt"
# Abbreviations, kept separately for the "expanded word list" game setting: abbr POS, plus abbr/abbr? class (FAQ, COVID, etc.).
{ list --poses no-default,abbr --wo-pos-classes "$NAMES"; list --wo-poses pre,suf --pos-classes no-default,abbr,abbr?; } \
  > "$DIR/scowl-80-abbr.txt"

cp Copyright "$DIR/scowl-copyright.txt"
rm -rf "$TMP"
echo "wrote $DIR/scowl-80.txt and scowl-80-abbr.txt"
