//! The grouping pipeline shared by `files` and `dir`: load, group, order and print.

use std::path::PathBuf;

use mediasim::{CompareOptions, DirCache, Media, OnError, Scan, Scanned};

use crate::args::{GroupArgs, OutputFormat};
use crate::error::CliError;
use crate::output::Ui;
use crate::{machine, output, progress};

/// Loads `paths`, groups the ones scoring at least `group`'s threshold against each other under `options`, and prints
/// the groups in `format`.
///
/// With [`OutputFormat::Term`] on a terminal it prints `header` (called with the colour flag), the threshold, the
/// progress display and a report of the groups, and otherwise only the grouped paths, so the output can be used in
/// scripts. CSV and JSON print only their document.
///
/// If `group` ignores errors, files that fail to load are skipped, and once loading ends they are reported on stderr,
/// in every format, in the order of `paths`. JSON lists them in its document too.
///
/// With a `cache`, the files load through it. Once every file has finished loading (skipped ones included), the cache
/// is deleted, before anything is printed; on any error, including Ctrl+C, it is kept for the next run.
pub fn run(
    paths: &[PathBuf],
    cache: Option<DirCache>,
    group: &GroupArgs,
    options: CompareOptions,
    format: OutputFormat,
    header: impl FnOnce(bool) -> String,
) -> Result<(), CliError> {
    let ui = Ui::for_stdout(format);

    if ui.interactive {
        println!();
        println!("{}", header(ui.color));
        println!("{}", output::threshold(group.threshold, ui.color));
    }
    let on_error = if group.ignore_errors { OnError::Skip } else { OnError::Stop };
    let mut scan = Scan::new(paths.to_vec(), group.threshold).options(options).on_error(on_error);
    if let Some(cache) = &cache {
        scan = scan.cache(cache);
    }
    let Scanned { mut groups, skipped } = progress::scan(scan, paths.len(), "Processing", ui)?;
    if let Some(cache) = cache {
        cache.finish();
    }
    for members in &mut groups {
        members.sort_by(Media::best_first);
    }

    if !skipped.is_empty() {
        if ui.interactive {
            eprintln!();
        }
        eprintln!("{}", output::skipped(&skipped, output::color_for(&std::io::stderr())));
    }

    match format {
        OutputFormat::Term if ui.interactive => {
            if groups.is_empty() {
                println!();
                println!("{}", output::NO_MATCHES);
            } else {
                println!("{}", output::groups(&groups, ui.color));
            }
        }
        OutputFormat::Term => {
            if !groups.is_empty() {
                println!("{}", output::plain_groups(&groups));
            }
        }
        OutputFormat::Csv => machine::groups_csv(&mut std::io::stdout().lock(), &groups)?,
        OutputFormat::Json => machine::groups_json(&mut std::io::stdout().lock(), &groups, &skipped)?,
    }

    Ok(())
}
