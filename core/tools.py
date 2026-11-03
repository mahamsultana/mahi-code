"""The assistant's hands: tools the model can ask for, run by Python.

The set mirrors Claude Code's file tools: explore (list, find, search),
read, then change files in place (edit, rename) or create them (write).

Safety rule: the model never touches files itself. It only *requests* a tool
call; this module decides whether and how to run it. Every path is confined to
the project folder (the "root" each face passes in), and secrets like .env are
off limits, because anything a tool returns is sent to the LLM provider.
There's deliberately no delete tool yet.

Milestone 3 adds approval prompts before a tool changes anything.
"""
import json
import re
from pathlib import Path

BLOCKED = {".env", ".git"}  # never read or write these
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv"}  # noise when searching
MAX_READ_CHARS = 100_000  # keeps one huge file from flooding the conversation
MAX_RESULTS = 100  # cap for find/search results


def _tool(name: str, description: str, properties: dict, required: list[str]) -> dict:
    """Build a tool schema in the OpenAI-compatible format the model reads."""
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required},
        },
    }


PATH = {"type": "string", "description": "Path relative to the project root."}

# What the model sees: a name, when to use it, and the arguments.
TOOLS = [
    _tool("list_files", "List the files and folders in one project directory (not recursive).",
          {"directory": {"type": "string", "description": "Directory relative to the project root. Defaults to the root."}},
          []),
    _tool("find_files", "Find files anywhere in the project by name pattern, e.g. '**/*.py' or '**/test_*'.",
          {"pattern": {"type": "string", "description": "Glob pattern, relative to the project root."}},
          ["pattern"]),
    _tool("search_files", "Search the contents of every text file in the project for a regular expression. "
          "Returns matching lines as path:line: text.",
          {"pattern": {"type": "string", "description": "Regular expression to search for."},
           "directory": {"type": "string", "description": "Limit the search to this directory. Defaults to the root."}},
          ["pattern"]),
    _tool("read_file", "Read a text file. Always read a file before describing or changing it.",
          {"path": PATH}, ["path"]),
    _tool("edit_file", "Change part of an existing file by replacing an exact piece of text. "
          "old_text must match the file exactly (including spaces and indentation) and appear exactly once. "
          "Use this for any change to an existing file.",
          {"path": PATH,
           "old_text": {"type": "string", "description": "The exact text to replace, copied from the file."},
           "new_text": {"type": "string", "description": "The text to put in its place."}},
          ["path", "old_text", "new_text"]),
    _tool("write_file", "Create a new file, or replace an entire file's contents. Creates folders as needed. "
          "To change part of an existing file use edit_file; to rename or move one use rename_file.",
          {"path": PATH, "content": {"type": "string", "description": "The full contents of the file."}},
          ["path", "content"]),
    _tool("rename_file", "Rename or move a file or folder. The old path stops existing. "
          "Use this whenever the user asks to rename or move something; never copy it with write_file.",
          {"old_path": {"type": "string", "description": "Current path, relative to the project root."},
           "new_path": {"type": "string", "description": "New path, relative to the project root."}},
          ["old_path", "new_path"]),
]


def _safe_path(root: Path, path: str) -> Path:
    """Resolve a model-supplied path, refusing anything outside the project or blocked."""
    full = (root / path).resolve()
    if not full.is_relative_to(root):
        raise ValueError(f"'{path}' is outside the project folder.")
    if BLOCKED & set(full.relative_to(root).parts):
        raise ValueError(f"'{path}' is off limits.")
    return full


def _visible_files(root: Path, folder: Path):
    """Every file under folder, skipping blocked and noisy directories."""
    for file in folder.rglob("*"):
        parts = set(file.relative_to(root).parts)
        if file.is_file() and not (parts & SKIP_DIRS or parts & BLOCKED):
            yield file


def _rel(root: Path, file: Path) -> str:
    return file.relative_to(root).as_posix()


