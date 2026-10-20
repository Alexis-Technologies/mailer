import { expectAssignable, expectError, expectType } from 'tsd';
import { createMessage, type MessageContent } from '../../index.js';
import {
  createReactEmailRenderer,
  htmlToText,
  renderContent,
  renderFields,
  type RenderedFields,
  type Renderer,
} from '../../src/render/index.js';

interface Element {
  readonly type: string;
}
declare const render: (element: Element, options?: { plainText?: boolean }) => Promise<string>;
const reactEmail = createReactEmailRenderer<Element>({
  render,
  plainText: true,
  renderOptions: { pretty: false },
});
expectAssignable<Renderer<Element>>(reactEmail);
const content = await renderContent(reactEmail, { type: 'div' });
expectType<MessageContent>(content);
createMessage({ from: 'a@example.com', to: 'b@example.com', subject: 'x', content });
const upper: Renderer<string> = { render: (source) => ({ html: source.toUpperCase() }) };
expectType<Promise<MessageContent>>(renderContent(upper, 'x', { autoText: false }));
expectError(renderContent(upper, 42));
expectType<string>(htmlToText('<p>x</p>'));
expectError(createReactEmailRenderer({}));
const titled: Renderer<string> = { render: (name) => ({ html: `<p>${name}</p>`, subject: name }) };
const fields = await renderFields(titled, 'x');
expectType<RenderedFields>(fields);
expectType<string | undefined>(fields.subject);
expectType<MessageContent>(fields.content);
expectError(renderFields(titled, 42));
