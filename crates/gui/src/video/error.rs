//! Why a probe or a session request was refused, as the window sees it.

use serde::Serialize;

use super::transcode::EncodeError;
use crate::scheme::Refusal;

/// Why the window's probe or session request was refused: an object tagged by `kind`.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum VideoError {
    /// An identity that was never admitted or names an image, or a session that is closed or never existed, or was
    /// closed while its request was being answered.
    #[error("no such video or session")]
    NotFound,
    /// An admitted file that has been removed or changed since.
    #[error("the file has changed or can no longer be read")]
    Gone,
    /// A file that can't be read, remuxed, decoded or encoded as asked.
    #[error("{message}")]
    Unreadable {
        /// What went wrong.
        message: String,
    },
    /// The background task panicked or was cancelled by the runtime, which says nothing about the file.
    #[error("{message}")]
    Task {
        /// What went wrong, as [`task_message`](crate::task_message) says it.
        message: String,
    },
}

impl From<Refusal> for VideoError {
    fn from(refusal: Refusal) -> Self {
        match refusal {
            Refusal::NotFound => Self::NotFound,
            Refusal::Gone => Self::Gone,
            Refusal::Failed => Self::Task { message: crate::task_message(&"it panicked") },
        }
    }
}

impl From<media::Error> for VideoError {
    fn from(err: media::Error) -> Self {
        Self::Unreadable { message: err.to_string() }
    }
}

impl From<tauri::Error> for VideoError {
    fn from(err: tauri::Error) -> Self {
        Self::Task { message: crate::task_message(&err) }
    }
}

impl From<EncodeError> for VideoError {
    fn from(err: EncodeError) -> Self {
        match err {
            // The session was closed under the request, which then answers as if it had already been.
            EncodeError::Cancelled => Self::NotFound,
            EncodeError::Media(err) | EncodeError::Encoder(err) => err.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_task_that_did_not_finish_is_a_task_error_not_an_unreadable_file() {
        let err = VideoError::from(tauri::Error::FailedToReceiveMessage);

        assert_eq!(
            serde_json::to_value(&err).unwrap(),
            serde_json::json!({
                "kind": "task",
                "message": crate::task_message(&tauri::Error::FailedToReceiveMessage),
            })
        );
        assert!(matches!(VideoError::from(Refusal::Failed), VideoError::Task { .. }));
    }
}
