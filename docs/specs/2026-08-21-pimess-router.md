# pimess two-way routing

## Goal

Allow multiple Pi sessions running on one Mac to share an iMessage chat without losing agent identity or routing replies to the wrong session.

## Approach

Use one shared local `pimess` router per Mac. The router owns one long-lived `imsg rpc` child, watches inbound messages, sends outbound messages, and maintains the mapping between iMessage message GUIDs and Pi sessions.

The Pi extension is a client of the router. It registers the current session, exposes user commands and an LLM tool, and receives routed inbound prompts over a local Unix socket.

### Alternatives rejected

- **One watcher per Pi process:** each session can observe the same inbound message, and shared-file locking does not solve ownership or delivery races.
- **Separate iMessage chats:** routing is simpler, but users must manage a different chat for every agent.
- **Latest-agent-wins:** unthreaded replies can silently reach the wrong session.

## Scope

### In scope

- Public Pi package/repository named `pimess`.
- Photon/Spectrum transport through the managed Node router by default.
- Optional local macOS transport through `imsg rpc`.
- One router process per user/Mac.
- Pi session registration with a human alias and stable Pi session ID.
- Outbound text messages labeled with the sending alias.
- Outbound correlation using `imsg` tracked-send GUIDs when available.
- Inbound routing by `reply_to_guid`.
- Explicit alias routing such as `api: fix the failing test`.
- Safe handling of unthreaded ambiguous replies.
- Persistent routing state across router restarts.
- Session liveness/expiry so dead sessions are not selected.
- Pi commands for status, initialization, alias, enable, and disable.
- Explicit initialization that creates or locates a recipient chat and persists its chat ID.
- Tests that do not require a live Messages.app account.

### Out of scope for the first release

- BlueBubbles support.
- Multiple Macs sharing one router.
- Group-chat membership management.
- Bulk messaging.
- Automatic routing based only on the most recently active agent.
- Sending intermediate tool output or shell transcripts by default.
- Attachments, reactions, typing indicators, and read receipts.

## Details

### Components

```text
Pi extension (one instance per session)
        │ Unix socket
        ▼
pimess router (one per Mac)
        │ one supervised child
        ▼
Photon/Spectrum SDK (default) or imsg rpc
        │
        ▼
iMessage
```

### Session identity

Each registered session has:

```json
{
  "alias": "api",
  "sessionId": "<Pi session ID>",
  "project": "<project name>",
  "cwd": "<absolute cwd>",
  "socket": "<session socket>",
  "lastSeenAt": "<ISO timestamp>",
  "enabled": true
}
```

Aliases are unique within the router. A registration with an alias already owned by a live session is rejected until the owner releases it or expires.

### Routing records

For each successful outbound message, the router stores:

```json
{
  "messageGuid": "<iMessage GUID>",
  "messageId": 123,
  "chatGuid": "<chat GUID>",
  "alias": "api",
  "sessionId": "<Pi session ID>",
  "sentAt": "<ISO timestamp>"
}
```

The store is append/update safe and bounded. Old records are pruned after a configurable retention period; active unresolved replies remain available.

### Outbound behavior

- The extension sends explicit messages through the router.
- The router prefixes human-visible text with `[alias]` unless the caller opts out for a one-off message.
- The router prefers `imsg rpc` tracked sends with a caller-owned correlation ID when the installed `imsg` exposes that method.
- If tracked sends are unavailable, the router uses ordinary `send` and records the returned GUID/ID when observable.
- Recipient/chat targets are configured and allowlisted; arbitrary recipient sends are rejected by default.
- The extension defaults to disabled automatic forwarding until `/pimess on`; explicit tool sends remain confirmation-gated.

### Inbound behavior

1. Ignore messages sent by the local user unless they are an inbound echo needed for correlation.
2. If `reply_to_guid` matches a stored outbound record, deliver to that session.
3. Otherwise parse an explicit alias prefix (`api:`, `docs:`, etc.) and deliver to that live session.
4. If exactly one enabled session owns the configured chat, deliver to it.
5. If multiple sessions could receive the message, do not invoke any agent. Send a short disambiguation response listing active aliases.
6. If the target session is dead or expired, do not fall through to another session; report that the target is offline.

The router strips the control alias from the prompt delivered to Pi but preserves the original message metadata, including chat and message GUID.

### Commands

```text
/pimess status
/pimess init <phone-or-apple-id>
/pimess alias <name>
/pimess on
/pimess off
```

`pimess photon setup --phone <E.164>` runs Photon device login, finds or creates the project, provisions the Spectrum secret, registers the phone as a Spectrum user, and persists runtime credentials in a mode-0600 Photon config. `/pimess init <target>` can then persist a recipient phone, Apple ID, or Photon space as the target. The Photon SDK uses the assigned Photon line and does not require local Messages.app or SIP changes. The optional imsg transport retains `/pimess init <phone-or-apple-id>` for creating or locating a local Messages conversation. That local path does not require `imsg launch`. `on` enables the current session to receive routed messages and, only when explicitly configured, forward settled assistant replies. `off` unregisters delivery without deleting routing history. `status` shows the router, current alias, active sessions, configured chats, and transport health without displaying message contents.

### Failure behavior

- Router unavailable: explicit sends fail with a clear local error; Pi does not claim delivery.
- `imsg rpc` exits: router restarts it with bounded backoff.
- Send result uncertain: do not retry automatically; retain an uncertain record and surface it in status.
- Watch overflow: resume from the cursor supplied by `imsg` and deduplicate by message GUID.
- Stale session socket: mark the session offline and require re-registration.
- Ambiguous inbound message: ask the user to use an alias or inline reply; never guess.

### Security

- Bind the Unix socket with owner-only permissions.
- Store router state under the user’s Pi configuration directory with owner-only permissions.
- Validate aliases, socket paths, and message sizes.
- Keep recipients in an explicit allowlist.
- Require an explicit Pi command before enabling automatic forwarding.
- Never log message bodies, credentials, or full phone numbers.

## Acceptance

1. Photon configuration starts the Spectrum SDK with project credentials and a target space; optional imsg initialization creates or locates a local recipient chat after confirmation and persists its chat ID.
2. Two Pi sessions can register as `api` and `docs` simultaneously.
3. Each outbound message visibly identifies its alias and creates a routing record.
4. An inline reply to an `api` message is delivered only to `api`.
5. `docs: update the README` is delivered only to `docs`.
6. An unthreaded message with multiple active sessions produces a disambiguation response and invokes no agent.
7. A message targeting an offline alias reports that alias offline and does not invoke another session.
8. Router restart preserves routing records and active configuration safely.
9. Router and extension tests cover registration, duplicate aliases, reply-GUID routing, alias parsing, ambiguity refusal, stale sessions, and bounded persistence.
10. The package can be loaded by Pi through its `pi` manifest and extension discovery without modifying Pi core.

## Open questions

None for the first implementation. Recipient configuration and automatic-forwarding defaults should be exposed as documented settings, not guessed from the first message.
