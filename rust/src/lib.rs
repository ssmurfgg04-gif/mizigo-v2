//! pricing-core — the MIZIGO money path as a `wasm32-unknown-unknown`
//! cdylib loaded server-side by `src/lib/rust-engine.ts`.
//!
//! # ABI (flat C ABI over linear memory — no wasm-bindgen, no dependencies)
//!
//! | export | signature | meaning |
//! |---|---|---|
//! | `abi_version` | `() -> i32` | ABI revision; the JS loader refuses mismatches |
//! | `fare_params_size` | `() -> i32` | `size_of::<FareParams>()` (104) — lets JS verify its mirror |
//! | `fare_result_size` | `() -> i32` | `size_of::<FareResult>()` (112) |
//! | `alloc` | `(len: i32) -> i32` | bump-allocate `len` bytes (8-aligned), returns the **offset from the heap base** (portable: no 64-bit address truncation) or −1 |
//! | `reset_heap` | `() -> ()` | rewind the bump pointer (once per call, from JS) |
//! | `fare_compute` | `(params: i32, result: i32) -> i32` | compute a fare; args are heap **offsets**; `0` = ok, negative = error |
//! | `dispatch_score` | `(distance_m, eta_min, rating, trips, acceptance, reliability, capacity_headroom_kg, cancellation_rate: f64) -> f64` |
//! | `eta_confidence` | `(eta_min, distance_km: f64) -> f64` |
//!
//! Error codes for `fare_compute`: `0` ok · `-1` pointer outside the heap
//! arena (or null) · `-2` misaligned pointer · `-3` arithmetic overflow.
//! A wasm *trap* (shouldn't happen; `panic = "abort"`) surfaces as a JS
//! exception which the engine wrapper catches → the TS fallback runs.
//!
//! # Memory management
//!
//! Single-threaded bump allocator over a static 16 KiB arena: the JS caller
//! does `reset_heap()` → `alloc(104)` (params) → `alloc(112)` (result) →
//! `fare_compute(p, r)` → read result. All pointer arguments across the ABI
//! are OFFSETS from the arena base (0-based) so the boundary is identical on
//! wasm32 (real target) and a 64-bit host (`cargo test`); JS obtains the
//! absolute base via the `heap_base_addr` export (i64) and writes param bytes
//! at `heap_base_addr + offset` in the wasm buffer. No free, no growth, no threads — the
//! wasm heap is bounded and the per-call state is tiny, which is exactly what
//! a serverless money path wants. (WebAssembly without `--enable-threads` is
//! single-threaded, so the `static` arena is race-free by construction.)
//!
//! # Why this exists
//!
//! Fares are money. The Rust core keeps every additive step in exact i64
//! minor units (KES × 100) so no float drift can ever accumulate in subtotals,
//! minimums or driver earnings, while the five `Math.round` product points are
//! reproduced bit-exactly so the wasm core and the TypeScript fallback (kept
//! as the guaranteed fallback + parity reference in `src/lib/pricing.ts`)
//! can never disagree. See `src/fare.rs` for the full rounding contract and
//! `rust/README.md` for the build/artifact story.

#![allow(clippy::missing_safety_doc)]

pub mod fare;
pub mod scoring;

pub use fare::{compute_fare, FareError, FareParams, FareResult};

/// Bumped by hand whenever the ABI changes in a way the JS loader must know.
pub const ABI_VERSION: i32 = 1;

// ── heap ─────────────────────────────────────────────────────────────────────

const HEAP_SIZE: usize = 16 * 1024;

// Interior-mutable so the arena is placed in a WRITABLE section on every
// target: wasm linear memory is writable by construction, but an immutable
// `static` on a native host lands in read-only .rodata and any param write
// segfaults. UnsafeCell keeps it writable everywhere without unsafe Sync
// exposure (single-threaded by wasm construction; tests serialize access
// through the same JS-style reset/alloc protocol).
#[repr(align(8))]
struct Heap(core::cell::UnsafeCell<[u8; HEAP_SIZE]>);
unsafe impl Sync for Heap {}

#[allow(non_upper_case_globals)]
static HEAP: Heap = Heap(core::cell::UnsafeCell::new([0u8; HEAP_SIZE]));
static mut HEAP_TOP: usize = 0;

#[inline]
fn heap_base() -> usize {
    HEAP.0.get() as usize
}

