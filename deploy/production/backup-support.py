#!/usr/bin/env python3
"""Local backup helpers. No credentials, network calls or live restore operations."""
import argparse
import contextlib
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tarfile
import tempfile
import time


MAX_FILES = 100_000
MAX_BYTES = 10 * 1024 ** 3
REASONS = ("daily", "pre-deploy")
DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


@contextlib.contextmanager
def open_relative(root_fd, name):
    """Walk every component without following links, including during a race."""
    fd = os.dup(root_fd)
    try:
        parts = PurePosixPath(name).parts
        for part in parts[:-1]:
            child = os.open(part, DIRECTORY_FLAGS, dir_fd=fd)
            os.close(fd)
            fd = child
        file_fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        with os.fdopen(file_fd, "rb") as source:
            yield source
    finally:
        os.close(fd)


def signature(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def inventory(root_fd):
    result = {}
    size = 0
    def fail(error):
        raise error
    for directory, dirs, files, directory_fd in os.fwalk(
            ".", dir_fd=root_fd, follow_symlinks=False, onerror=fail):
        for name in dirs:
            if not stat.S_ISDIR(os.stat(name, dir_fd=directory_fd, follow_symlinks=False).st_mode):
                raise ValueError("Uploads contain a linked directory")
        for name in files:
            info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise ValueError("Uploads contain a link or special file")
            relative = str(PurePosixPath(directory) / name)
            result[relative] = signature(info)
            size += info.st_size
            if len(result) > MAX_FILES or size > MAX_BYTES:
                raise ValueError("Uploads exceed the reviewed backup limits")
    return result


def create_uploads(source, output):
    root_fd = os.open(source, DIRECTORY_FLAGS)
    try:
        before = inventory(root_fd)
        if not before:
            return 0  # A manifest records this; no empty archive is uploaded.
        # O_EXCL prevents overwriting an earlier backup or following a destination link.
        fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as destination, tarfile.open(fileobj=destination, mode="w:gz") as archive:
            for name, expected in sorted(before.items()):
                with open_relative(root_fd, name) as handle:
                    info = os.fstat(handle.fileno())
                    if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                            or signature(info) != expected):
                        raise ValueError("Uploads changed while being archived; retry")
                    member = tarfile.TarInfo(name)
                    member.size = info.st_size
                    member.mode = 0o600
                    member.mtime = int(info.st_mtime)
                    archive.addfile(member, handle)
                    if signature(os.fstat(handle.fileno())) != expected:
                        raise ValueError("Uploads changed while being archived; retry")
        if inventory(root_fd) != before:
            raise ValueError("Uploads changed while being archived; retry")
        return len(before)
    finally:
        os.close(root_fd)


def checked_members(archive):
    names = set()
    size = 0
    for member in archive:
        parts = member.name.split("/")
        if (not member.isfile() or member.name.startswith("/")
                or any(part in ("", ".", "..") for part in parts)
                or "\\" in member.name or member.name in names):
            raise ValueError("Unsafe archive member")
        names.add(member.name)
        size += member.size
        if len(names) > MAX_FILES or member.size < 0 or size > MAX_BYTES:
            raise ValueError("Archive exceeds the reviewed restore limits")
        yield member


def verify_uploads(archive_path, destination=None):
    # Preflight reads every byte, not just the catalog. Never call extractall().
    count = 0
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in checked_members(archive):
            with archive.extractfile(member) as source:
                while source.read(1024 * 1024):
                    pass
            count += 1
    # Force the gzip footer/CRC to be read as tar readers can stop at end markers.
    with gzip.open(archive_path, "rb") as compressed:
        total = 0
        for chunk in iter(lambda: compressed.read(1024 * 1024), b""):
            total += len(chunk)
            if total > MAX_BYTES + MAX_FILES * 4096 + 10240:
                raise ValueError("Archive exceeds the reviewed restore limits")
    if destination is not None:
        # A restore drill may ONLY create a new directory, never merge into uploads.
        os.mkdir(destination, 0o700)
        with tarfile.open(archive_path, "r:gz") as archive:
            for member in checked_members(archive):
                target = Path(destination).joinpath(*member.name.split("/"))
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(fd, "wb") as output, archive.extractfile(member) as source:
                    while True:
                        chunk = source.read(1024 * 1024)
                        if not chunk:
                            break
                        output.write(chunk)
    return count


