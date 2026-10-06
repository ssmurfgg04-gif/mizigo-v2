// MIZIGO — Rust/WASM pricing core loader.
//
// The money path (fare computation) runs in a Rust cdylib compiled to
// wasm32-unknown-unknown (rust/ crate → src/wasm/pricing_core.wasm, base64-
// embedded so deploys need no filesystem access and no Rust toolchain).
// The TypeScript implementation in src/lib/pricing.ts stays as the guaranteed
// fallback + parity reference: if the wasm cannot be instantiated, or the
// inputs fall outside the bit-exact contract, the caller transparently uses
// the TS path instead. See rust/README.md for the build story.
//
// The module is 2.7 KB, so it is compiled synchronously on first use —
// priceFor's sync signature stays intact and no call site changes.
//
// ABI (flat C ABI over linear memory — offsets, never absolute addresses):
//   abi_version() -> i32          (must be 1)
//   fare_params_size() -> i32     (104)
//   fare_result_size() -> i32     (112)
//   heap_base_addr() -> i64       absolute base of the 16 KiB arena
//   alloc(len) -> i32             bump-allocate; returns a 0-based byte offset
//   reset_heap()                  rewind the bump cursor
//   fare_compute(paramsOff, resultOff) -> i32   0 ok, negative = error
//   dispatch_score(8×f64) -> f64  (parity reference; matching stays on TS)
//   eta_confidence(2×f64) -> f64

import { PRICING_CORE_WASM_B64 } from "@/wasm/pricing_core_b64";

export interface RustFareParams {
  baseFare: number; // minor units (KES × 100)
  perKm: number;
  perMin: number;
  loadingFee: number;
  helperFee: number; // 0 — TS has no second helper fee
  stopFee: number;
  platformFee: number;
  minimumFare: number;
  distanceM: number; // km × 1000, integer
  durationMin: number; // whole minutes
  helpers: number;
  extraStops: number;
  nightPermille: number; // 1120 = ×1.12, 1000 = off
  schedulePermille: number; // 950 = −5%, 1000 = off
  discountPermille: number; // 0 — promos are applied by the quote route
  commissionPermille: number; // 150 = 15%
  peakPermille: number; // 1250 = ×1.25, 1000 = off
}

export interface RustFareResult {
  total: number;
  subtotal: number;
  base: number;
  distance: number;
  duration: number;
  loading: number;
  stops: number;
  night: number;
  schedule: number;
  discount: number;
  platform: number;
  commission: number;
  driverEarnings: number;
  minimumApplied: boolean;
}

interface PricingCoreExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  abi_version(): number;
  fare_params_size(): number;
  fare_result_size(): number;
  heap_base_addr(): bigint;
  alloc(len: number): number;
  reset_heap(): void;
  fare_compute(paramsOff: number, resultOff: number): number;
  dispatch_score(
    distanceM: number, etaMin: number, rating: number, trips: number,
    acceptance: number, reliability: number, capacityHeadroomKg: number,
    cancellationRate: number,
  ): number;
  eta_confidence(etaMin: number, distanceKm: number): number;
}

const ABI_VERSION = 1;
const PARAMS_SIZE = 104;
const RESULT_SIZE = 112;

interface Engine { exports: PricingCoreExports; view: DataView }

// one instantiation per process, cached like the Prisma client (warm
// serverless instances reuse it; cold starts pay a sub-millisecond sync
// compile for 2.7 KB of wasm)
const globalForEngine = globalThis as unknown as { __mizigoPricingCore?: Engine | null };

function decode(): ArrayBuffer {
  // window.atob is not available in all runtimes; Node's Buffer is. Both
  // paths land in a plain ArrayBuffer so WebAssembly.Module gets a clean
  // BufferSource regardless of TS lib variance.
  if (typeof Buffer !== "undefined") {
    const b = Buffer.from(PRICING_CORE_WASM_B64, "base64");
    const ab = new ArrayBuffer(b.byteLength);
    new Uint8Array(ab).set(b);
    return ab;
  }
  const bin = atob(PRICING_CORE_WASM_B64);
  const ab = new ArrayBuffer(bin.length);
  const bytes = new Uint8Array(ab);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return ab;
}

function getEngine(): Engine | null {
  if (globalForEngine.__mizigoPricingCore !== undefined) return globalForEngine.__mizigoPricingCore;
  try {
    const mod = new WebAssembly.Module(decode());
    const inst = new WebAssembly.Instance(mod, {});
    const exports = inst.exports as unknown as PricingCoreExports;
    if (
      typeof exports.abi_version !== "function" || exports.abi_version() !== ABI_VERSION ||
      exports.fare_params_size() !== PARAMS_SIZE || exports.fare_result_size() !== RESULT_SIZE
    ) {
      console.error("[rust-engine] ABI mismatch — TypeScript pricing fallback active");
      globalForEngine.__mizigoPricingCore = null;
      return null;
    }
    globalForEngine.__mizigoPricingCore = { exports, view: new DataView(exports.memory.buffer) };
  } catch (err) {
    console.error("[rust-engine] wasm instantiate failed — TS fallback active:", err);
    globalForEngine.__mizigoPricingCore = null;
  }
  return globalForEngine.__mizigoPricingCore ?? null;
}

