#!/usr/bin/env python3
"""Exercise the real disposable Mailpit fixture with an unreachable DNS resolver.

Run explicitly: python3 tools/m1/mailpit_smoke.py
Only the uniquely named temporary container is touched. No database is needed.
"""
from concurrent.futures import ThreadPoolExecutor
from email.message import EmailMessage
import json
import smtplib
import subprocess
import time
import urllib.request
import uuid

from verify import free_port, start_mailpit


def main():
    name = 'polylink-mail-smoke-' + uuid.uuid4().hex
    smtp_port, api_port = free_port(), free_port()
    count = 80
    started = time.monotonic()
    try:
        # TEST-NET-1 deliberately cannot resolve reverse DNS. Removing the
        # fixture's MP_SMTP_DISABLE_RDNS causes SMTP greeting/readiness timeouts.
        start_mailpit(name, smtp_port, api_port, dns='192.0.2.1')

        def send(index):
            message = EmailMessage()
            message['From'] = 'fixture@example.invalid'
            message['To'] = f'recipient-{index}@example.invalid'
            message['Subject'] = 'Synthetic verification'
            message.set_content('Synthetic verification code 123456')
            with smtplib.SMTP('127.0.0.1', smtp_port, timeout=5) as smtp:
                assert smtp.send_message(message) == {}

        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(send, range(count)))
        with urllib.request.urlopen(f'http://127.0.0.1:{api_port}/api/v1/messages?limit=100', timeout=2) as response:
            captured = json.load(response)
        assert captured['total'] == count, captured['total']
        assert len({item['To'][0]['Address'] for item in captured['messages']}) == count
        print(f'Mailpit DNS-outage regression passed: {count} SMTP messages captured in {time.monotonic()-started:.2f}s; client timeout remains 5s.')
    finally:
        subprocess.run(['docker','rm','-f',name],check=True,stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
