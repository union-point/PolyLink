#!/usr/bin/env python3
"""Idempotent local configuration; never starts services or migrates a database."""
from __future__ import annotations

import argparse
import base64
import glob
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
KEY = re.compile(r"[A-Z][A-Z0-9_]*\Z")


class SetupError(Exception):
    pass


def run(args, **kwargs):
    result = subprocess.run([str(a) for a in args], capture_output=True, **kwargs)
    if result.returncode:
        # Tool output can contain secrets or configuration; report only the capability.
        raise SetupError(f"{Path(str(args[0])).name} failed. Check its input paths and permissions.")
    return result.stdout


def private_dir(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink():
        raise SetupError("The local state directory must not be a symlink.")
    path.chmod(0o700)


def write(path, contents, mode=0o600):
    """Atomically replace only changed content; keep partial writes out of service files."""
    contents = contents.encode() if isinstance(contents, str) else contents
    if path.is_symlink():
        raise SetupError("Refusing to replace a symlink in local state.")
    if path.exists() and path.read_bytes() == contents:
        path.chmod(mode)
        return
    fd, name = tempfile.mkstemp(prefix=".polylink-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as output:
            os.fchmod(output.fileno(), mode)
            output.write(contents)
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def read_env(path):
    """Read literal shell assignments, without evaluating expansions or running commands."""
    values = {}
    if not path.exists():
        return values
    for number, line in enumerate(path.read_text().splitlines(), 1):
        parts = shlex.split(line, comments=True)
        if not parts:
            continue
        if parts[0] == "export":
            parts.pop(0)
        if len(parts) != 1 or "=" not in parts[0]:
            raise SetupError(f"Use literal export NAME='value' assignments in local.env (line {number}).")
        name, value = parts[0].split("=", 1)
        if not KEY.fullmatch(name):
            raise SetupError(f"Invalid configuration name on local.env line {number}.")
        values[name] = value
    return values


def env_text(values):
    if any(not KEY.fullmatch(key) or any(c in str(value) for c in ("\n", "\r", "\0")) for key, value in values.items()):
        raise SetupError("Configuration names must be uppercase identifiers and values must be single-line literals.")
    return "# Managed by tools/local/setup.sh. Edit literal values; never commit this file.\n" + "".join(
        f"export {key}={shlex.quote(str(value))}\n" for key, value in values.items()
    )


def valid_jdk(path):
    if not path:
        return False
    path = Path(path)
    if not (path / "bin/keytool").is_file() or not (path / "lib/security/cacerts").is_file():
        return False
    try:
        for executable in ("java", "javac"):
            result = subprocess.run([str(path / "bin" / executable), "-version"], capture_output=True, timeout=10)
            if result.returncode or not re.search(rb'\b(?:version\s+\")?25(?:[.\s\"+]|$)', result.stdout + result.stderr):
                return False
        return True
    except (OSError, subprocess.TimeoutExpired):
        return False


def find_jdk(preferred=None):
    candidates = [preferred, os.environ.get("JAVA_HOME")]
    if sys.platform == "darwin" and Path("/usr/libexec/java_home").exists():
        result = subprocess.run(["/usr/libexec/java_home", "-v", "25"], capture_output=True, text=True)
        if result.returncode == 0:
            candidates.append(result.stdout.strip())
    javac = shutil.which("javac")
    if javac:
        candidates.append(str(Path(javac).resolve().parent.parent))
    for pattern in (
        "/usr/lib/jvm/*", "/opt/java/*", "/Library/Java/JavaVirtualMachines/*/Contents/Home",
        "/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home",
        "/usr/local/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home",
        "~/.cache/polylink/jdk/*", "~/.sdkman/candidates/java/*", "~/.jdks/*",
    ):
        candidates.extend(sorted(glob.glob(os.path.expanduser(pattern)), reverse=True))
    for candidate in dict.fromkeys(candidates):
        if valid_jdk(candidate):
            return str(Path(candidate).resolve())
    raise SetupError("Install a full JDK 25 (java, javac, keytool), or set JAVA_HOME to one, then rerun setup.")


def discover():
    """Inspect only paths and local settings; never read initialization/root credentials."""
    if not shutil.which("docker"):
        return None
    result = subprocess.run(["docker", "inspect", "polylink-security-openbao-1"], capture_output=True, text=True)
    if result.returncode:
        return None
    record = json.loads(result.stdout)[0]
    mounts = {m["Destination"]: Path(m["Source"]) for m in record.get("Mounts", [])}
    working = record.get("Config", {}).get("Labels", {}).get("com.docker.compose.project.working_dir")
    return {"tls": mounts.get("/openbao/tls"), "checkout": Path(working).parent.parent if working else None}


def import_database(values, checkout):
    path = checkout / "backend/config/application-local.properties"
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        if line.startswith("DB_") and "=" in line:
            name, value = line.split("=", 1)
            if name in values:
                values[name] = value.strip()


def copy_existing_tls(tls, discovered):
    for name in ("server.crt", "server.key"):
        target = tls / name
        if target.exists():
            continue
        source = discovered.get("tls")
        if source and (source / name).is_file() and os.access(source / name, os.R_OK):
            write(target, (source / name).read_bytes())
        else:
            # Docker can read its mounted private key even if its owner is container UID 100.
            with tempfile.TemporaryDirectory(prefix=".copy-", dir=tls) as directory:
                copied = Path(directory) / name
                result = subprocess.run(["docker", "cp", f"polylink-security-openbao-1:/openbao/tls/{name}", str(copied)], capture_output=True)
                if result.returncode:
                    raise SetupError("Cannot reuse the existing OpenBao TLS files. Supply OPENBAO_CACERT and its matching local server key before moving infrastructure.")
                write(target, copied.read_bytes())


def ensure_tls(tls):
    cert, key = tls / "server.crt", tls / "server.key"
    if cert.exists() != key.exists():
        raise SetupError("Only one OpenBao TLS file exists. Restore the matching certificate/key pair; setup will not overwrite it.")
    if not cert.exists():
        # A config file works with both macOS LibreSSL and Linux OpenSSL, without -addext.
        with tempfile.TemporaryDirectory(prefix=".certificate-", dir=tls) as directory:
            temp = Path(directory)
            config = temp / "openssl.cnf"
            config.write_text("[req]\ndistinguished_name=dn\nx509_extensions=extensions\nprompt=no\n[dn]\nCN=localhost\n[extensions]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\n")
            run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "365", "-config", config, "-keyout", temp / "server.key", "-out", temp / "server.crt"])
            write(key, (temp / "server.key").read_bytes())
            write(cert, (temp / "server.crt").read_bytes())
    # Never adopt a mismatched pair.
    cert_public = run(["openssl", "x509", "-in", cert, "-pubkey", "-noout"])
    key_public = run(["openssl", "pkey", "-in", key, "-pubout"])
    if cert_public != key_public:
        raise SetupError("OpenBao TLS certificate and private key do not match.")


