const { test } = require('node:test');
const assert = require('node:assert');
const { createMailer } = require('../../index.js');

test('Mailer: createMailer is a placeholder until the mailer is implemented', () => {
  assert.throws(() => createMailer({}), { message: 'createMailer is not implemented yet' });
});
