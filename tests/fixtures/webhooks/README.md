<!-- Not ported: the fixtures of the webhook tests. -->

Webhook test certificate
========================

`sns-cert.pem` and `sns-key.pem` stand for the certificate SNS signs its
messages with, so that the tests of `./webhooks` sign and verify SNS messages
without AWS. They were made with

    openssl req -x509 -newkey rsa:2048 -nodes -days 36500 \
      -subj "/CN=sns.amazonaws.com" -keyout sns-key.pem -out sns-cert.pem

The private key is intentionally committed and must never be used outside the
tests.