#[inline]
fn heap_bounds() -> (usize, usize) {
    (heap_base(), heap_base() + HEAP_SIZE)
}

/// Bump-allocate `len` bytes (rounded up to 8-byte alignment). Returns the
/// byte OFFSET from the heap base (always 0..HEAP_SIZE, so it round-trips
/// through i32 on any platform), or −1 if the arena is exhausted.
#[no_mangle]
#[inline(never)]
pub extern "C" fn alloc(len: i32) -> i32 {
    if len < 0 {
        return -1;
    }
    let len = ((len as usize) + 7) & !7;
    unsafe {
        let top = core::ptr::addr_of_mut!(HEAP_TOP);
        let old = *top;
        let new = old.checked_add(len).unwrap_or(usize::MAX);
        if new > HEAP_SIZE {
            return -1;
        }
        *top = new;
        old as i32
    }
}

/// Absolute address of the heap arena as an i64 (never truncates: JS uses it
/// to translate `alloc` offsets into wasm-buffer indices).
#[no_mangle]
#[inline(never)]
pub extern "C" fn heap_base_addr() -> i64 {
    heap_base() as i64
}

/// Rewind the bump pointer. Called by the JS engine before each fare call.
#[no_mangle]
#[inline(never)]
pub extern "C" fn reset_heap() {
    unsafe {
        *core::ptr::addr_of_mut!(HEAP_TOP) = 0;
    }
}

// ── ABI surface ──────────────────────────────────────────────────────────────

#[no_mangle]
pub extern "C" fn abi_version() -> i32 {
    ABI_VERSION
}

#[no_mangle]
pub extern "C" fn fare_params_size() -> i32 {
    core::mem::size_of::<FareParams>() as i32
}

#[no_mangle]
pub extern "C" fn fare_result_size() -> i32 {
    core::mem::size_of::<FareResult>() as i32
}

/// Compute a fare. `params_off`/`result_off` are byte offsets from the heap
/// base, 8-aligned, and must leave room for the full structs. Returns 0 on
/// success or a negative error code — see the module docs.
#[no_mangle]
#[inline(never)]
pub extern "C" fn fare_compute(params_off: i32, result_off: i32) -> i32 {
    if params_off < 0 || result_off < 0 {
        return -1;
    }
    if params_off % 8 != 0 || result_off % 8 != 0 {
        return -2;
    }
    let ps = core::mem::size_of::<FareParams>();
    let rs = core::mem::size_of::<FareResult>();
    let p = params_off as usize;
    let r = result_off as usize;
    // offset + size must stay inside the arena (no overflow: HEAP_SIZE is tiny)
    if p + ps > HEAP_SIZE || r + rs > HEAP_SIZE {
        return -1;
    }
    let base = heap_base();
    let params = unsafe { &*((base + p) as *const FareParams) };
    let result = unsafe { &mut *((base + r) as *mut FareResult) };
    match compute_fare(params) {
        Ok(res) => {
            *result = res;
            0
        }
        Err(_) => -3,
    }
}

/// Weighted driver dispatch score (see `scoring::dispatch_score`).
/// Exported under the name the JS engine expects (`dispatch_score`).
#[no_mangle]
pub extern "C" fn dispatch_score(
    distance_m: f64,
    eta_min: f64,
    rating: f64,
    trips_completed: f64,
    acceptance_rate: f64,
    reliability: f64,
    capacity_headroom_kg: f64,
    cancellation_rate: f64,
) -> f64 {
    scoring::dispatch_score(
        distance_m,
        eta_min,
        rating,
        trips_completed,
        acceptance_rate,
        reliability,
        capacity_headroom_kg,
        cancellation_rate,
    )
}

