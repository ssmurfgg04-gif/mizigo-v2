// MIZIGO — server-side dispatch fetchers (the db-backed pair for
// matchDriverRing). Lives OUTSIDE matching.ts because matching is also
// imported by client components (DriverApp) and must never pull Prisma /
// node:fs into the browser bundle — the injectable-fetcher design in
// matching.ts keeps the ring algorithm pure and this file is its only seam
// to the database.
import { db } from "@/lib/db";
import type { MatchCandidate } from "@/lib/matching";

/**
 * fetchByCells serves the per-ring query off the Driver.h3Cell index
 * (Prisma's `in` naturally excludes NULL/stale cells — those are exactly what
 * the fallback covers); fetchAll is the legacy full scan the request action
 * used before rings. Include/shape mirrors the action route's candidate query
 * (user name + vehicles with category) so matchDriver filters and scores
 * identically.
 */
export function ringFetcher(): {
  fetchByCells: (cells: string[]) => Promise<MatchCandidate[]>;
  fetchAll: () => Promise<MatchCandidate[]>;
} {
  return {
    fetchByCells: async (cells: string[]) => {
      if (cells.length === 0) return [];
      return db.driver.findMany({
        where: { h3Cell: { in: cells } },
        include: {
          user: { select: { name: true } },
          vehicles: { include: { category: true } },
        },
      });
    },
    fetchAll: async () =>
      db.driver.findMany({
        include: {
          user: { select: { name: true } },
          vehicles: { include: { category: true } },
        },
      }),
  };
}
