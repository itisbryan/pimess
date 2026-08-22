# pimess

A Pi extension and shared local router for sending and receiving iMessages across multiple Pi sessions.

## Transport

`pimess` uses **Photon/Spectrum by default**, so PiMess has its own iMessage identity instead of appearing as a self-chat.

Photon setup requires a Photon account and an E.164 phone number to register. The setup command provisions or reuses the project, creates the Spectrum secret, registers the phone, and saves the assigned line. On shared/free lines, text the assigned Photon line from that phone first.

```bash
cd /Users/itisbryan/Desktop/personal/pimess
npm install
node bin/pimess.mjs photon setup --phone +15551234567
```

PiMess stores runtime credentials in `~/.pi/agent/pimess/photon.json` with mode `0600`. You can instead provide them explicitly:

```bash
export SPECTRUM_PROJECT_ID="..."
export SPECTRUM_PROJECT_SECRET="..."
export PIMESS_ALIAS=api
```

Install the extension directly without installing it into Pi:

```bash
cd /Users/itisbryan/Desktop/personal/pimess
npm install
pi -e ./src/extension.ts
```

Or install it as a Pi package:

```bash
pi install git:github.com/itisbryan/pimess
```

Then set or change the target from inside Pi:

```text
/pimess init +15551234567
```

This persists the Photon recipient/space in `~/.pi/agent/pimess/config.json`. Then enable the session:

```text
/pimess on
```

PiMess runs the official pinned `spectrum-ts` SDK in its managed router process, using Photon Cloud project credentials for the remote iMessage provider. No local Messages.app account, SIP changes, or `imsg launch` are required for Photon.

### Local `imsg` fallback

To use the Mac’s own Messages.app account instead:

```bash
export PIMESS_TRANSPORT=imsg
export PIMESS_CHAT_ID=42
```

Then start Pi and use `/pimess on`. This mode requires `imsg` and Messages.app permissions and appears as the Mac account, not a separate PiMess identity.

## Commands

```text
/pimess status
/pimess init <phone-number, Apple ID, or Photon space>
/pimess alias <name>
/pimess on
/pimess on forward
/pimess off
/pimess forward on|off
```

`/pimess on` enables inbound delivery for the current session. Settled-reply forwarding is separately controlled by `PIMESS_FORWARD_SETTLED=1` and `/pimess forward on`.

## Routing

- Inline replies use the originating message GUID when Photon provides it.
- Explicit messages such as `api: fix the failing test` route by alias.
- A plain message routes only when one session is enabled.
- With multiple enabled sessions, pimess asks for an alias instead of guessing.
- Offline target sessions never fall through to another agent.

The router is shared across Pi processes and stores message-to-session mappings under `~/.pi/agent/pimess/state.json`.

## Explicit sends

The LLM can call `send_imessage`, but Pi asks for confirmation before delivery. Messages are labeled with the current session alias.

See [the design spec](docs/specs/2026-08-21-pimess-router.md) for the architecture and acceptance criteria.
