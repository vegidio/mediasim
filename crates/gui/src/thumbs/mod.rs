//! Thumbnails: how small pictures of admitted files reach the window.
//!
//! The window loads `thumb://localhost/<identity>?size=<bound>` in an `<img>`, with an identity from the
//! [`admission`](crate::admission) registry, which [`serve`] answers with a rendition from [`cache`], rendered by
//! [`preview`]. A request names an identity, never a path, so the window can only reach files that were admitted.

mod cache;
pub mod commands;
mod preview;
mod serve;

use std::path::Path;
use std::sync::{Arc, OnceLock};

use cache::Renditions;
pub use serve::serve;

// Must stay in sync with `tauri.conf.json`'s `img-src`, which needs both platform forms of it.
/// The URI scheme thumbnails are served over. Registered in `src/lib.rs`.
pub const SCHEME: &str = "thumb";

/// The rendition cache, as Tauri managed state.
#[derive(Debug, Default)]
pub struct ThumbState {
    /// Set once by [`ThumbState::open_cache`], off the main thread; requests wait for it. Shared, so a request can
    /// wait for it on the blocking pool.
    renditions: Arc<OnceLock<Renditions>>,
}

impl ThumbState {
    /// Opens the rendition cache under `dir`, or in memory alone when `dir` is `None` or can't be used. Only the first
    /// call has an effect.
    ///
    /// Must never panic or fail: every thumbnail request blocks in [`renditions`](Self::renditions) until this has
    /// run, so a `setup` thread that died before it would leave them waiting forever.
    pub fn open_cache(&self, dir: Option<&Path>) {
        let _ = self.renditions.set(Renditions::open(dir));
    }

    /// The rendition cache, waiting for [`open_cache`](Self::open_cache) if it hasn't finished.
    fn renditions(&self) -> &Renditions {
        self.renditions.wait()
    }

    /// The cache as it opens, to wait for off the async runtime before [`renditions`](Self::renditions) is called
    /// there.
    fn opening(&self) -> Arc<OnceLock<Renditions>> {
        Arc::clone(&self.renditions)
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A state with an in-memory cache, as `setup` leaves it when the cache directory can't be used.
    pub(crate) fn state() -> ThumbState {
        let state = ThumbState::default();
        state.open_cache(None);
        state
    }

    #[test]
    fn tauri_conf_json_lets_the_window_load_the_scheme_and_nothing_else_by_url() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).expect("tauri.conf.json is JSON");

        for policy in ["csp", "devCsp"] {
            let img_src = conf["app"]["security"][policy]["img-src"].as_str().expect("img-src is set");
            let sources: Vec<_> = img_src.split_whitespace().collect();

            assert_eq!(
                sources,
                ["'self'", "data:", &format!("{SCHEME}:"), &format!("http://{SCHEME}.localhost")],
                "{policy}"
            );
        }
    }

    #[test]
    fn no_directive_allows_the_asset_protocol() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).expect("tauri.conf.json is JSON");

        for policy in ["csp", "devCsp"] {
            let directives = conf["app"]["security"][policy].as_object().expect("the policy is an object");
            for (name, sources) in directives {
                // Unused, and it would serve any file in its scope by path.
                let sources = sources.as_str().unwrap_or_default();
                assert!(!sources.contains("asset"), "{policy} {name} allows the asset protocol");
            }
        }
    }
}
