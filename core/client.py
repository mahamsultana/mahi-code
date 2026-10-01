"""How we reach the brain: one shared connection to the LLM."""
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()  # reads the MAHAM_CODE_* settings from a .env file if there is one

# Groq, Gemini and Ollama all speak the same "OpenAI-compatible" API,
# so switching providers is just a different URL + model name in .env.
MODEL = os.environ.get("MAHAM_CODE_MODEL", "openai/gpt-oss-120b")


def get_client() -> OpenAI:
    api_key = os.environ.get("MAHAM_CODE_API_KEY")
    if not api_key:
        raise SystemExit("No API key. Copy .env.example to .env and put your key in it.")
    return OpenAI(
        api_key=api_key,
        base_url=os.environ.get("MAHAM_CODE_BASE_URL", "https://api.groq.com/openai/v1"),
    )
