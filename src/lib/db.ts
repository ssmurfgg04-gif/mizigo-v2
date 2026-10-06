import { PrismaClient } from '@prisma/client'
import { accessSync, constants as fsConstants } from 'node:fs'
import { dirname } from 'node:path'

// ── Serverless runtime shim ────────────────────────────────────────────────
// Verified live (Netlify function runtime, Amazon Linux 2023): repo .env files
// do not ship with the bundle and process.env.NETLIFY is NOT set at runtime —
// DATABASE_URL arrives undefined, and the only writable directory is /tmp.
// Decide BEFORE the Prisma client resolves its datasource URL:
//   no DATABASE_URL at all          → /tmp SQLite (serverless sandbox demo)
//   file: URL inside /tmp           → keep (explicit serverless choice)
//   file::memory:                   → keep (in-memory)
//   file: URL elsewhere, writable   → keep (local dev with the repo DB)
//   file: URL elsewhere, read-only  → /tmp SQLite (read-only function bundle)
//   any other URL (postgres:// …)   → keep untouched (hosted DB)
function resolveRuntimeDbUrl(): string | undefined {
  const url = process.env.DATABASE_URL
  if (!url) return 'file:/tmp/mizigo.db'
  if (!url.startsWith('file:')) return undefined
  if (url.startsWith('file:/tmp/') || url.startsWith('file::memory:')) return undefined
  const filePath = url.slice('file:'.length).replace(/\?.*$/, '')
  try {
    accessSync(filePath, fsConstants.W_OK) // existing, writable DB file
    return undefined
  } catch {
    try {
      accessSync(dirname(filePath), fsConstants.W_OK) // dir writable → file can be created
      return undefined
    } catch {
      return 'file:/tmp/mizigo.db' // read-only bundle (e.g. /var/task on Lambda)
    }
  }
}

const runtimeDbUrl = resolveRuntimeDbUrl()
if (runtimeDbUrl) process.env.DATABASE_URL = runtimeDbUrl

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
