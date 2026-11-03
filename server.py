"""HTTP face for the VS Code extension (it can't import Python directly)."""
from pathlib import Path

from flask import Flask, Response, request

from core.chat import Conversation

app = Flask(__name__)
convo = Conversation()


@app.post("/chat")
def chat():
    data = request.get_json()
    user_text = data["message"]
    root = data.get("root")  # the folder open in VS Code, if any

    def stream():
        try:
            if root and Path(root).is_dir():
                convo.root = Path(root)
                yield from convo.run(user_text)
            else:
                # No folder open: chat only, so it never edits files somewhere unexpected.
                yield "(No folder is open, so I can't see your files. Open a folder to let me read and edit them.)\n\n"
                yield from convo.ask_stream(user_text)
        except Exception as e:  # e.g. rate limit or retired model: show it in the chat
            yield f"\n\n**Error:** {e}"

    # Stream the reply as plain text so the extension can show it live.
    return Response(stream(), mimetype="text/plain")


@app.post("/reset")
def reset():
    convo.reset()
    return {"ok": True}


if __name__ == "__main__":
    app.run(port=8765, threaded=False)
