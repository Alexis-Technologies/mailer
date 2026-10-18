# Known issues

The transport layer is ported from [upyo](https://github.com/dahlia/upyo) 0.7.0 and keeps its
behavior, bugs included, until each bug is fixed on its own with a test. This page lists the ones
still open; the fixed ones are in the [changelog](https://github.com/Alexis-Technologies/mailer/blob/main/CHANGELOG.md).

## HTTP providers and JMAP

- JMAP on Node 24: an authentication rejection (401) during the upload of a raw message whose
  size is not known ahead becomes a retryable network error, as Node's `fetch` reports an early
  answer to a streamed body so. Requests, and raw messages of a known size up to 4 MiB, go from a
  buffer and are not affected.

## Deno

- Deno's `fetch` (2.9.6) sends a request again when a reused HTTP/1.1 connection closes before
  its answer. When the provider took the request before the connection was lost, the message
  goes twice; on Node and Bun the same failure is reported as of unknown delivery
  (`deliveryUnknown`) and not retried. Pass the HTTP transports and JMAP a `fetch` on a client
  that keeps no idle connection, `Deno.createHttpClient({ poolMaxIdlePerHost: 0 })`, as
  [getting started](/guide/getting-started#bun-and-deno) shows. The providers that take an
  idempotency key, which the transport sends with every message (Resend, Lettermint, Brevo,
  Azure), see the second request as the first and do not send the message again.
