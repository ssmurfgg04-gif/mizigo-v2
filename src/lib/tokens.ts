// MIZIGO — share-token hashing (v1 security lesson).
// The public tracking token is a capability: anyone holding it can follow a
// shipment. v1 stored only the sha256 of its delivery tokens; v2 now does the
// same. Raw tokens are minted on demand by the "share-link" action, returned
// once to the requester, and never persisted.

import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function mintToken(): string {
  return randomBytes(18).toString("base64url");
}

// Generate a fresh raw token whose hash is unique in the shipments table.
export async function newShareTokenHashed(): Promise<{ raw: string; hash: string }> {
  let raw = mintToken();
  let hash = hashToken(raw);
  while (await db.shipment.findUnique({ where: { shareToken: hash } })) {
    raw = mintToken();
    hash = hashToken(raw);
  }
  return { raw, hash };
}
