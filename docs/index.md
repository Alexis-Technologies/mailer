---
layout: home

title: '@alexify/mailer'
titleTemplate: Email for Node.js, with a reliability layer

hero:
  name: mailer
  text: Email for Node.js, with a reliability layer
  tagline: Its own SMTP client, MIME builder, DKIM and HTTP providers, and on top of them what the other libraries leave to you — a persistent queue, an audit log, delivery events, suppression and idempotency. Zero dependencies.
  image:
    src: /logo-mark.svg
    alt: mailer
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Why mailer?
      link: /guide/why
    - theme: alt
      text: Compared with alternatives
      link: /guide/comparison

features:
  - icon: ✉️
    title: Its own transport
    details: "An SMTP client, a MIME builder and DKIM signing of its own, and HTTP providers on fetch, starting with Amazon SES v2. Secure defaults: TLS is verified and AUTH never goes over plain text."
    link: /guide/why
    linkText: The transport
  - icon: 🧾
    title: A reliability layer
    details: "A persistent queue and outbox, an append-only audit log and one model of delivery events. None of the fourteen libraries in the comparison has the three."
    link: /guide/comparison
    linkText: The comparison
  - icon: 🔁
    title: Sent once, or known to be unknown
    details: "Idempotency keys with deduplication, errors classified as permanent or temporary, and a delivery_unknown state instead of a blind retry when a provider has no idempotency key."
    link: /guide/why
    linkText: The design
  - icon: 🪶
    title: Zero dependencies
    details: "Built on node:* modules and fetch. A queue or a database driver (BullMQ, MongoDB) is passed in by your application, never installed by the package. Node.js 22+, CommonJS with ESM named imports and hand-written typings."
    link: /api/exports
    linkText: API
---

::: warning Work in progress
The library is being designed: the features above are what it is built to do, not what the
published package does yet. See [Why @alexify/mailer?](/guide/why) for the plan.
:::
