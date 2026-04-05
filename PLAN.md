# PLAN — Planning Agent Workspace Improvements

Improve the meeting workspace into a more reliable and useful planning-agent product by fixing known reliability/quality bugs (audio ingestion, summarizer history parsing, typing/lint issues) and adding high-impact product features (draft safety, plan regeneration/versioning, exportability, and automated regression coverage).

**Done gate:** Mark a task as `[x]` only after implementation is complete **and** lint + relevant tests pass.

Status legend: `[ ]` not started · `[/]` in progress · `[x]` done

## Task Board

- [x] **Task 1 — Stabilize real-time audio ingestion and recorder lifecycle**
- [x] **Task 2 — Fix summarizer conversation-history parsing and backend robustness**
- [x] **Task 3 — Remove `any` usage and establish typed API contracts (lint-clean frontend)**
- [x] **Task 4 — Prevent orphan meetings and improve setup/draft lifecycle UX**
- [x] **Task 5 — Add planning-agent power features (regenerate, version, export plan output)**
- [x] **Task 6 — Add regression tests and quality gates for backend + frontend critical flows**

---

## Task 1 — Stabilize real-time audio ingestion and recorder lifecycle

**Goal**
Eliminate transcription dropouts/decoding failures and reduce race conditions between background recording and push-to-talk recording.

**Implementation**
- Refactor `frontend/src/app/meetings/[id]/page.tsx` recording flow to a single coherent state machine for:
  - background chunking,
  - pause/resume,
  - push-to-talk override,
  - cleanup on unmount/end meeting/reactivate.
- Prevent empty/too-short chunks client-side before upload.
- Pass explicit mime/extension metadata to backend and validate it server-side in `backend/main.py`.
- Improve `_transcribe_audio` error reporting and return structured failure info (without crashing the session).

**Acceptance checks**
- No recurring `audio file could not be decoded` errors during normal use.
- Pause/resume + PTT can be toggled repeatedly without duplicate recorder loops or leaked tracks.
- Transcript continues smoothly before and after meeting reactivation.

---

## Task 2 — Fix summarizer conversation-history parsing and backend robustness

**Goal**
Ensure summaries reliably include copilot conversation context and remove the current parsing failure in logs.

**Implementation**
- Fix `/api/meeting/summarize` history extraction in `backend/main.py` to handle both:
  - JSON arrays of run objects,
  - double-encoded JSON string payloads (current failure mode).
- Normalize extracted runs defensively (ignore malformed items, keep valid ones).
- Include richer history (user + assistant turns when available, ordered and bounded).
- Resolve agent DB path handling so summarization is robust regardless of backend working directory.

**Acceptance checks**
- No `Could not fetch copilot history: 'str' object has no attribute 'get'` errors.
- Summaries reflect actual chat interactions, not transcript-only context.
- Summarize endpoint remains successful when history is missing or partially malformed.

---

## Task 3 — Remove `any` usage and establish typed API contracts (lint-clean frontend)

**Goal**
Get frontend back to lint-clean state and improve long-term maintainability with strict types.

**Implementation**
- Define explicit interfaces/types for meetings, context items, messages, and API responses in `frontend/src/lib/api.ts` (or dedicated `types.ts`).
- Replace `any` usage in:
  - `frontend/src/app/meetings/[id]/page.tsx`
  - `frontend/src/app/meetings/page.tsx`
  - `frontend/src/lib/api.ts`
- Remove dead imports and align component state types with API models.

**Acceptance checks**
- `cd frontend && bun run lint` passes with 0 errors.
- `cd frontend && bun run build` passes.

---

## Task 4 — Prevent orphan meetings and improve setup/draft lifecycle UX

**Goal**
Stop creating accidental/stale meetings and make setup flow safer when users abandon `/meetings/new`.

**Implementation**
- Rework `frontend/src/app/meetings/new/page.tsx` so meeting creation is not an automatic side effect on page load.
- Introduce an explicit draft strategy:
  - create on first real user action or on “Start Meeting”,
  - or auto-create with cleanup logic for abandoned drafts.
- Add backend support in `backend/main.py` for stale inactive draft cleanup (manual endpoint and/or time-based purge policy).
- Improve UX messaging for setup save/start failures.

**Acceptance checks**
- Visiting setup page and navigating away no longer leaves zombie meetings.
- Context/model/title are preserved correctly through the start flow.
- Meeting list remains clean after repeated setup aborts.

---

## Task 5 — Add planning-agent power features (regenerate, version, export plan output)

**Goal**
Make generated plans more usable as a real planning workspace output.

**Implementation**
- Add “Regenerate Plan” with optional user instruction (e.g., stricter scope, more detail, shorter output).
- Add summary/plan versioning per meeting (retain previous outputs, show current active version).
- Add export actions in meeting view:
  - copy markdown,
  - download `.md` file.
- Persist version metadata in DB (`backend/database.py`) and expose via API (`backend/main.py`).

**Acceptance checks**
- Users can regenerate and switch between plan versions without losing prior output.
- Exported markdown is clean and ready for external use.

---

## Task 6 — Add regression tests and quality gates for backend + frontend critical flows

**Goal**
Protect improved behavior from regressions and enable confident future changes.

**Implementation**
- Backend tests (FastAPI + DB) for:
  - meeting lifecycle (create/start/summarize/reactivate),
  - context CRUD,
  - summarizer history parsing edge cases.
- Frontend tests for key UI logic:
  - setup flow draft behavior,
  - meeting session view-state toggles (summary/transcript),
  - context panel interactions.
- Add project scripts for repeatable checks and document them.

**Acceptance checks**
- Relevant backend/frontend tests pass locally.
- Lint + test commands are documented and used as completion gate for `[x]` status.