def list_files(root: Path, directory: str = ".") -> str:
    folder = _safe_path(root, directory)
    if not folder.is_dir():
        return f"Error: '{directory}' is not a directory."
    entries = sorted(folder.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
    lines = [p.name + "/" if p.is_dir() else p.name for p in entries if p.name not in BLOCKED]
    return "\n".join(lines) or "(empty directory)"


def find_files(root: Path, pattern: str) -> str:
    matches = sorted(_rel(root, f) for f in _visible_files(root, root) if f.relative_to(root).match(pattern)
                     or Path(_rel(root, f)).match(pattern.removeprefix("**/")))
    if not matches:
        return f"No files match '{pattern}'."
    extra = f"\n({len(matches) - MAX_RESULTS} more not shown)" if len(matches) > MAX_RESULTS else ""
    return "\n".join(matches[:MAX_RESULTS]) + extra


def search_files(root: Path, pattern: str, directory: str = ".") -> str:
    folder = _safe_path(root, directory)
    try:
        regex = re.compile(pattern)
    except re.error:
        regex = re.compile(re.escape(pattern))  # not a valid regex: search for it literally
    hits = []
    for file in sorted(_visible_files(root, folder)):
        try:
            lines = file.read_text(encoding="utf-8").splitlines()
        except (UnicodeDecodeError, OSError):
            continue  # binary or unreadable: skip
        for number, line in enumerate(lines, 1):
            if regex.search(line):
                hits.append(f"{_rel(root, file)}:{number}: {line.strip()[:200]}")
                if len(hits) >= MAX_RESULTS:
                    return "\n".join(hits) + f"\n(stopped at {MAX_RESULTS} matches)"
    return "\n".join(hits) or f"No matches for '{pattern}'."


def read_file(root: Path, path: str) -> str:
    file = _safe_path(root, path)
    if not file.is_file():
        return f"Error: '{path}' is not a file."
    try:
        text = file.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return f"Error: '{path}' is not a text file."
    if len(text) > MAX_READ_CHARS:
        return text[:MAX_READ_CHARS] + f"\n\n[Truncated: showing {MAX_READ_CHARS:,} of {len(text):,} characters.]"
    return text or "(empty file)"


def edit_file(root: Path, path: str, old_text: str, new_text: str) -> str:
    file = _safe_path(root, path)
    if not file.is_file():
        return f"Error: '{path}' does not exist. Use write_file to create a new file."
    text = file.read_text(encoding="utf-8")
    count = text.count(old_text) if old_text else 0
    if count == 0:
        return f"Error: old_text was not found in {path}. Read the file again and copy the text exactly."
    if count > 1:
        return f"Error: old_text appears {count} times in {path}. Include more surrounding lines so it matches once."
    file.write_text(text.replace(old_text, new_text, 1), encoding="utf-8")
    return f"Edited {path}."


def write_file(root: Path, path: str, content: str) -> str:
    file = _safe_path(root, path)
    existed = file.exists()
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(content, encoding="utf-8")
    return f"{'Replaced' if existed else 'Created'} {path} ({len(content):,} characters)."


def rename_file(root: Path, old_path: str, new_path: str) -> str:
    source = _safe_path(root, old_path)
    target = _safe_path(root, new_path)
    if not source.exists():
        return f"Error: '{old_path}' does not exist."
    if target.exists():
        return f"Error: '{new_path}' already exists. Pick another name, or ask the user what to do."
    target.parent.mkdir(parents=True, exist_ok=True)
    source.rename(target)
    return f"Renamed {old_path} to {new_path}. '{old_path}' no longer exists."


HANDLERS = {
    "list_files": list_files,
    "find_files": find_files,
    "search_files": search_files,
    "read_file": read_file,
    "edit_file": edit_file,
    "write_file": write_file,
    "rename_file": rename_file,
}


def describe_tool_call(name: str, arguments: str) -> str:
    """A short, human-readable line for a tool call, e.g. 'Writing hello.py'."""
    try:
        args = json.loads(arguments or "{}")
    except json.JSONDecodeError:
        args = {}
    descriptions = {
        "list_files": lambda: f"Listing {args.get('directory') or 'project folder'}",
        "find_files": lambda: f"Finding {args.get('pattern', '?')}",
        "search_files": lambda: f"Searching for {args.get('pattern', '?')}",
        "read_file": lambda: f"Reading {args.get('path', '?')}",
        "edit_file": lambda: f"Editing {args.get('path', '?')}",
        "write_file": lambda: f"Writing {args.get('path', '?')}",
        "rename_file": lambda: f"Renaming {args.get('old_path', '?')} to {args.get('new_path', '?')}",
    }
    return descriptions.get(name, lambda: f"Using {name}")()


def execute_tool(name: str, arguments: str | dict, root: Path) -> str:
    """Run one tool call inside root. Always returns a string, so a bad call never
    crashes the loop; the model reads the error and can try again."""
    try:
        args = json.loads(arguments or "{}") if isinstance(arguments, str) else arguments
        handler = HANDLERS.get(name)
        if handler is None:
            return f"Error: unknown tool '{name}'."
        return handler(root.resolve(), **args)
    except json.JSONDecodeError:
        return "Error: tool arguments were not valid JSON."
    except TypeError as e:
        return f"Error: wrong arguments for {name}: {e}"
    except Exception as e:
        return f"Error: {e}"
