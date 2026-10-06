#!/usr/bin/env python3
"""String-level sanity check for src/lib/i18n.ts (plain Python — no TS toolchain).

Confirms that:
  1. all 18 language blocks exist and are non-empty,
  2. every language block contains EVERY en key (no missing, no extras),
  3. no duplicate keys inside a block,
  4. {placeholder} tokens survive translation (same set as the en value),
  5. the `dict` literal references all 18 identifiers,
  6. LANGUAGES metadata lists exactly the 18 codes.

Exit code 0 = clean, 1 = problems found.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src" / "lib" / "i18n.ts"

LANGS = ["en", "sw", "fr", "lg", "rw", "am", "so", "ar", "ha",
         "yo", "ig", "zu", "af", "pt", "es", "hi", "zh", "ki"]

text = SRC.read_text(encoding="utf-8")
problems: list[str] = []


def block_of(name: str) -> str:
    m = re.search(rf"const {name}: Record<string, string> = \{{", text)
    if not m:
        return ""
    i, depth = m.end(), 1
    while i < len(text) and depth:
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
        i += 1
    return text[m.end():i - 1]


def keys_of(name: str, body: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for m in re.finditer(r'^\s*"([A-Za-z0-9_.]+)":\s*"(.*)",\s*$', body, re.M):
        k, v = m.group(1), m.group(2)
        if k in out:
            problems.append(f"[{name}] duplicate key: {k}")
        if not v.strip():
            problems.append(f"[{name}] empty value for: {k}")
        out[k] = v
    return out


blocks: dict[str, dict[str, str]] = {}
for code in LANGS:
    body = block_of(code)
    if not body:
        problems.append(f"[{code}] block `const {code}: Record<string, string> = {{...}}` not found")
        continue
    blocks[code] = keys_of(code, body)

en_keys = blocks.get("en", {})

# 2 + 3: completeness against en
for code in LANGS:
    if code not in blocks or code == "en":
        continue
    missing = en_keys.keys() - blocks[code].keys()
    extra = blocks[code].keys() - en_keys.keys()
    for k in sorted(missing):
        problems.append(f"[{code}] missing key: {k}")
    for k in sorted(extra):
        problems.append(f"[{code}] extra key (not in en): {k}")

# 4: placeholders survive translation
for code, kv in blocks.items():
    for k, en_val in en_keys.items():
        v = kv.get(k)
        if v is None:
            continue
        want = set(re.findall(r"\{[a-z_]+\}", en_val))
        got = set(re.findall(r"\{[a-z_]+\}", v))
        if want != got:
            problems.append(f"[{code}] placeholder mismatch on {k}: expected {sorted(want)}, got {sorted(got)}")

# 5: dict literal references all identifiers
m = re.search(r"const dict: Record<Lang, Record<string, string>> = \{([^}]*)\}", text)
if not m:
    problems.append("dict literal not found")
else:
    refs = [x.strip() for x in m.group(1).split(",") if x.strip()]
    if sorted(refs) != sorted(LANGS):
        problems.append(f"dict references {sorted(refs)} — expected {sorted(LANGS)}")

# 6: LANGUAGES metadata codes
meta_block = re.search(r"export const LANGUAGES[^=]*= \[(.*?)\];", text, re.S)
if not meta_block:
    problems.append("LANGUAGES metadata not found")
else:
    codes = re.findall(r'code:\s*"([a-z]+)"', meta_block.group(1))
    if len(codes) != len(LANGS) or sorted(codes) != sorted(LANGS):
        problems.append(f"LANGUAGES codes {sorted(codes)} != expected {sorted(LANGS)}")
    rtl = re.findall(r'code:\s*"([a-z]+)",[^}]*?rtl:\s*true', meta_block.group(1))
    if rtl != ["ar"]:
        problems.append(f"expected exactly ['ar'] flagged rtl, got {rtl}")

# report
print(f"i18n.ts check — {len(LANGS)} languages, en keys: {len(en_keys)}")
for code in LANGS:
    if code in blocks:
        n = len(blocks[code])
        fb = sum(1 for k, v in blocks[code].items() if code != "en" and v == en_keys.get(k))
        line = f"  {code:>2}: {n}/{len(en_keys)} keys"
        if code != "en" and fb:
            line += f" ({fb} English fallback)"
        print(line)

if problems:
    print(f"\nFAIL — {len(problems)} problem(s):")
    for p in problems:
        print(f"  - {p}")
    sys.exit(1)
print("\nOK — every language block contains every en key, placeholders intact, metadata consistent.")
