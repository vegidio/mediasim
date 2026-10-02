//! The errors that end a command.

use mediasim::{CompareError, MediaError};

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
