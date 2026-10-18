<!-- Not ported: the fixtures of the tests that trust a certificate by its CA. -->

TLS test certificates
=====================

`server-cert.pem` and `server-key.pem` are a certificate for `localhost`,
`127.0.0.1` and `::1`, issued by the test CA of `ca-cert.pem`, for the tests
that pass `ca` rather than `rejectUnauthorized: false`. Bun, on BoringSSL, does
not take a self-signed certificate that is not a CA, such as the one of
`../smtp`, as a root of trust, while Node and Deno do. They were made with

    openssl req -x509 -newkey rsa:2048 -nodes -days 36500 \
      -subj "/CN=mailer test CA" \
      -addext "basicConstraints=critical,CA:TRUE" \
      -addext "keyUsage=critical,keyCertSign,cRLSign" \
      -keyout ca-key.pem -out ca-cert.pem
    openssl req -newkey rsa:2048 -nodes -subj "/CN=localhost" \
      -keyout server-key.pem -out server.csr
    openssl x509 -req -days 36500 -in server.csr -CA ca-cert.pem \
      -CAkey ca-key.pem -set_serial 1 -extfile server.ext -out server-cert.pem

where `server.ext` holds

    basicConstraints=critical,CA:FALSE
    keyUsage=critical,digitalSignature,keyEncipherment
    extendedKeyUsage=serverAuth
    subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1

The key of the CA was not kept; a new certificate means a new CA. The private
key of the server is intentionally committed and must never be used outside the
tests.
