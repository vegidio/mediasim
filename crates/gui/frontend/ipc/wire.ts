import { invoke } from "@tauri-apps/api/core";

/** Whether `value` is a JSON object, whose fields can then be read and checked one by one. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

/** Whether `value` is one of `values`. */
const isOneOf = <T>(values: readonly T[], value: unknown): value is T => (values as readonly unknown[]).includes(value);

/**
 * `invoke`, rejecting with what `toError` makes of the command's rejection rather than with the rejection itself, so
 * each caller sees one known error shape.
 */
export const invokeOr =
    <E>(toError: (error: unknown) => E) =>
    <T>(command: string, args: Record<string, unknown>): Promise<T> =>
        invoke<T>(command, args).catch((error: unknown) => {
            throw toError(error);
        });

/** A file operation's failure for one file: why, from `reasons`, and what the platform said. */
export type FailedOutcome<Reason> = { status: "failed"; reason: Reason; message: string };

/**
 * A reader of one file's outcome as a file operation in `crates/gui/src/trash.rs` serializes it: the success `done`
 * reads, or a failure with one of `reasons`. Any other shape reads as a failure with the `fallback` reason, so a reply
 * that isn't understood never reads as a success.
 */
export const outcomeReader =
    <Done, Reason>(
        done: (value: Record<string, unknown>) => Done | undefined,
        reasons: readonly Reason[],
        fallback: Reason,
    ) =>
    (value: unknown): Done | FailedOutcome<Reason> => {
        if (isRecord(value)) {
            const success = done(value);
            if (success !== undefined) return success;

            const { status, reason, message } = value;
            if (status === "failed" && isOneOf(reasons, reason) && typeof message === "string") {
                return { status, reason, message };
            }
        }

        return { status: "failed", reason: fallback, message: "the reply was not understood" };
    };
