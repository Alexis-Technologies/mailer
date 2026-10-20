// Types ported from unemail v0.7.0 (src/render)
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind

import type { MessageContent } from '../../index.js';

/**
 * What a renderer gives: the HTML of a message, its text, or both.
 */
export interface RenderOutput {
  readonly html?: string;
  readonly text?: string;
  /**
   * The subject of the message, when the template has one, as those of
   * `./templates` do. {@link renderContent} leaves it out of the content;
   * {@link renderFields} gives it.
   */
  readonly subject?: string;
}

/**
 * Turns the input of a template into the content of a message: React Email
 * components, MJML, a template language of the application's own.
 */
export interface Renderer<TInput = unknown> {
  render(input: TInput): RenderOutput | Promise<RenderOutput>;
}

/**
 * The options of {@link renderContent}.
 */
export interface RenderContentOptions {
  /**
   * Derives the text from the HTML with {@link htmlToText} when the renderer
   * gives none.
   * @default true
   */
  readonly autoText?: boolean;
}

/**
 * Renders the content of a message for `createMessage`: `{ html, text }`, the
 * text derived from the HTML when the renderer gives none.
 *
 * @example
 * ```js
 * const message = createMessage({
 *   from, to, subject: 'Welcome',
 *   content: await renderContent(reactEmail, Welcome({ name: 'Ada' })),
 * });
 * ```
 * @throws {TypeError} If the renderer is not one, or gives no string.
 */
export declare function renderContent<TInput>(
  renderer: Renderer<TInput>,
  input: TInput,
  options?: RenderContentOptions,
): Promise<MessageContent>;

/**
 * What {@link renderFields} gives: the subject and the content of a message.
 */
export interface RenderedFields {
  /** The subject the renderer gave; undefined when it gave none. */
  readonly subject?: string;
  readonly content: MessageContent;
}

/**
 * Renders the subject and the content of a message: the content as
 * {@link renderContent} renders it, and the subject the renderer gave with it.
 *
 * @example
 * ```js
 * const { subject, content } = await renderFields(templates, {
 *   template: 'welcome', context: { name: 'Ada' },
 * });
 * const message = createMessage({ from, to, subject, content });
 * ```
 * @throws {TypeError} As renderContent does, or if the subject is not a string.
 */
export declare function renderFields<TInput>(
  renderer: Renderer<TInput>,
  input: TInput,
  options?: RenderContentOptions,
): Promise<RenderedFields>;

/**
 * The options `render` of `@react-email/render` takes.
 */
export interface ReactEmailRenderOptions {
  readonly plainText?: boolean;
  readonly pretty?: boolean;
  readonly [option: string]: unknown;
}

/**
 * The options of {@link createReactEmailRenderer}.
 */
export interface ReactEmailRendererOptions<TElement = unknown> {
  /** `require('@react-email/render').render`, or a function like it. */
  readonly render: (
    element: TElement,
    options?: ReactEmailRenderOptions,
  ) => string | Promise<string>;
  /**
   * Takes the text from React Email's plain-text pass rather than deriving it
   * from the HTML.
   * @default true
   */
  readonly plainText?: boolean;
  /** Passed to `render`, such as `{ pretty: true }`. */
  readonly renderOptions?: ReactEmailRenderOptions;
}

/**
 * Makes a renderer of React Email components with the `render` the
 * application passes in, so the package depends on neither React nor React
 * Email.
 *
 * @example
 * ```js
 * const { render } = require('@react-email/render');
 * const reactEmail = createReactEmailRenderer({ render });
 * ```
 * @throws {TypeError} If `render` is not a function.
 */
export declare function createReactEmailRenderer<TElement = unknown>(
  options: ReactEmailRendererOptions<TElement>,
): Renderer<TElement>;

/**
 * The plain text an HTML body reads as: the text of its elements, a line or a
 * blank line for its blocks, list items with a bullet or a number, and the
 * address of each link after its label.  Scripts, styles, the head, comments
 * and what is marked `data-skip-in-text` are left out.  It handles what a
 * mail body holds, in one pass, in time linear in its length.
 *
 * @throws {TypeError} If `html` is not a string.
 */
export declare function htmlToText(html: string): string;