/**
 * Compute a fare through the Rust core. Returns null whenever the wasm path
 * is unavailable or the input is rejected — callers must then use the
 * TypeScript reference implementation (identical results by construction;
 * see tests/rust/parity.test.ts).
 */
export function computeFareRust(p: RustFareParams): RustFareResult | null {
  const eng = getEngine();
  if (!eng) return null;
  try {
    const { exports, view } = eng;
    // write params exactly the way the ABI documents them
    exports.reset_heap();
    const pOff = exports.alloc(PARAMS_SIZE);
    const rOff = exports.alloc(RESULT_SIZE);
    if (pOff < 0 || rOff < 0) return null;
    const base = Number(exports.heap_base_addr());
    const w = base + pOff;
    view.setBigInt64(w + 0, BigInt(Math.round(p.baseFare)), true);
    view.setBigInt64(w + 8, BigInt(Math.round(p.perKm)), true);
    view.setBigInt64(w + 16, BigInt(Math.round(p.perMin)), true);
    view.setBigInt64(w + 24, BigInt(Math.round(p.loadingFee)), true);
    view.setBigInt64(w + 32, BigInt(Math.round(p.helperFee)), true);
    view.setBigInt64(w + 40, BigInt(Math.round(p.stopFee)), true);
    view.setBigInt64(w + 48, BigInt(Math.round(p.platformFee)), true);
    view.setBigInt64(w + 56, BigInt(Math.round(p.minimumFare)), true);
    view.setInt32(w + 64, Math.round(p.distanceM), true);
    view.setInt32(w + 68, Math.round(p.durationMin), true);
    view.setInt32(w + 72, Math.round(p.helpers), true);
    view.setInt32(w + 76, Math.round(p.extraStops), true);
    view.setUint32(w + 80, Math.round(p.nightPermille), true);
    view.setUint32(w + 84, Math.round(p.schedulePermille), true);
    view.setUint32(w + 88, Math.round(p.discountPermille), true);
    view.setUint32(w + 92, Math.round(p.commissionPermille), true);
    view.setUint32(w + 96, Math.round(p.peakPermille), true);

    const rc = exports.fare_compute(pOff, rOff);
    if (rc !== 0) return null;

    const r = base + rOff;
    const g = (off: number) => Number(view.getBigInt64(r + off, true));
    return {
      total: g(0),
      subtotal: g(8),
      base: g(16),
      distance: g(24),
      duration: g(32),
      loading: g(40),
      stops: g(48),
      night: g(56),
      schedule: g(64),
      discount: g(72),
      platform: g(80),
      commission: g(88),
      driverEarnings: g(96),
      minimumApplied: (view.getUint8(r + 104) & 0b1) === 1,
    };
  } catch (err) {
    console.error("[rust-engine] computeFare failed — TS fallback active:", err);
    return null;
  }
}

/** Dispatch-score parity hook (matching runs on TS; see rust/README.md). */
export function dispatchScoreRust(
  distanceKm: number, etaMin: number, rating: number, tripsCompleted: number,
  acceptanceRate: number, reliability: number, capacityHeadroomKg: number, cancellationRate: number,
): number | null {
  const eng = getEngine();
  if (!eng) return null;
  try {
    return eng.exports.dispatch_score(
      distanceKm * 1000, etaMin, rating, tripsCompleted,
      acceptanceRate, reliability, capacityHeadroomKg, cancellationRate,
    );
  } catch {
    return null;
  }
}

/** ETA-confidence parity hook. */
export function etaConfidenceRust(etaMin: number, distanceKm: number): number | null {
  const eng = getEngine();
  if (!eng) return null;
  try {
    return eng.exports.eta_confidence(etaMin, distanceKm);
  } catch {
    return null;
  }
}

/**
 * The wasm core is only used when the inputs are inside the documented
 * bit-exact contract (≤3-decimal km, whole minutes); otherwise the TS
 * reference path decides. Exported for the parity suite.
 */
export function withinRustContract(input: { distanceKm: number; durationMin: number }): boolean {
  const m = input.distanceKm * 1000;
  return Number.isInteger(m) && Number.isInteger(input.durationMin) &&
    m > -2_000_000 && m < 2_000_000;
}

/** Test hook: force the cached engine to null to exercise the fallback. */
export function __disableRustEngineForTests(): void {
  globalForEngine.__mizigoPricingCore = null;
}
