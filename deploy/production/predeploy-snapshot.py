#!/usr/bin/env python3
"""Fail-closed runner-side rotation of Wecog pre-deploy disk snapshots.

Run only under the shared wecog-production workflow concurrency group. The
create command belongs AFTER wecog-release prepare (the DB/media backup gate),
and BEFORE wecog-release deploy. No production credentials are needed by tests.
"""

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import time


RESOURCE_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,62}\Z")
AUTO_NAME = re.compile(r"wecog-predeploy-\d{8}-\d{6}(?:-\d{6})?-[0-9a-f]{8}\Z")
TIMESTAMP = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z\Z")
SNAPSHOT_QUOTA = re.compile(
    r"^ERROR: rpc error: code = ResourceExhausted desc = The limit on "
    r"(?:total size of snapshots|(?:total )?(?:number|count) of snapshots|snapshots (?:count|size)) "
    r"has (?:been )?exceeded\.?\s*$", re.MULTILINE,
)
LIST_LIMIT = 1000


class SnapshotError(RuntimeError):
    pass


class CLIError(SnapshotError):
    def __init__(self, action, result):
        # Do not echo arbitrary CLI output, environment values or trace paths.
        code = re.search(r"\bcode = ([A-Za-z]+)\b", result.stderr)
        reason = code[1] if code else "CLI failure"
        super().__init__(f"yc snapshot {action} failed ({reason}); release stopped")
        self.snapshot_quota = bool(
            action == "create" and not result.stdout.strip()
            and SNAPSHOT_QUOTA.search(result.stderr)
        )


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def decode_json(source):
    def invalid_constant(_value):
        raise ValueError("non-JSON numeric constant")

    try:
        return json.loads(source, object_pairs_hook=unique_object, parse_constant=invalid_constant)
    except (ValueError, TypeError):
        raise SnapshotError("Invalid JSON from yc; release stopped") from None


def validate_snapshot(value):
    if not isinstance(value, dict):
        raise SnapshotError("Invalid snapshot object from yc")
    for field in ("id", "folder_id", "source_disk_id"):
        if not isinstance(value.get(field), str) or not RESOURCE_ID.fullmatch(value[field]):
            raise SnapshotError(f"Missing or invalid snapshot {field}")
    if value.get("status") not in ("READY", "CREATING", "DELETING", "ERROR"):
        raise SnapshotError("Missing or invalid snapshot status")
    timestamp = value.get("created_at")
    if not isinstance(timestamp, str) or not TIMESTAMP.fullmatch(timestamp):
        raise SnapshotError("Missing or invalid snapshot created_at")
    try:
        # Validate calendar fields separately, compatible with Python 3.10.
        # Ordering below retains all nine fractional digits.
        dt.datetime.strptime(timestamp[:19], "%Y-%m-%dT%H:%M:%S")
    except ValueError:
        raise SnapshotError("Invalid snapshot calendar date") from None
    labels = value.get("labels", {})
    if not isinstance(labels, dict) or any(
        not isinstance(key, str) or not isinstance(item, str) for key, item in labels.items()
    ):
        raise SnapshotError("Invalid snapshot labels")
    if not isinstance(value.get("name", ""), str):
        raise SnapshotError("Invalid snapshot name")
    return value


def created_order(snapshot):
    stamp = snapshot["created_at"][:-1]
    whole, _, fraction = stamp.partition(".")
    return whole, fraction.ljust(9, "0"), snapshot["id"]


def identity(snapshot):
    # Exclude storage_size/disk_size, which can be recomputed by the service.
    return {field: snapshot.get(field, {}) if field == "labels" else snapshot.get(field)
            for field in ("id", "folder_id", "source_disk_id", "name", "created_at", "status", "labels")}


