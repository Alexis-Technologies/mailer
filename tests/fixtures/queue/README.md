<!-- Not ported: the fixtures of the golden tests of ./queue. -->

Jobs of 1.2
===========

`mail-job-v1.json` is a mail job as `prepareMailJob` of 1.2.1 wrote it: its
request without the data, and its data, signed with the key `k1` of
`tests/unit/golden.test.js`. `mail-job-v1-sealed.json` is the same job as a
queue with a codec stores it: its envelope in clear and its fields in `enc`,
the base64 of their JSON.

They hold what a store of 1.2 may still hold when 2.0 reads it, so they are
never written again: a worker of 2.0 must send each of them as 1.2 would, with
the same Message-ID and Content-IDs, and a producer of 2.0 must take the same
message under the same key as a duplicate of the job, not as a key used again.
