"""Exercise the actual nested stimulus callback without opening Tk or a camera."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest


class TkStimulusScopeTest(unittest.TestCase):
    def test_stimulus_metadata_comes_from_current_trial(self):
        source = Path(__file__).parents[1] / "scripts" / "run_tk_experiment.py"
        tree = ast.parse(source.read_text(encoding="utf-8"))
        callback = next(node for node in ast.walk(tree)
                        if isinstance(node, ast.FunctionDef) and node.name == "stim_on")
        code = compile(ast.fix_missing_locations(ast.Module(body=[callback], type_ignores=[])),
                       str(source), "exec")
        for task, expected, is_go in [("simple", "space", True),
                                      ("choice", "left", True),
                                      ("go_nogo", None, False)]:
            with self.subTest(task=task):
                events = []
                timers = []
                widget = SimpleNamespace(config=lambda **_kwargs: None)
                namespace = {"state": {"trial_id": 7, "stimulus_type": "current_stimulus",
                                       "expected": expected, "is_go": is_go},
                             "args": SimpleNamespace(task=task), "label": widget, "sub": widget,
                             "bounds": SimpleNamespace(timeout_ms=1234),
                             "root": SimpleNamespace(after=lambda *args: timers.append(args)),
                             "stim_off": lambda: None,
                             "emit": lambda event, **kwargs: events.append((event, kwargs))}
                exec(code, namespace)
                namespace["stim_on"]()
                self.assertEqual(events[0][0], "stimulus_on")
                self.assertEqual(events[0][1]["stimulus_type"], "current_stimulus")
                self.assertEqual(events[0][1]["stimulus_id"], "current_stimulus")
                self.assertEqual(events[0][1]["trial_id"], 7)
                self.assertEqual(timers[0][0], 1234)


if __name__ == "__main__":
    unittest.main()
