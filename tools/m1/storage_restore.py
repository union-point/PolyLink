"""Cold SQL/SeaweedFS/OpenBao restore rehearsal after disposable HTTP tests exit."""
import json
import os
import pathlib
import shutil
import subprocess


def rehearse(root, temp, env, java, cp, admin_sql, name, bao, request, admin, compose):
    command = [str(java), '--class-path', str(root / 'backend/target/classes') + os.pathsep + cp]
    def maintenance(main, operation, child=env, output=None):
        return subprocess.run(command + [main, operation], env=child, check=True, stdout=output)
    ledger = temp / 'deletions.json'
    with ledger.open('w') as output:
        maintenance('am.polylink.chat.MessengerMaintenanceCommand', 'export-deletions', output=output)
    ledger.chmod(0o600)
    # No backend process remains; no application writer or scheduled cleanup is running.
    maintenance('am.polylink.storage.StorageCommand', 'abandon-uploads')
    maintenance('am.polylink.storage.StorageCommand', 'verify', output=subprocess.DEVNULL)
    backup = f'/var/opt/mssql/data/{name}.bak'
    restored = name + '_restore'
    admin_sql(f"BACKUP DATABASE [{name}] TO DISK=N'{backup}' WITH COPY_ONLY,CHECKSUM,INIT; RESTORE VERIFYONLY FROM DISK=N'{backup}' WITH CHECKSUM")
    operator = env.copy()
    operator.update(BAO_TOKEN=admin['root_token'])
    bao_cli = ['docker', 'exec', '-e', 'BAO_TOKEN', '-e', 'BAO_ADDR=https://127.0.0.1:8200', '-e', 'BAO_CACERT=/fixture/server.crt', bao, 'bao', 'operator', 'raft', 'snapshot']
    subprocess.run(bao_cli + ['save', '/fixture/storage-restore.snap'], env=operator, check=True, stdout=subprocess.DEVNULL)
    subprocess.run(compose + ['stop'], check=True, stdout=subprocess.DEVNULL)
    storage = temp / 'storage'
    shutil.copytree(storage / 'data', temp / 'cold-data')
    subprocess.run(compose + ['down'], check=True, stdout=subprocess.DEVNULL)
    shutil.rmtree(storage / 'data')
    shutil.copytree(temp / 'cold-data', storage / 'data')
    subprocess.run(compose + ['up', '-d'], check=True, stdout=subprocess.DEVNULL)
    try:
        admin_sql(f"RESTORE DATABASE [{restored}] FROM DISK=N'{backup}' WITH MOVE N'{name}' TO N'/var/opt/mssql/data/{restored}.mdf', MOVE N'{name}_log' TO N'/var/opt/mssql/data/{restored}_log.ldf', CHECKSUM")
        subprocess.run(bao_cli + ['restore', '/fixture/storage-restore.snap'], env=operator, check=True, stdout=subprocess.DEVNULL)
        import time
        for attempt in range(60):
            try:
                state = request('sys/seal-status')
                if state['sealed']:
                    request('sys/unseal', {'key': admin['keys_base64'][0]})
                from verify import wait_for_active
                wait_for_active(request)
                break
            except Exception:
                if attempt == 59:
                    raise
                time.sleep(.25)
        child = env.copy()
        child.update(DB_NAME=restored, BACKUP_SET=name, DELETION_LEDGER_FILE=str(ledger))
        # Replay through the existing operator command; args stay structured and contain no credentials.
        subprocess.run(command + ['am.polylink.chat.MessengerMaintenanceCommand', 'replay-deletions', str(ledger)], env=child, check=True)
        # Retry readiness only; verification itself must not hide corruption.
        import ssl, urllib.request, urllib.error
        ctx=ssl.create_default_context(cafile=str(storage/'tls/server.crt'))
        for attempt in range(180):
            try:
                urllib.request.urlopen(env['S3_ENDPOINT']+'/polylink',context=ctx,timeout=2)
                raise AssertionError('Anonymous S3 unexpectedly allowed after restore')
            except urllib.error.HTTPError as error:
                if error.code==403:break
                raise
            except (OSError,urllib.error.URLError):
                if attempt==179:raise
                time.sleep(.25)
        report = temp / 'restore-report.json'
        with report.open('w') as output:
            maintenance('am.polylink.storage.StorageCommand', 'restore-report', child, output)
        report.chmod(0o600)
        result = json.loads(report.read_text())
        if not result['verified'] or not result['transitVerified'] or not result['deletionLedgerReplayed']:
            raise AssertionError('Coordinated restore failed')
        # Binary retirement runs only on this verified disposable restore.
        child['STORAGE_RESTORE_REPORT'] = str(report)
        maintenance('am.polylink.storage.StorageCommand', 'retire-sql-bodies', child)
        maintenance('am.polylink.storage.StorageCommand', 'restore-report', child, subprocess.DEVNULL)
        print('Coordinated SQL/SeaweedFS/OpenBao cold restore, Transit verification, deletion replay and binary retirement passed.')
    finally:
        admin_sql(f'IF DB_ID(N\'{restored}\') IS NOT NULL BEGIN ALTER DATABASE [{restored}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{restored}]; END')
