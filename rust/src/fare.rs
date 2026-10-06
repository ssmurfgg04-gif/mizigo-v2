//! Fare computation — the MIZIGO money path.
//!
//! This mirrors `src/lib/pricing.ts` (`priceForTS`) EXACTLY, including its
//! rounding behaviour, so the wasm core and the TypeScript fallback can never
//! disagree on a fare. Money is carried in **minor units (KES × 100)** as i64
//! for every additive step (no float drift can accumulate in sums, subtotals,
//! minimums or driver earnings).
//!
//! # Rounding contract (read this before touching anything)
//!
//! The TS reference rounds five *products* to whole KES with `Math.round`
//! (half toward +∞) on a **float64** product:
//!
//! ```ts
//! base      = Math.round(baseFare   * peak);            // peak = 1 when off
//! distance  = Math.round(perKmRate  * distanceKm);
//! duration  = Math.round(perMinRate * durationMin);
//! night     = Math.round(S * (nightMultiplier - 1));    // S = base+distance+duration
//! schedule  = Math.round(S * scheduledDiscount);
//! commission= Math.round(total * commissionRate);
//! ```
//!
//! A naive "exact rational, round half up" implementation was measured against
//! TS over 3.17M production-shaped products (whole-KES rates × 1–3 decimal
//! kilometres, realistic multipliers/rates): it disagrees on **15,487** cases
//! (e.g. `Math.round(55 * 2.3)` → 126 because `fl(2.3) = 2.29999999999999982`
//! and the float product lands *below* 126.5 while the exact rational is
//! exactly 126.5). Therefore the products are computed in f64 here with
//! operands reconstructed **bit-identically** to the TS pipeline, and rounded
//! with `ts_round` (exact `Math.round` semantics — notably NOT `floor(x+0.5)`,
//! which is wrong for x = 0.49999999999999994). Everything else — sums,
//! minimums, subtractions, driver earnings — is exact i64 minor-unit math.
//!
//! Operand reconstruction (all exact whenever the DB values have at most the
//! stated precision — true for every seeded/admin-realistic value):
//!
//! | TS operand                | here                                    | exact for  |
//! |---------------------------|-----------------------------------------|------------|
//! | `baseFare` (KES double)   | `minor as f64 / 100.0`                  | ≤ 2 decimals |
//! | `peakMultiplier`          | `permille as f64 / 1000.0`              | ≤ 3 decimals |
//! | `distanceKm`              | `distance_m as f64 / 1000.0`            | ≤ 3 decimals (production sends 1) |
//! | `nightMultiplier - 1`     | `permille as f64 / 1000.0 - 1.0` (exact subtraction) | ≤ 3 decimals |
//! | `scheduledDiscount`       | `(1000 - schedule_permille) as f64 / 1000.0` | ≤ 3 decimals |
//! | `commissionRate`          | `permille as f64 / 1000.0`              | ≤ 3 decimals |
//!
//! Inputs are therefore *quantised* by the ABI: rates to cents, multipliers /
//! rates-of-change to permille, distance to metres, duration to whole
//! minutes. Production callers (`/api/quote`, `/api/shipments`, the return-load
//! comparison) all send whole-KES rates, 1-decimal km and integer minutes, so
//! parity is exact end to end; the parity suite (`tests/rust/parity.test.ts`)
//! enforces this on thousands of vectors.

use core::fmt;

/// `Math.round` semantics: nearest integer, halves toward +∞.
/// NOT `(x + 0.5).floor()` — that mis-rouunds x = 0.49999999999999994 (and JS
/// `Math.round` is specified as "if frac is exactly 0.5, toward +∞").
#[inline]
pub(crate) fn ts_round(x: f64) -> f64 {
    let f = x.floor();
    if x - f >= 0.5 {
        f + 1.0
    } else {
        f
    }
}

/// A product rounded to whole KES, returned in minor units (× 100).
/// `x` is the f64 product exactly as TS would have computed it.
#[inline]
fn ts_round_kes_minor(x: f64) -> i64 {
    (ts_round(x) * 100.0) as i64
}

#[inline]
fn minor_to_kes_f64(minor: i64) -> f64 {
    minor as f64 / 100.0
}

#[inline]
fn permille_to_f64(permille: u32) -> f64 {
    permille as f64 / 1000.0
}