def ensure_truststore(state, java, certificate):
    trust = state / "openbao-truststore"
    if trust.is_symlink():
        raise SetupError("The local truststore must not be a symlink.")
    if not trust.exists():
        write(trust, (Path(java) / "lib/security/cacerts").read_bytes())
    der = run(["openssl", "x509", "-in", certificate, "-outform", "DER"])
    alias = "polylink-local-openbao-" + hashlib.sha256(der).hexdigest()[:24]
    arguments = [str(Path(java) / "bin/keytool"), "-keystore", str(trust), "-storepass", "changeit"]
    present = subprocess.run(arguments + ["-list", "-alias", alias], capture_output=True)
    if present.returncode:
        # Work on a copy so a failed import cannot corrupt the active store.
        with tempfile.TemporaryDirectory(prefix=".trust-", dir=state) as directory:
            candidate = Path(directory) / "truststore"
            shutil.copyfile(trust, candidate)
            run([str(Path(java) / "bin/keytool"), "-importcert", "-noprompt", "-alias", alias, "-file", certificate, "-keystore", candidate, "-storepass", "changeit"])
            write(trust, candidate.read_bytes())
    trust.chmod(0o600)
    return trust


def setup(state, java=None, discovery=True):
    state = state.expanduser().absolute()
    if state.is_symlink():
        raise SetupError("The local state directory must not be a symlink.")
    state = state.resolve()
    # Private material must not become a new worktree attachment by accident.
    try:
        state.relative_to(ROOT)
        raise SetupError("Choose POLYLINK_LOCAL_DIR outside this Git checkout.")
    except ValueError:
        pass
    existing = read_env(state / "local.env")
    java = find_jdk(java or existing.get("JAVA_HOME"))
    if not shutil.which("openssl"):
        raise SetupError("Install OpenSSL (or macOS LibreSSL) before local setup.")
    private_dir(state)
    values = json.loads((HERE / "config.example.json").read_text())
    found = discover() if discovery else None
    if not existing:
        import_database(values, found["checkout"] if found and found["checkout"] else ROOT)
        for name in values:
            if os.environ.get(name):
                values[name] = os.environ[name]
    values.update(existing)
    for name in ("AUTH_HMAC_KEY", "AUTH_REPLAY_KEY"):
        if not values.get(name):
            values[name] = secrets.token_urlsafe(32)
        try:
            decoded = base64.urlsafe_b64decode(values[name] + "=")
        except (ValueError, TypeError):
            raise SetupError(f"{name} must contain a canonical 32-byte base64url secret.") from None
        if len(decoded) != 32 or base64.urlsafe_b64encode(decoded).decode().rstrip("=") != values[name]:
            raise SetupError(f"{name} must contain a canonical 32-byte base64url secret.")
    if values["AUTH_HMAC_KEY"] == values["AUTH_REPLAY_KEY"]:
        raise SetupError("AUTH_HMAC_KEY and AUTH_REPLAY_KEY must be independent.")
    security, tls = state / "security", state / "security/tls"
    private_dir(security)
    private_dir(tls)
    if found and not (tls / "server.crt").exists() and not (tls / "server.key").exists():
        copy_existing_tls(tls, found)
    ensure_tls(tls)
    token = state / "openbao.token"
    if token.is_symlink():
        raise SetupError("The backend token file must not be a symlink.")
    if not token.exists():
        candidates = [values.get("OPENBAO_TOKEN_FILE")]
        if found and found["checkout"]:
            candidates.append(str(found["checkout"] / "backend/secrets/openbao.token"))
        for source in candidates:
            if source and Path(source).is_file():
                write(token, Path(source).read_bytes())
                break
    if token.exists():
        token.chmod(0o600)
    for source, target in ((HERE / "compose.yaml", security / "compose.yaml"), (ROOT / "infra/openbao/openbao.hcl", security / "openbao.hcl"), (ROOT / "infra/openbao/backend-policy.hcl", security / "backend-policy.hcl")):
        write(target, source.read_bytes(), 0o644)
    trust = ensure_truststore(state, java, tls / "server.crt")
    values.update({"JAVA_HOME": java, "POLYLINK_LOCAL_DIR": str(state), "POLYLINK_SECURITY_COMPOSE": str(security / "compose.yaml"), "OPENBAO_CACERT": str(tls / "server.crt"), "OPENBAO_TOKEN_FILE": str(token), "POLYLINK_TRUSTSTORE": str(trust)})
    write(state / "local.env", env_text(values))
    return values


