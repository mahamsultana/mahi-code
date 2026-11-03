"""Unit tests for core/tools.py. No API key needed.

Run from the project root:  py -m unittest discover tests
"""
import json
import tempfile
import unittest
from pathlib import Path

from core.tools import describe_tool_call, execute_tool


class ToolTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name).resolve()
        (self.root / "app.py").write_text("def add(a, b):\n    return a + b\n", encoding="utf-8")
        (self.root / "src").mkdir()
        (self.root / "src" / "util.py").write_text("def helper():\n    pass\n", encoding="utf-8")
        (self.root / ".env").write_text("SECRET=1\n", encoding="utf-8")

    def tearDown(self):
        self._tmp.cleanup()

    def run_tool(self, name, **args):
        return execute_tool(name, json.dumps(args), self.root)

    def read(self, path):
        return (self.root / path).read_text(encoding="utf-8")

    # ---------- Exploring ----------

    def test_list_files_marks_folders_and_hides_env(self):
        result = self.run_tool("list_files")
        self.assertIn("src/", result)
        self.assertIn("app.py", result)
        self.assertNotIn(".env", result)

    def test_find_files_searches_subfolders(self):
        result = self.run_tool("find_files", pattern="**/*.py")
        self.assertIn("app.py", result)
        self.assertIn("src/util.py", result)

    def test_find_files_no_match(self):
        self.assertIn("No files match", self.run_tool("find_files", pattern="*.rs"))

    def test_search_files_reports_path_and_line(self):
        self.assertIn("app.py:2: return a + b", self.run_tool("search_files", pattern="return a"))

    def test_search_files_never_reads_env(self):
        self.assertIn("No matches", self.run_tool("search_files", pattern="SECRET"))

    def test_search_files_invalid_regex_is_literal(self):
        self.assertIn("app.py:1", self.run_tool("search_files", pattern="add(a"))

    # ---------- Reading ----------

    def test_read_file(self):
        self.assertIn("def add", self.run_tool("read_file", path="app.py"))

    def test_read_missing_file(self):
        self.assertIn("Error", self.run_tool("read_file", path="nope.py"))

    # ---------- Editing ----------

    def test_edit_file_changes_in_place(self):
        result = self.run_tool("edit_file", path="app.py", old_text="a + b", new_text="a + b + 0")
        self.assertIn("Edited", result)
        self.assertIn("return a + b + 0", self.read("app.py"))

    def test_edit_file_text_not_found(self):
        result = self.run_tool("edit_file", path="app.py", old_text="nope", new_text="x")
        self.assertIn("not found", result)

    def test_edit_file_ambiguous_match_changes_nothing(self):
        (self.root / "dup.py").write_text("x = 1\nx = 1\n", encoding="utf-8")
        result = self.run_tool("edit_file", path="dup.py", old_text="x = 1", new_text="x = 2")
        self.assertIn("appears 2 times", result)
        self.assertEqual(self.read("dup.py"), "x = 1\nx = 1\n")

    def test_edit_missing_file(self):
        self.assertIn("does not exist", self.run_tool("edit_file", path="new.py", old_text="a", new_text="b"))

    # ---------- Writing ----------

    def test_write_file_creates_folders(self):
        result = self.run_tool("write_file", path="pkg/new.py", content="x = 1\n")
        self.assertIn("Created", result)
        self.assertEqual(self.read("pkg/new.py"), "x = 1\n")

    def test_write_file_reports_replace(self):
        self.assertIn("Replaced", self.run_tool("write_file", path="app.py", content="pass\n"))

    # ---------- Renaming ----------

    def test_rename_moves_file_and_removes_old(self):
        result = self.run_tool("rename_file", old_path="app.py", new_path="main.py")
        self.assertIn("Renamed", result)
        self.assertFalse((self.root / "app.py").exists())
        self.assertIn("def add", self.read("main.py"))

    def test_rename_into_new_folder(self):
        self.run_tool("rename_file", old_path="app.py", new_path="lib/app.py")
        self.assertTrue((self.root / "lib" / "app.py").is_file())

    def test_rename_never_overwrites(self):
        result = self.run_tool("rename_file", old_path="app.py", new_path="src/util.py")
        self.assertIn("already exists", result)
        self.assertIn("def helper", self.read("src/util.py"))
        self.assertTrue((self.root / "app.py").exists())

    def test_rename_missing_source(self):
        self.assertIn("does not exist", self.run_tool("rename_file", old_path="x.py", new_path="y.py"))

    # ---------- Safety ----------

    def test_blocks_paths_outside_project(self):
        for name, args in [
            ("read_file", {"path": "../outside.txt"}),
            ("write_file", {"path": "../outside.txt", "content": "x"}),
            ("rename_file", {"old_path": "app.py", "new_path": "../app.py"}),
            ("edit_file", {"path": "../outside.txt", "old_text": "a", "new_text": "b"}),
        ]:
            with self.subTest(name=name):
                self.assertIn("outside the project", self.run_tool(name, **args))
        self.assertTrue((self.root / "app.py").exists())

    def test_blocks_env_and_git(self):
        self.assertIn("off limits", self.run_tool("read_file", path=".env"))
        self.assertIn("off limits", self.run_tool("write_file", path=".git/config", content="x"))
        self.assertIn("off limits", self.run_tool("rename_file", old_path=".env", new_path="env.txt"))
        self.assertEqual(self.read(".env"), "SECRET=1\n")

    def test_bad_calls_return_errors_not_exceptions(self):
        self.assertIn("unknown tool", execute_tool("delete_all", "{}", self.root))
        self.assertIn("not valid JSON", execute_tool("read_file", "{path:", self.root))
        self.assertIn("wrong arguments", execute_tool("read_file", '{"file": "x"}', self.root))

    # ---------- Display ----------

    def test_describe_tool_call(self):
        self.assertEqual(describe_tool_call("write_file", '{"path": "a.py", "content": "x"}'), "Writing a.py")
        self.assertEqual(
            describe_tool_call("rename_file", '{"old_path": "a.py", "new_path": "b.py"}'), "Renaming a.py to b.py"
        )
        self.assertEqual(describe_tool_call("list_files", "{}"), "Listing project folder")


if __name__ == "__main__":
    unittest.main()
