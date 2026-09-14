'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TOKEN_RE, createMessage, safeData } = require('../src/firebase-messaging');

test('FCM: payload usa canal Android, prioridade alta e dados somente texto', () => {
  const message = createMessage('abc_DEF:01234567890123456789', {
    title: 'Cam-01', body: 'Movimento detectado', channelId: 'alarms', priority: 'high',
    data: { alarmId: 'a1', nested: { camera: 'c1' }, 'bad key': 'não entra' },
  });
  assert.equal(message.android.priority, 'HIGH');
  assert.equal(message.android.notification.channel_id, 'alarms');
  assert.equal(message.android.notification.visibility, 'PRIVATE');
  assert.equal(message.data.alarmId, 'a1');
  assert.equal(message.data.nested, '{"camera":"c1"}');
  assert.equal(message.data['bad key'], undefined);
});

test('FCM: aceita somente tokens plausíveis e não transforma dados nulos em string', () => {
  assert.equal(TOKEN_RE.test('abc_DEF:01234567890123456789'), true);
  assert.equal(TOKEN_RE.test('curto'), false);
  assert.deepEqual(safeData({ empty: null, valid: 42 }), { valid: '42' });
});

test('FCM: recusa notificação sem conteúdo legível', () => {
  assert.throws(() => createMessage('abc_DEF:01234567890123456789', { title: '', body: 'x' }), /título/i);
});
