#!/usr/bin/env node
// MIZIGO copy lint — user-facing text consistency checks.
//
// Scans every .tsx under src/ plus every .ts/.tsx under src/app/ (API route
// error messages are user-facing) and lints the COPY, not the code:
//
//   em-dash/double       "——" inside user-facing text
//   em-dash/unspaced     a single "—" that is not the house-style separator
//                        " — " (space on both sides, mid-string). The spaced
//                        em-dash is the established separator across the app
//                        ("Fare locked — no surprises"), so it is allowed;
//                        doubled, glued or edge-positioned ones are not.
//   spacing/double-space two or more consecutive spaces inside text
//   ellipsis/mixed       "..." and "…" must not be mixed — whichever is
//                        dominant in the tree is the house style; the other
//                        one is flagged (census printed every run)
//   quotes/curly         curly apostrophes ’ ‘ in user-facing text (house
//                        style is straight apostrophes only). Curly double
//                        quotes “ ” used for quoting content are reported as
//                        WARNINGS, not failures.
//   placeholders/        TODO / FIXME / HACK / "coming soon" in user-visible
//   unfinished           strings — unfinished copy must not ship in the UI
//
// False-positive control matters more than coverage: className/style/src
// attribute values, class-helper (cn/clsx/cva/twMerge) arguments, module
// specifiers, object keys and interpolated template literals are skipped;
// intentional strings are exempted in scripts/lint-copy-allowlist.json.
//
// Exit 0 = clean (warnings allowed), exit 1 = violations found.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST_PATH = join(ROOT, "scripts", "lint-copy-allowlist.json");

function dirname(p) {
  const parts = p.split("/");
  parts.pop();
  return parts.join("/") || "/";
}

// ─── collect files: src/**/*.tsx + src/app/**/*.{ts,tsx} ─────────────────────

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const allFiles = walk(join(ROOT, "src"), []);
const FILES = allFiles.filter((f) => {
  const rel = relative(ROOT, f);
  if (rel.endsWith(".tsx")) return true; // every .tsx under src/
  if (rel.startsWith("src/app/") && rel.endsWith(".ts")) return true; // api routes
  return false;
});

// ─── allowlist ───────────────────────────────────────────────────────────────

const allowEntries = existsSync(ALLOWLIST_PATH)
  ? JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")).allow ?? []
  : [];

function isAllowed(unit) {
  return allowEntries.some(
    (e) =>
      typeof e.string === "string" &&
      e.string === unit.text &&
      (!e.file || unit.file.startsWith(e.file))
  );
}

// ─── extract user-facing text units from the AST ─────────────────────────────

// attributes whose values are machine-facing, not copy
const SKIP_ATTRS = new Set([
  "className", "class", "style", "css", "id", "key", "src", "href", "url",
  "path", "action", "d", "testid", "data-testid", "xlinkHref", "viewBox",
  "stroke", "fill", "strokeLinecap", "strokeLinejoin", "clipPath", "filter",
  "gradientUnits", "offset", "xmlns", "charSet", "httpEquiv", "name", "property",
]);
// calls whose string arguments are class names / technical tokens, not copy
const SKIP_CALLS = new Set(["cn", "clsx", "cx", "cva", "twMerge"]);

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** Flatten JSX text the way a browser does: newline+indent runs → one space. */
function flattenJsx(raw) {
  return decodeEntities(raw.replace(/[ \t]*\n[ \t]*/g, " ")).trim();
}

function extractUnits(file) {
  const content = readFileSync(file, "utf8");
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, kind);
  const units = [];

  const visit = (node, parent) => {
    // JSX text nodes → copy
    if (ts.isJsxText(node)) {
      const text = flattenJsx(node.getText(sf));
      if (text) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        units.push({ file: relative(ROOT, file), line: line + 1, text, kind: "jsx" });
      }
    }

    // string literals + no-substitution template literals → maybe copy
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      !isTechnical(node, parent)
    ) {
      const text = decodeEntities(node.text).trim();
      if (text) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        units.push({ file: relative(ROOT, file), line: line + 1, text, kind: "string" });
      }
    }

    node.forEachChild((child) => visit(child, node));
  };
  sf.forEachChild((child) => visit(child, sf));
  return units;
}

function isTechnical(node, parent) {
  if (!parent) return false;
  // import/export module specifiers
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  // object keys / enum members / property names
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isEnumMember(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent)) &&
    parent.name === node
  ) {
    return true;
  }
  // machine-facing JSX attributes
  if (ts.isJsxAttribute(parent) && ts.isIdentifier(parent.name) && SKIP_ATTRS.has(parent.name.text)) {
    return true;
  }
  // class-helper call arguments
  if (ts.isCallExpression(parent)) {
    const callee = parent.expression;
    const name = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)
        ? callee.name.text
        : "";
    if (SKIP_CALLS.has(name)) return true;
  }
  return false;
}

