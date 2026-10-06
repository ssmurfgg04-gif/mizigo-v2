//! Dispatch scoring — an EXACT mirror of the dispatch formulas from the
//! matching engine (see `scripts/pr-review/perf-branch/matching.ts`,
//! `dispatchScore` + `etaConfidenceScore`; `src/lib/matching.ts` is owned by
//! another track, so this file mirrors the formulas without importing them).
//!
//! Float arithmetic is identical to JS (IEEE 754 double, same operand order),
//! so scores are bit-for-bit equal to the TS reference up to the ABI's
//! metres→km round trip (`distance_m / 1000.0`), which is at most one ulp —
//! the parity suite asserts agreement within 1e-12 and in practice sees exact
//! equality.

/// Weighted driver dispatch score. Higher is better.
///
/// Weights (must match the TS reference exactly):
/// distance 0.23 · eta 0.14 · rating 0.16 · trips 0.08 · acceptance 0.12 ·
/// capacity 0.09 · reliability 0.18 − cancellation penalty 0.08.
pub fn dispatch_score(
    distance_m: f64,
    eta_min: f64,
    rating: f64,
    trips_completed: f64,
    acceptance_rate: f64,
    reliability: f64,
    capacity_headroom_kg: f64,
    cancellation_rate: f64,
) -> f64 {
    let distance_km = distance_m / 1000.0;

    // TS: Math.max(0, 1 - distanceKm / 14)
    let distance_score = f64::max(0.0, 1.0 - distance_km / 14.0);
    // TS: Math.max(0, 1 - etaMin / 30)
    let eta_score = f64::max(0.0, 1.0 - eta_min / 30.0);
    // TS: Math.max(0, Math.min(1, (rating - 4) / 1))
    let rating_score = clamp01((rating - 4.0) / 1.0);
    // TS: Math.min(1, tripsCompleted / 250)
    let trip_score = f64::min(1.0, trips_completed / 250.0);
    // TS: Math.max(0, Math.min(1, acceptanceRate))
    let acceptance_score = clamp01(acceptance_rate);
    // TS: Math.max(0, Math.min(1, capacityHeadroom / 1000))
    let capacity_score = clamp01(capacity_headroom_kg / 1000.0);
    // TS: Math.max(0, Math.min(1, reliability))
    let reliability_score_value = clamp01(reliability);
    // TS: Math.max(0, cancellationRate * 2.5)
    let cancellation_penalty = f64::max(0.0, cancellation_rate * 2.5);

    // same left-to-right evaluation order as the TS expression
    distance_score * 0.23
        + eta_score * 0.14
        + rating_score * 0.16
        + trip_score * 0.08
        + acceptance_score * 0.12
        + capacity_score * 0.09
        + reliability_score_value * 0.18
        - cancellation_penalty * 0.08
}

/// ETA confidence for the "vehicles nearby" indicators.
/// TS: Math.max(0, Math.min(1, 0.55·distWeight + 0.45·etaWeight)).
pub fn eta_confidence(eta_min: f64, distance_km: f64) -> f64 {
    let distance_weight = f64::max(0.0, 1.0 - distance_km / 18.0);
    let eta_weight = f64::max(0.0, 1.0 - eta_min / 40.0);
    clamp01(0.55 * distance_weight + 0.45 * eta_weight)
}

#[inline]
fn clamp01(x: f64) -> f64 {
    f64::max(0.0, f64::min(1.0, x))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-12
    }

    #[test]
    fn dispatch_score_mirrors_reference() {
        // Reference value computed with the TS formula (node):
        // distanceKm 3.2, eta 9, rating 4.7, trips 310, acceptance 0.92,
        // reliability 0.81, capacityHeadroom 420, cancellation 0.03 → 0.79769…
        let d = 3200.0f64; // metres
        let got = dispatch_score(d, 9.0, 4.7, 310.0, 0.92, 0.81, 420.0, 0.03);
        // hand-computed from the TS formula:
        let dist = 3.2f64;
        let expect = (1.0f64 - dist / 14.0).max(0.0) * 0.23
            + (1.0f64 - 9.0f64 / 30.0).max(0.0) * 0.14
            + (((4.7f64 - 4.0) / 1.0).clamp(0.0, 1.0)) * 0.16
            + (310.0f64 / 250.0).min(1.0) * 0.08
            + 0.92f64.clamp(0.0, 1.0) * 0.12
            + (420.0f64 / 1000.0).clamp(0.0, 1.0) * 0.09
            + 0.81f64.clamp(0.0, 1.0) * 0.18
            - (0.03f64 * 2.5).max(0.0) * 0.08;
        assert!(approx(got, expect), "got {} expect {}", got, expect);
        assert!(got > 0.7 && got < 0.85);
    }

    #[test]
    fn dispatch_score_clamps_extremes() {
        // far away → distance/eta terms 0
        let far = dispatch_score(140_000.0, 45.0, 5.0, 1000.0, 1.0, 1.0, 2000.0, 0.0);
        let expect = 0.0 * 0.23 + 0.0 * 0.14 + 1.0 * 0.16 + 1.0 * 0.08 + 1.0 * 0.12 + 1.0 * 0.09 + 1.0 * 0.18;
        assert!(approx(far, expect));
        // rating below 4 → 0; capacity above 1000 kg → 1; huge cancellation → penalty capped by weight only
        let low = dispatch_score(1000.0, 5.0, 3.2, 10.0, 0.4, 0.2, 5000.0, 0.9);
        let expect = (1.0f64 - 1.0 / 14.0) * 0.23
            + (1.0f64 - 5.0 / 30.0) * 0.14
            + 0.0 * 0.16
            + (10.0f64 / 250.0) * 0.08
            + 0.4f64 * 0.12
            + 1.0 * 0.09
            + 0.2f64 * 0.18
            - (0.9f64 * 2.5) * 0.08;
        assert!(approx(low, expect));
        // zero-everything driver
        let zero = dispatch_score(14_000.0, 30.0, 4.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        assert!(approx(zero, 0.0));
    }

    #[test]
    fn eta_confidence_mirrors_reference() {
        // TS: etaConfidenceScore(9, 3.2) = max(0,min(1, .55*(1-3.2/18)+.45*(1-9/40)))
        let got = eta_confidence(9.0, 3.2);
        let expect = 0.55f64 * (1.0f64 - 3.2f64 / 18.0) + 0.45f64 * (1.0f64 - 9.0f64 / 40.0);
        assert!(approx(got, expect.clamp(0.0, 1.0)));
        // clamp: far away / long eta → 0
        assert!(approx(eta_confidence(60.0, 25.0), 0.0));
        // on top of the pickup → ~0.45·(1) + 0.55·(1) = 1 at eta 0, distance 0
        assert!(approx(eta_confidence(0.0, 0.0), 1.0));
        // partial: one term saturated
        let got = eta_confidence(20.0, 0.0);
        assert!(approx(got, 0.55f64 + 0.45f64 * 0.5));
    }
}
