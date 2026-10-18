// Not ported: the types of ./attachments, attachments read from a path, a URL,
// a data URI or a stream (after nodemailer and sently).

import type { Attachment, IdGenerator } from '../../index.js';

/**
 * The fields of the attachment a helper makes, each with a default the helper
 * finds: the file name of the path or URL, and the type of its extension or
 * the one the server or data URI gives.
 */
export interface AttachmentOptions {
  /** The file name the recipient sees. */
  readonly filename?: string;
  /** The media type, such as `application/pdf`. */
  readonly contentType?: `${string}/${string}`;
  /**
   * The Content-ID the HTML refers to as `cid:`, needed for an inline
   * attachment.
   */
  readonly contentId?: string;
  /**
   * Whether the attachment is shown in the HTML rather than listed.
   * @default false
   */
  readonly inline?: boolean;
}

/** Options of {@link fromPath}. */
export interface FromPathOptions extends AttachmentOptions {
  /**
   * A directory the file must be in, once both are resolved with `realpath`,
   * so that neither `..` nor a symbolic link leads out of it.  Pass it when
   * the path comes from a user.
   */
  readonly root?: string;
  /**
   * The longest file taken, in bytes, when it is made and each time it is
   * read.
   * @default 26214400
   */
  readonly maxBytes?: number;
}

/** Options of {@link fromUrl}. */
export interface FromUrlOptions extends AttachmentOptions {
  /**
   * The `fetch` to use, such as one that checks the address it connects to
   * (a `node:https` request whose `lookup` refuses the ranges `isPublicUrl`
   * refuses), which closes the DNS rebinding the default check leaves.
   */
  readonly fetch?: typeof globalThis.fetch;
  /** Request header fields, sent to the origin of the URL only. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Cancels the request. */
  readonly signal?: AbortSignal;
  /**
   * The time the request and its body may take, in milliseconds; 0 or
   * `Infinity` for none.
   * @default 30000
   */
  readonly timeout?: number;
  /**
   * The most bytes the body may have.
   * @default 26214400
   */
  readonly maxBytes?: number;
  /**
   * The most redirects to follow, each checked by `allowUrl`.
   * @default 5
   */
  readonly maxRedirects?: number;
  /**
   * Whether to fetch a URL, the first and each one a redirect leads to.  By
   * default, {@link isPublicUrl} of the host as written, then every address
   * its name resolves to through `lookup`: `localhost` and the loopback,
   * private, link-local and other ranges it lists are refused.  A name that
   * answers the fetch with another address than it gave the check (DNS
   * rebinding) passes, so a sender that fetches URLs from users passes a
   * `fetch` that checks the address it connects to.  A redirect from https to
   * http is refused whatever this says.
   */
  readonly allowUrl?: (url: URL) => boolean | Promise<boolean>;
  /**
   * Resolves a host name for the default check, as `dns.promises.lookup`
   * with `{ all: true, verbatim: true }` does.  Not called when `allowUrl` is
   * given.
   */
  readonly lookup?: (
    hostname: string,
    options: { readonly all: true; readonly verbatim: true },
  ) => Promise<readonly { readonly address: string; readonly family: number }[]>;
}

/** Options of {@link fromDataUri}. */
export interface FromDataUriOptions extends AttachmentOptions {
  /**
   * The most bytes the data URI may hold.
   * @default 26214400
   */
  readonly maxBytes?: number;
}

/** Options of {@link fromStream}. */
export interface FromStreamOptions extends AttachmentOptions {
  /**
   * The most bytes the stream may give.
   * @default 26214400
   */
  readonly maxBytes?: number;
  /** Stops reading. */
  readonly signal?: AbortSignal;
}

/** Options of {@link inlineDataUrls}. */
export interface InlineDataUrlsOptions {
  /**
   * The most bytes one image may hold.
   * @default 26214400
   */
  readonly maxBytes?: number;
  /**
   * The longest HTML taken, in characters: a longer one is refused with a
   * `RangeError` before it is read.
   * @default 67108864
   */
  readonly maxLength?: number;
  /** Makes the left half of each Content-ID instead of a UUID. */
  readonly generateId?: IdGenerator;
  /**
   * The right half of each Content-ID.
   * @default "localhost"
   */
  readonly domain?: string;
}

/**
 * Makes an attachment of a file, read again each time the message is read.
 * Each reading opens the file that was checked: one that a link or a renamed
 * directory has put in its place since, or that has grown past `maxBytes`,
 * fails the reading.
 *
 * @example
 * ```js
 * const { fromPath } = require('@alexify/mailer/attachments');
 * const report = await fromPath('./reports/october.pdf');
 * ```
 */
export declare function fromPath(path: string, options?: FromPathOptions): Promise<Attachment>;

/**
 * Makes an attachment of what an http or https URL answers, fetched now and
 * held in memory.
 */
export declare function fromUrl(url: string | URL, options?: FromUrlOptions): Promise<Attachment>;

/**
 * Makes an attachment of a `data:` URI (RFC 2397), base64 or
 * percent-encoded.
 */
export declare function fromDataUri(uri: string, options?: FromDataUriOptions): Attachment;

/**
 * Makes an attachment of what a stream gives, read now and held in memory,
 * since a message may be read more than once and a stream cannot be.
 */
export declare function fromStream(
  source: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>,
  options?: FromStreamOptions,
): Promise<Attachment>;

/**
 * Turns the images of HTML given as data URIs into inline attachments, each
 * referred to by its Content-ID.
 *
 * @example
 * ```js
 * const { html, attachments } = inlineDataUrls('<img src="data:image/png;base64,iVBOR…">');
 * createMessage({ ...fields, content: { html }, attachments });
 * ```
 */
export declare function inlineDataUrls(
  html: string,
  options?: InlineDataUrlsOptions,
): { readonly html: string; readonly attachments: readonly Attachment[] };

/**
 * The check of a URL {@link fromUrl} makes when no `allowUrl` is given.  It
 * reads the host of the URL as written: no `localhost`, and no IP literal in a
 * loopback, private, link-local, multicast, reserved or documentation range,
 * or in an IPv6 range that carries an IPv4 address (IPv4-compatible, NAT64,
 * 6to4).  A host name is not resolved, so one that resolves to such an address
 * passes, and so does one that changes its address between the check and the
 * fetch (DNS rebinding).
 */
export declare function isPublicUrl(url: URL): boolean;
