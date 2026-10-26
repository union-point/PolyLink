"""Regression coverage for the disposable OpenBao fixture's leader election."""
import unittest
import urllib.error
from unittest.mock import Mock, patch

from verify import wait_for_active, start_mailpit, wait_for_mailpit
import smtplib


class OpenBaoReadinessTests(unittest.TestCase):
    def test_waits_for_leader_after_unseal(self):
        request = Mock(side_effect=[
            urllib.error.HTTPError('https://localhost/v1/sys/health', 503, 'sealed', {}, None),
            urllib.error.HTTPError('https://localhost/v1/sys/health', 429, 'standby', {}, None),
            {'initialized': True, 'sealed': False, 'standby': True},
            {'initialized': True, 'sealed': False, 'standby': False},
        ])
        with patch('verify.time.sleep'):
            wait_for_active(request)
        self.assertEqual(request.call_count, 4)
        request.assert_called_with('sys/health')

    def test_never_proceeds_when_election_times_out(self):
        request = Mock(return_value={'initialized': True, 'sealed': False, 'standby': True})
        with patch('verify.time.sleep'), self.assertRaisesRegex(TimeoutError, 'become active'):
            wait_for_active(request)
        self.assertEqual(request.call_count, 100)

    def test_does_not_hide_unexpected_http_errors(self):
        request = Mock(side_effect=urllib.error.HTTPError('https://localhost', 403, 'forbidden', {}, None))
        with self.assertRaises(urllib.error.HTTPError):
            wait_for_active(request)
        self.assertEqual(request.call_count, 1)


class MailpitReadinessTests(unittest.TestCase):
    def test_fixture_disables_reverse_dns_and_checks_both_ports(self):
        with patch('verify.run') as run, patch('verify.wait_for_mailpit') as wait:
            start_mailpit('fixture', 21025, 28025)
        command = run.call_args.args[0]
        self.assertIn('MP_SMTP_DISABLE_RDNS=true', command)
        self.assertIn('127.0.0.1:21025:1025', command)
        self.assertIn('127.0.0.1:28025:8025', command)
        wait.assert_called_once_with('http://127.0.0.1:28025', 21025)

    def test_waits_for_api_and_smtp_greeting(self):
        with patch('verify.urllib.request.urlopen') as urlopen, patch('verify.smtplib.SMTP') as smtp, patch('verify.time.sleep'):
            urlopen.return_value.__enter__.return_value.status = 200
            # The successful SMTP context acknowledges NOOP.
            connection = Mock()
            connection.__enter__ = Mock(return_value=connection)
            connection.__exit__ = Mock(return_value=False)
            connection.noop.return_value = (250, b'OK')
            smtp.side_effect = [smtplib.SMTPServerDisconnected('greeting delayed'), connection]
            wait_for_mailpit('http://localhost', 1025)
            self.assertEqual(smtp.call_count, 2)
            connection.noop.assert_called_once()
            urlopen.assert_called_with('http://localhost/readyz', timeout=1)

    def test_storage_failure_is_bounded(self):
        error = urllib.error.HTTPError('http://localhost/readyz',503,'not ready',{},None)
        with patch('verify.urllib.request.urlopen', side_effect=error), patch('verify.smtplib.SMTP') as smtp, patch('verify.time.monotonic', side_effect=[0, 0, 11]), patch('verify.time.sleep'):
            with self.assertRaisesRegex(TimeoutError, 'Mailpit API/SMTP'):
                wait_for_mailpit('http://localhost',1025)
            smtp.assert_not_called()

    def test_unexpected_http_failure_is_not_retried(self):
        error = urllib.error.HTTPError('http://localhost/readyz',403,'forbidden',{},None)
        with patch('verify.urllib.request.urlopen', side_effect=error), patch('verify.smtplib.SMTP') as smtp:
            with self.assertRaises(urllib.error.HTTPError):
                wait_for_mailpit('http://localhost',1025)
            smtp.assert_not_called()

if __name__ == '__main__':
    unittest.main()
