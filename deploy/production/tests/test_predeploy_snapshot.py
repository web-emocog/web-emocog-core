"""Snapshot failure/recovery tests; every yc command is isolated from cloud IO."""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("predeploy_snapshot", Path(__file__).parents[1] / "predeploy-snapshot.py")
snapshots = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(snapshots)
SHA = "a" * 40
REAL_RUN = subprocess.run
QUOTA = "ERROR: rpc error: code = ResourceExhausted desc = The limit on total size of snapshots has exceeded."
DENIED = "ERROR: rpc error: code = PermissionDenied desc = Permission denied"


def snapshot(number, **overrides):
    result = {
        "id": f"snapshot-{number}", "folder_id": "production-folder", "source_disk_id": "production-disk",
        "name": f"wecog-predeploy-20261001-{number:06d}-aaaaaaaa",
        "created_at": f"2026-10-01T00:00:{number:02d}Z", "status": "READY",
        "labels": {"app": "wecog", "reason": "predeploy", "commit": SHA[:12]},
    }
    return {**result, **overrides}


class FakeYC:
    def __init__(self, count=3, capacity=100):
        self.values = [snapshot(i) for i in range(1, count + 1)]
        self.capacity = capacity
        self.calls = []
        self.handlers = {}
        self.create_errors = []

    def run(self, command, **kwargs):
        assert command[:3] == ["yc", "compute", "snapshot"]
        assert command[4:8] == ["--folder-id", "production-folder", "--format", "json"]
        assert command[8:10] == ["--retry", "0"]
        assert "--async" not in command
        assert 0 < kwargs["timeout"] <= 600
        assert kwargs.get("shell", False) is False
        action = command[3]
        self.calls.append((action, command))
        if action in self.handlers:
            return self.handlers[action](command)
        return self.default(command)

    def response(self, command, value=None, error=None):
        return subprocess.CompletedProcess(command, 1 if error else 0,
                                           json.dumps(value) if value is not None else "", error or "")

    def default(self, command):
        action = command[3]
        if action == "list":
            assert command[-2:] == ["--limit", "1000"]
            return self.response(command, self.values)
        if action == "get":
            item = next(item for item in self.values if item["id"] == command[-1])
            return self.response(command, item)
        if action == "delete":
            self.values = [item for item in self.values if item["id"] != command[-1]]
            return self.response(command, {"done": True})
        if action == "create":
            if self.create_errors:
                return self.response(command, error=self.create_errors.pop(0))
            if len(self.values) >= self.capacity:
                return self.response(command, error=QUOTA)
            new = snapshot(50, id="snapshot-new", name=command[command.index("--name") + 1])
            self.values.append(new)
            return self.response(command, new)
        raise AssertionError(action)

    def ids(self):
        return {item["id"] for item in self.values}

    def actions(self):
        return [action for action, _command in self.calls]

    def deleted(self):
        return [command[-1] for action, command in self.calls if action == "delete"]


