// MIZIGO — runtime feature flags (perf task 10-E).
//
// Flags default to the mode the deployment runs in and can be overridden
// explicitly with environment variables. Read at call time (cheap) so tests
// and runtime env changes are reflected without a rebuild.

function isPostgresUrl(url: string | undefined): boolean {
  return /^postgres(ql)?:\/\//.test(url ?? "");
}

/** True when the runtime DATABASE_URL points at hosted Postgres (production mode). */
export function dbIsPostgres(): boolean {
  return isPostgresUrl(process.env.DATABASE_URL);
}

/**
 * DEMO_AUTO_PROGRESS — sandbox auto-advance (poll-driven driver simulation,
 * seeded quote submission, auto-accept). ON by default in the SQLite sandbox
 * (the live demo behaves exactly as before), OFF by default in Postgres
 * production mode. Explicit env override always wins:
 *   DEMO_AUTO_PROGRESS=false → never auto-progress (even in sandbox)
 *   DEMO_AUTO_PROGRESS=true  → always auto-progress (even on Postgres)
 */
export function isDemoAutoProgress(): boolean {
  const raw = (process.env.DEMO_AUTO_PROGRESS ?? "").trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off") return false;
  if (raw === "true" || raw === "1" || raw === "on") return true;
  // default: sandbox yes, production no
  return !dbIsPostgres();
}

/** All flags in one object (bootstrap build info / ops surfaces). */
export function featureFlags(): { demoAutoProgress: boolean } {
  return { demoAutoProgress: isDemoAutoProgress() };
}
