"""Regression coverage for the disposable OpenBao fixture's leader election."""
import unittest
import urllib.error
from unittest.mock import Mock, patch

from verify import wait_for_active


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


if __name__ == '__main__':
    unittest.main()
