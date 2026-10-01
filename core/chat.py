"""The Conversation class: the brain's memory plus the call to the LLM."""
from typing import Iterator

from core.client import MODEL, get_client

SYSTEM_PROMPT = (
    "You are Maham Code, a friendly coding assistant. "
    "Answer clearly and keep explanations short unless asked for detail."
)


class Conversation:
    def __init__(self, system: str = SYSTEM_PROMPT):
        self.client = get_client()
        self.system = system
        # The memory. The API remembers nothing between calls,
        # so every turn we send this whole list again.
        self.messages: list[dict] = []

    def ask_stream(self, user_text: str) -> Iterator[str]:
        """Send one message and yield the reply piece by piece."""
        self.messages.append({"role": "user", "content": user_text})

        stream = self.client.chat.completions.create(
            model=MODEL,
            # The system prompt goes first, then the whole history.
            messages=[{"role": "system", "content": self.system}] + self.messages,
            stream=True,
        )

        reply = ""
        for chunk in stream:
            if not chunk.choices:
                continue
            text = chunk.choices[0].delta.content or ""
            reply += text
            yield text

        self.messages.append({"role": "assistant", "content": reply})

    def ask(self, user_text: str) -> str:
        """Same as ask_stream, but waits and returns the whole reply."""
        return "".join(self.ask_stream(user_text))

    def reset(self) -> None:
        self.messages = []
