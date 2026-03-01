# Telegram Capability Upgrade Plan

## Objective
Upgrade Telegram integration from text-only into full user-facing messaging that supports:
- receiving media from users (starting with photo/document)
- sending files/media back to users
- agent-driven file/media actions with strict safety controls
- user slash commands for complete Telegram media operations

## Current State Review (Code Baseline)
- Inbound is text-only: `nanoclaw/src/channels/telegram.ts` listens to `message:text` only.
- Outbound is text-only: `sendMessage(jid, text)` only in `TelegramChannel`.
- Channel abstraction is text-only: `sendMessage(...)` in `nanoclaw/src/types.ts`.
- Message schema is text-only: `NewMessage.content: string` with no attachments.
- Message bus is text-only: `IncomingMessage.text` in `nanoclaw/src/message-bus.ts`.
- Router/context builder assumes only text content.
- Telegram media-specific tests do not exist yet (`whatsapp.test.ts` exists, Telegram channel test file does not).

## Target Capability (What "Complete" Means)
- User -> Bot:
  - Text, photo, and document are fully supported first.
  - Metadata for unsupported media types is still captured safely (no silent drop).
- Bot/AI -> User:
  - Text, photo, and document can be sent with optional caption.
- Persistence:
  - Message attachments are stored as metadata; optional local file download controlled by config.
- Agent control:
  - AI can request sending file/photo via structured output directives.
- User control:
  - Slash commands allow user to send files, inspect media settings, enable/disable media download, and clean up stored media.
- Reliability:
  - Clear fallbacks when media send/download fails.
  - No extra noisy logs; actionable errors only.

## Implementation Plan

### Phase 1: Extend Contracts (Types + Channel API)
Work:
- Add `MessageAttachment` model in `nanoclaw/src/types.ts`:
  - `id`, `kind`, `mimeType`, `fileName`, `fileSize`, `telegramFileId`, `telegramFileUniqueId`, `caption`, `width`, `height`, `durationSec`, `localPath`, `checksum`.
- Extend `NewMessage` with optional `attachments?: MessageAttachment[]`.
- Extend `Channel` with payload method:
  - `sendPayload?(jid: string, payload: OutboundPayload): Promise<void>`
  - keep `sendMessage` for backward compatibility.

Acceptance:
- Existing text flows still compile and run unchanged.
- New types can represent media without breaking old callers.

Tests:
- Type-level + unit tests for backward compatibility and payload typing.

### Phase 2: Persistence Layer for Attachments
Work:
- Add DB migration in `nanoclaw/src/db.ts`:
  - new table `message_attachments` linked by `(message_id, chat_jid)`.
- Add CRUD helpers:
  - `storeMessageAttachments(...)`
  - `getMessageAttachments(...)`
- Keep `messages.content` as text summary for compatibility.

Acceptance:
- Media metadata persists and can be queried by message.
- No schema regression on existing databases.

Tests:
- DB migration test on fresh DB and legacy DB path.
- CRUD tests for attachment insert/read.

### Phase 3: Inbound Telegram Media (User -> Bot)
Work:
- In `nanoclaw/src/channels/telegram.ts`, add handlers for:
  - `message:photo`
  - `message:document`
  - optional next: `message:video`, `message:voice`, `message:audio`
- Build a single extractor helper to normalize all inbound message variants into `NewMessage + attachments`.
- Add optional download pipeline:
  - config flags:
    - `TELEGRAM_MEDIA_DOWNLOAD_ENABLED`
    - `TELEGRAM_MEDIA_MAX_BYTES`
    - `TELEGRAM_MEDIA_DIR`
  - store metadata always; download file only when enabled and within limits.
- Convert media events into readable text summary when needed, for current agent prompt compatibility.

Acceptance:
- Photo/document from user is not dropped.
- Caption is preserved.
- Non-caption media still produces a meaningful placeholder in context.

