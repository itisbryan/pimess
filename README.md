# pimess

A Pi extension and local router for sending and receiving iMessages across multiple Pi sessions.

## Requirements

- macOS 14+
- Pi
- [`imsg`](https://github.com/openclaw/imsg) installed and authorized for Messages.app
- A configured iMessage chat ID

## Install

```bash
pi install git:github.com/itisbryan/pimess
```

Configure the chat to watch and send to:

```bash
export PIMESS_CHAT_ID=42
export PIMESS_ALIAS=api
```

Find chat IDs with:

```bash
imsg chats --json
```

Start Pi and enable this session:

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
