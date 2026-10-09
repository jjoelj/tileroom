#!/usr/bin/env sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Regenerates wordlists/scowl-80.txt from the English Speller Database (ESDB/SCOWL) at a pinned commit.
# Needs git and Python 3.7+ (with sqlite3). Takes ~2 minutes. Then run: bun wordlists/build.ts
set -eu
COMMIT=1e5b7d3a72f47a71da5d28686c1dd4b397178485
OUT="$(cd "$(dirname "$0")" && pwd)/scowl-80.txt"
TMP="$(mktemp -d)"
git clone -q https://github.com/en-wl/wordlist "$TMP/wl"
cd "$TMP/wl"
git checkout -q "$COMMIT"
export PYTHONUTF8=1 # Windows: the data files are UTF-8
PY=python3; $PY -c '' 2>/dev/null || PY=python # Windows has a fake python3 alias
$PY combine.py create-db scowl.db > /dev/null
# Size 80 = "a valid word in current usage" (the word-game size, see the ESDB README).
# All spellings (US, GB -ise/-ize, CA, AU), variants up to 6 "acceptable", hacker words, no accents.
# Abbreviations, prefixes, suffixes, word parts and non-words (roman numerals) are excluded by POS.
# Proper nouns are excluded by POS class; `upper`/`upper?` are SCOWL's unclassified capitalized words (Paris, NASA).
$PY scowl word-list 80 A,B,Z,C,D 6 \
  --wo-poses abbr,pre,suf --wo-pos-categories nonword,wordpart \
  --wo-pos-classes name,name?,person,place,surname,demonym,trademark,upper,upper? \
  --categories hacker --deaccent --apostrophe False > "$OUT"
cp Copyright "$(dirname "$OUT")/scowl-copyright.txt"
rm -rf "$TMP"
echo "wrote $OUT"