def file_description(file_path):
    digest = hashlib.sha256()
    with open(file_path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"file": file_path.name, "sha256": digest.hexdigest(), "bytes": file_path.stat().st_size}


def write_manifest(directory, timestamp, tag, reason, count):
    if not re.fullmatch(r"[0-9]{8}T[0-9]{6}(?:[0-9]{9})?Z", timestamp) or not re.fullmatch(r"[0-9a-f]{40}", tag):
        raise ValueError("Invalid backup identity")
    if reason not in REASONS or not 0 <= count <= MAX_FILES:
        raise ValueError("Invalid backup manifest values")
    prefix = Path(directory) / f"wecog-{timestamp}-{tag[:12]}"
    manifest = {
        "format_version": 1, "release": tag, "reason": reason, "started_at": timestamp,
        "database": file_description(Path(f"{prefix}.dump")),
        "uploads": {"file_count": count, "empty": count == 0, "archive": (
            file_description(Path(f"{prefix}.uploads.tar.gz")) if count else None)},
    }
    with open(f"{prefix}.manifest.json", "x", encoding="utf-8") as output:
        json.dump(manifest, output, indent=2)
        output.write("\n")


def atomic_write(destination, text, mode):
    fd, temporary = tempfile.mkstemp(prefix=".backup-", dir=destination.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            os.fchmod(output.fileno(), mode)
            output.write(text)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def metrics(directory, reason, event, count=0):
    if reason not in REASONS or event not in ("init", "start", "success", "failure"):
        raise ValueError("Invalid backup metric transition")
    if not 0 <= count <= MAX_FILES:
        raise ValueError("Invalid uploads count")
    directory = Path(directory)
    directory.mkdir(mode=0o755, parents=True, exist_ok=True)
    os.chmod(directory, 0o755)
    state_file = directory / f"backup-{reason}.json"
    state = {
        "last_success_timestamp_seconds": 0, "last_attempt_timestamp_seconds": 0,
        "last_run_success": 0, "in_progress": 0, "uploads_files": 0,
    }
    if state_file.exists():
        saved = json.loads(state_file.read_text(encoding="utf-8"))
        if set(saved) != set(state) or any(type(value) is not int or value < 0 for value in saved.values()):
            raise ValueError("Invalid backup metric state")
        state.update(saved)
    now = int(time.time())
    if event == "start":
        state.update(last_attempt_timestamp_seconds=now, in_progress=1)
    elif event == "success":
        state.update(last_success_timestamp_seconds=now, last_run_success=1, in_progress=0, uploads_files=count)
    elif event == "failure":
        state.update(last_run_success=0, in_progress=0)
    atomic_write(state_file, json.dumps(state) + "\n", 0o600)
    # Timestamps are gauge VALUES, not sample timestamps (unsupported by textfile).
    exposition = "".join(
        f'wecog_backup_{key}{{reason="{reason}"}} {value}\n' for key, value in state.items())
    atomic_write(directory / f"backup-{reason}.prom", exposition, 0o644)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("create-uploads")
    create.add_argument("source")
    create.add_argument("output")
    verify = sub.add_parser("verify-uploads")
    verify.add_argument("archive")
    verify.add_argument("--restore-to-new-directory")
    manifest = sub.add_parser("manifest")
    for key in ("directory", "timestamp", "tag", "reason"):
        manifest.add_argument(key)
    manifest.add_argument("count", type=int)
    metric = sub.add_parser("metrics")
    metric.add_argument("directory")
    metric.add_argument("reason", choices=REASONS)
    metric.add_argument("event", choices=("init", "start", "success", "failure"))
    metric.add_argument("count", type=int, nargs="?", default=0)
    args = parser.parse_args()
    os.umask(0o077)
    if args.command == "create-uploads":
        print(create_uploads(args.source, args.output))
    elif args.command == "verify-uploads":
        print(verify_uploads(args.archive, args.restore_to_new_directory))
    elif args.command == "manifest":
        write_manifest(args.directory, args.timestamp, args.tag, args.reason, args.count)
    else:
        metrics(args.directory, args.reason, args.event, args.count)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, tarfile.TarError, EOFError):
        # Never expose archive filenames, payloads or host paths in logs.
        print("Backup helper failed: check permissions, archive integrity, limits or concurrent uploads.", file=sys.stderr)
        sys.exit(1)
