use mediasim::core::diff::calculate_diff;
use mediasim::Icon;

fn main() {
    let a = Icon::from_path("test1.jpg").unwrap();
    let b = Icon::from_path("test2.jpg").unwrap();

    println!("{:?}", calculate_diff(a, b));
}
