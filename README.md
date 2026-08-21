# pimess

A Pi extension and local router for sending and receiving iMessages across multiple Pi sessions.

## Requirements

- macOS 14+
- Pi
- [`imsg`](https://github.com/openclaw/imsg) installed and authorized for Messages.app
- Messages.app signed in with the recipient available

## Install

```bash
pi install git:github.com/itisbryan/pimess
```

Start Pi with the extension and initialize a dedicated recipient chat:

```bash
export PIMESS_ALIAS=api
pi -e /path/to/pimess/src/extension.ts
```

Inside Pi, explicitly approve the recipient:

```text
/pimess init +15551234567
```

`pimess` sends a normal iMessage to create or locate the Messages conversation, then persists the resulting chat ID under `~/.pi/agent/pimess/config.json`. This does not require `imsg launch`, SIP changes, or private framework injection. You can also configure an existing chat manually with `PIMESS_CHAT_ID=42`.

Then enable this session:

```text
/pimess on
```

Use a different alias in another Pi session:

```text
/pimess alias docs
/pimess on
```

## Commands

```text
/pimess status
/pimess init <phone-or-apple-id>
/pimess alias <name>
/pimess on
/pimess off
/pimess forward on|off
```

`/pimess on` enables inbound delivery for the current session. Settled-reply forwarding is separately controlled by `PIMESS_FORWARD_SETTLED=1` and `/pimess forward on`.

## Routing

- Inline iMessage replies use `reply_to_guid` to return to the exact Pi session.
- Explicit messages such as `api: fix the failing test` route by alias.
- A plain message routes only when one session is enabled.
- With multiple enabled sessions, pimess asks for an alias instead of guessing.
- Offline target sessions never fall through to another agent.

The router is shared across Pi processes and stores message-to-session mappings under `~/.pi/agent/pimess/state.json`.

## Explicit sends

The LLM can call `send_imessage`, but Pi asks for confirmation before delivery. Messages are labeled with the current session alias.

See [the design spec](docs/specs/2026-08-21-pimess-router.md) for the architecture and acceptance criteria.
