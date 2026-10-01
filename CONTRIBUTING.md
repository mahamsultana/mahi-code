# Contributing to Maham Code

Thanks for your interest! This project is built in public as a way to learn how AI coding assistants work, so questions and small improvements are just as welcome as big features.

## Ways to help

- **Report a bug:** open an issue with what you did, what you expected, and what happened (include the error message).
- **Suggest an idea:** open an issue describing the feature and why it would help.
- **Send a pull request:** fixes, docs improvements and new provider configs are all great.

## Setting up

Follow the [Quick start](README.md#quick-start) in the README. You'll need a free API key from Groq, or a local model through Ollama.

## Guidelines

- **Keep AI logic in `core/`.** The terminal, desktop and VS Code apps should only display text. This is the main design rule of the project.
- **Keep changes small and focused.** One pull request per fix or feature.
- **Match the existing style.** Short functions, plain names, and comments that explain *why*.
- **Never commit API keys.** Your key belongs in `.env`, which git ignores.
