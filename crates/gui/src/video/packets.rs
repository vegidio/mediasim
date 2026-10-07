//! Timestamps of demuxed packets, and the first keyframe of a stream, shared by a session's sources.

use media::prelude::{MediaReader, Packet, Rational};

/// When `packet` is shown, in its stream's ticks: its `pts`, or its `dts` when it has none.
pub(super) fn packet_ts(packet: &Packet) -> i64 {
    if packet.pts() == i64::MIN { packet.dts() } else { packet.pts() }
}

/// `ts` ticks of `time_base`, in seconds.
pub(super) fn seconds(ts: i64, time_base: Rational) -> f64 {
    #[expect(clippy::cast_precision_loss, reason = "a timestamp, far below 2^52 ticks")]
    let seconds = ts as f64 * time_base.as_f64();
    seconds
}

/// The next keyframe of stream `index` that `reader` reads, dropping every packet before it, or `None` at the end.
pub(super) fn first_keyframe(reader: &mut MediaReader, index: usize) -> media::Result<Option<Packet>> {
    while let Some(packet) = reader.packets().next().transpose()? {
        if packet.stream_index() == index && packet.is_keyframe() {
            return Ok(Some(packet));
        }
    }

    Ok(None)
}
