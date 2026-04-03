# Meeting Co-Pilot Workspace (AGENTS.md)

Welcome to the **Meeting Co-Pilot** repository. This project is a real-time meeting transcription, co-pilot assistant, and project management tool built with Agno, FastAPI, and Next.js.

## 🏗️ Project Architecture

### Backend (`/backend`)
A FastAPI server hosting two specialized Agno Agents:
1. **Meeting Co-Pilot**: Active participant during meetings.
   - **Model**: OpenAI (GPT-4o-mini/GPT-4o).
   - **Tools**: `DuckDuckGoTools` for real-time web search.
   - **Memory**: Persistent sessions via `agno.db.sqlite.SqliteDb`.
2. **Project Manager (Summarizer)**: Post-meeting analysis.
   - **Model**: OpenRouter (Gemini 2.1 Pro/GPT-4).
   - **Purpose**: Generates a structured Markdown Implementation Plan from the transcript.

#### Key Files:
- `main.py`: FastAPI application & API endpoints.
- `database.py`: SQLAlchemy models for business logic persistence.
- `models.py`: Centralized model configurations.
- `prompts.py`: System instructions for agents.
- `agents/`: Implementation of specific Agno Agents.

### Frontend (`/frontend`)
A modern **Next.js 16 (App Router)** interface.
- **Styling**: Tailwind CSS 4 with a dark/glassmorphic premium design.
* **Recording**: Continuous 20s chunking via `MediaRecorder` for background transcription and silent updates to the visual transcript.
* **Push-To-Talk**: Interactive dialogue with the Agno Co-Pilot for immediate voice queries.

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

### Frontend
From the root:
```bash
cd frontend
bun dev
```

## 🧠 Best Practices
- **Persistence**: Agent internal memory is in `agents.db`. Application metadata (Meeting titles, statuses, summaries) is in `app_data.db`.
- **Transcription**: Background recording is silent and populates the `Live Transcript` on the left. Active "Push-to-Talk" triggers the Co-Pilot to answer questions on the right.
- **Agno Usage**: Always check the session ID (`id` from URL) to maintain conversation context with the Agno Co-Pilot.

## ⚠️ Notes for Agents
- If modifying the backend models, update `backend/models.py`.
- For UI enhancements, use the Tailwind `glass` or `gradient-text` utility classes defined in `globals.css`.
- Whisper is used via the direct OpenAI transcription API (`whisper-1`).
