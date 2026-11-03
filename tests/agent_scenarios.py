"""End-to-end checks against the real model: multi-turn conversations, then
inspect the files on disk. Uses your API key and free-tier quota.

Run from the project root:  py -m tests.agent_scenarios
Run one scenario:           py -m tests.agent_scenarios rename
"""
import sys
import tempfile
from pathlib import Path

from core.chat import Conversation


def files(root: Path) -> set[str]:
    return {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()}


def text(root: Path, path: str) -> str:
    return (root / path).read_text(encoding="utf-8")


# Each scenario: starting files, what the user types (turn by turn), and a check
# on the final folder that returns a list of problems (empty means pass).
SCENARIOS = {
    "rename": {
        "setup": {},
        "turns": ["create hello.py that prints hi", "rename the file to greet.py"],
        "check": lambda r: [
            *(["greet.py missing"] if "greet.py" not in files(r) else []),
            *(["hello.py still exists"] if "hello.py" in files(r) else []),
            *([f"unexpected files: {files(r)}"] if files(r) != {"greet.py"} else []),
        ],
    },
    "rename_it": {
        "setup": {"notes.txt": "buy milk\n"},
        "turns": ["read notes.txt", "rename it to todo.txt"],
        "check": lambda r: [] if files(r) == {"todo.txt"} and "buy milk" in text(r, "todo.txt")
        else [f"files are {files(r)}"],
    },
    "move": {
        "setup": {"util.py": "def helper():\n    return 1\n"},
        "turns": ["move util.py into a folder called lib"],
        "check": lambda r: [] if files(r) == {"lib/util.py"} else [f"files are {files(r)}"],
    },
    "edit_in_place": {
        "setup": {"calc.py": "def add(a, b):\n    return a + b\n"},
        "turns": ["add a subtract function to calc.py"],
        "check": lambda r: [
            *([f"files are {files(r)}"] if files(r) != {"calc.py"} else []),
            *(["add() was lost"] if "def add" not in text(r, "calc.py") else []),
            *(["no subtract function"] if "def subtract" not in text(r, "calc.py") else []),
        ],
    },
    "fix_bug": {
        "setup": {"area.py": "def rectangle_area(w, h):\n    return w + h\n"},
        "turns": ["rectangle_area in area.py returns the wrong answer. fix it"],
        "check": lambda r: [
            *([f"files are {files(r)}"] if files(r) != {"area.py"} else []),
            *(["bug not fixed"] if "w * h" not in text(r, "area.py").replace("h * w", "w * h") else []),
        ],
    },
    "create_then_change": {
        "setup": {},
        "turns": ["make a python script that prints the numbers 1 to 5", "change it to print 1 to 10 instead"],
        "check": lambda r: [
            *([f"expected exactly one file, got {files(r)}"] if len(files(r)) != 1 else []),
            *(["not updated to 10"] if files(r) and "10" not in text(r, next(iter(files(r))))
              and "11" not in text(r, next(iter(files(r)))) else []),
        ],
    },
    "find_code": {
        "setup": {"a.py": "x = 1\n", "pkg/b.py": "def parse_config():\n    pass\n"},
        "turns": ["which file defines parse_config?"],
        "check": lambda r: [] if files(r) == {"a.py", "pkg/b.py"} else [f"files changed: {files(r)}"],
        "reply_must_contain": "b.py",
    },
    "no_overwrite": {
        "setup": {"a.txt": "AAA\n", "b.txt": "BBB\n"},
        "turns": ["rename a.txt to b.txt"],
        "check": lambda r: [] if "b.txt" in files(r) and text(r, "b.txt") == "BBB\n"
        else ["b.txt was overwritten"],
    },
    "question_no_edit": {
        "setup": {"area.py": "def rectangle_area(w, h):\n    return w + h\n"},
        "turns": ["is there a bug in area.py?"],
        "check": lambda r: [] if text(r, "area.py") == "def rectangle_area(w, h):\n    return w + h\n"
        else ["edited the file for a question"],
        "reply_must_contain": "w * h",
    },
    "concise": {
        "setup": {},
        "turns": ["how do I reverse a list in python?"],
        "check": lambda r: [] if not files(r) else [f"created files for a question: {files(r)}"],
        "max_words": 80,
    },
    "no_delete": {
        "setup": {"old.py": "print('old')\n"},
        "turns": ["delete old.py"],
        "check": lambda r: [] if files(r) == {"old.py"} and text(r, "old.py") == "print('old')\n"
        else [f"files are {files(r)}"],
    },
}


def run_scenario(name: str, scenario: dict) -> bool:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp).resolve()
        for path, content in scenario["setup"].items():
            (root / path).parent.mkdir(parents=True, exist_ok=True)
            (root / path).write_text(content, encoding="utf-8")

        convo = Conversation(root=root)
        trace, reply = [], ""
        try:
            for turn in scenario["turns"]:
                reply = ""
                for piece in convo.run(turn):
                    if piece.startswith("[tool] "):
                        trace.append(piece.strip()[7:])
                    else:
                        reply += piece
        except Exception as e:
            print(f"ERROR {name}: {e}")
            return False

        problems = scenario["check"](root)
        needed = scenario.get("reply_must_contain")
        if needed and needed not in reply:
            problems.append(f"reply doesn't mention {needed}")
        max_words = scenario.get("max_words")
        if max_words and len(reply.split()) > max_words:
            problems.append(f"reply is {len(reply.split())} words, over {max_words}")

    print(f"{'PASS' if not problems else 'FAIL'}  {name}")
    print(f"      tools: {' -> '.join(trace) or '(none)'}")
    for problem in problems:
        print(f"      problem: {problem}")
    return not problems


def main() -> None:
    names = sys.argv[1:] or list(SCENARIOS)
    results = [run_scenario(n, SCENARIOS[n]) for n in names]
    print(f"\n{sum(results)}/{len(results)} scenarios passed")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
