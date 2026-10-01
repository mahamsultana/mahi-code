"""HTTP face for the VS Code extension (it can't import Python directly)."""
from flask import Flask, Response, request

from core.chat import Conversation

app = Flask(__name__)
convo = Conversation()


@app.post("/chat")
def chat():
    user_text = request.get_json()["message"]

    def stream():
        try:
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
