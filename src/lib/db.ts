import { PrismaClient } from '@prisma/client'

// ── Serverless runtime shim ────────────────────────────────────────────────
// On Netlify (and any read-only-bundle host) the SQLite file must live in /tmp,
// the only writable directory. Each warm function instance keeps its own DB and
// ensureDB() (src/lib/db-ready.ts) bootstraps schema + demo seed on cold start.
// Local dev is untouched: the repo DB (prisma db push) is used as-is.
if (process.env.NETLIFY && !process.env.DATABASE_URL?.startsWith('file:/tmp/')) {
  process.env.DATABASE_URL = 'file:/tmp/mizigo.db'
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'production'
        ? ['error'] as const
        : (['query', 'error', 'warn'] as const),
  })

// cache across warm invocations in every environment (avoids connection storms)
globalForPrisma.prisma = db
