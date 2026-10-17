// Ported from upyo v0.7.0 (packages/mailgun/src/index.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { MailgunTransport } = require('./mailgun-transport.js');

const { MailgunApiError } = require('./http-client.js');

module.exports = { MailgunTransport, MailgunApiError };