class SnapshotRotationTests(unittest.TestCase):
    def setUp(self):
        self.yc = FakeYC()
        self.output = io.StringIO()
        self.enterContext(contextlib.redirect_stdout(self.output))
        self.enterContext(patch.object(snapshots.subprocess, "run", self.yc.run))
        self.controller = snapshots.Snapshots("production-folder", "production-disk", 5, SHA)

    def fails(self, message=None):
        return self.assertRaisesRegex(snapshots.SnapshotError, message or ".+")

    def test_preflight_only_reads_and_rejects_denied_even_with_empty_array(self):
        self.controller.check()
        self.assertEqual(self.yc.actions(), ["list", "get"])
        self.yc.handlers["list"] = lambda cmd: subprocess.CompletedProcess(cmd, 1, "[]", DENIED)
        with self.fails("PermissionDenied"):
            self.controller.check()
        self.assertEqual(self.yc.actions(), ["list", "get", "list"])

    def test_preflight_get_denied_stops_before_any_mutation(self):
        self.yc.handlers["get"] = lambda cmd: self.yc.response(cmd, error=DENIED)
        with self.fails("PermissionDenied"):
            self.controller.check()
        self.assertEqual(self.yc.actions(), ["list", "get"])

    def test_regular_retention_reserves_slot_before_create_and_verifies_ready(self):
        self.yc.values = [snapshot(i) for i in range(1, 6)]
        self.assertEqual(self.controller.create(), "snapshot-new")
        self.assertEqual(self.yc.deleted(), ["snapshot-1"])
        self.assertEqual(self.yc.ids(), {"snapshot-2", "snapshot-3", "snapshot-4", "snapshot-5", "snapshot-new"})
        self.assertLess(self.yc.actions().index("delete"), self.yc.actions().index("create"))
        self.assertEqual(self.yc.actions()[-2:], ["get", "list"])

    def test_quota_deletes_oldest_one_at_a_time_and_keeps_last_old_ready(self):
        self.yc.values = [snapshot(i) for i in range(1, 6)]
        self.yc.capacity = 2
        self.controller.create()
        self.assertEqual(self.yc.deleted(), ["snapshot-1", "snapshot-2", "snapshot-3", "snapshot-4"])
        self.assertEqual(self.yc.ids(), {"snapshot-5", "snapshot-new"})
        self.assertEqual(self.yc.actions().count("create"), 4)

    def test_quota_fails_closed_when_only_last_ready_remains(self):
        self.yc.capacity = 1
        with self.fails("last READY"):
            self.controller.create()
        self.assertEqual(self.yc.deleted(), ["snapshot-1", "snapshot-2"])
        self.assertEqual(self.yc.ids(), {"snapshot-3"})
        self.assertNotIn("snapshot-new", self.yc.ids())

    def test_bootstrap_with_no_old_snapshot_creates_one_without_deletion(self):
        self.yc.values = []
        self.controller.create()
        self.assertEqual(self.yc.ids(), {"snapshot-new"})
        self.assertEqual(self.yc.deleted(), [])

    def test_bootstrap_quota_has_nothing_safe_to_delete(self):
        self.yc.values, self.yc.capacity = [], 0
        with self.fails("last READY"):
            self.controller.create()
        self.assertEqual(self.yc.deleted(), [])
        self.assertEqual(self.yc.actions().count("create"), 1)

    def test_manual_baseline_other_disk_folder_and_partial_labels_are_not_deleted(self):
        extras = [
            snapshot(10, name="manual-baseline"),
            snapshot(11, source_disk_id="another-disk"),
            snapshot(12, folder_id="another-folder"),
            snapshot(13, labels={"app": "wecog"}),
            snapshot(14, labels={"reason": "predeploy"}),
            snapshot(15, labels={}),
            snapshot(16, labels={"app": "another-app", "reason": "predeploy"}),
            snapshot(17, status="ERROR"),
        ]
        self.yc.values.extend(extras)
        self.yc.capacity = len(extras) + 2
        self.controller.create()
        self.assertTrue({item["id"] for item in extras} <= self.yc.ids())
        self.assertEqual(self.yc.deleted(), ["snapshot-1", "snapshot-2"])

    def test_explicit_protection_label_is_preserved_under_quota(self):
        self.yc.values[0]["labels"]["protected"] = "true"
        self.yc.capacity = 2
        with self.fails("last READY"):
            self.controller.create()
        self.assertEqual(self.yc.deleted(), ["snapshot-2"])
        self.assertEqual(self.yc.ids(), {"snapshot-1", "snapshot-3"})

    def test_nonready_snapshot_cannot_count_as_last_recovery_point(self):
        self.yc.values = [snapshot(1), snapshot(2, status="ERROR")]
        self.yc.capacity = 2
        with self.fails("last READY"):
            self.controller.create()
        self.assertEqual(self.yc.deleted(), [])

    def test_inflight_operations_stop_before_any_mutation(self):
        for status in ("CREATING", "DELETING"):
            with self.subTest(status=status):
                self.yc.values[0]["status"] = status
                with self.fails("in progress"):
                    self.controller.create()
        self.assertEqual(self.yc.actions(), ["list", "list"])

    def test_get_denied_stops_before_deletion(self):
        self.yc.values = [snapshot(i) for i in range(1, 6)]
        self.yc.handlers["get"] = lambda cmd: self.yc.response(cmd, error=DENIED)
        with self.fails("PermissionDenied"):
            self.controller.create()
        self.assertNotIn("delete", self.yc.actions())
        self.assertNotIn("create", self.yc.actions())

    def test_delete_denied_stops_and_cannot_be_hidden_by_shell_substitution(self):
        self.yc.values = [snapshot(i) for i in range(1, 6)]
        self.yc.handlers["delete"] = lambda cmd: self.yc.response(cmd, error=DENIED)
        with self.fails("PermissionDenied"):
            self.controller.create()
        self.assertNotIn("create", self.yc.actions())
        self.assertEqual(len(self.yc.ids()), 5)

    def test_silent_failed_deletion_is_detected_before_create(self):
        self.yc.values = [snapshot(i) for i in range(1, 6)]
        self.yc.handlers["delete"] = lambda cmd: self.yc.response(cmd, {"done": True})
        with self.fails("changed unexpectedly"):
            self.controller.create()
        self.assertNotIn("create", self.yc.actions())

    def test_create_denied_does_not_trigger_quota_cleanup(self):
        self.yc.create_errors = [DENIED]
        with self.fails("PermissionDenied"):
            self.controller.create()
        self.assertEqual(self.yc.deleted(), [])
        self.assertEqual(self.yc.actions().count("create"), 1)

    def test_only_specific_snapshot_quota_errors_allow_extra_deletion(self):
        for error in ("ERROR: rpc error: code = ResourceExhausted desc = Too many operations",
                      "ERROR: rpc error: code = Unavailable desc = Try again", "quota exceeded", "network timeout"):
            with self.subTest(error=error):
                self.yc.create_errors = [error]
                with self.fails():
                    self.controller.create()
        self.assertEqual(self.yc.deleted(), [])

    def test_unknown_or_ambiguous_create_result_never_retries_or_deletes_more(self):
        for result in ("not-json", "{}", "null", "[]", '{"id":"operation-id"}'):
            with self.subTest(result=result):
                self.yc.handlers["create"] = lambda cmd: subprocess.CompletedProcess(cmd, 0, result, "")
                with self.fails():
                    self.controller.create()
        self.yc.handlers["create"] = lambda cmd: subprocess.CompletedProcess(cmd, 1, '{"id":"maybe-created"}', QUOTA)
        with self.fails():
            self.controller.create()
        self.assertEqual(self.yc.deleted(), [])

    def test_timeout_never_causes_additional_deletion_or_create_retry(self):
        def timeout(cmd):
            raise subprocess.TimeoutExpired(cmd, 600)
        self.yc.handlers["create"] = timeout
        with self.fails("timed out"):
            self.controller.create()
        self.assertEqual(self.yc.deleted(), [])
        self.assertEqual(self.yc.actions().count("create"), 1)

    def test_invalid_list_and_duplicate_json_keys_cannot_cause_mutations(self):
        for source in ("", "not-json", "{}", "null", '[{"id":"x","id":"y"}]', '[NaN]'):
            with self.subTest(source=source):
                self.yc.handlers["list"] = lambda cmd: subprocess.CompletedProcess(cmd, 0, source, "")
                with self.fails():
                    self.controller.create()
        self.assertTrue(all(action == "list" for action in self.yc.actions()))

    def test_missing_or_malformed_metadata_fails_before_mutations(self):
        for field, value in (("id", ""), ("source_disk_id", None), ("folder_id", None),
                             ("status", "unknown"), ("created_at", "2026-02-30T00:00:00Z"),
                             ("created_at", "yesterday"), ("labels", []), ("labels", {"app": 1}), ("name", [])):
            with self.subTest(field=field, value=value):
                self.yc.values = [snapshot(1), snapshot(2, **{field: value})]
                with self.fails():
                    self.controller.create()
        self.assertTrue(all(action == "list" for action in self.yc.actions()))

    def test_duplicate_or_truncated_inventory_fails_closed(self):
        for values in ([snapshot(1), snapshot(1)], [snapshot(1)] * 1000):
            self.yc.values = values
            with self.fails():
                self.controller.create()
        self.assertTrue(all(action == "list" for action in self.yc.actions()))

    def test_new_snapshot_must_match_requested_disk_folder_name_commit_and_ready_status(self):
        for updates in ({"source_disk_id": "another-disk"}, {"folder_id": "another-folder"},
                        {"name": "manual-baseline"}, {"status": "CREATING"}, {"status": "ERROR"},
                        {"labels": {"app": "wecog", "reason": "predeploy", "commit": "b" * 12}},
                        {"id": "snapshot-3"}):
            with self.subTest(updates=updates):
                def invalid_create(cmd):
                    new = snapshot(50, id="snapshot-new", name=cmd[cmd.index("--name") + 1])
                    return self.yc.response(cmd, {**new, **updates})
                self.yc.handlers["create"] = invalid_create
                with self.fails():
                    self.controller.create()
        self.assertEqual(self.yc.deleted(), [])

    def test_get_must_confirm_new_snapshot_remains_ready(self):
        def get(cmd):
            result = self.yc.default(cmd)
            if cmd[-1] == "snapshot-new":
                value = json.loads(result.stdout)
                value["status"] = "ERROR"
                return self.yc.response(cmd, value)
            return result
        self.yc.handlers["get"] = get
        with self.fails("readiness"):
            self.controller.create()
        self.assertEqual(self.yc.deleted(), [])

    def test_labels_changed_before_deletion_abort(self):
        self.yc.values = [snapshot(i) for i in range(1, 6)]
        def get(cmd):
            value = json.loads(self.yc.default(cmd).stdout)
            value["labels"]["protected"] = "true"
            return self.yc.response(cmd, value)
        self.yc.handlers["get"] = get
        with self.fails("metadata changed"):
            self.controller.create()
        self.assertNotIn("delete", self.yc.actions())

    def test_concurrent_new_ready_snapshot_aborts_quota_cleanup(self):
        def quota(cmd):
            self.yc.values.append(snapshot(20))
            return self.yc.response(cmd, error=QUOTA)
        self.yc.handlers["create"] = quota
        with self.fails("changed unexpectedly"):
            self.controller.create()
        self.assertEqual(self.yc.deleted(), [])

    def test_changing_storage_size_is_not_a_change_to_protected_identity(self):
        self.yc.values = [snapshot(i) for i in range(1, 6)]
        def get(cmd):
            value = json.loads(self.yc.default(cmd).stdout)
            return self.yc.response(cmd, {**value, "storage_size": "100"})
        self.yc.handlers["get"] = get
        self.controller.create()
        self.assertEqual(self.yc.deleted(), ["snapshot-1"])

    def test_timestamp_sort_is_chronological_with_fractional_precision(self):
        self.yc.values = [snapshot(1, created_at="2026-10-01T00:00:00.000000001Z"),
                          snapshot(2, created_at="2026-10-01T00:00:00Z")]
        self.yc.capacity = 2
        self.controller.create()
        self.assertEqual(self.yc.deleted(), ["snapshot-2"])

    def test_bad_configuration_stops_before_any_cli_call(self):
        env = {"YC_FOLDER_ID": "production-folder", "YC_VM_DISK_ID": "production-disk",
               "GITHUB_SHA": SHA, "YC_AUTOMATED_SNAPSHOTS_TO_KEEP": "5"}
        for field, value in (("YC_FOLDER_ID", ""), ("YC_VM_DISK_ID", "--other"), ("GITHUB_SHA", "main"),
                             ("YC_AUTOMATED_SNAPSHOTS_TO_KEEP", "1"), ("YC_AUTOMATED_SNAPSHOTS_TO_KEEP", "invalid")):
            with self.subTest(field=field), patch.dict(os.environ, {**env, field: value}), patch.object(snapshots.sys, "argv", ["helper", "create"]):
                with self.fails():
                    snapshots.main()
        self.assertEqual(self.yc.calls, [])

    def test_real_entrypoint_exits_nonzero_on_cli_failure_without_echoing_sensitive_output(self):
        with tempfile.TemporaryDirectory(prefix="wecog-snapshot-cli-") as directory:
            fake = Path(directory) / "yc"
            fake.write_text(f'#!{sys.executable}\nimport sys\nprint("[]")\n'
                            f'print({DENIED!r}, file=sys.stderr)\n'
                            'print("SENSITIVE-CLI-DETAILS", file=sys.stderr)\nsys.exit(1)\n')
            fake.chmod(0o700)
            env = {**os.environ, "PATH": directory + os.pathsep + os.environ["PATH"],
                   "YC_FOLDER_ID": "production-folder", "YC_VM_DISK_ID": "production-disk",
                   "GITHUB_SHA": SHA, "YC_AUTOMATED_SNAPSHOTS_TO_KEEP": "5"}
            result = REAL_RUN([sys.executable, "-B", SPEC.origin, "check"],
                              capture_output=True, text=True, check=False, env=env, timeout=5)
            self.assertEqual(result.returncode, 1)
            self.assertIn("PermissionDenied", result.stderr)
            self.assertNotIn("SENSITIVE-CLI-DETAILS", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
