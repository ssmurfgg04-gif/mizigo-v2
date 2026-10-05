#!/usr/bin/env python3
"""Wire ensureDB() into every API route handler (serverless cold-start bootstrap).

- Routes that already call ensureSeed() get it swapped for ensureDB().
- Every other handler gets `await ensureDB();` as its first statement.
- Import added/updated accordingly.
"""
import re
from pathlib import Path

API = Path("src/app/api")
IMPORT_RE = re.compile(r'^import .*?;$', re.M)
HANDLER_RE = re.compile(r'^(export async function (?:GET|POST|PUT|PATCH|DELETE)\([^)]*\)[^\n]*\{)$', re.M)

changed = []
for f in sorted(API.rglob("route.ts")):
    if f.parent == API:  # root health check — no DB
        continue
    src = f.read_text()
    orig = src

    # swap ensureSeed → ensureDB (import + calls)
    src = src.replace('import { ensureSeed } from "@/lib/seed";', 'import { ensureDB } from "@/lib/db-ready";')
    src = re.sub(r'await ensureSeed\(\);', 'await ensureDB();', src)

    # insert into handlers missing it
    def insert(m):
        return m.group(1) + "\n  await ensureDB();"
    out_lines, offset, skip = [], 0, False
    lines = src.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        m = re.match(r'^export async function (GET|POST|PUT|PATCH|DELETE)\(', line)
        if m and line.rstrip().endswith("{"):
            # find end of handler (line that is exactly "}" at col 0)
            j, has_db = i + 1, False
            while j < len(lines) and lines[j] != "}":
                if "ensureDB()" in lines[j]:
                    has_db = True
                j += 1
            if not has_db:
                lines.insert(i + 1, "  await ensureDB();")
        i += 1
    src = "\n".join(lines)

    # ensure import exists (only if we reference ensureDB)
    if "ensureDB" in src and 'from "@/lib/db-ready"' not in src:
        imports = list(IMPORT_RE.finditer(src))
        last = imports[-1]
        src = src[:last.end()] + '\nimport { ensureDB } from "@/lib/db-ready";' + src[last.end():]

    if src != orig:
        f.write_text(src)
        changed.append(str(f))

print(f"patched {len(changed)} files:")
for c in changed:
    print(" -", c)
