# pimess

A Pi extension and shared local router for sending and receiving iMessages across multiple Pi sessions.

## Transport

`pimess` uses **Photon/Spectrum by default**, so PiMess has its own iMessage identity instead of appearing as a self-chat.

Photon setup requires:

- A Photon project with Spectrum enabled.
- `SPECTRUM_PROJECT_ID`.
- `SPECTRUM_PROJECT_SECRET`.
- The Photon-assigned iMessage line.
- The recipient’s phone number or Photon space as `PHOTON_TARGET`.
- The recipient must text the assigned Photon line first when using a shared/free line.

Configure the environment before starting Pi:

```bash
export SPECTRUM_PROJECT_ID="..."
export SPECTRUM_PROJECT_SECRET="..."
export PHOTON_TARGET="+15551234567"
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

Then enable the session:

```text
/pimess on
```

Photon runs a supervised Node sidecar using the pinned `spectrum-ts` dependency. No local Messages.app account, SIP changes, or `imsg launch` are required for Photon.

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
/pimess alias <name>
/pimess on
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
