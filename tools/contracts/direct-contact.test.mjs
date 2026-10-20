import test from 'node:test';
import assert from 'node:assert/strict';
import { openDirectWithUnblock } from '../../js/chat/direct-contact.js';
const denied = code => Object.assign(new Error(code), { code });

test('own block requires confirmation before unblocking and reopening', async () => {
  const calls = [];
  const room = { id: 'room' };
  const chat = {
    async openDirect(id) { calls.push(['open', id]); if (calls.length === 1) throw denied('DIRECT_BLOCKED_BY_YOU'); return room; },
    async block(...args) { calls.push(['block', ...args]); },
  };
  assert.equal(await openDirectWithUnblock(chat, 'peer', async message => {
    assert.match(message, /Ապաարգելափակե՞լ/);
    calls.push(['confirm']); return true;
  }), room);
  assert.deepEqual(calls, [['open', 'peer'], ['confirm'], ['block', 'peer', false], ['open', 'peer']]);
});

test('cancel leaves the block intact', async () => {
  let blocked = true;
  const chat = { openDirect: async () => { throw denied('DIRECT_BLOCKED_BY_YOU'); }, block: async () => { blocked = false; } };
  assert.equal(await openDirectWithUnblock(chat, 'peer', async () => false), null);
  assert.equal(blocked, true);
});

test('peer block and unrelated failures do not offer unblocking', async () => {
  for (const code of ['DIRECT_UNAVAILABLE', 'NETWORK']) {
    const error = denied(code);
    await assert.rejects(openDirectWithUnblock({ openDirect: async () => { throw error; } }, 'peer', () => assert.fail('Unexpected confirmation')), e => e === error);
  }
});

test('mutual block remains unavailable after removing own block', async () => {
  let ownBlock = true;
  const chat = {
    openDirect: async () => { throw denied(ownBlock ? 'DIRECT_BLOCKED_BY_YOU' : 'DIRECT_UNAVAILABLE'); },
    block: async () => { ownBlock = false; },
  };
  await assert.rejects(openDirectWithUnblock(chat, 'peer', async () => true), { code: 'DIRECT_UNAVAILABLE' });
});

test('unblocked contact opens without confirmation', async () => {
  const room = { id: 'room' };
  assert.equal(await openDirectWithUnblock({ openDirect: async () => room }, 'peer', () => assert.fail('Unexpected confirmation')), room);
});
