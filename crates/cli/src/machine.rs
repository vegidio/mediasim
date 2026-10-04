//! The CSV and JSON documents printed by `-o csv` and `-o json`, for other programs to read.

use std::io::{self, Write};

use mediasim::{Media, MediaError};
use serde::Serialize;

use crate::output::format_score;

/// The CSV header of a groups document: the group number, then the fields a [`Media`] serializes, in their order. A
/// unit test keeps it in step with `Media`.
const GROUPS_HEADER: [&str; 9] =
    ["group", "path", "type", "width", "height", "size", "duration", "created", "modified"];

/// `score`, then the score formatted as [`format_score`] does, each on its own line.
pub fn score_csv(out: &mut impl Write, score: f64) -> io::Result<()> {
    writeln!(out, "score\n{}", format_score(score))
}

/// `{"score":<score>}` on one line, with the score rounded to 5 decimal places.
pub fn score_json(out: &mut impl Write, score: f64) -> io::Result<()> {
    #[derive(Serialize)]
    struct Document {
        score: f64,
    }

    let score = format_score(score).parse().expect("a formatted score is a number");
    serde_json::to_writer(&mut *out, &Document { score })?;
    writeln!(out)
}

/// A header row, then one row per media: its group's number, counting from 1, and its fields. Groups and their media
/// keep their order.
pub fn groups_csv(out: &mut impl Write, groups: &[Vec<Media>]) -> io::Result<()> {
    // The header is written by hand, so it is there even with no rows; `csv` would only infer it from the first one.
    let mut writer = csv::WriterBuilder::new().has_headers(false).from_writer(out);
    writer.write_record(GROUPS_HEADER)?;

    for (n, group) in groups.iter().enumerate() {
        for media in group {
            writer.serialize((n + 1, media))?;
        }
    }

    writer.flush()
}

