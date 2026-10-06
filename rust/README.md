# pricing-core — the MIZIGO money path in Rust

The fare computation (every shilling a customer is charged) runs in this
no-dependency Rust crate, compiled to `wasm32-unknown-unknown` and loaded
server-side by `src/lib/rust-engine.ts`. The TypeScript implementation in
`src/lib/pricing.ts` stays in the tree as the **guaranteed fallback and the
parity reference**: if the wasm cannot be instantiated, or an input falls
outside the documented bit-exact contract, `priceFor` transparently uses the
TS path. Both paths produce identical results by construction —
`tests/rust/parity.test.ts` proves it across a 1,440-fare production-shaped
grid on every push.

## Why Rust for this

- **Fares are money.** The core keeps every component in exact `i64` minor
  units with `checked_*` arithmetic (overflow is an error, never a wrap), so
  no float drift can accumulate in subtotals, minimums, commissions, or
  driver earnings.
- **Bit-exact with the TS reference.** The five `Math.round` product points
  (base×peak, perKm×km, perMin×min, night surcharge, scheduled discount,
  commission) are reproduced exactly — including the JS float semantics that
  a naive integer port gets wrong on ~0.5% of production-shaped products
  (see `fare.rs`: `ts_round`, `ts_round_kes_minor`).
- **Auditable.** ~400 lines of pure functions, zero dependencies, no
  allocator beyond a 16 KiB bump arena, `panic = "abort"`, `opt-level = "z"`:
  the shipped artifact is **2.7 KB**.

## Layout

| path | role |
|---|---|
| `src/fare.rs` | `FareParams`/`FareResult` (`#[repr(C)]`), `compute_fare`, rounding contract, unit tests |
| `src/scoring.rs` | `dispatch_score` + `eta_confidence` (mirrors of the TS formulas in `src/lib/matching.ts`) |
| `src/lib.rs` | the flat C ABI: `alloc`/`reset_heap`/`heap_base_addr`/`fare_compute`/`dispatch_score`/`eta_confidence`, sizes + ABI version exports |

## The ABI (flat C ABI, offsets — never absolute addresses)

All pointer arguments across the boundary are **byte offsets from the heap
base** (0-based, 8-aligned), so the ABI is identical on wasm32 (the real
target) and a 64-bit host (`cargo test`) — absolute 64-bit addresses would
truncate through `i32`. JS obtains the arena base via `heap_base_addr()`
(`i64`) and writes param bytes at `base + offset` in the wasm buffer.

Flow per call: `reset_heap()` → `alloc(104)` (params) → `alloc(112)`
(result) → write params → `fare_compute(pOff, rOff)` → read result.
Error codes: `0` ok · `-1` out-of-arena/negative · `-2` misaligned ·
`-3` arithmetic overflow. A wasm trap surfaces as a JS exception which
`rust-engine.ts` catches → the TS fallback runs.

The arena is `UnsafeCell` interior-mutable: wasm linear memory is writable by
construction, but an immutable `static` on a native host lands in read-only
`.rodata` and segfaults under `cargo test` (this exact bug shipped once —
see the git history).

## Building

```bash
scripts/build-wasm.sh          # cargo test (host) + wasm build + artifact staging
scripts/build-wasm.sh --skip-tests
```

The script writes two **committed** artifacts:

- `src/wasm/pricing_core.wasm` — the raw module (2.7 KB)
- `src/wasm/pricing_core_b64.ts` — a base64 module the server imports at
  runtime (no filesystem access needed on Netlify, no Rust toolchain to
  deploy)

Named `*_b64.ts` (not `.wasm.ts`) because an import specifier ending in
`.wasm` resolves to a binary asset in webpack and a `.wasm.ts` stem cannot
be imported without `allowImportingTsExtensions`.

## Where each engine runs

| engine | used for | why |
|---|---|---|
| Rust/wasm | `priceFor` fare computation (money path) | strictness + parity-proofed |
| TypeScript | fallback for `priceFor`; `matchDriver` dispatch scoring | the wasm call saves nothing in a candidate loop (identical formula, parity-tested in `tests/rust/dispatch-parity.test.ts`) |

## CI

The wasm artifact is committed, so deploys never need Rust. Rebuild +
parity runs locally via `scripts/build-wasm.sh` and `bun run test`; the CI
`unit` job runs the parity suites on every push, so a regenerated artifact
that drifts from the TS reference fails the build.
