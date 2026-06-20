//! Verifies `euc_metric` against the reference output (`result.txt`) for the two sample images at the
//! workspace root.

use mediasim::{Icon, euc_metric};

const TEST1: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../test1.jpg");
const TEST2: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../test2.jpg");

// Reference values (see result.txt).
const REF_M1: f64 = 264_273.240_784_313_76;
const REF_M2: f64 = 185_067.863_483_275_64;
const REF_M3: f64 = 163_167.678_692_810_38;

#[test]
fn matches_reference() {
    let a = Icon::from_path(TEST1).expect("decode test1.jpg");
    let b = Icon::from_path(TEST2).expect("decode test2.jpg");

    let (m1, m2, m3) = euc_metric(&a, &b);

    // Print computed values and deltas so fidelity vs the reference is visible in test output
    // (run with `cargo test -- --nocapture`).
    for (name, got, want) in [("m1", m1, REF_M1), ("m2", m2, REF_M2), ("m3", m3, REF_M3)] {
        let abs = (got - want).abs();
        let rel = abs / want;
        println!("{name}: got={got:.11} ref={want:.11} abs_delta={abs:.6} rel_delta={rel:.3e}");
    }

    // The post-decode pipeline is bit-exact; the only divergence from the reference is the JPEG decoder
    // itself (zune-jpeg's chroma upsampling and YCbCr->RGB conversion differ from the reference decoder),
    // which keeps the metrics within ~1% relative error (largest is the Cb channel, ~0.84%). We allow 1.5%
    // for headroom across image-crate versions.
    const TOL: f64 = 1.5e-2;
    let rel = |got: f64, want: f64| (got - want).abs() / want;
    assert!(rel(m1, REF_M1) < TOL, "m1 relative error too large");
    assert!(rel(m2, REF_M2) < TOL, "m2 relative error too large");
    assert!(rel(m3, REF_M3) < TOL, "m3 relative error too large");
}

#[test]
fn identical_images_have_zero_distance() {
    let a = Icon::from_path(TEST1).expect("decode test1.jpg");
    let b = Icon::from_path(TEST1).expect("decode test1.jpg");

    assert_eq!(euc_metric(&a, &b), (0.0, 0.0, 0.0));
}