class Snapshots:
    def __init__(self, folder, disk, keep, sha):
        self.folder, self.disk, self.keep, self.sha = folder, disk, keep, sha
        self.deadline = time.monotonic() + 1200

    def command(self, action, *arguments):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise SnapshotError("Snapshot operation deadline exceeded; release stopped")
        try:
            result = subprocess.run(
                ["yc", "compute", "snapshot", action, "--folder-id", self.folder,
                 "--format", "json", "--retry", "0", *arguments],
                capture_output=True, text=True, check=False,
                timeout=min(600, remaining), env={**os.environ, "LC_ALL": "C"},
            )
        except subprocess.TimeoutExpired:
            # A timed-out create may still finish in the cloud. Never delete
            # anything else or retry creation on an ambiguous result.
            raise SnapshotError(f"yc snapshot {action} timed out; inspect cloud operations before retry") from None
        except OSError:
            raise SnapshotError("Cannot execute yc; release stopped") from None
        if result.returncode:
            raise CLIError(action, result)
        return result.stdout

    def managed(self, snapshot):
        labels = snapshot.get("labels", {})
        return (snapshot["folder_id"] == self.folder
                and snapshot["source_disk_id"] == self.disk
                and labels.get("app") == "wecog"
                and labels.get("reason") == "predeploy"
                and AUTO_NAME.fullmatch(snapshot.get("name", "")) is not None)

    def inventory(self):
        values = decode_json(self.command("list", "--limit", str(LIST_LIMIT)))
        if not isinstance(values, list) or len(values) >= LIST_LIMIT:
            raise SnapshotError("Invalid or possibly truncated snapshot list; release stopped")
        snapshots = [validate_snapshot(value) for value in values]
        if len({item["id"] for item in snapshots}) != len(snapshots):
            raise SnapshotError("Duplicate snapshot IDs; release stopped")
        owned = [item for item in snapshots if self.managed(item)]
        if any(item["status"] in ("CREATING", "DELETING") for item in owned):
            raise SnapshotError("An automated snapshot operation is still in progress; release stopped")
        return sorted((item for item in owned if item["status"] == "READY"), key=created_order)

    def unchanged(self, expected):
        ready = self.inventory()
        if {item["id"] for item in ready} != expected:
            raise SnapshotError("Automated READY snapshot inventory changed unexpectedly; release stopped")
        return ready

    def check(self):
        ready = self.inventory()
        if ready:
            newest = ready[-1]
            current = validate_snapshot(decode_json(self.command("get", "--id", newest["id"])))
            if identity(current) != identity(newest):
                raise SnapshotError("Snapshot metadata changed during read-access check; release stopped")
        print(f"Snapshot inventory is readable; {len(ready)} automated READY snapshots. Write permissions are checked by create/delete.")

    def delete_oldest(self, expected, protected):
        ready = self.unchanged(expected)
        candidates = [item for item in ready if item["id"] != protected
                      and item.get("labels", {}).get("protected") != "true"]
        if len(ready) <= 1 or not candidates:
            raise SnapshotError("No safely removable snapshots remain; preserve the last READY copy and request quota review")
        victim = candidates[0]
        # Re-read both the retained recovery point and the deletion target.
        # Labels/names may have changed since the list was taken.
        for selected in (next(item for item in ready if item["id"] == protected), victim):
            current = validate_snapshot(decode_json(self.command("get", "--id", selected["id"])))
            if identity(current) != identity(selected):
                raise SnapshotError("Snapshot metadata changed before deletion; release stopped")
        print(f"Removing oldest automated snapshot {victim['id']}; retaining {protected}", flush=True)
        # Synchronous deletion; a nonzero exit must propagate, unlike Bash < <(...).
        self.command("delete", "--id", victim["id"])
        expected.remove(victim["id"])
        self.unchanged(expected)  # A successful exit alone is not proof of removal.

    def create(self):
        ready = self.inventory()
        expected = {item["id"] for item in ready}
        protected = ready[-1]["id"] if ready else None
        # Reserve one count slot within the normal retention budget first.
        # Never count ERROR/CREATING/manual copies as a usable recovery point.
        while len(expected) > self.keep - 1:
            self.delete_oldest(expected, protected)
        name = "wecog-predeploy-" + dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d-%H%M%S-%f") + "-" + self.sha[:8]
        while True:
            self.unchanged(expected)
            try:
                created = validate_snapshot(decode_json(self.command(
                    "create", "--name", name, "--disk-id", self.disk,
                    "--description", f"Wecog automatic pre-deploy snapshot for {self.sha}",
                    "--labels", f"app=wecog,reason=predeploy,commit={self.sha[:12]}",
                )))
            except CLIError as error:
                if not error.snapshot_quota:
                    raise
                print("Confirmed snapshot quota exhaustion; trying one older automated copy", flush=True)
                # Strictly decreases the fixed initial inventory, so retries are
                # bounded. The final old READY copy is never a candidate.
                self.delete_oldest(expected, protected)
                continue
            if (not self.managed(created) or created.get("name") != name
                    or created.get("labels", {}).get("commit") != self.sha[:12]
                    or created["id"] in expected or created["status"] != "READY"):
                raise SnapshotError("Create did not return the requested new READY snapshot; release stopped")
            current = validate_snapshot(decode_json(self.command("get", "--id", created["id"])))
            if identity(current) != identity(created) or current["status"] != "READY":
                raise SnapshotError("New snapshot readiness could not be confirmed; release stopped")
            self.unchanged(expected | {created["id"]})
            print(f"Pre-deploy snapshot {created['id']} is READY; retained {len(expected) + 1} automated READY snapshots", flush=True)
            return created["id"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("check", "create"))
    args = parser.parse_args()
    folder, disk = (os.environ.get(name, "") for name in ("YC_FOLDER_ID", "YC_VM_DISK_ID"))
    sha = os.environ.get("GITHUB_SHA", "")
    keep = os.environ.get("YC_AUTOMATED_SNAPSHOTS_TO_KEEP", "")
    if not RESOURCE_ID.fullmatch(folder) or not RESOURCE_ID.fullmatch(disk):
        raise SnapshotError("Explicit folder and disk IDs are required")
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise SnapshotError("A full release commit SHA is required")
    if not re.fullmatch(r"[0-9]+", keep) or not 2 <= int(keep) <= 100:
        raise SnapshotError("Snapshot retention must be an integer between 2 and 100")
    snapshots = Snapshots(folder, disk, int(keep), sha)
    if args.action == "check":
        snapshots.check()
    else:
        snapshots.create()


if __name__ == "__main__":
    try:
        main()
    except SnapshotError as error:
        print(f"predeploy-snapshot: {error}", file=sys.stderr)
        sys.exit(1)
