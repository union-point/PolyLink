#!/usr/bin/env python3
"""Explicit opt-in smoke test for fresh local provisioning in disposable Docker volumes."""
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import uuid

from setup import setup, write, env_text
from provision_openbao import Bao, provision, usable_token


def port():
    with socket.socket() as connection:
        connection.bind(("127.0.0.1", 0))
        return connection.getsockname()[1]


def main():
    name = "polylink_setup_" + uuid.uuid4().hex
    with tempfile.TemporaryDirectory(prefix="polylink-infrastructure-") as directory:
        state = Path(directory) / "app"
        values = setup(state, discovery=False)
        address, smtp, mail = port(), port(), port()
        compose = state / "security/compose.yaml"
        compose.write_text(compose.read_text().replace("18200:8200", f"{address}:8200").replace("1025:1025", f"{smtp}:1025").replace("8025:8025", f"{mail}:8025"))
        command = ["docker", "compose", "-p", name, "-f", str(compose)]
        values["OPENBAO_URL"] = f"https://localhost:{address}"
        write(state / "local.env", env_text(values))
        token, operator = Path(values["OPENBAO_TOKEN_FILE"]), Path(directory) / "operator"
        try:
            subprocess.run(command + ["up", "-d", "openbao", "mailpit"], check=True, stdout=subprocess.DEVNULL)
            bao = Bao(values["OPENBAO_URL"], values["OPENBAO_CACERT"])
            for attempt in range(60):
                try:
                    bao.request("sys/init")
                    break
                except (urllib.error.URLError, OSError):
                    if attempt == 59:
                        raise RuntimeError("Disposable OpenBao did not start")
                    time.sleep(0.25)
            policy = (state / "security/backend-policy.hcl").read_text()
            provision(bao, token, operator, policy)
            first = token.read_bytes()
            assert usable_token(bao, token)
            provision(bao, token, operator, policy)
            assert first == token.read_bytes(), "An idempotent provision rotated the service token"
            root = json.loads((operator / "openbao-init.json").read_text())["root_token"]
            bao.request("sys/seal", {}, root)
            provision(bao, token, operator, policy)
            assert first == token.read_bytes(), "Unseal should preserve the valid service token"
            # Expiry/revocation needs a new narrow token, preserving the same Transit key.
            previous_key = bao.request("transit/keys/polylink-vault", token=root)["data"]
            bao.request("auth/token/revoke", {"token": first.decode().strip()}, root)
            provision(bao, token, operator, policy)
            assert first != token.read_bytes()
            current_key = bao.request("transit/keys/polylink-vault", token=root)["data"]
            assert previous_key["keys"] == current_key["keys"]
            # Root tokens must never be accepted as existing application tokens.
            write(token, root)
            assert not usable_token(bao, token)
            provision(bao, token, operator, policy)
            assert usable_token(bao, token)
            print("Disposable local infrastructure passed: TLS permissions, init, idempotency, unseal, token replacement and preserved Transit keys.")
        finally:
            subprocess.run(command + ["down", "-v"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)


if __name__ == "__main__":
    main()
