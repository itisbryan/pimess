# pimess

A Pi extension and local router for sending and receiving iMessages across multiple Pi sessions.

## Status

Design approved; implementation in progress.

## Planned behavior

- One shared `pimess` router per Mac.
- `imsg rpc` as the macOS Messages transport.
- Short aliases for Pi sessions (`api`, `docs`, `test`).
- Exact routing through iMessage `reply_to_guid` when available.
- Explicit alias routing for messages such as `api: fix the failing test`.
- Ambiguous replies are refused rather than guessed.

See [the design spec](docs/specs/2026-08-21-pimess-router.md).