/// Fare inputs. All money fields are minor units (KES × 100).
///
/// Layout (repr(C), little-endian, 8-byte aligned — offsets in comments;
/// `fare_params_size()` exports `size_of::<FareParams>()` so the JS side can
/// verify its mirror instead of hard-coding):
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FareParams {
    /// 0: category.baseFare (minor units)
    pub base_fare: i64,
    /// 8: category.perKmRate (minor units per km)
    pub per_km: i64,
    /// 16: category.perMinRate (minor units per minute)
    pub per_min: i64,
    /// 24: category.loadingFee (minor units, per helper)
    pub loading_fee: i64,
    /// 32: reserved second per-helper fee — the TS pipeline has no such fee,
    /// wiring MUST pass 0 (kept for ABI completeness; parity requires 0).
    pub helper_fee: i64,
    /// 40: category.extraStopFee (minor units, per stop)
    pub stop_fee: i64,
    /// 48: zone.platformFee (minor units, flat)
    pub platform_fee: i64,
    /// 56: category.minimumFare (minor units)
    pub minimum_fare: i64,
    /// 64: distance in metres (km × 1000)
    pub distance_m: i32,
    /// 68: minutes on the road (whole minutes; production always sends integers)
    pub duration_min: i32,
    /// 72: loading-assistance helper count
    pub helpers: i32,
    /// 76: extra stop count
    pub extra_stops: i32,
    /// 80: night multiplier in permille — 1120 = ×1.12, 1000 = off
    pub night_permille: u32,
    /// 84: scheduled-price multiplier in permille — 950 = −5%, 1000 = off
    pub schedule_permille: u32,
    /// 88: promo discount rate in permille — 100 = −10%, 0 = off.
    /// Reserved: priceFor has no promo (the quote route applies promos on top
    /// of fare.total), so parity wiring always passes 0.
    pub discount_permille: u32,
    /// 92: platform commission rate in permille — 150 = 15%
    pub commission_permille: u32,
    /// 96: peak multiplier in permille — 1250 = ×1.25, 1000 = off
    pub peak_permille: u32,
}

/// Fare output, all minor units. `total/subtotal/night/schedule/discount/
/// platform` are the mandated fields; the remaining components exist so the
/// TS fallback and the wasm core can be compared field by field and the
/// receipt `lines` can be rebuilt without a second computation.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FareResult {
    /// 0: final total charged (after minimum, before any route-level promo)
    pub total: i64,
    /// 8: subtotal before the minimum-fare floor
    pub subtotal: i64,
    /// 16: base transport component
    pub base: i64,
    /// 24: distance component
    pub distance: i64,
    /// 32: duration component
    pub duration: i64,
    /// 40: loading assistance component
    pub loading: i64,
    /// 48: extra stops component
    pub stops: i64,
    /// 56: night surcharge component
    pub night: i64,
    /// 60 → 64: planned-delivery discount component (positive number, subtracted)
    pub schedule: i64,
    /// 72: reserved engine-side promo discount (wiring sends 0)
    pub discount: i64,
    /// 80: flat platform fee
    pub platform: i64,
    /// 88: platform commission
    pub commission: i64,
    /// 96: driver earnings = total − platform − commission
    pub driver_earnings: i64,
    /// 104: flags — bit0: minimum fare applied, bit1: promo discount applied
    pub flags: u8,
}

/// Bit indices into `FareResult::flags`.
pub const FLAG_MINIMUM_APPLIED: u8 = 1 << 0;
pub const FLAG_DISCOUNT_APPLIED: u8 = 1 << 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FareError {
    /// An intermediate exceeded i64 minor units (≥ ~92 trillion KES).
    Overflow,
}

impl fmt::Display for FareError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FareError::Overflow => write!(f, "fare overflow"),
        }
    }
}

/// Round a product `value_minor × permille / 1000` to whole KES using exact
/// `Math.round` semantics on the f64 product. This is *the* parity-critical
/// rounding helper — see the module docs before "simplifying" it to integer
/// math (a pure-integer variant was measured to disagree with TS on ~0.5% of
/// production-shaped products).
#[inline]
fn mul_permille_round_kes(value_minor: i64, permille: u32) -> Result<i64, FareError> {
    let product = minor_to_kes_f64(value_minor) * permille_to_f64(permille);
    Ok(ts_round_kes_minor(product))
}