Tests:
- New `nanoclaw/src/channels/telegram.test.ts` with mocked grammY API:
  - photo with caption
  - document with filename
  - oversize file skip
  - download failure fallback

### Phase 4: Outbound Telegram Media (Bot/AI -> User)
Work:
- Implement `sendPayload` in Telegram channel:
  - `sendPhoto`
  - `sendDocument`
  - optional caption + parse mode handling
- Keep `sendMessage` path for text-only responses.
- Add fallback policy:
  - if media send fails, send explanation text to user.

Acceptance:
- Host can send file/photo to Telegram chat from structured payload.
- Text-only behavior remains unchanged.

Tests:
- Outbound send tests for photo/document success + fallback paths.

### Phase 5: AI-Driven Media Actions
Work:
- Define structured output contract (internal tag or JSON block) for media send actions.
- Parse in host-side response handling before outbound send.
- Add strict path policy:
  - allow only files under the group workspace (and optional configured outbox path)
  - block path traversal / absolute path escape
  - enforce max file size + allowlist MIME/extensions
- Log concise action audit entries.

Acceptance:
- AI can reliably request sending a generated file/photo to the active Telegram chat.
- Unsafe paths are rejected with explicit user-facing reason.

Tests:
- Parser tests for valid/invalid directives.
- Security tests for path traversal and blocked file types.

### Phase 6: User Telegram Media Commands
Work:
- Add slash commands (inline tier):
  - `/tgmedia help`
  - `/tgmedia status`
  - `/tgmedia enable`
  - `/tgmedia disable`
  - `/tgsendfile <relative_path> [caption]`
  - `/tgsendphoto <relative_path> [caption]`
  - `/tgmediaclean [days]`
- Update:
  - `nanoclaw/src/command-registry.ts`
  - `nanoclaw/src/inline-handler.ts`
  - command tests

Acceptance:
- User can fully control Telegram media behavior and manual file sending via commands.

Tests:
- Command parser + handler tests for all new commands.
- Error tests (missing file, invalid args, disabled media).

### Phase 7: Observability, Noise Reduction, Rollout
Work:
- Add metrics/log fields:
  - inbound media count by type
  - download success/fail
  - outbound media success/fail
- Keep logs concise (one actionable line per failure class, no flood).
- Feature flag rollout:
  - `TELEGRAM_MEDIA_ENABLED=true|false`
  - enable in staging first, then production.

Acceptance:
- Operators can verify media health without noisy logs.
- Safe rollback by disabling media flags.

Tests:
- Smoke test in staging with real Telegram bot:
  - send photo/document from user
  - bot sends file back
  - AI-generated file send

## Definition of Done
- Telegram supports text + photo + document both inbound and outbound.
- AI can trigger safe file/photo sends through structured directives.
- Users can control Telegram media fully with commands.
- Unit/integration tests cover happy path + failure path + security path.
- Default behavior remains backward-compatible for existing text-only flows.

## Execution Log (Current Iteration)
- [x] Phase 1 foundation implemented:
  - Added `MessageAttachment` and `OutboundPayload` contracts.
  - Extended `Channel` with optional `sendPayload`.
- [x] Phase 2 foundation implemented:
  - Added `message_attachments` table and DB CRUD for attachment metadata.
- [x] Phase 3 implemented (initial scope):
  - Telegram inbound now handles `message` (text + media metadata).
  - Photo/document metadata extraction with optional local download.
  - Non-text media creates meaningful placeholder content.
- [x] Phase 4 implemented (initial scope):
  - Telegram `sendPayload` supports photo + document.
- [x] Phase 5 implemented (initial scope):
  - Added `<tg-media>{...}</tg-media>` directive parser.
  - Added group-workspace path policy and file-size checks.
  - AI output path can send media safely via directives.
- [x] Phase 6 implemented (initial scope):
  - Added `/tgmedia`, `/tgsendfile`, `/tgsendphoto` commands.
- [x] Tests executed:
  - `npm run typecheck` passed.
  - `npm test` passed (`19` files, `298` tests).
