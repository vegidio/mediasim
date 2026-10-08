//! The errors that end a command.

use mediasim::{CompareError, MediaError, ScanError};

#[derive(Debug, thiserror::Error)]
pub enum CliError {
    #[error(transparent)]
    Load(#[from] MediaError),

    #[error(transparent)]
    Compare(#[from] CompareError),

    #[error("terminal error: {0}")]
    Terminal(#[from] std::io::Error),

    /// The user pressed Ctrl+C. Reported only through the exit code.
    #[error("interrupted")]
    Interrupted,
}

impl From<ScanError> for CliError {
    fn from(err: ScanError) -> Self {
        match err {
            ScanError::Cancelled => Self::Interrupted,
            ScanError::Load(err) => Self::Load(err),
        }
    }
}
