"""The Conversation class: the brain's memory plus the call to the LLM."""
from pathlib import Path
from typing import Iterator

from core.client import MODEL, get_client
from core.tools import TOOLS, describe_tool_call, execute_tool

SYSTEM_PROMPT = """\
You are Maham Code, a coding assistant that works directly in the user's project folder, like Claude Code.

Your tools:
- list_files, find_files, search_files: explore the project and locate code.
- read_file: look at a file. Read a file before you describe or change it; never guess its contents.
- edit_file: change part of an existing file in place. Use it for fixes, additions and updates.
- write_file: create a new file, or replace a whole file you have already read.
- rename_file: rename or move a file or folder.

How to work:
- First decide: is the user asking a question, or asking for a change? Questions like "is there a bug in X?", \
"what does X do?", "why is X slow?" or "how does X work?" get an answer only. Do not edit, write or rename \
anything for a question, even if you find a problem. Say what the problem is and how you'd fix it, and the user \
can ask you to do it. Only imperative requests ("fix", "add", "change", "create", "rename", "update") change files.
- Asked to create, make, build or write a program, script or file: create it with write_file. \
Don't just paste code in your reply. Pick a sensible file name if none is given.
- Asked to rename or move something: use rename_file. Never write a copy and leave the original behind.
- Asked to change, fix, update or add to existing code: read the file, then change that same file \
with edit_file. Never create a new file instead of changing the existing one.
- If the user says "it" or "the file", work out which file they mean from the conversation, \
or by listing files. Ask only if it's genuinely unclear.
- You can't delete files or run commands yet. If asked, say so and tell the user how to do it themselves.
- If a tool returns an error, read it and fix your approach instead of giving up or guessing.

How to answer:
- Put the answer in the first sentence. No preamble, no restating the question, \
no "Sure!" or "Great question", and no closing offers like "Let me know if...".
- Be short. Most answers are one to three sentences. Go longer only when the user asks for detail \
or the task genuinely needs it.
- Be specific: name the file, function and line, and quote exact values. Never be vague when you can look it up.
- For "how do I" questions, show the single best way with a short code example. Mention an alternative \
in one line only if it really matters.
- Don't use tables or headings. Use a short bulleted list only when listing several separate things.
- If you don't know or couldn't check something, say so in one sentence instead of hedging.
- After changing files, say what you changed in one line per file.
"""

MAX_STEPS = 15  # stops a confused model from calling tools forever


class Conversation:
    def __init__(self, system: str = SYSTEM_PROMPT, root: Path | None = None):
        self.client = get_client()
        self.system = system
        # The project folder the tools work in. The terminal and desktop apps use
        # the folder you started them from; VS Code sends its open folder.
        self.root = root or Path.cwd()
        # The memory. The API remembers nothing between calls,
        # so every turn we send this whole list again.
        self.messages: list[dict] = []

    def _history(self) -> list[dict]:
        # The system prompt goes first, then the whole history.
        return [{"role": "system", "content": self.system}] + self.messages

    def ask_stream(self, user_text: str) -> Iterator[str]:
        """Plain chat, no tools: send one message and yield the reply piece by piece."""
        self.messages.append({"role": "user", "content": user_text})

        stream = self.client.chat.completions.create(model=MODEL, messages=self._history(), stream=True)

        reply = ""
        for chunk in stream:
            if not chunk.choices:
                continue
            text = chunk.choices[0].delta.content or ""
            reply += text
            yield text

        self.messages.append({"role": "assistant", "content": reply})

    def run(self, user_text: str) -> Iterator[str]:
        """The agent loop: let the model use tools until it has an answer.

        Yields a short note for each tool call as it happens, then the final reply,
        so every face can show progress the same way it shows streamed chat.
        """
        self.messages.append({"role": "user", "content": user_text})

        for _ in range(MAX_STEPS):
            response = self.client.chat.completions.create(
                model=MODEL, messages=self._history(), tools=TOOLS
            )
            message = response.choices[0].message

            # No tool calls means the model is done: this is the answer.
            if not message.tool_calls:
                reply = message.content or ""
                self.messages.append({"role": "assistant", "content": reply})
                yield reply
                return

            # The model asked for tools. Record the request exactly, so the
            # results we send back can point to it by id.
            self.messages.append({
                "role": "assistant",
                "content": message.content,
                "tool_calls": [
                    {
                        "id": call.id,
                        "type": "function",
                        "function": {"name": call.function.name, "arguments": call.function.arguments},
                    }
                    for call in message.tool_calls
                ],
            })

            # Python runs each tool; the model only ever sees the result.
            for call in message.tool_calls:
                yield f"[tool] {describe_tool_call(call.function.name, call.function.arguments)}\n\n"
                result = execute_tool(call.function.name, call.function.arguments, self.root)
                self.messages.append({"role": "tool", "tool_call_id": call.id, "content": result})

        note = f"(Stopped after {MAX_STEPS} tool steps without a final answer.)"
        self.messages.append({"role": "assistant", "content": note})
        yield note

    def ask(self, user_text: str) -> str:
        """Same as run, but waits and returns everything as one string."""
        return "".join(self.run(user_text))

    def reset(self) -> None:
        self.messages = []
