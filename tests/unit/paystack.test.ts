// Paystack wiring unit tests — the pure money-safety primitives.
// Integration coverage (webhook dispatch against a real DB) lives in
// paystack-webhook.test.ts; these tests need zero I/O.
import { describe, it, expect } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import {
  verifyPaystackSignature,
  paystackTxReference,
  paystackTransferReference,
  encryptSecret,
  decryptSecret,
} from "../../src/lib/integrations/paystack";

const SECRET = "sk_test_" + "x".repeat(32);

describe("verifyPaystackSignature (webhook HMAC-SHA512, blueprint §d)", () => {
  const body = JSON.stringify({ event: "charge.success", data: { reference: "MZG482913A1", amount: 300000 } });
  const good = createHmac("sha512", SECRET).update(body, "utf8").digest("hex");

  it("accepts a correctly signed raw body", () => {
    expect(verifyPaystackSignature(body, good, SECRET)).toBe(true);
  });
  it("rejects a tampered body (signature no longer matches)", () => {
    expect(verifyPaystackSignature(body.replace("300000", "1"), good, SECRET)).toBe(false);
  });
  it("rejects a wrong signature", () => {
    expect(verifyPaystackSignature(body, "f".repeat(128), SECRET)).toBe(false);
  });
  it("rejects a signature signed with a different secret", () => {
    const other = createHmac("sha512", "sk_live_other").update(body, "utf8").digest("hex");
    expect(verifyPaystackSignature(body, other, SECRET)).toBe(false);
  });
  it("rejects empty/short garbage without throwing", () => {
    expect(verifyPaystackSignature(body, "", SECRET)).toBe(false);
    expect(verifyPaystackSignature("", good, SECRET)).toBe(false);
    expect(verifyPaystackSignature(body, "abc", SECRET)).toBe(false);
  });
});

describe("reference builders (blueprint §11.5 — two different charsets)", () => {
  it("transaction references use NO underscores (Paystack rejects them)", () => {
    const ref = paystackTxReference("MZG-482913", 2);
    expect(ref).toBe("MZG482913A2");
    expect(ref).toMatch(/^[A-Za-z0-9\-=.]+$/);
    expect(ref).not.toContain("_");
  });
  it("transaction references increment the attempt counter", () => {
    expect(paystackTxReference("MZG-482913", 1)).not.toBe(paystackTxReference("MZG-482913", 2));
    expect(paystackTxReference("MZG-482913", 0)).toBe(paystackTxReference("MZG-482913", 1)); // clamped ≥1
  });
  it("transfer references are ≥16 chars, lowercase [a-z0-9_-] (the transfer charset)", () => {
    const ref = paystackTransferReference("MZG-482913", 1);
    expect(ref).toBe("po-mzg-482913-01");
    expect(ref.length).toBeGreaterThanOrEqual(16);
    expect(ref.length).toBeLessThanOrEqual(50);
    expect(ref).toMatch(/^[a-z0-9_-]+$/);
  });
  it("pads short codes to keep the 16-char floor", () => {
    expect(paystackTransferReference("MZG-4829", 1)).toBe("po-mzg-004829-01");
  });
  it("transfer references are stable per sequence (retry key — never regenerate)", () => {
    expect(paystackTransferReference("MZG-482913", 3)).toBe("po-mzg-482913-03");
  });
});

describe("encrypted DB key storage (blueprint §g.2 — AES-256-GCM)", () => {
  const master = randomBytes(32).toString("base64");
  it("round-trips a secret", () => {
    const blob = encryptSecret(SECRET, master);
    expect(blob.startsWith("v1:")).toBe(true);
    expect(blob).not.toContain(SECRET);
    expect(decryptSecret(blob, master)).toBe(SECRET);
  });
  it("fails on the wrong master key (GCM auth tag)", () => {
    const blob = encryptSecret(SECRET, master);
    expect(() => decryptSecret(blob, randomBytes(32).toString("base64"))).toThrow();
  });
  it("fails on a tampered ciphertext", () => {
    const blob = encryptSecret(SECRET, master);
    const parts = blob.split(":");
    parts[3] = Buffer.from("hacked").toString("base64");
    expect(() => decryptSecret(parts.join(":"), master)).toThrow();
  });
  it("rejects malformed blobs", () => {
    expect(() => decryptSecret("not-a-blob", master)).toThrow();
  });
});
