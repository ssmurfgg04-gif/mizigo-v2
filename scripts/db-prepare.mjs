#!/usr/bin/env node
// MIZIGO — provider-aware database preparation.
//
// Runs wherever `prisma generate` used to run (postinstall + build:netlify):
//   DATABASE_URL unset / file:… (sandbox)  → sqlite client from prisma/schema.prisma
//   DATABASE_URL postgres://… (production) → postgres client from
//     prisma/schema.postgres.prisma + `prisma db push --skip-generate`
//     (idempotent; fails loudly on destructive changes so nothing is lost
//     silently in CI)
//
// This is what makes the same codebase run as a zero-config sandbox demo
// (per-instance /tmp SQLite) or a real multi-user deployment (Neon/Supabase/
// any Postgres) purely by setting one environment variable on Netlify.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// npm does not load .env into process.env; prisma CLI does. Mirror that here
// so local dev (file:… in .env) picks the sqlite schema too.
function loadDotEnv() {
  const p = join(root, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadDotEnv();

const url = process.env.DATABASE_URL ?? "";
const isPostgres = /^postgres(ql)?:\/\//.test(url);

if (isPostgres) {
  console.log("▸ db-prepare: DATABASE_URL is Postgres → postgres client + schema push");
  execSync("npx prisma generate --schema prisma/schema.postgres.prisma", { stdio: "inherit", cwd: root });
  execSync("npx prisma db push --schema prisma/schema.postgres.prisma --skip-generate", {
    stdio: "inherit",
    cwd: root,
  });
} else {
  console.log("▸ db-prepare: sandbox mode (no hosted DATABASE_URL) → sqlite client");
  execSync("npx prisma generate --schema prisma/schema.prisma", { stdio: "inherit", cwd: root });
}