// ─── rules ────────────────────────────────────────────────────────────────────

const ELLIPSIS_CHAR = "…";
const ELLIPSIS_DOTS = "...";

function excerpt(text, max = 90) {
  const t = text.length > max ? text.slice(0, max - 1) + "…" : text;
  return t.replace(/\n/g, " ");
}

function runRules(units) {
  // pass 1 — ellipsis census (house style = the dominant form)
  let charCount = 0;
  let dotsCount = 0;
  for (const u of units) {
    if (u.text.includes(ELLIPSIS_CHAR)) charCount++;
    if (u.text.includes(ELLIPSIS_DOTS)) dotsCount++;
  }
  const houseEllipsis = charCount >= dotsCount ? ELLIPSIS_CHAR : ELLIPSIS_DOTS;
  const strayEllipsis = houseEllipsis === ELLIPSIS_CHAR ? ELLIPSIS_DOTS : ELLIPSIS_CHAR;

  const errors = [];
  const warns = [];

  for (const u of units) {
    const allowed = isAllowed(u);
    const push = (rule, list = errors) => {
      if (!allowed) list.push({ ...u, rule });
    };
    const text = u.text;

    // (a) em-dashes — house style is the mid-string " — " separator.
    // JSX text is split into fragments at {interpolation} boundaries, so a
    // fragment that starts/ends with "— " / " —" is usually the half of a
    // properly-spaced rendered pair → tolerated for jsx units, strict for
    // string literals.
    if (text.includes("——")) {
      push("em-dash/double");
    } else if (text.includes("—")) {
      const len = text.length;
      const bad = [...text].some((ch, i) => {
        if (ch !== "—") return false;
        const prev = i > 0 ? text[i - 1] : null;
        const next = i < len - 1 ? text[i + 1] : null;
        const startOk = u.kind === "jsx" && i === 0 && next === " ";
        const endOk = u.kind === "jsx" && i === len - 1 && prev === " ";
        if (startOk || endOk) return false;
        return prev !== " " || next !== " "; // glued / edge em-dash
      });
      if (bad) push("em-dash/unspaced");
    }

    // (b) double spaces (text is already JSX-flattened + trimmed)
    if (/ {2,}/.test(text)) push("spacing/double-space");

    // (c) ellipsis consistency
    if (text.includes(strayEllipsis)) push("ellipsis/mixed");

    // (d) straight apostrophes only; curly double quotes → warn
    if (/[’‘]/.test(text)) push("quotes/curly-apostrophe");
    if (/[“”]/.test(text)) push("quotes/curly-double", warns);

    // (e) unfinished placeholder copy
    if (/\bTODO\b|\bFIXME\b|\bHACK\b|coming soon/i.test(text)) {
      push("placeholders/unfinished");
    }
  }

  return { errors, warns, census: { houseEllipsis, charCount, dotsCount } };
}

// ─── main ─────────────────────────────────────────────────────────────────────

const units = FILES.flatMap((f) => {
  try {
    return extractUnits(f);
  } catch (err) {
    console.error(`parse failed: ${relative(ROOT, f)} — ${err.message}`);
    process.exitCode = 2;
    return [];
  }
});

const { errors, warns, census } = runRules(units);

const rel = (f) => f;
console.log(`copy lint — ${FILES.length} files, ${units.length} user-facing text units`);
console.log(
  `census: ellipsis "${census.houseEllipsis}" is the house style ` +
    `(${census.charCount} strings use "…", ${census.dotsCount} use "...")`
);

if (warns.length) {
  console.log(`\nwarnings (${warns.length}) — informational, do not fail CI:`);
  for (const w of warns) {
    console.log(`  [${w.rule}] ${w.file}:${w.line}`);
    console.log(`    “${excerpt(w.text)}”`);
  }
}

if (errors.length) {
  console.error(`\nviolations (${errors.length}):`);
  for (const v of errors) {
    console.error(`  [${v.rule}] ${rel(v.file)}:${v.line}`);
    console.error(`    “${excerpt(v.text)}”`);
  }
  console.error(
    `\ncopy lint: ${errors.length} violation(s). ` +
      `Fix the copy, or add a reasoned entry to scripts/lint-copy-allowlist.json.`
  );
  process.exit(1);
} else {
  console.log("\ncopy lint: clean");
}
