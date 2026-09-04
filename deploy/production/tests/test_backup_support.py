import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tarfile
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("backup_support", Path(__file__).parents[1] / "backup-support.py")
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupSupportTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="wecog-backup-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.uploads = self.root / "uploads"
        self.uploads.mkdir()
        self.archive = self.root / "uploads.tar.gz"

    def test_empty_uploads_do_not_create_archive(self):
        (self.uploads / "empty").mkdir()
        self.assertEqual(backup.create_uploads(self.uploads, self.archive), 0)
        self.assertFalse(self.archive.exists())

    def test_restore_preserves_bytes_and_does_not_overwrite_live_directory(self):
        (self.uploads / "documents").mkdir()
        (self.uploads / "documents" / "résumé.pdf").write_bytes(b"%PDF-test\0\1")
        (self.uploads / "empty-file").touch()
        self.assertEqual(backup.create_uploads(self.uploads, self.archive), 2)
        self.assertEqual(stat.S_IMODE(self.archive.stat().st_mode), 0o600)
        self.assertEqual(backup.verify_uploads(self.archive), 2)
        destination = self.root / "drill"
        self.assertEqual(backup.verify_uploads(self.archive, destination), 2)
        self.assertEqual((destination / "documents" / "résumé.pdf").read_bytes(), b"%PDF-test\0\1")
        with self.assertRaises(FileExistsError):
            backup.verify_uploads(self.archive, self.uploads)

    def test_missing_root_is_not_reported_as_empty(self):
        with self.assertRaises(FileNotFoundError):
            backup.create_uploads(self.root / "missing", self.archive)

    def test_source_links_and_special_files_are_rejected(self):
        outside = self.root / "secret"
        outside.write_text("must not leak")
        link = self.uploads / "link"
        link.symlink_to(outside)
        with self.assertRaises(ValueError):
            backup.create_uploads(self.uploads, self.archive)
        link.unlink()
        link.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            backup.create_uploads(self.uploads, self.archive)
        link.unlink()
        os.link(outside, link)
        with self.assertRaises(ValueError):
            backup.create_uploads(self.uploads, self.archive)
        link.unlink()
        os.mkfifo(link)
        with self.assertRaises(ValueError):
            backup.create_uploads(self.uploads, self.archive)
        linked_root = self.root / "linked-root"
        linked_root.symlink_to(self.uploads, target_is_directory=True)
        with self.assertRaises(OSError):
            backup.create_uploads(linked_root, self.archive)

    def test_source_changed_during_copy_is_rejected(self):
        data = self.uploads / "file"
        data.write_text("before")
        original = tarfile.TarFile.addfile
        def mutate(archive, member, source):
            original(archive, member, source)
            data.write_text("changed contents")
        with patch.object(tarfile.TarFile, "addfile", mutate):
            with self.assertRaises(ValueError):
                backup.create_uploads(self.uploads, self.archive)

    def test_concurrent_new_file_is_rejected(self):
        (self.uploads / "file").write_text("data")
        original = tarfile.TarFile.addfile
        def mutate(archive, member, source):
            original(archive, member, source)
            (self.uploads / "new").write_text("new data")
        with patch.object(tarfile.TarFile, "addfile", mutate):
            with self.assertRaises(ValueError):
                backup.create_uploads(self.uploads, self.archive)

    def test_backup_does_not_overwrite_existing_artifact(self):
        (self.uploads / "file").write_text("data")
        self.archive.write_text("existing backup")
        with self.assertRaises(FileExistsError):
            backup.create_uploads(self.uploads, self.archive)
        self.assertEqual(self.archive.read_text(), "existing backup")

    def test_size_and_count_limits(self):
        (self.uploads / "file").write_text("data")
        with patch.object(backup, "MAX_BYTES", 1):
            with self.assertRaises(ValueError):
                backup.create_uploads(self.uploads, self.archive)
        with patch.object(backup, "MAX_FILES", 0):
            with self.assertRaises(ValueError):
                backup.create_uploads(self.uploads, self.archive)

    def test_malicious_archives_are_rejected_before_destination_creation(self):
        for name, kind in [("../escape", tarfile.REGTYPE), ("/absolute", tarfile.REGTYPE),
                           ("link", tarfile.SYMTYPE), ("link", tarfile.LNKTYPE),
                           ("fifo", tarfile.FIFOTYPE), ("a/./b", tarfile.REGTYPE)]:
            with self.subTest(name=name, kind=kind):
                with tarfile.open(self.archive, "w:gz") as archive:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    archive.addfile(member, io.BytesIO(b""))
                destination = self.root / "unsafe-drill"
                with self.assertRaises(ValueError):
                    backup.verify_uploads(self.archive, destination)
                self.assertFalse(destination.exists())

    def test_corrupt_gzip_footer_is_rejected(self):
        (self.uploads / "file").write_text("data")
        backup.create_uploads(self.uploads, self.archive)
        data = bytearray(self.archive.read_bytes())
        data[-8] ^= 255
        self.archive.write_bytes(data)
        with self.assertRaises((OSError, tarfile.TarError)):
            backup.verify_uploads(self.archive)

    def test_manifest_records_hashes_and_empty_uploads(self):
        tag, timestamp = "a" * 40, "20260904T120000Z"
        prefix = self.root / f"wecog-{timestamp}-{tag[:12]}"
        Path(f"{prefix}.dump").write_bytes(b"database")
        backup.write_manifest(self.root, timestamp, tag, "daily", 0)
        manifest = json.loads(Path(f"{prefix}.manifest.json").read_text())
        self.assertEqual(manifest["uploads"], {"archive": None, "empty": True, "file_count": 0})
        self.assertEqual(len(manifest["database"]["sha256"]), 64)
        self.assertEqual(manifest["database"]["bytes"], 8)

    def test_failure_preserves_success_time_and_reasons_are_independent(self):
        metrics = self.root / "metrics"
        with patch.object(backup.time, "time", return_value=100):
            backup.metrics(metrics, "daily", "init")
            backup.metrics(metrics, "daily", "start")
            backup.metrics(metrics, "daily", "success", 3)
        with patch.object(backup.time, "time", return_value=200):
            backup.metrics(metrics, "daily", "start")
            running = json.loads((metrics / "backup-daily.json").read_text())
            self.assertEqual(running["last_run_success"], 1)
            self.assertEqual(running["in_progress"], 1)
            backup.metrics(metrics, "daily", "failure")
            backup.metrics(metrics, "pre-deploy", "success")
            backup.metrics(metrics, "daily", "init")
        state = json.loads((metrics / "backup-daily.json").read_text())
        self.assertEqual(state["last_success_timestamp_seconds"], 100)
        self.assertEqual(state["last_attempt_timestamp_seconds"], 200)
        self.assertEqual(state["last_run_success"], 0)
        self.assertEqual(state["in_progress"], 0)
        self.assertEqual(state["uploads_files"], 3)
        self.assertEqual(stat.S_IMODE((metrics / "backup-daily.prom").stat().st_mode), 0o644)
        self.assertEqual(stat.S_IMODE((metrics / "backup-daily.json").stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(metrics.stat().st_mode), 0o755)
        for line in (metrics / "backup-daily.prom").read_text().splitlines():
            self.assertEqual(len(line.split()), 2)  # No Prometheus sample timestamps.
        self.assertFalse(list(metrics.glob(".backup-*")))


if __name__ == "__main__":
    unittest.main()
