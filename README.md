# Maham Code

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-blue.svg)](https://www.python.org/)
[![Status: Milestone 1](https://img.shields.io/badge/status-milestone%201-orange.svg)](#roadmap)

An open-source coding assistant built from scratch to learn how tools like Claude Code work under the hood.

It's being built in public, one milestone at a time. Right now it's a chat assistant; next it learns to read and edit files on its own.

## One brain, three faces

All the AI logic lives in `core/`. Each app is a thin wrapper that just sends text in and shows text out.

```
                ┌──────────────┐
  Terminal ───► │              │
  Desktop  ───► │    core/     │ ───► LLM API
  VS Code  ───► │ (the brain)  │
   (via server) └──────────────┘
```

| Face | File | How it reaches the brain |
|---|---|---|
| Terminal | `cli/main.py` | Imports `core` directly |
| Desktop | `desktop/app.py` | pywebview window; JavaScript calls Python methods |
| VS Code | `vscode-extension/` | Sidebar chat that sends HTTP requests to `server.py` |

Upgrade the brain once and every face gets the upgrade.

## Quick start

You need Python 3.10+ and a free API key from [Groq](https://console.groq.com/keys).

```bash
git clone https://github.com/mahamsultana/mahi-code.git
cd mahi-code
pip install -r requirements.txt
cp .env.example .env      # then paste your key into .env
python -m cli.main        # on Windows: py -m cli.main
```

### Desktop app

```bash
python -m desktop.app
```

### VS Code extension

1. Start the server: `python server.py`
2. Open this folder in VS Code and press **F5**.
3. In the new window, click the **M** icon in the activity bar.

Highlight code, then right-click and choose **Ask Maham Code about selection**, to ask about it.

## Using a different model

Any OpenAI-compatible provider works. Change three lines in `.env`:

| Provider | Cost | `MAHAM_CODE_BASE_URL` |
|---|---|---|
| Groq (default) | Free tier | `https://api.groq.com/openai/v1` |
| Google Gemini | Free tier | `https://generativelanguage.googleapis.com/v1beta/openai/` |
| Ollama | Free, runs on your computer | `http://localhost:11434/v1` |

See `.env.example` for the matching model names.

## Roadmap

- [x] **Milestone 1:** Chat in the terminal, desktop and VS Code, with streaming replies and conversation memory
- [ ] **Milestone 2:** Tools: the assistant can read and write files
- [ ] **Milestone 3:** Agent loop: it plans, runs tools and checks its own work
- [ ] **Milestone 4:** Running commands, with permission prompts

## How it works (Milestone 1)

- **The `messages` list is the memory.** The API remembers nothing between calls, so the whole conversation is sent again every turn.
- **Streaming** shows the reply piece by piece instead of waiting for the full answer.
- **The faces contain no AI logic.** They only display strings.

## Project structure

```
mahi-code/
├── core/
│   ├── client.py        # Connects to the LLM provider
│   └── chat.py          # Conversation class: memory + streaming
├── cli/main.py          # Terminal app
├── desktop/
│   ├── app.py           # Desktop window (pywebview)
│   └── index.html       # Desktop UI
├── server.py            # HTTP server the VS Code extension talks to
└── vscode-extension/
    ├── extension.js     # Sidebar provider: bridge between VS Code and server.py
    └── media/           # Chat UI (main.js, main.css, icon.svg)
```

## Contributing

This is a learning project built in public, and ideas, issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
