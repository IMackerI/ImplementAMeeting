import os
import json
from agno.agent import Agent
from agno.db.sqlite import SqliteDb
from agno.tools.duckduckgo import DuckDuckGoTools
from agno.models.openai import OpenAIChat
from agno.models.openrouter import OpenRouter
from models import COPILOT_MODEL
from prompts import COPILOT_SYSTEM_PROMPT

# Keep agent storage separate from our metadata db
agent_db = SqliteDb(
    session_table="copilot_sessions",
    db_file="agents.db"
)


def _build_model(model_id: str | None):
    """Build the right Agno model object from a model_id string."""
    if not model_id:
        return COPILOT_MODEL

    openai_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("OPEN_AI_SECRET_KEY", "")
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")

    # Load models_config to determine provider
    config_path = os.path.join(os.path.dirname(__file__), "..", "models_config.json")
    try:
        with open(config_path) as f:
            config = json.load(f)
        all_models = config.get("copilot_models", []) + config.get("summarizer_models", [])
        entry = next((m for m in all_models if m["id"] == model_id), None)
        provider = entry["provider"] if entry else ("openai" if "/" not in model_id else "openrouter")
    except Exception:
        provider = "openai" if "/" not in model_id else "openrouter"

    if provider == "openai":
        return OpenAIChat(id=model_id, api_key=openai_key)
    else:
        return OpenRouter(id=model_id, api_key=openrouter_key, max_tokens=4096)


def get_copilot_agent(session_id: str, transcript: str = "", context_text: str = "", model_id: str | None = None) -> Agent:
    context_block = ""
    if context_text.strip():
        context_block = (
            f"\n\n**Meeting Context Materials:**\n<meeting_context>\n{context_text}\n</meeting_context>\n"
            "Use these materials to provide more informed and specific answers during the meeting.\n"
        )

    return Agent(
        model=_build_model(model_id),
        db=agent_db,
        session_id=session_id,
        add_history_to_context=True,
        num_history_runs=10,
        instructions=[
            COPILOT_SYSTEM_PROMPT,
            f"Here is the context of the meeting so far:\n<meeting_transcript>\n{transcript}\n</meeting_transcript>\n"
            "Use this transcript to answer the user's queries accurately."
            + context_block
        ],
        tools=[DuckDuckGoTools()],
        markdown=True
    )