/// ETA confidence for nearby-driver indicators (see `scoring::eta_confidence`).
/// Exported under the name the JS engine expects (`eta_confidence`).
#[no_mangle]
pub extern "C" fn eta_confidence(eta_min: f64, distance_km: f64) -> f64 {
    scoring::eta_confidence(eta_min, distance_km)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fare::FLAG_MINIMUM_APPLIED;

    #[test]
    fn heap_alloc_is_aligned_and_resettable() {
        unsafe { *core::ptr::addr_of_mut!(HEAP_TOP) = 0 };
        let a = alloc(104);
        assert_eq!(a, 0); // offsets start at the arena base
        let b = alloc(112);
        assert_eq!(b, 104); // sizes rounded to 8 → exact spacing
        assert_eq!(alloc(HEAP_SIZE as i32), -1); // arena exhausted
        assert_eq!(heap_base_addr() > 0, true);
        reset_heap();
        let c = alloc(8);
        assert_eq!(c, 0); // rewound to the start
        reset_heap();
    }

    #[test]
    fn abi_sizes_are_exported() {
        assert_eq!(abi_version(), 1);
        assert_eq!(fare_params_size(), 104);
        assert_eq!(fare_result_size(), 112);
    }

    #[test]
    fn fare_compute_round_trip_through_heap() {
        reset_heap();
        let pp = alloc(core::mem::size_of::<FareParams>() as i32);
        let rp = alloc(core::mem::size_of::<FareResult>() as i32);
        assert_eq!(pp, 0); // first allocation sits at the base
        assert_eq!(rp, 104);

        // write a params struct byte-for-byte the way the JS engine does
        let params = FareParams {
            base_fare: 25000,
            per_km: 5500,
            per_min: 200,
            loading_fee: 15000,
            helper_fee: 0,
            stop_fee: 10000,
            platform_fee: 10000,
            minimum_fare: 35000,
            distance_m: 2300,
            duration_min: 26,
            helpers: 1,
            extra_stops: 1,
            night_permille: 1120,
            schedule_permille: 950,
            discount_permille: 0,
            commission_permille: 150,
            peak_permille: 1000,
        };
        eprintln!("DBG2 pp={} rp={} base={:x}", pp, rp, heap_base());
        unsafe {
            core::ptr::write((heap_base() + pp as usize) as *mut FareParams, params);
        }
        let rc = fare_compute(pp, rp);
        eprintln!("DBG2 rc={}", rc);
        assert_eq!(rc, 0);
        let result = unsafe { core::ptr::read((heap_base() + rp as usize) as *const FareResult) };
        // distance = Math.round(55 × 2.3) = 126 (the JS trap case)
        assert_eq!(result.distance, 12600);
        assert_eq!(result.loading, 15000);
        assert_eq!(result.stops, 10000);
        assert_eq!(result.base, 25000);
        assert_eq!(result.duration, 5200);
        assert!(result.night > 0);
        assert!(result.schedule > 0);
        assert!(result.total > 0);
    }

    #[test]
    fn fare_compute_rejects_bad_pointers() {
        reset_heap();
        let p = alloc(104);
        let r = alloc(112);
        assert_eq!(fare_compute(-1, r), -1); // negative params offset
        assert_eq!(fare_compute(p, -1), -1); // negative result offset
        assert_eq!(fare_compute(p + 1, r), -2); // misaligned
        assert_eq!(fare_compute(p + 4, r), -2); // misaligned
        // 8-aligned but too close to the arena end for a FareParams
        let near_end = (HEAP_SIZE - 8) as i32;
        assert_eq!(fare_compute(near_end, r), -1);
        // aligned but far outside the arena
        assert_eq!(fare_compute(1 << 20, 1 << 20), -1);
        assert_eq!(fare_compute(1, 1), -2); // tiny misaligned
    }

    #[test]
    fn minimum_flag_round_trip() {
        reset_heap();
        let pp = alloc(104);
        let rp = alloc(112);
        let params = FareParams {
            base_fare: 25000,
            per_km: 5500,
            per_min: 200,
            loading_fee: 15000,
            helper_fee: 0,
            stop_fee: 10000,
            platform_fee: 10000,
            minimum_fare: 50000,
            distance_m: 0,
            duration_min: 4,
            helpers: 0,
            extra_stops: 0,
            night_permille: 1000,
            schedule_permille: 1000,
            discount_permille: 0,
            commission_permille: 150,
            peak_permille: 1000,
        };
        unsafe {
            core::ptr::write((heap_base() + pp as usize) as *mut FareParams, params);
        }
        assert_eq!(fare_compute(pp, rp), 0);
        let result = unsafe { core::ptr::read((heap_base() + rp as usize) as *const FareResult) };
        assert_eq!(result.flags & FLAG_MINIMUM_APPLIED, FLAG_MINIMUM_APPLIED);
        assert_eq!(result.total, 50000);
    }
}
