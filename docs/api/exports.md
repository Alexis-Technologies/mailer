# Exports

::: warning Work in progress
`createMailer` is a placeholder: it throws until the mailer is implemented, and its signature will
change with the design of the messages, the transports and the queue.
:::

```js
const { createMailer } = require('@alexify/mailer');
```

## `createMailer(options)`

Creates a mailer that sends messages through a transport, with the reliability layer on top.

```ts
interface Mailer {
  send(message: object): Promise<unknown>;
}

function createMailer(options: object): Mailer;
```

Throws `Error('createMailer is not implemented yet')`.
