//! The media formats `mediasim` loads, for the formats footer and the file picker's filter.

use mediasim::MediaFormat;

/// Every format `mediasim` loads, in its order: the image formats, then the video formats.
#[tauri::command]
pub fn supported_formats() -> Vec<MediaFormat> {
    MediaFormat::all().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_what_mediasim_lists() {
        assert_eq!(supported_formats(), MediaFormat::all().collect::<Vec<_>>());
    }
}
