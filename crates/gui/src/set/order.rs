//! The gallery's display order: within a folder its own files come first and its subfolders after them, and names
//! compare ignoring case, with runs of digits compared by their numeric value.

use std::cmp::Ordering;
use std::path::Path;

/// Compares two paths in display order.
///
/// Paths compare folder by folder from the start. At the first component that differs, a file (the path's last
/// component) comes before a subfolder; otherwise the two names compare naturally. Paths whose names are equal under
/// those rules, such as `a.jpg` and `A.jpg`, fall back to `Path` order, so the order is total and the same every time.
pub fn display_cmp(a: &Path, b: &Path) -> Ordering {
    let (mut left, mut right) = (a.components(), b.components());

    loop {
        match (left.next(), right.next()) {
            (Some(x), Some(y)) if x == y => {}
            (Some(x), Some(y)) => {
                let x_is_file = left.clone().next().is_none();
                let y_is_file = right.clone().next().is_none();
                let ord = match (x_is_file, y_is_file) {
                    (true, false) => Ordering::Less,
                    (false, true) => Ordering::Greater,
                    _ => natural_cmp(&x.as_os_str().to_string_lossy(), &y.as_os_str().to_string_lossy()),
                };
                return ord.then_with(|| a.cmp(b));
            }
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (None, None) => return Ordering::Equal,
        }
    }
}

/// Compares two names ignoring case, with each run of digits compared by its numeric value.
fn natural_cmp(mut a: &str, mut b: &str) -> Ordering {
    loop {
        let (x, y) = match (a.chars().next(), b.chars().next()) {
            (Some(x), Some(y)) => (x, y),
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (None, None) => return Ordering::Equal,
        };

        if x.is_ascii_digit() && y.is_ascii_digit() {
            let (digits_a, rest_a) = split_digits(a);
            let (digits_b, rest_b) = split_digits(b);
            let (value_a, value_b) = (digits_a.trim_start_matches('0'), digits_b.trim_start_matches('0'));
            let ord = value_a.len().cmp(&value_b.len()).then_with(|| value_a.cmp(value_b));
            if ord.is_ne() {
                return ord;
            }
            (a, b) = (rest_a, rest_b);
        } else {
            let ord = x.to_lowercase().cmp(y.to_lowercase());
            if ord.is_ne() {
                return ord;
            }
            (a, b) = (&a[x.len_utf8()..], &b[y.len_utf8()..]);
        }
    }
}

/// Splits `s` into its leading run of ASCII digits and the rest.
fn split_digits(s: &str) -> (&str, &str) {
    s.split_at(s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len()))
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    /// Sorts `paths` in display order.
    fn sorted(paths: &[&str]) -> Vec<PathBuf> {
        let mut paths: Vec<_> = paths.iter().map(PathBuf::from).collect();
        paths.sort_by(|a, b| display_cmp(a, b));
        paths
    }

    fn expected(paths: &[&str]) -> Vec<PathBuf> {
        paths.iter().map(PathBuf::from).collect()
    }

    #[test]
    fn a_folders_files_come_before_its_subfolders() {
        let paths = [
            "Folder/caca/b.jpg",
            "Folder/bola/a.jpg",
            "Folder/z.jpg",
            "Folder/caca/a.jpg",
            "Folder/a.jpg",
            "Folder/bola/b.jpg",
        ];

        assert_eq!(
            sorted(&paths),
            expected(&[
                "Folder/a.jpg",
                "Folder/z.jpg",
                "Folder/bola/a.jpg",
                "Folder/bola/b.jpg",
                "Folder/caca/a.jpg",
                "Folder/caca/b.jpg",
            ])
        );
    }

    #[test]
    fn case_is_ignored() {
        assert_eq!(sorted(&["c.jpg", "B.jpg", "a.jpg"]), expected(&["a.jpg", "B.jpg", "c.jpg"]));
    }

    #[test]
    fn numbers_compare_by_value() {
        assert_eq!(
            sorted(&["IMG_10.jpg", "IMG_2.jpg", "IMG_1.jpg"]),
            expected(&["IMG_1.jpg", "IMG_2.jpg", "IMG_10.jpg"])
        );
    }

    #[test]
    fn subfolders_compare_by_value() {
        assert_eq!(sorted(&["p/Day 10/a.jpg", "p/Day 2/b.jpg"]), expected(&["p/Day 2/b.jpg", "p/Day 10/a.jpg"]));
    }

    #[test]
    fn names_equal_ignoring_case_fall_back_to_their_bytes() {
        assert_eq!(sorted(&["a.jpg", "A.jpg"]), expected(&["A.jpg", "a.jpg"]));
        assert_eq!(display_cmp(Path::new("A.jpg"), Path::new("a.jpg")), Ordering::Less);
    }

    #[test]
    fn numbers_equal_in_value_fall_back_to_their_bytes() {
        assert_eq!(sorted(&["IMG_2.jpg", "IMG_02.jpg"]), expected(&["IMG_02.jpg", "IMG_2.jpg"]));
        assert_eq!(display_cmp(Path::new("IMG_2.jpg"), Path::new("IMG_02.jpg")), Ordering::Greater);
    }

    #[test]
    fn equal_paths_compare_equal() {
        assert_eq!(display_cmp(Path::new("p/a.jpg"), Path::new("p/a.jpg")), Ordering::Equal);
    }
}
