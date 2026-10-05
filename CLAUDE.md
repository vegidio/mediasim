# Project Conventions

## Frontend

- Prefer `type` aliases over `interface`.
- Prefer `undefined` over `null`. Use `undefined` to represent "no value"; do not introduce `null`.
- For a value that may be absent, use optional-property syntax — `name?: string` — not `name: string | undefined`.
- Never type anything as `undefined | null` (or `null | undefined`). Pick one (always `undefined`).
- Enable and respect strict mode. Do not use `any`; reach for `unknown` plus narrowing when a type is genuinely unknown.
