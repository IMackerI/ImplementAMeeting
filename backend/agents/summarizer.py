import os
import json
from agno.agent import Agent
from agno.models.openai import OpenAIChat
from agno.models.openrouter import OpenRouter
from models import SUMMARIZER_MODEL
from prompts import SUMMARIZER_SYSTEM_PROMPT


def _build_summarizer_model(model_id: str | None):
    if not model_id:
        return SUMMARIZER_MODEL

    openai_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("OPEN_AI_SECRET_KEY", "")
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")

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
        return OpenRouter(id=model_id, api_key=openrouter_key, max_tokens=8192)


def run_summarizer(
    transcript: str,
    chat_history: str,
    context_text: str = "",
    model_id: str | None = None,
    instruction: str | None = None,
) -> str:
    agent = Agent(
        model=_build_summarizer_model(model_id),
        instructions=[SUMMARIZER_SYSTEM_PROMPT],
        markdown=True
    )
    
    context_block = ""
    if context_text.strip():
        context_block = f"\n\nContext materials provided before the meeting:\n<meeting_context>\n{context_text}\n</meeting_context>\n"

    instruction_block = ""
    if instruction and instruction.strip():
        instruction_block = (
            "\n\nAdditional user instruction for this version:"
            f"\n<regeneration_instruction>\n{instruction.strip()}\n</regeneration_instruction>"
        )

    prompt = (
        f"Here is the meeting transcript:\n\n{transcript}"
        f"{context_block}"
        f"\n\nHere is the chat history during the meeting:\n\n{chat_history}"
        f"{instruction_block}"
    )
    
    response = agent.run(prompt)
    if hasattr(response, 'content'):
        return response.content
    return str(response)
