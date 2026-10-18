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

Scaleway test certificates
==========================

`scaleway-ca.pem` stands for Scaleway's SNS trust chain, and
`scaleway-cert.pem` with `scaleway-key.pem` for a certificate it issued.
`scaleway-expired-ca.pem` is a CA valid only in 2020, and
`scaleway-cert-of-expired-ca.pem` a certificate it issued for the same key,
valid until 2120, so that a test can tell a CA no longer valid from its leaf.
They were made with OpenSSL 3.6:

    openssl req -x509 -newkey rsa:2048 -nodes -keyout ca-key.pem \
      -out scaleway-expired-ca.pem -subj "/CN=Expired Test Scaleway CA" \
      -not_before 20200101000000Z -not_after 20210101000000Z \
      -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign"
    openssl req -new -key scaleway-key.pem -subj "/CN=sns.mnq.fr-par.scaleway.com" -out leaf.csr
    openssl x509 -req -in leaf.csr -CA scaleway-expired-ca.pem -CAkey ca-key.pem \
      -set_serial 7 -not_before 20200101000000Z -not_after 21200101000000Z \
      -out scaleway-cert-of-expired-ca.pem

The key of the expired CA was not kept.
