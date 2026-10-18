"""Authorization and existing-state safeguards, without a running OpenBao."""
from pathlib import Path
import tempfile
import unittest

# unittest discovery already adds tools/local to sys.path.
from provision_openbao import Bao, provision
from setup import SetupError, write


class ExistingBao:
    def __init__(self, sealed=False):
        self.calls = []
        self.sealed = sealed

    def request(self, path, body=None, token=None, method=None):
        self.calls.append((path, body))
        if path == "sys/init" and body is None:
            return {"initialized": True}
        if path == "sys/seal-status":
            return {"sealed": self.sealed}
        if path == "auth/token/lookup-self":
            return {"data": {"policies": ["polylink-backend"]}}
        if path == "auth/token/renew-self":
            return {}
        raise AssertionError("Unexpected operator mutation: " + path)


class ProvisionTests(unittest.TestCase):
    def test_existing_narrow_token_is_renewed_without_operator_keys_or_reinitialization(self):
        with tempfile.TemporaryDirectory() as directory:
            token = Path(directory) / "backend.token"
            write(token, "synthetic-narrow-token")
            bao = ExistingBao()
            provision(bao, token, Path(directory) / "operator", "unused")
            self.assertEqual(token.read_text(), "synthetic-narrow-token")
            self.assertFalse(any(body is not None and path.startswith("sys/") for path, body in bao.calls))

    def test_existing_sealed_server_without_shares_stops_without_initialization(self):
        with tempfile.TemporaryDirectory() as directory:
            bao = ExistingBao(sealed=True)
            with self.assertRaisesRegex(SetupError, "never reinitialize"):
                provision(bao, Path(directory) / "token", Path(directory) / "operator", "unused")
            self.assertFalse(any(body is not None for _, body in bao.calls))

    def test_remote_or_redirectable_operator_endpoints_are_rejected_before_network_access(self):
        for address in ("http://localhost:8200", "https://example.invalid", "https://root@localhost:8200", "https://localhost:8200/prefix", "https://localhost:8200?redirect=1"):
            with self.assertRaises(SetupError):
                Bao(address, "/unused-certificate")


if __name__ == "__main__":
    unittest.main()