def java_options():
    options = shlex.split(os.environ.get("JAVA_TOOL_OPTIONS", ""))
    options = [o for o in options if not o.startswith(("-Djavax.net.ssl.trustStore=", "-Djavax.net.ssl.trustStorePassword="))]
    options += ["-Djavax.net.ssl.trustStore=" + os.environ["POLYLINK_TRUSTSTORE"], "-Djavax.net.ssl.trustStorePassword=changeit"]
    return shlex.join(options)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config-dir", type=Path, default=Path(os.environ.get("POLYLINK_LOCAL_DIR", "~/.config/polylink")).expanduser())
    parser.add_argument("--no-discovery", action="store_true", help="Do not inspect/reuse the existing Docker OpenBao service")
    parser.add_argument("--java-home", action="store_true", help="Print a verified JDK 25 path without modifying configuration")
    parser.add_argument("--java-options", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        if args.java_home:
            print(find_jdk())
        elif args.java_options:
            print(java_options())
        else:
            values = setup(args.config_dir, discovery=not args.no_discovery)
            print(f"Local configuration ready: {args.config_dir.expanduser().absolute() / 'local.env'}")
            print("Existing secrets, TLS keys and database data were preserved. No service was started.")
            if not values["DB_PASSWORD"]:
                print("Next: edit DB_PASSWORD in local.env to match your existing SQL Server.")
            if not Path(values["OPENBAO_TOKEN_FILE"]).exists():
                print("Next: start local OpenBao and run tools/local/provision-openbao.sh.")
            print("Load this terminal with: source tools/local/env.sh")
    except (SetupError, OSError, ValueError, KeyError) as error:
        # Values and subprocess output never appear here.
        print(f"Local setup failed: {error if isinstance(error, SetupError) else type(error).__name__}. No existing service was reinitialized.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
