"""Exercise local setup with disposable files; never touch a developer's services/config."""
import importlib.util
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("local_setup", Path(__file__).with_name("setup.py"))
setup = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(setup)


class LocalSetupTests(unittest.TestCase):
    def test_shell_values_roundtrip_without_executing_secret_content(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "local.env"
            values = {"DB_PASSWORD": "a'quote $HOME $(touch should-never-exist) `id` \\ end", "AUTH_HMAC_KEY": "literal"}
            setup.write(path, setup.env_text(values))
            self.assertEqual(setup.read_env(path), values)
            for shell in ("bash", "zsh"):
                if shutil.which(shell):
                    result = subprocess.run([shell, "-c", '. "$1"; printf "%s" "$DB_PASSWORD"', "test", str(path)], capture_output=True, text=True, cwd=directory, check=True)
                    self.assertEqual(result.stdout, values["DB_PASSWORD"])
            self.assertFalse((Path(directory) / "should-never-exist").exists())
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_parser_rejects_commands_without_executing_them(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "local.env"
            path.write_text("touch unexpected\n")
            with self.assertRaises(setup.SetupError):
                setup.read_env(path)

    def test_java_discovery_ignores_a_runtime_only_and_accepts_full_25(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("runtime", "jdk"):
                (root / name / "bin").mkdir(parents=True)
                (root / name / "lib/security").mkdir(parents=True)
                (root / name / "lib/security/cacerts").touch()
                for tool in ("java", "javac", "keytool"):
                    path = root / name / "bin" / tool
                    path.write_text('#!/bin/sh\nprintf \'javac 25.0.1\\n\'\n')
                    path.chmod(0o755)
            (root / "runtime/bin/javac").unlink()
            with patch.dict(os.environ, {"JAVA_HOME": str(root / "runtime")}), patch.object(setup.glob, "glob", return_value=[str(root / "jdk")]), patch.object(setup.shutil, "which", return_value=None):
                self.assertEqual(setup.find_jdk(), str(root / "jdk"))

    def test_setup_is_idempotent_and_survives_a_different_checkout(self):
        java = setup.find_jdk()
        with tempfile.TemporaryDirectory(prefix="polylink setup ") as directory:
            state = Path(directory) / "private state"
            with patch.dict(os.environ, {"DB_PASSWORD": "test-only-secret", "AUTH_HMAC_KEY": "", "AUTH_REPLAY_KEY": ""}):
                first = setup.setup(state, java, discovery=False)
                files = [state / "local.env", state / "security/tls/server.key", state / "openbao-truststore"]
                before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in files}
                # Re-running must not rotate secrets or reimport the same certificate.
                second = setup.setup(state, java, discovery=False)
                self.assertEqual(first, second)
                self.assertNotEqual(first["AUTH_HMAC_KEY"], first["AUTH_REPLAY_KEY"])
                for path in files:
                    self.assertEqual(before[path], (path.read_bytes(), path.stat().st_mtime_ns))
                    self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                self.assertEqual(stat.S_IMODE(state.stat().st_mode), 0o700)
                # Files used by the backend/infrastructure point outside the checkout.
                for name in ("OPENBAO_TOKEN_FILE", "OPENBAO_CACERT", "POLYLINK_SECURITY_COMPOSE", "POLYLINK_TRUSTSTORE"):
                    self.assertTrue(Path(first[name]).is_relative_to(state))
                # Both supported shells can source paths with spaces, repeatedly, from another cwd.
                for shell in ("bash", "zsh"):
                    if shutil.which(shell):
                        result = subprocess.run([shell, "-c", 'source "$1" && source "$1" && "$JAVA_HOME/bin/java" -version', "test", str(setup.HERE / "env.sh")], env={**os.environ, "POLYLINK_LOCAL_DIR": str(state)}, cwd="/tmp", capture_output=True, text=True)
                        self.assertEqual(result.returncode, 0, result.stderr)
                # A later local certificate is imported without replacing the previous trust roots.
                other = Path(directory) / "other tls"
                setup.private_dir(other)
                setup.ensure_tls(other)
                setup.ensure_truststore(state, java, other / "server.crt")
                self.assertNotEqual(before[state / "openbao-truststore"][0], (state / "openbao-truststore").read_bytes())

    def test_partial_tls_or_invalid_secrets_fail_without_replacing_existing_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            tls = Path(directory)
            (tls / "server.key").write_text("preserve-this")
            with self.assertRaises(setup.SetupError):
                setup.ensure_tls(tls)
            self.assertEqual((tls / "server.key").read_text(), "preserve-this")

    def test_macos_java_home_is_a_supported_discovery_path(self):
        with patch.object(setup.sys, "platform", "darwin"), patch.object(setup.Path, "exists", return_value=True), patch.object(setup.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "/fixture/mac-jdk\n", "")), patch.object(setup, "valid_jdk", side_effect=lambda p: p == "/fixture/mac-jdk"), patch.object(setup.shutil, "which", return_value=None), patch.object(setup.glob, "glob", return_value=[]):
            self.assertEqual(setup.find_jdk(), "/fixture/mac-jdk")


if __name__ == "__main__":
    unittest.main()
