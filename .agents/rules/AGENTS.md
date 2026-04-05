---
trigger: always_on
---

# Meeting Co-Pilot Workspace (AGENTS.md)

Welcome to the **Meeting Co-Pilot** repository. This project is a real-time meeting transcription, co-pilot assistant, and project management tool built with Agno, FastAPI, and Next.js.

## 🏗️ Project Architecture

### Backend (`/backend`)
A FastAPI server hosting two specialized Agno Agents:
1. **Meeting Co-Pilot**: Active participant during meetings.
   - **Model**: Configurable per-meeting via `models_config.json` (default: GPT-4o-mini).
   - **Tools**: `DuckDuckGoTools` for real-time web search.
   - **Memory**: Persistent sessions via `agno.db.sqlite.SqliteDb`.
2. **Project Manager (Summarizer)**: Post-meeting analysis.
   - **Model**: Configurable per-meeting via `models_config.json` (default: Gemini 2.5 Pro via OpenRouter).
   - **Purpose**: Generates a structured Markdown Implementation Plan from the transcript.

#### Key Files:
- `main.py`: FastAPI application & API endpoints.
- `database.py`: SQLAlchemy models for business logic persistence.
- `models.py`: Default model configurations (fallback if no per-meeting override).
- `models_config.json`: **Edit this** to add/remove available model options shown in the UI dropdown.
- `prompts.py`: System instructions for agents.
- `agents/copilot.py`: Copilot agent — accepts `context_text` and `model_id` overrides.
- `agents/summarizer.py`: Summarizer agent — accepts `context_text` and `model_id` overrides.

#### Database Schema (`app_data.db`):
- `meetings` table: `id`, `title`, `created_at`, `is_active`, `summary_markdown`, `transcript`, `context_items`, `copilot_model_id`, `summarizer_model_id`
- `summary_versions` table: `id`, `meeting_id`, `version_number`, `content`, `instruction`, `created_at` (plan/summarizer version history)

### Frontend (`/frontend`)
A modern **Next.js 16 (App Router)** interface.
- **Styling**: Tailwind CSS 4 with a dark/glassmorphic premium design.
- **Recording**: Continuous 20s chunking via `MediaRecorder` for background transcription.
- **Push-To-Talk**: Interactive dialogue with the Agno Co-Pilot for immediate voice queries.
- **Setup Screen**: `/meetings/new` — configure title, models, and context before starting.
- **Context Panel**: Accessible during active meeting via sidebar toggle.

## 🛠️ Development & Environment

### Prerequisites
- **Python**: Use `uv` for environment management.
- **Node**: Use `bun` / `bunx` for frontend.
- **Terminal Shell**: Fish.

### API Keys
Create a `.env` file in the root or `backend/` directory with:
```env
OPENAI_API_KEY=sk-...
OPENROUTER_API_KEY=sk-...
```

## 🚀 Commands

### Backend
From the root:
```bash
cd backend
uv run uvicorn main:app --reload --port 8000
```

Backend tests:
```bash
cd backend
uv run pytest -q
```

### Frontend
From the root:
```bash
cd frontend
bun dev
```

Frontend quality gates:
```bash
cd frontend
bun run lint
bun run build
bun run test
```

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/meeting/create` | Create inactive meeting (setup phase) |
| POST | `/api/meeting/{id}/start` | Activate meeting (start recording) |
| PATCH | `/api/meetings/{id}` | Update title/model selections |
| DELETE | `/api/meetings/{id}` | Remove meeting permanently |
| POST | `/api/meeting/cleanup-stale-drafts` | Remove abandoned old inactive setup drafts |
| POST | `/api/meetings/{id}/reactivate` | Re-open finished meeting; appends old summary |
| POST | `/api/meeting/{id}/context/text` | Add text note to context |
| POST | `/api/meeting/{id}/context/file` | Upload file → extract → add to context |
| DELETE | `/api/meeting/{id}/context/{index}` | Remove context item |
| GET | `/api/meeting/{id}/context` | List all context items |
| GET | `/api/models` | Get available model options from models_config.json |
| POST | `/api/meeting/transcript` | Append background audio chunk |
| POST | `/api/chat/text` | Text query to copilot |
| POST | `/api/chat/audio` | Audio query to copilot (PTT) |
| POST | `/api/meeting/summarize` | End meeting & generate summary (also stores summary version) |
| POST | `/api/meeting/{id}/summaries/regenerate` | Regenerate summary/plan with optional instruction |
| GET | `/api/meetings/{id}/summaries` | List summary versions |
| POST | `/api/meetings/{id}/summaries/{version}/activate` | Activate selected summary version |
| GET | `/api/meetings` | List all meetings |
| GET | `/api/meetings/{id}` | Get meeting detail |

## 🧠 Best Practices
- **Persistence**: Agent internal memory is in `agents.db`. Application metadata is in `app_data.db`.
- **Context**: Context items are stored as JSON in `meeting.context_items` and injected into both copilot and summarizer prompts.
- **Models**: Add/remove available models in `backend/models_config.json` — no code changes needed.
- **Meeting Lifecycle**: `is_active=False` at creation → set `True` by `/start` → `False` by `/summarize` → can be re-`True` by `/reactivate`.
- **Pause**: Frontend pause now explicitly stops background recorder loop and resumes safely without duplicate recorders.
- **Setup draft strategy**: `/meetings/new` now creates draft meetings lazily (on first meaningful action), preventing orphan rows on page open/close.
- **Plan versions**: each summarize/regenerate run is persisted in `summary_versions`; UI can switch active version and export markdown.
- **Agno Usage**: Always check the session ID (`id` from URL) to maintain conversation context with the Agno Co-Pilot.

## ⚠️ Notes for Agents
- No backward compatibility needed — prune unused features freely.
- **DB migrations**: When adding columns to `Meeting`, run a manual ALTER TABLE (SQLAlchemy doesn't do migrations). Use plain `python3` (not `uv run`) if in the sandbox (uv cache may be read-only).
- **Agno `SqliteDb.get_sessions()`** requires a `session_type` parameter. Query `agents.db` directly via `sqlite3`: `copilot_sessions` table has `runs` JSON column.
- **Chat panel expand button** must be rendered *outside* the `<motion.section overflow-hidden>` container — otherwise it's clipped at width=0.
- **Polling & view state**: Use `useRef` flags to track intentional user navigation; stop polling once `is_active === false`.
- **Background recorder cleanup**: Always call `stream.getTracks().forEach(t => t.stop())` on meeting end.
- **Context panel** is a separate `<motion.aside>` rendered between the transcript section and the chat sidebar.
- **Reactivate**: Appends old summary to transcript with a `⟳ Meeting Resumed` separator, then clears `summary_markdown` so the UI doesn't auto-switch back to summary view.

## Planning Workspace State (2026-04-04 17:21)
- Active plan file: PLAN.md
- Idea: explore this project and suggest improvements
- Done gate: Mark [x] only after lint + relevant tests pass.
- Detected lint commands:
  - `cd frontend && bun run lint`
- Detected test commands:
  - `cd frontend && bun run test`
  - `cd backend && uv run pytest -q`
  - (build gate) `cd frontend && bun run build`
