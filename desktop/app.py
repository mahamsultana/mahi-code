"""Desktop face: a pywebview window. The UI is plain HTML in index.html."""
import json
from pathlib import Path

import webview

from core.chat import Conversation


class Api:
    """Every method here is callable from JavaScript as pywebview.api.<name>()."""

    def __init__(self):
        self.convo = Conversation()
        self.window = None

    def send(self, user_text):
        for chunk in self.convo.ask_stream(user_text):
            self.window.evaluate_js(f"appendChunk({json.dumps(chunk)})")
        return True

    def reset(self):
        self.convo.reset()


def main():
    api = Api()
    html = Path(__file__).with_name("index.html")
    api.window = webview.create_window("Maham Code", str(html), js_api=api, width=800, height=700)
    webview.start()


if __name__ == "__main__":
    main()
