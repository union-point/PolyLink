#!/usr/bin/env python3
"""Initialize/unseal/configure only a loopback development OpenBao, preserving existing keys."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from setup import ROOT, SetupError, private_dir, read_env, write


class BaoError(Exception):
    def __init__(self, status):
        self.status = status


class Bao:
    def __init__(self, address, certificate):
        parsed = urllib.parse.urlparse(address)
        if parsed.scheme != "https" or parsed.hostname not in ("localhost", "127.0.0.1", "::1") or parsed.username or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
            raise SetupError("Automatic provisioning supports only loopback HTTPS development OpenBao.")
        self.base = address.rstrip("/") + "/v1/"
        self.context = ssl.create_default_context(cafile=str(certificate))
        # No proxy/redirect may receive operator credentials.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(), urllib.request.HTTPSHandler(context=self.context))

    def request(self, path, body=None, token=None, method=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["X-Vault-Token"] = token
        req = urllib.request.Request(self.base + path, data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
        try:
            with self.opener.open(req, timeout=10) as response:
                data = response.read(262145)
                if len(data) > 262144:
                    raise SetupError("OpenBao response exceeds the local provisioning limit.")
                return json.loads(data) if data else {}
        except urllib.error.HTTPError as error:
            raise BaoError(error.code) from None


def usable_token(bao, token):
    if not token.is_file():
        return False
    try:
        result = bao.request("auth/token/lookup-self", token=token.read_text().strip())["data"]
        policies = result.get("policies", [])
        return "polylink-backend" in policies and not (set(policies) - {"polylink-backend", "default"})
    except (BaoError, KeyError):
        return False


def provision(bao, token, operator, policy):
    initialized = bao.request("sys/init")["initialized"]
    bundle = operator / "openbao-init.json"
    if not initialized:
        # An existing operator bundle might belong to another volume. Never replace it.
        if bundle.exists():
            raise SetupError("Uninitialized server but operator state already exists. Verify the intended volume; no keys were replaced.")
        private_dir(operator)
        result = bao.request("sys/init", {"secret_shares": 5, "secret_threshold": 3})
        write(bundle, json.dumps(result))
        print("Created local-only operator state outside the application configuration. Keep it for this development volume.")
    sealed = bao.request("sys/seal-status")["sealed"]
    admin = json.loads(bundle.read_text()) if bundle.exists() else None
    if sealed:
        if not admin:
            raise SetupError("Existing OpenBao is sealed and its operator shares are not available here. Unseal it with three existing shares; never reinitialize it.")
        for key in admin["keys_base64"][:3]:
            result = bao.request("sys/unseal", {"key": key})
            if not result["sealed"]:
                break
        if bao.request("sys/seal-status")["sealed"]:
            raise SetupError("The saved operator shares did not unseal this server. Check its volume and operator state.")
    if usable_token(bao, token):
        # Renew now, so an otherwise usable short-lived token has a full period for startup.
        bao.request("auth/token/renew-self", {"increment": "3600"}, token.read_text().strip())
        print("Existing narrow backend token is valid and renewed; Transit keys were unchanged.")
        return
    if not admin:
        raise SetupError("Existing server needs a narrow backend token. Install an operator-issued token at OPENBAO_TOKEN_FILE, or provide its existing operator directory with --operator-dir.")
    root = admin["root_token"]
    mounts = bao.request("sys/mounts", token=root)
    mounts = mounts.get("data", mounts)
    if "transit/" not in mounts:
        bao.request("sys/mounts/transit", {"type": "transit"}, root)
    # Read first: do not recreate/reconfigure a key already protecting user vaults.
    try:
        info = bao.request("transit/keys/polylink-vault", token=root)["data"]
        if info.get("type") != "aes256-gcm96" or not info.get("derived") or info.get("exportable") or info.get("allow_plaintext_backup") or info.get("convergent_encryption"):
            raise SetupError("The existing Transit key differs from the required protected derived key; manual review is required.")
    except BaoError as error:
        if error.status != 404:
            raise
        bao.request("transit/keys/polylink-vault", {"type": "aes256-gcm96", "derived": True, "exportable": False, "allow_plaintext_backup": False}, root)
    bao.request("sys/policies/acl/polylink-backend", {"policy": policy}, root, method="PUT")
    issued = bao.request("auth/token/create", {"policies": ["polylink-backend"], "no_default_policy": True, "period": "1h"}, root)
    write(token, issued["auth"]["client_token"] + "\n")
    if not usable_token(bao, token):
        raise SetupError("The issued token did not satisfy the narrow backend policy.")
    print("Local OpenBao is ready. The backend receives only its narrow service token.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operator-dir", type=Path, help="Existing local-only operator state; contains openbao-init.json")
    args = parser.parse_args()
    try:
        state = Path(os.environ.get("POLYLINK_LOCAL_DIR", "~/.config/polylink")).expanduser()
        values = read_env(state / "local.env")
        operator = args.operator_dir or state.with_name(state.name + "-operator")
        # Keep root/unseal credentials out of the application state and checkout.
        if operator.resolve().is_relative_to(state.resolve()) or operator.resolve().is_relative_to(ROOT):
            raise SetupError("Choose an operator directory outside the checkout and application configuration directory.")
        bao = Bao(values["OPENBAO_URL"], values["OPENBAO_CACERT"])
        for attempt in range(30):
            try:
                bao.request("sys/init")
                break
            except (urllib.error.URLError, OSError):
                if attempt == 29:
                    raise SetupError("OpenBao is not reachable with its trusted local certificate. Start its Compose service first.")
                time.sleep(0.5)
        policy = (state / "security/backend-policy.hcl").read_text()
        provision(bao, Path(values["OPENBAO_TOKEN_FILE"]), operator, policy)
    except (SetupError, BaoError, OSError, ValueError, KeyError) as error:
        message = str(error) if isinstance(error, SetupError) else "OpenBao provisioning failed; check operator authorization and local file permissions."
        print(message, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
