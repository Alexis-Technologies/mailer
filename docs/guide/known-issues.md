# Known issues

The transport layer is ported from [upyo](https://github.com/dahlia/upyo) 0.7.0 and keeps its
behavior, bugs included, until each bug is fixed on its own with a test. This page lists the ones
still open; the fixed ones are in the [changelog](https://github.com/Alexis-Technologies/mailer/blob/main/CHANGELOG.md).

## HTTP providers and JMAP

- JMAP on Node 24: an authentication rejection (401) during the upload of a raw message whose
  size is not known ahead becomes a retryable network error, as Node's `fetch` reports an early
  answer to a streamed body so. Requests, and raw messages of a known size up to 4 MiB, go from a
  buffer and are not affected.

## Decorators

- `./pool`: `continueOnSuccess` is never read.
