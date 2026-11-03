"""Disposable pinned SeaweedFS topology, using the same templates as developer setup."""
import os
import pathlib
import socket
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from contextlib import contextmanager


@contextmanager
def fixture(root, directory, env, java_home):
    sys.path.insert(0, str(root / 'tools/local'))
    import setup
    values = {}
    setup.prepare_storage(directory, values, str(java_home))
    storage = directory / 'storage'
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    with (storage / '.env').open('a') as out:
        out.write(f'S3_HOST_PORT={port}\n')
    values['S3_ENDPOINT'] = f'https://localhost:{port}'
    env.update(values, OBJECT_STORAGE_ENABLED='true')
    # The runner has a separate Bao truststore; import storage's certificate into that store too.
    trust = directory / 'trust.jks'
    subprocess.run([str(java_home / 'bin/keytool'), '-importcert', '-noprompt', '-alias', 'seaweed-test', '-file', str(storage / 'tls/server.crt'), '-keystore', str(trust), '-storepass', 'changeit'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    compose = ['docker', 'compose', '-p', 'polylink-s3-' + uuid.uuid4().hex, '-f', str(storage / 'compose.yaml')]
    try:
        subprocess.run(compose + ['up', '-d'], check=True, stdout=subprocess.DEVNULL)
        ctx = ssl.create_default_context(cafile=str(storage / 'tls/server.crt'))
        for attempt in range(180):
            try:
                urllib.request.urlopen(env['S3_ENDPOINT'] + '/polylink', context=ctx, timeout=2)
                raise AssertionError('Anonymous S3 unexpectedly allowed')
            except urllib.error.HTTPError as error:
                if error.code == 403:
                    break
                raise
            except (OSError, urllib.error.URLError):
                if attempt == 179:
                    raise TimeoutError('Private SeaweedFS did not become ready')
                time.sleep(.25)
        yield compose
    finally:
        subprocess.run(compose + ['down'], check=True, stdout=subprocess.DEVNULL)