/// `{"groups":[[<media>,...],...],"skipped":[{"path","error"},...]}` on one line, keeping the order of `groups` and
/// `skipped`.
pub fn groups_json(out: &mut impl Write, groups: &[Vec<Media>], skipped: &[MediaError]) -> io::Result<()> {
    #[derive(Serialize)]
    struct Document<'a> {
        groups: &'a [Vec<Media>],
        skipped: Vec<Skipped>,
    }

    #[derive(Serialize)]
    struct Skipped {
        path: String,
        error: String,
    }

    let skipped = skipped
        .iter()
        .map(|err| Skipped { path: err.path().to_string_lossy().into_owned(), error: err.to_string() })
        .collect();
    serde_json::to_writer(&mut *out, &Document { groups, skipped })?;
    writeln!(out)
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, SystemTime};

    use super::*;
    use crate::test_support;

    /// 2026-10-04T12:34:56Z.
    fn time() -> SystemTime {
        SystemTime::UNIX_EPOCH + Duration::from_secs(1_791_117_296)
    }

    /// A media with fixed metadata: 12345 bytes, no creation time, modified at [`time`].
    fn media(path: &str, width: u32, height: u32, seconds: Option<u64>) -> Media {
        let mut media = test_support::media(path, width, height, seconds);
        (media.size, media.created, media.modified) = (12345, None, Some(time()));
        media
    }

    fn two_groups() -> Vec<Vec<Media>> {
        vec![
            vec![media("a.png", 640, 480, None), media("b.png", 320, 240, None)],
            vec![media("c.mp4", 1280, 720, Some(12))],
        ]
    }

    fn written(write: impl FnOnce(&mut Vec<u8>) -> io::Result<()>) -> String {
        let mut out = Vec::new();
        write(&mut out).unwrap();
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn score_csv_is_a_header_and_the_formatted_score() {
        assert_eq!(written(|out| score_csv(out, 0.955_131)), "score\n0.95513\n");
        assert_eq!(written(|out| score_csv(out, 1.0)), "score\n1\n");
        assert_eq!(written(|out| score_csv(out, 0.0)), "score\n0\n");
    }

    #[test]
    fn score_json_is_the_rounded_score() {
        assert_eq!(written(|out| score_json(out, 0.955_131)), "{\"score\":0.95513}\n");
        assert_eq!(written(|out| score_json(out, 1.0)), "{\"score\":1.0}\n");
        assert_eq!(written(|out| score_json(out, 0.999_996)), "{\"score\":1.0}\n");
        assert_eq!(written(|out| score_json(out, 0.0)), "{\"score\":0.0}\n");
    }

    #[test]
    fn groups_json_lists_each_group_on_one_line() {
        let json = written(|out| groups_json(out, &two_groups(), &[]));

        assert_eq!(json.matches('\n').count(), 1, "{json:?}");
        assert!(json.ends_with('\n'));
        assert_eq!(
            json,
            concat!(
                r#"{"groups":[["#,
                r#"{"path":"a.png","type":"image","width":640,"height":480,"size":12345,"duration":null,"created":null,"modified":"2026-10-04T12:34:56Z"},"#,
                r#"{"path":"b.png","type":"image","width":320,"height":240,"size":12345,"duration":null,"created":null,"modified":"2026-10-04T12:34:56Z"}"#,
                r#"],["#,
                r#"{"path":"c.mp4","type":"video","width":1280,"height":720,"size":12345,"duration":12.0,"created":null,"modified":"2026-10-04T12:34:56Z"}"#,
                r#"]],"skipped":[]}"#,
                "\n"
            )
        );
    }

    #[test]
    fn groups_json_with_no_groups() {
        assert_eq!(written(|out| groups_json(out, &[], &[])), "{\"groups\":[],\"skipped\":[]}\n");
    }

    #[test]
    fn groups_json_lists_the_skipped_files() {
        let skipped = [MediaError::Unsupported { path: "x.txt".into() }];

        let json = written(|out| groups_json(out, &[], &skipped));

        assert_eq!(json.matches('\n').count(), 1, "{json:?}");
        assert_eq!(
            json,
            "{\"groups\":[],\"skipped\":[{\"path\":\"x.txt\",\"error\":\"unsupported file x.txt\"}]}\n"
        );
    }

    #[test]
    fn csv_flattens_a_group_number_and_a_media_into_one_record() {
        let mut writer = csv::WriterBuilder::new().has_headers(false).from_writer(Vec::new());

        writer.serialize((7, &media("a.png", 640, 480, None))).unwrap();

        let row = String::from_utf8(writer.into_inner().unwrap()).unwrap();
        assert_eq!(row, "7,a.png,image,640,480,12345,,,2026-10-04T12:34:56Z\n");
    }

    #[test]
    fn groups_header_matches_the_media_fields() {
        // With headers on, `csv` writes the field names `Media` serializes, in order.
        let mut writer = csv::Writer::from_writer(Vec::new());
        writer.serialize(media("a.png", 640, 480, None)).unwrap();
        let written = String::from_utf8(writer.into_inner().unwrap()).unwrap();

        assert_eq!(written.lines().next(), Some(GROUPS_HEADER[1..].join(",").as_str()));
    }

    #[test]
    fn groups_csv_has_one_row_per_media_in_order() {
        assert_eq!(
            written(|out| groups_csv(out, &two_groups())),
            "group,path,type,width,height,size,duration,created,modified\n\
             1,a.png,image,640,480,12345,,,2026-10-04T12:34:56Z\n\
             1,b.png,image,320,240,12345,,,2026-10-04T12:34:56Z\n\
             2,c.mp4,video,1280,720,12345,12.0,,2026-10-04T12:34:56Z\n"
        );
    }

    #[test]
    fn groups_csv_with_no_groups_is_the_header() {
        assert_eq!(
            written(|out| groups_csv(out, &[])),
            "group,path,type,width,height,size,duration,created,modified\n"
        );
    }

    #[test]
    fn groups_csv_leaves_absent_fields_empty() {
        let mut image = media("a.png", 640, 480, None);
        image.modified = None;

        let csv = written(|out| groups_csv(out, &[vec![image]]));

        assert_eq!(csv.lines().nth(1), Some("1,a.png,image,640,480,12345,,,"));
    }

    #[test]
    fn groups_csv_quotes_a_path_with_a_comma_and_quotes() {
        let csv = written(|out| groups_csv(out, &[vec![media(r#"a, "final".png"#, 640, 480, None)]]));

        assert_eq!(csv.lines().nth(1), Some(r#"1,"a, ""final"".png",image,640,480,12345,,,2026-10-04T12:34:56Z"#));
    }
}