/// The fare pipeline — a faithful port of `priceForTS` in src/lib/pricing.ts.
/// Order of operations and every rounding point match the TS reference
/// exactly; see the module docs for the rounding contract.
pub fn compute_fare(p: &FareParams) -> Result<FareResult, FareError> {
    // f64 mirrors of the TS operands (bit-identical for contract-conforming
    // inputs — ≤2-decimal rates, ≤3-decimal multipliers/km).
    let _base_fare_f = minor_to_kes_f64(p.base_fare);
    let _peak_f = permille_to_f64(p.peak_permille);
    let per_km_f = minor_to_kes_f64(p.per_km);
    let km_f = p.distance_m as f64 / 1000.0;
    let per_min_f = minor_to_kes_f64(p.per_min);
    let dur_f = p.duration_min as f64;
    let night_sur_f = permille_to_f64(p.night_permille) - 1.0; // exact in f64
    let sd_f = (1000i32.saturating_sub(p.schedule_permille as i32).max(0)) as f64 / 1000.0;
    let cr_f = permille_to_f64(p.commission_permille);
    let _discount_f = permille_to_f64(p.discount_permille);

    // ── rounded whole-KES components (TS Math.round points) ──
    let base = mul_permille_round_kes(p.base_fare, p.peak_permille)?;
    // distance: perKm × km — the denominator here is metres→km, not permille,
    // so the product is built explicitly:
    let distance = ts_round_kes_minor(per_km_f * km_f);
    let duration = ts_round_kes_minor(per_min_f * dur_f);

    let s = base
        .checked_add(distance)
        .and_then(|v| v.checked_add(duration))
        .ok_or(FareError::Overflow)?;
    // TS computes (base + distance + duration) as a float sum; all three are
    // whole KES, so the sum is an exact integer double either way.
    let s_f = minor_to_kes_f64(s);

    let night = ts_round_kes_minor(s_f * night_sur_f);
    let schedule = ts_round_kes_minor(s_f * sd_f);

    // ── unrounded components (TS leaves loading/stops/platform as floats;
    //     with ≤2-decimal fees these are exact in minor units) ──
    let helpers = p.helpers.max(0) as i64;
    let stops_n = p.extra_stops.max(0) as i64;
    let loading = if helpers > 0 {
        (p.loading_fee + p.helper_fee)
            .checked_mul(helpers)
            .ok_or(FareError::Overflow)?
    } else {
        0
    };
    // float mirror exactly as TS computes it: loadingFee × helpers (+ helper
    // fee term, which is 0 in parity wiring; adding 0.0 is a no-op in IEEE).
    let loading_f = if helpers > 0 {
        (minor_to_kes_f64(p.loading_fee) + minor_to_kes_f64(p.helper_fee)) * helpers as f64
    } else {
        0.0
    };
    let stops = if stops_n > 0 {
        p.stop_fee
            .checked_mul(stops_n)
            .ok_or(FareError::Overflow)?
    } else {
        0
    };
    let stops_f = if stops_n > 0 {
        minor_to_kes_f64(p.stop_fee) * stops_n as f64
    } else {
        0.0
    };
    let platform = p.platform_fee;
    let platform_f = minor_to_kes_f64(platform);

    // ── subtotal: TS sums left-to-right in f64; mirror that for the
    //     minimum-floor comparison and the commission input, and keep the
    //     exact i64 sum for the reported total. They are identical for
    //     whole-KES inputs (the production regime). ──
    let subtotal = s
        .checked_add(loading)
        .and_then(|v| v.checked_add(stops))
        .and_then(|v| v.checked_add(platform))
        .and_then(|v| v.checked_add(night))
        .and_then(|v| v.checked_sub(schedule))
        .ok_or(FareError::Overflow)?;
    let subtotal_f = (((((minor_to_kes_f64(base) + minor_to_kes_f64(distance))
        + minor_to_kes_f64(duration))
        + loading_f)
        + stops_f)
        + platform_f)
        + minor_to_kes_f64(night)
        - minor_to_kes_f64(schedule);

    let minimum_f = minor_to_kes_f64(p.minimum_fare);
    let minimum_applied = subtotal_f < minimum_f; // TS: subtotal < category.minimumFare
    let (total, total_f) = if minimum_applied {
        (p.minimum_fare, minimum_f)
    } else {
        (subtotal, subtotal_f)
    };

    // commission on the pre-discount total, exactly where TS computes it
    let commission = ts_round_kes_minor(total_f * cr_f);
    let driver_earnings = total
        .checked_sub(platform)
        .and_then(|v| v.checked_sub(commission))
        .ok_or(FareError::Overflow)?;

    // ── reserved engine-side promo (wiring sends 0; see FareParams docs) ──
    let discount = if p.discount_permille > 0 {
        mul_permille_round_kes(total, p.discount_permille)?
            .min(total) // never discount below zero
    } else {
        0
    };
    let total = total
        .checked_sub(discount)
        .ok_or(FareError::Overflow)?;

    let mut flags = 0u8;
    if minimum_applied {
        flags |= FLAG_MINIMUM_APPLIED;
    }
    if discount > 0 {
        flags |= FLAG_DISCOUNT_APPLIED;
    }

    Ok(FareResult {
        total,
        subtotal,
        base,
        distance,
        duration,
        loading,
        stops,
        night,
        schedule,
        discount,
        platform,
        commission,
        driver_earnings,
        flags,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(
        base_fare: i64,
        per_km: i64,
        per_min: i64,
        distance_m: i32,
        duration_min: i32,
    ) -> FareParams {
        FareParams {
            base_fare,
            per_km,
            per_min,
            loading_fee: 15000,
            helper_fee: 0,
            stop_fee: 10000,
            platform_fee: 10000,
            minimum_fare: 35000,
            distance_m,
            duration_min,
            helpers: 0,
            extra_stops: 0,
            night_permille: 1000,
            schedule_permille: 1000,
            discount_permille: 0,
            commission_permille: 150,
            peak_permille: 1000,
        }
    }

    #[test]
    fn ts_round_matches_js_math_round() {
        assert_eq!(ts_round(445.5), 446.0); // exact half → toward +∞
        assert_eq!(ts_round(445.49999999999997), 445.0);
        assert_eq!(ts_round(126.49999999999999), 126.0); // the 55 × 2.3 trap
        assert_eq!(ts_round(0.49999999999999994), 0.0); // floor(x+0.5) would say 1
        assert_eq!(ts_round(-0.5), 0.0); // Math.round(-0.5) === -0
        assert_eq!(ts_round(-1.5), -1.0); // halves toward +∞
        assert_eq!(ts_round(0.0), 0.0);
        assert_eq!(ts_round(5.0), 5.0);
    }

    #[test]
    fn layout_is_stable() {
        // The JS mirror (src/lib/rust-engine.ts) relies on these exact sizes;
        // fare_params_size()/fare_result_size() re-verify at load time.
        assert_eq!(core::mem::size_of::<FareParams>(), 104);
        assert_eq!(core::mem::align_of::<FareParams>(), 8);
        assert_eq!(core::mem::size_of::<FareResult>(), 112);
        assert_eq!(core::mem::align_of::<FareResult>(), 8);
    }

    #[test]
    fn zero_km_is_base_plus_platform() {
        // distance 0, duration 0, no extras: total = base + platform
        let r = compute_fare(&params(25000, 5500, 200, 0, 0)).unwrap();
        assert_eq!(r.base, 25000);
        assert_eq!(r.distance, 0);
        assert_eq!(r.duration, 0);
        assert_eq!(r.night, 0);
        assert_eq!(r.schedule, 0);
        assert_eq!(r.subtotal, 35000); // 25000 + 10000
        assert_eq!(r.total, 35000);
        assert_eq!(r.commission, 5300); // round(350 × 0.15) = round(52.5) = 53
        assert_eq!(r.driver_earnings, 19700); // 350 − 100 − 53
    }

    #[test]
    fn hand_computed_full_stack() {
        // tuktuk: base 250, perKm 55, perMin 2, min 350, loading 150, stop 100
        // zone: platform 100, commission 15%, peak 1.25, night 1.12, sched −5%
        // 8.3 km, 30 min, 2 helpers, 1 stop, peak+night+scheduled (values verified
        // against the TS reference in node):
        //   base = round(250×1.25) = round(312.5) = 313
        //   distance = Math.round(55×8.3) = 457
        //   duration = round(2×30) = 60
        //   S = 313+457+60 = 830; night = round(830×0.12) = round(99.6) = 100
        //   schedule = round(830×0.05) = round(41.5) = 42 (exact half → up, like TS)
        //   loading = 150×2 = 300; stops = 100; platform = 100
        //   subtotal = 830+300+100+100+100−42 = 1388 (> min 350)
        //   commission = round(1388×0.15) = round(208.2) = 208
        //   driver = 1388 − 100 − 208 = 1080
        let mut p = params(25000, 5500, 200, 8300, 30);
        p.helpers = 2;
        p.extra_stops = 1;
        p.peak_permille = 1250;
        p.night_permille = 1120;
        p.schedule_permille = 950;
        let r = compute_fare(&p).unwrap();
        assert_eq!(r.base, 31300);
        assert_eq!(r.distance, 45700);
        assert_eq!(r.duration, 6000);
        assert_eq!(r.night, 10000);
        assert_eq!(r.schedule, 4200);
        assert_eq!(r.loading, 30000);
        assert_eq!(r.stops, 10000);
        assert_eq!(r.platform, 10000);
        assert_eq!(r.subtotal, 138800);
        assert_eq!(r.total, 138800);
        assert_eq!(r.flags, 0);
        assert_eq!(r.commission, 20800);
        assert_eq!(r.driver_earnings, 108000);
    }

    #[test]
    fn minimum_fare_floor() {
        // tiny trip below the minimum: subtotal 250+0+8+100 = 358 > 350 → no floor…
        let mut p = params(25000, 5500, 200, 0, 4); // duration = round(2×4) = 8
        let r = compute_fare(&p).unwrap();
        assert_eq!(r.subtotal, 35800);
        assert_eq!(r.flags, 0);
        // …now raise the minimum above the subtotal
        p.minimum_fare = 50000;
        let r = compute_fare(&p).unwrap();
        assert_eq!(r.subtotal, 35800);
        assert_eq!(r.total, 50000);
        assert_eq!(r.flags, FLAG_MINIMUM_APPLIED);
        assert_eq!(r.commission, 7500); // round(500×0.15) = 75
        assert_eq!(r.driver_earnings, 32500); // 500 − 100 − 75 = 325
    }

    #[test]
    fn hundred_percent_scheduled_discount() {
        // scheduledDiscount = 1.0 → schedule_permille = 0 → the whole
        // base+distance+duration is discounted away
        let mut p = params(25000, 5500, 200, 2300, 20); // distance 127 (55×2.3 JS trap), duration 40
        p.schedule_permille = 0;
        let r = compute_fare(&p).unwrap();
        let s = r.base + r.distance + r.duration;
        assert_eq!(r.schedule, s);
        assert_eq!(r.subtotal, s + r.loading + r.stops + r.platform + r.night - r.schedule);
    }

    #[test]
    fn reserved_promo_discount_capped() {
        let mut p = params(25000, 5500, 200, 2300, 20);
        p.discount_permille = 100; // −10%
        let r = compute_fare(&p).unwrap();
        let plain = compute_fare(&params(25000, 5500, 200, 2300, 20)).unwrap();
        let expected = ts_round_kes_minor(minor_to_kes_f64(plain.total) * 0.1);
        assert_eq!(r.discount, expected);
        assert_eq!(r.total, plain.total - expected);
        assert_eq!(r.flags, FLAG_DISCOUNT_APPLIED);
        // a 100% promo cannot go below zero
        let mut q = params(25000, 5500, 200, 2300, 20);
        q.discount_permille = 100_000;
        let r = compute_fare(&q).unwrap();
        assert_eq!(r.total, 0);
    }

    #[test]
    fn negative_counts_are_clamped_like_ts() {
        // TS: loading = helpers > 0 ? fee×helpers : 0 → negatives act like 0
        let mut p = params(25000, 5500, 200, 2300, 20);
        p.helpers = -3;
        p.extra_stops = -2;
        let r = compute_fare(&p).unwrap();
        assert_eq!(r.loading, 0);
        assert_eq!(r.stops, 0);
    }

    #[test]
    fn overflow_is_reported_not_wrapped() {
        let mut p = params(i64::MAX / 2, 5500, 200, 2300, 20);
        p.peak_permille = 2000;
        // base alone doesn't overflow, but base+distance+duration+… might not;
        // force it through loading with a huge helper count:
        p.loading_fee = i64::MAX / 4;
        p.helpers = 8;
        assert!(compute_fare(&p).is_err());
    }

    #[test]
    fn parity_with_ts_traps() {
        // every case that the integer-math sweep flagged as divergent, pinned
        // here so the f64-replication cannot regress:
        //   Math.round(55 × 2.3) = 126  (exact rational is 126.5 → 127)
        //   Math.round(55 × 4.1) = 225  (exact rational is 225.5 → 226)
        //   Math.round(55 × 8.7) = 478  (exact rational is 478.5 → 479)
        let cases: [(i64, i32, i64); 3] = [
            (5500, 2300, 12600),
            (5500, 4100, 22500),
            (5500, 8700, 47800),
        ];
        for (per_km, distance_m, expect) in cases {
            let p = params(25000, per_km, 200, distance_m, 0);
            let r = compute_fare(&p).unwrap();
            assert_eq!(r.distance, expect, "perKm={} m={}", per_km, distance_m);
        }
    }
}
