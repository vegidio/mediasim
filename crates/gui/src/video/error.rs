//! Why a probe or a remux request was refused, as the window sees it.

use serde::Serialize;

use crate::thumbs::Refusal;

/// Why the window's probe or remux request was refused: an object tagged by `kind`.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum RemuxError {
    /// An identity that was never admitted or names an image, or a session that is closed or never existed.
    #[error("no such video or session")]
    NotFound,
    /// An admitted file that has been removed or changed since.
    #[error("the file has changed or can no longer be read")]
    Gone,
    /// A file that can't be read or remuxed as a video.
    #[error("{message}")]
    Unreadable {
        /// What went wrong.
        message: String,
    },
}

impl From<Refusal> for RemuxError {
    fn from(refusal: Refusal) -> Self {
        match refusal {
            Refusal::NotFound => Self::NotFound,
            Refusal::Gone => Self::Gone,
        }
    }
}

impl From<media::Error> for RemuxError {
    fn from(err: media::Error) -> Self {
        Self::Unreadable { message: err.to_string() }
    }
}

impl From<tauri::Error> for RemuxError {
    fn from(err: tauri::Error) -> Self {
        Self::Unreadable { message: format!("the video task did not finish: {err}") }
    }
}
