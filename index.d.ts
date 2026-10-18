// Types ported from upyo v0.7.0 (packages/core/src)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee
// The types of the root entry of @alexify/mailer, written by hand: the message
// model and the transport contract (src/core/).

/**
 * A type alias for email address strings that must contain an @ symbol.
 */
export type EmailAddress = `${string}@${string}`;
/**
 * A pair of name (which is optional) and email address.
 */
export interface Address {
  /**
   * The name of the person or entity associated with the email address.
   */
  readonly name?: string;
  /**
   * The email address itself.
   */
  readonly address: EmailAddress;
}
/**
 * Formats an address object into a string representation.  This function is
 * an inverse of the {@link parseAddress} function.
 *
 * @example Formatting an address with a name
 * ```ts
 * import { type Address, formatAddress } from "@alexify/mailer";
 * const address: Address = { name: "John Doe", address: "john@example.com" };
 * console.log(formatAddress(address)); // "John Doe <john@example.com>"
 * ```
 *
 * @example Formatting an address without a name
 * ```ts
 * import { type Address, formatAddress } from "@alexify/mailer";
 * const address: Address = { address: "jane@examle.com" };
 * console.log(formatAddress(address)); // "jane@example.com"
 * ```
 *
 * @param address The address object to format.
 * @return A string representation of the address.
 */
export declare function formatAddress(address: Address): string;
/**
 * Parses a string representation of an email address into an {@link Address}
 * object.  This function is an inverse of the {@link formatAddress} function.
 *
 * @example Parsing an address with a name
 * ```ts
 * import { parseAddress } from "@alexify/mailer";
 * const address = parseAddress("John Doe <john@example.com>");
 * console.log(address); // { name: "John Doe", address: "john@example.com" }
 * ```
 *
 * @example Parsing an address without a name
 * ```ts
 * import { parseAddress } from "@alexify/mailer";
 * const address = parseAddress("jane@example.com");
 * console.log(address); // { address: "jane@example.com" }
 * ```
 *
 * @example Trying to parse an invalid address
 * ```ts
 * import { parseAddress } from "@alexify/mailer";
 * const address = parseAddress("invalid-email");
 * console.log(address); // undefined
 * ```
 *
 * @param address The string representation of the address to parse.
 * @returns An {@link Address} object if the parsing is successful,
 *          or `undefined` if the input is invalid.
 */
export declare function parseAddress(address: string): Address | undefined;
/**
 * Type guard function that checks if a given value is a valid email address.
 *
 * @example
 * ```ts
 * import { isEmailAddress } from "@alexify/mailer";
 *
 * const userInput = "user@example.com";
 * if (isEmailAddress(userInput)) {
 *   // TypeScript now knows userInput is EmailAddress type
 *   console.log(userInput); // Type: `${string}@${string}`
 * }
 * ```
 *
 * @param email The value to check
 * @returns `true` if the value is a valid email address, `false` otherwise
 */
export declare function isEmailAddress(email: unknown): email is EmailAddress;

/**
 * Result of combining abort signals.
 */
export interface CombinedSignal {
  /**
   * The signal that aborts when any input signal aborts.
   */
  readonly signal: AbortSignal;
  /**
   * Releases what the composition holds; a no-op with `AbortSignal.any()`, kept so
   * that callers can always call it.
   */
  cleanup(): void;
}
/**
 * Combines a primary abort signal with an optional external signal.
 *
 * The returned signal aborts as soon as either input signal aborts, with the
 * reason of the signal that aborted first (`AbortSignal.any()`).
 *
 * @param primarySignal The signal owned by the current operation.
 * @param externalSignal Optional caller-supplied signal to compose.
 * @returns A combined signal and cleanup callback.
 */
export declare function combineSignals(
  primarySignal: AbortSignal,
  externalSignal?: AbortSignal | null,
): CombinedSignal;

/**
 * Opens a fresh, independent attachment reader on every invocation. Readers
 * must produce identical bytes for retries, concurrent sends, and DKIM passes.
 * A yielded chunk must remain valid until the next read. Factories should honor
 * the signal during acquisition and release resources when iteration ends.
 * @param signal Cancellation signal owned by the reader.
 * @returns A new iterable, optionally acquired asynchronously.
 */
export type AttachmentContentFactory = (
  signal?: AbortSignal,
) => AsyncIterable<Uint8Array> | Promise<AsyncIterable<Uint8Array>>;
/**
 * Replayable attachment bytes. One-shot iterables are intentionally excluded;
 * wrap them in a factory that opens a new reader for each invocation.
 */
export type AttachmentContent = Uint8Array | Promise<Uint8Array> | Blob | AttachmentContentFactory;
/**
 * Represents an attachment in an email message.
 */
export interface Attachment {
  /**
   * Whether the attachment is intended to be used for inline images.
   */
  readonly inline: boolean;
  /**
   * The filename of the attachment, which is used for display purposes
   * and may not be the actual name of the file on disk.
   */
  readonly filename: string;
  /**
   * Replayable attachment content. Use {@link readAttachmentContent} to collect
   * bytes or {@link iterateAttachmentContent} to read them incrementally.
   */
  readonly content: AttachmentContent;
  /**
   * The media type of the attachment, which indicates the type of content
   * and how it should be handled by email clients.
   */
  readonly contentType: `${string}/${string}`;
  /**
   * The content ID of the attachment, which is used to reference
   * inline images in HTML emails.
   */
  readonly contentId: string;
}
/**
 * Checks if the provided value is an {@link Attachment} object.
 * @param attachment The value to check.
 * @return `true` if the value is an {@link Attachment}, otherwise `false`.
 */
export declare function isAttachment(attachment: unknown): attachment is Attachment;
/**
 * Reads attachment chunks without prefetching. Early exit or cancellation
 * aborts the source and requests cleanup without waiting for an uncooperative
 * producer. Producers remain responsible for honoring cancellation.
 * @param content Replayable content to read.
 * @param signal Optional cancellation signal.
 * @returns An iterable of byte chunks, valid until the next read.
 * @throws {TypeError} If a source or yielded chunk is invalid.
 * @throws {Error} If reading fails or cancellation is requested.
 */
export declare function iterateAttachmentContent(
  content: AttachmentContent,
  signal?: AbortSignal,
): AsyncIterable<Uint8Array>;
/**
 * Collects an attachment in memory. Existing arrays retain their identity;
 * streamed chunks are copied before the producer can reuse their storage.
 * @param content Replayable content to collect.
 * @param signal Optional cancellation signal.
 * @returns The complete attachment bytes.
 * @throws {TypeError} If a source or yielded chunk is invalid.
 * @throws {RangeError} If the attachment cannot fit in a byte array.
 * @throws {Error} If reading fails or cancellation is requested.
 */
export declare function readAttachmentContent(
  content: AttachmentContent,
  signal?: AbortSignal,
): Promise<Uint8Array>;

/**
 * An iTIP method, naming what a scheduling message does.
 *
 * These are the methods registered by RFC 5546 §1.4.  A method written as an
 * `x-name` or as an unregistered IANA token is rejected rather than passed
 * through, because the value is written into a `Content-Type` parameter and has
 * to agree with the calendar object that carries it.
 */
export type CalendarMethod =
  | 'PUBLISH'
  | 'REQUEST'
  | 'REPLY'
  | 'ADD'
  | 'CANCEL'
  | 'REFRESH'
  | 'COUNTER'
  | 'DECLINECOUNTER';
/**
 * The scheduling payload of a message, in the form a transport serializes.
 *
 * This is what {@link Message.calendar} holds.  Both fields are settled: the
 * method has been checked against the calendar object's own `METHOD` property,
 * and the content carries the CRLF line endings RFC 5545 §3.1 makes normative.
 */
export interface CalendarContent {
  /**
   * The method the calendar object declares, which the MIME `method` parameter
   * repeats.
   */
  readonly method: CalendarMethod;
  /**
   * The iCalendar object, with CRLF line endings and a terminating CRLF.
   */
  readonly content: string;
}
/**
 * The scheduling payload in the looser form a caller supplies.
 *
 * This is what {@link MessageConstructor.calendar} accepts.  Line endings are
 * normalized and the method is resolved when the message is created.
 */
export interface CalendarConstructor {
  /**
   * Asserts which method the calendar object carries.
   *
   * This is a guard, not a source: the resolved method always comes from the
   * object's own `METHOD` property, and supplying a value that disagrees with
   * it is an error rather than an override.  Leave it unset unless you want the
   * check.
   */
  readonly method?: CalendarMethod;
  /**
   * The iCalendar object.  Bare LF and bare CR line endings are accepted and
   * normalized to CRLF; the object's own line folding is left alone.
   */
  readonly content: string;
}
/**
 * Reads the method a calendar object declares.
 *
 * This is a convenience parser for a payload arriving from elsewhere, so it
 * returns `undefined` rather than throwing, the way {@link parseMessageId}
 * does.  It answers one question—which iTIP method does this object declare?—
 * and answers `undefined` whenever it cannot answer with confidence: no
 * `METHOD` at the top level, more than one, a method Upyo does not support, or
 * malformed content line syntax or component structure.  It never salvages a
 * plausible token from malformed input.
 *
 * Use {@link resolveCalendarContent} instead when you want to know *why* a
 * payload was refused.
 *
 * @example
 * ```ts
 * import { parseCalendarMethod } from "@alexify/mailer";
 * parseCalendarMethod("BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nEND:VCALENDAR\r\n");
 * // "REQUEST"
 * ```
 *
 * @param content The iCalendar object to read.
 * @returns The declared method, or `undefined` if there is not exactly one
 *          supported top-level method.
 */
export declare function parseCalendarMethod(content: string): CalendarMethod | undefined;
/**
 * Checks a scheduling payload and puts it in the form a transport serializes.
 *
 * A transport calls this before composing, the way it calls
 * {@link formatMessageId}: {@link Message} is a structural interface, so a
 * value that never passed through {@link createMessage} still has to be checked
 * before its method reaches a `Content-Type` parameter.
 *
 * This is deliberately not a full iCalendar validator.  It checks what MIME
 * composition depends on: the syntax of every content line, one calendar
 * object with balanced components, and exactly one supported method.  It
 * leaves property-specific value syntax and scheduling semantics to the caller.
 * Whether the object names an `ORGANIZER`, carries a stable `UID`, bumps
 * `SEQUENCE` on an update, or satisfies the iTIP constraints for its method is
 * not checked here.
 *
 * @example
 * ```ts
 * import { resolveCalendarContent } from "@alexify/mailer";
 * const calendar = resolveCalendarContent({ content: ics });
 * calendar.method;  // "REQUEST"
 * ```
 *
 * @param calendar The payload to check.
 * @returns The payload with CRLF line endings and a resolved method.
 * @throws {TypeError} If the content is not a single well-formed calendar
 * object with valid content line syntax, if it does not declare exactly one
 * supported method, or if it declares a method other than the one asserted.
 */
export declare function resolveCalendarContent(calendar: CalendarConstructor): CalendarContent;
/**
 * Builds the *invite.ics* part that stands in for a calendar alternative.
 *
 * A transport that cannot compose a `text/calendar` body alternative falls back
 * to this, so the payload travels rather than being dropped.  The part keeps
 * the calendar media type and the `method` parameter, which is what a client
 * needs to treat it as scheduling content, but whether a provider preserves
 * that parameter is the provider's business; see the transport's documentation.
 *
 * The content ID is empty, which marks the part as an ordinary attachment
 * across the transports that infer inline disposition from one.
 *
 * @param calendar The payload to carry.
 * @returns An attachment holding the calendar object.
 * @throws {TypeError} If the payload is not valid; see
 * {@link resolveCalendarContent}.
 */
export declare function createCalendarAttachment(calendar: CalendarConstructor): Attachment;

/**
 * Represents an email message with various properties such as
 * sender, recipients, subject, content, and attachments.
 *
 * You wouldn't typically create this type directly.  Instead, you probably
 * want to use the {@link createMessage} function, which provides a more
 * convenient API for creating messages.
 */
export interface Message {
  /**
   * The email address of the sender of the message.
   */
  readonly sender: Address;
  /**
   * The email addresses of the recipient of the message.
   */
  readonly recipients: readonly Address[];
  /**
   * The email addresses of the carbon copy (CC) recipients of the message.
   */
  readonly ccRecipients: readonly Address[];
  /**
   * The email addresses of the blind carbon copy (BCC) recipients of the message.
   */
  readonly bccRecipients: readonly Address[];
  /**
   * The email addresses of the reply-to recipients of the message.
   */
  readonly replyRecipients: readonly Address[];
  /**
   * The attachments included in the email message.  These are files that
   * are sent along with the email, such as documents, images, or other
   * media files.  Each attachment is represented by an {@link Attachment}
   * object, which contains information about the attachment such as its
   * filename, content type, and content ID.
   */
  readonly attachments: readonly Attachment[];
  /**
   * The subject of the email message.  This is typically a brief summary
   * of the content of the email, and is used to help the recipient identify
   * the purpose of the message.
   */
  readonly subject: string;
  /**
   * The content of the email message, which can be either HTML or plain text.
   * This property is represented by the {@link MessageContent} type, which
   * includes both HTML and plain text content.  The HTML content is typically
   * used for rich formatting and layout, while the plain text content is
   * used for simple text emails or for compatibility with email clients
   * that do not support HTML.
   */
  readonly content: MessageContent;
  /**
   * The priority of the email message, which indicates its importance
   * relative to other messages.  The priority can be one of three
   * levels: `"high"`, `"normal"`, or `"low"`.  This is represented by
   * the {@link Priority} type, which is a string literal type that
   * allows only these three values.
   */
  readonly priority: Priority;
  /**
   * The tags associated with the email message.
   */
  readonly tags: readonly string[];
  /**
   * The headers of the email message.  This is represented by
   * the {@link ImmutableHeaders} type, which is a supertype of
   * the standard `Headers` class.  The `ImmutableHeaders` type
   * includes only the methods for reading the headers, such as `get`, `keys`,
   * `has`, and `entries`, but does not include methods for modifying
   * the headers, such as `append`, `delete`, or `set`.
   */
  readonly headers: ImmutableHeaders;
  /**
   * An idempotency key to ensure that the same message is not sent multiple
   * times.  This is useful for retrying failed send operations without
   * risking duplicate delivery.
   *
   * If provided, the transport will use this key to deduplicate requests.
   * If not provided, the transport may generate its own key internally
   * (behavior varies by transport implementation).
   *
   * The key should be unique for each distinct message you want to send.
   * When retrying the same message, use the same idempotency key.
   *
   * Note: Not all transports support idempotency keys.  Check the specific
   * transport documentation for details.
   */
  readonly idempotencyKey?: string;
  /**
   * The RFC 5322 message identifier of the message, without the enclosing
   * angle brackets.
   *
   * Set this when the identity of the message matters to the application, so
   * that it can be stored and a reply arriving with a matching `In-Reply-To`
   * correlated back to the conversation.  The value stays the same across
   * delivery retries.  When it is left unset, a transport that composes the
   * message itself generates one.
   *
   * Not every transport carries this.  A provider that composes the message on
   * its own side may assign or rewrite the identifier regardless of what is
   * given here; see the transport's documentation.  This is also unrelated to
   * {@link Receipt.messageId}, which is the delivery handle the transport or
   * the provider reports back.
   */
  readonly messageId?: string;
  /**
   * The origination date of the message: when its author considers it to have
   * been sent, which is not necessarily when a transport delivers it.
   *
   * When it is left unset, a transport that composes the message itself uses
   * the time of conversion, so a retry carries a later date than the first
   * attempt.  Set it to keep the date stable.
   */
  readonly date?: Date;
  /**
   * The identifiers of the messages this one directly replies to, without the
   * enclosing angle brackets.
   *
   * An empty array means the message deliberately replies to nothing, which
   * suppresses an `In-Reply-To` header supplied through {@link headers};
   * leaving the field unset lets that header through.
   */
  readonly inReplyTo?: readonly string[];
  /**
   * The identifiers of the conversation this message belongs to, oldest first
   * and without the enclosing angle brackets.
   *
   * A reply usually carries the parent's references followed by the parent's
   * own identifier, which is how a mail client reconstructs a thread.
   *
   * An empty array means the message deliberately belongs to no conversation,
   * which suppresses a `References` header supplied through {@link headers};
   * leaving the field unset lets that header through.
   */
  readonly references?: readonly string[];
  /**
   * The scheduling payload of the message: an iCalendar object describing an
   * invitation, a reply to one, or a cancellation.
   *
   * A calendar client recognizes a scheduling message from a `text/calendar`
   * body part whose `method` parameter repeats the object's own `METHOD`
   * property, which is what this field lets a transport compose.  Attaching an
   * *.ics* file yourself does not do the same thing.
   *
   * The human-readable {@link content} is still required and still carries the
   * message: a recipient whose client knows nothing about scheduling sees that
   * and nothing else.  Keep it consistent with the calendar object, since
   * Outlook substitutes the HTML alternative for the object's `DESCRIPTION`.
   *
   * Not every transport composes this.  One that cannot sends the object as an
   * *invite.ics* attachment instead, which preserves the payload but not
   * necessarily the scheduling semantics; see the transport's documentation.
   */
  readonly calendar?: CalendarContent;
  /**
   * When the provider should deliver the message.  A transport that cannot
   * schedule it refuses the message with a non-retryable `unsupported`
   * receipt rather than sending it at once, and `./pool` fails over to one
   * that can.
   */
  readonly scheduledAt?: Date;
  /**
   * Open and click tracking for this message, over what the transport is
   * configured with, where its provider takes it per message.
   */
  readonly tracking?: MessageTracking;
  /**
   * Values the provider keeps with the message and returns in its events
   * (custom arguments, variables), where its provider takes them: at most 64
   * keys of 1 to 128 of `[A-Za-z0-9_.-]`, each value at most 1024 characters
   * with no control character.
   */
  readonly metadata?: Readonly<Record<string, string>>;
}
/**
 * Open and click tracking of a message.
 */
export interface MessageTracking {
  /** Whether the provider tracks opens, with a pixel. */
  readonly opens?: boolean;
  /** Whether the provider tracks clicks, by rewriting links. */
  readonly clicks?: boolean;
}
/**
 * Represents the content of an email message, which can be either HTML
 * or plain text.  The `html` property is optional, and if it is
 * provided, the `text` property may also be included for
 * compatibility with email clients that do not support HTML.
 */
export type MessageContent =
  | {
      /**
       * The HTML content of the email message.  This is typically used
       * for rich formatting and layout.
       */
      html: string;
      /**
       * The alternative plain text content of the email message.  This is
       * optional and may be included for compatibility with email
       * clients that do not support HTML.
       */
      text?: string;
    }
  | {
      /**
       * The plain text content of the email message.  This is typically
       * used for simple text emails.
       */
      text: string;
    };
/**
 * Represents the headers of an email message.  This type is a supertype of
 * the standard `Headers` class, which is used to manage HTTP headers.
 * Note that this type does not include methods for modifying the headers,
 * such as `append`, `delete`, or `set`.  It is intended to be used for
 * read-only access to the headers of an email message.
 */
export type ImmutableHeaders = Omit<Headers, 'append' | 'delete' | 'set'>;
/**
 * A constructor interface for creating a new email message using
 * the {@link createMessage} function.
 */
export interface MessageConstructor {
  /**
   * The email address of the sender of the message.
   */
  readonly from: Address | string;
  /**
   * The email addresses of the recipient of the message.
   */
  readonly to: Address | string | (Address | string)[];
  /**
   * The email addresses of the carbon copy (CC) recipients of the message.
   * @default `[]`
   */
  readonly cc?: Address | string | (Address | string)[];
  /**
   * The email addresses of the blind carbon copy (BCC) recipients of the message.
   * @default `[]`
   */
  readonly bcc?: Address | string | (Address | string)[];
  /**
   * The email addresses of the reply-to recipients of the message.
   * @default `[]`
   */
  readonly replyTo?: Address | string | (Address | string)[];
  /**
   * The attachments included in the email message.  These are files that
   * are sent along with the email, such as documents, images, or other
   * media files.  Each attachment can be represented by an {@link Attachment}
   * or a `File` object, which contains information about the attachment such as
   * its filename and content type.
   * @default `[]`
   */
  readonly attachments?: Attachment | File | (Attachment | File)[];
  /**
   * The subject of the email message.  This is typically a brief summary
   * of the content of the email, and is used to help the recipient identify
   * the purpose of the message.
   */
  readonly subject: string;
  /**
   * The content of the email message, which can be either HTML or plain text.
   * This property is represented by the {@link MessageContent} type, which
   * includes both HTML and plain text content.  The HTML content is typically
   * used for rich formatting and layout, while the plain text content is
   * used for simple text emails or for compatibility with email clients
   * that do not support HTML.
   */
  readonly content: MessageContent;
  /**
   * The priority of the email message, which indicates its importance
   * relative to other messages.  The priority can be one of three
   * levels: `"high"`, `"normal"`, or `"low"`.  This is represented by
   * the {@link Priority} type, which is a string literal type that
   * allows only these three values.
   * @default `"normal"`
   */
  readonly priority?: Priority;
  /**
   * The tags associated with the email message.
   * @default `[]`
   */
  readonly tags?: string[];
  /**
   * The headers of the email message.
   * @default `{}`
   */
  readonly headers?: ImmutableHeaders | Record<string, string>;
  /**
   * The List-* header fields of a mailing list or a newsletter (RFC 2369,
   * RFC 2919), and one-click unsubscription (RFC 8058).  They are added to
   * {@link Message.headers}, so every transport that sends custom header
   * fields sends them; a field given here may not also be in `headers`.
   */
  readonly list?: ListFields;
  /**
   * An idempotency key to ensure that the same message is not sent multiple
   * times.  This is useful for retrying failed send operations without
   * risking duplicate delivery.
   *
   * If provided, the transport will use this key to deduplicate requests.
   * If not provided, the transport may generate its own key internally
   * (behavior varies by transport implementation).
   *
   * The key should be unique for each distinct message you want to send.
   * When retrying the same message, use the same idempotency key.
   *
   * Note: Not all transports support idempotency keys.  Check the specific
   * transport documentation for details.
   */
  readonly idempotencyKey?: string;
  /**
   * The RFC 5322 message identifier of the message.  The enclosing angle
   * brackets are optional and stripped, so both `abc@example.com` and
   * `<abc@example.com>` are accepted.
   *
   * Use {@link generateMessageId} to mint one before sending, so that it can
   * be stored alongside whatever the message is about.
   */
  readonly messageId?: string;
  /**
   * The origination date of the message.
   */
  readonly date?: Date;
  /**
   * The identifier, or identifiers, of the messages this one directly replies
   * to.  A single string is one identifier, never a list.  An empty array
   * suppresses an `In-Reply-To` header supplied through {@link headers}.
   */
  readonly inReplyTo?: string | readonly string[];
  /**
   * The identifiers of the conversation this message belongs to, oldest first.
   * A single string is one identifier, never a list.  An empty array
   * suppresses a `References` header supplied through {@link headers}.
   */
  readonly references?: string | readonly string[];
  /**
   * The scheduling payload of the message: an iCalendar object your
   * application, or a library such as *ical-generator*, produced.  Upyo does
   * not generate one.
   *
   * The method is taken from the object's own `METHOD` property; supplying
   * {@link CalendarConstructor.method} asserts what that property says rather
   * than overriding it.  Line endings are normalized to CRLF.
   */
  readonly calendar?: CalendarConstructor;
  /**
   * When the provider should deliver the message.  A transport that cannot
   * schedule it (SMTP, JMAP, and every provider without a scheduling API)
   * refuses the message with a non-retryable `unsupported` receipt rather
   * than sending it at once, and `./pool` fails over to one that can.
   */
  readonly scheduledAt?: Date;
  /**
   * Open and click tracking for this message, over what the transport is
   * configured with, where its provider takes it per message.  SMTP and JMAP
   * ignore it.
   */
  readonly tracking?: MessageTracking;
  /**
   * Values the provider keeps with the message and returns in its events.
   * A key is 1 to 128 letters, digits, `_`, `-` or `.`, as it may become the
   * name of a header or form field; a value is a string without control
   * characters.  SMTP and JMAP ignore it.
   */
  readonly metadata?: Readonly<Record<string, string>>;
}
/**
 * A URL of a List-* field: an `http:`, `https:` or `mailto:` URL, or a bare
 * address for a `mailto:` one, with an optional comment of printable ASCII.
 */
export type ListUrl = string | { readonly url: string; readonly comment?: string };
/**
 * The List-* header fields of a message.
 *
 * @example
 * ```js
 * createMessage({
 *   // ...
 *   list: {
 *     id: { id: 'news.example.com', name: 'Weekly News' },
 *     unsubscribe: ['https://example.com/unsubscribe?u=42', 'unsubscribe@example.com'],
 *     oneClick: true,
 *   },
 * });
 * ```
 */
export interface ListFields {
  /**
   * `List-Id` (RFC 2919): a dot-atom with a namespace, such as
   * `news.example.com`, with an optional name of printable ASCII.
   */
  readonly id?: string | { readonly id: string; readonly name?: string };
  /** `List-Help`. */
  readonly help?: ListUrl | readonly ListUrl[];
  /** `List-Unsubscribe`: one field, its URLs separated by commas. */
  readonly unsubscribe?: ListUrl | readonly ListUrl[];
  /** `List-Subscribe`. */
  readonly subscribe?: ListUrl | readonly ListUrl[];
  /** `List-Post`. */
  readonly post?: ListUrl | readonly ListUrl[];
  /** `List-Owner`. */
  readonly owner?: ListUrl | readonly ListUrl[];
  /** `List-Archive`. */
  readonly archive?: ListUrl | readonly ListUrl[];
  /**
   * Adds `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058),
   * which tells a mailbox provider that a POST to the https URL of
   * `unsubscribe` unsubscribes at once, without a page to confirm.  Gmail and
   * Yahoo ask bulk senders for it.  Set it only when that endpoint does so;
   * it needs an https URL in `unsubscribe`.  The DKIM signature of `./mime`
   * and `./smtp` covers both fields by default.
   * @default false
   */
  readonly oneClick?: boolean;
}
/**
 * Creates a new email {@link Message} based on the provided constructor
 * parameters.  This function provides a more convenient API for creating
 * messages compared to constructing a {@link Message} object directly.
 *
 * @example
 * ```typescript
 * const message = createMessage({
 *   from: "sender@example.com",
 *   to: "recipient1@example.com",
 *   subject: "Hello World",
 *   content: { text: "This is a test message" }
 * });
 * ```
 *
 * @param constructor The constructor parameters for the message. Uses more
 *                    user-friendly types like accepting strings for email
 *                    addresses and `File` objects for attachments.
 * @param options `generateId`, which makes the left half of the Content-ID of
 *                a `File` attachment instead of a UUID.
 * @returns A new {@link Message} object with all properties normalized and
 *          validated.
 * @throws {TypeError} When any email address string cannot be parsed, when an
 *                     address or attachment carries a carriage return or line
 *                     feed that could forge header fields, when an attachment
 *                     object is invalid, when a message identifier is not
 *                     valid, when the date is not one RFC 5322 can express, or
 *                     when the calendar content is not a single well-formed
 *                     iCalendar object declaring one supported method, or when
 *                     `generateId` returns no dot-atom-text.
 */
export declare function createMessage(
  constructor: MessageConstructor,
  options?: IdOptions,
): Message;

/**
 * Generates a globally unique message identifier rooted in a domain.
 *
 * The identifier is a random UUID followed by `@` and the domain, which makes
 * it unique within the scope RFC 5322 §3.6.4 asks the generator to ensure.
 * The same construction is used for attachment content IDs.
 *
 * The domain has to be a valid identifier right-hand side: a dot-atom such as
 * `example.com` or an address literal such as `[192.0.2.1]`.  A URL, a host
 * with a port, or a value carrying whitespace is rejected.  A domain written
 * in a non-Latin script is converted to its ASCII (Punycode) form so that the
 * *generated* identifier travels through mail software that predates RFC 6532;
 * a non-ASCII domain that is not a DNS name is kept as it is.  An identifier
 * supplied by a caller is never rewritten this way.
 *
 * @example
 * ```ts
 * import { generateMessageId } from "@alexify/mailer";
 * const messageId = generateMessageId("example.com");
 * // "1e2ee2e1-…-…@example.com"
 * ```
 *
 * @param domain The domain the identifier is rooted in.
 * @param options `generateId`, which makes the left half instead of a UUID.
 * @returns A bare message identifier, without angle brackets.
 * @throws {TypeError} If the domain is not a valid identifier right-hand side,
 *                     or `generateId` returns no dot-atom-text.
 */
export declare function generateMessageId(domain: string, options?: IdOptions): string;

/**
 * What an identifier the library generates is for: the left half of a
 * Message-ID or a Content-ID, the idempotency key of a request, or the
 * message ID of a receipt that a provider did not give one for.
 */
export type IdKind = 'message-id' | 'content-id' | 'idempotency-key' | 'receipt-id';
/**
 * Makes the identifiers the library would otherwise draw from
 * `crypto.randomUUID()`, such as a cuid2, a ULID or a nanoid, to correlate
 * them with the records of the application.  For a Message-ID or a
 * Content-ID it returns the left half only, and the library adds `@` and the
 * domain.  What it returns is checked: dot-atom-text for those two kinds, and
 * printable ASCII without spaces, at most 256 characters, for every kind;
 * anything else is a `TypeError` before a message is sent.
 */
export type IdGenerator = (kind: IdKind) => string;
/**
 * A log level, by pino's names.
 */
export type LoggerLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
/**
 * A log method that takes the structured properties first and the message
 * second, as pino's do.
 */
export type LogMethod = (properties: object, message: string) => unknown;
/**
 * A pino-like logger: a pino logger, a child of one
 * (`logger.child({ component: 'mail' })`), or anything with the methods of the
 * levels it is used with.  `child` and `isLevelEnabled`, which pino has, are
 * used when present: the first to bind the transport to every record, the
 * second to skip building one that would not be written.
 */
export interface Logger {
  readonly trace?: LogMethod;
  readonly debug?: LogMethod;
  readonly info?: LogMethod;
  readonly warn?: LogMethod;
  readonly error?: LogMethod;
  readonly fatal?: LogMethod;
  readonly child?: (bindings: object) => Logger;
  readonly isLevelEnabled?: (level: string) => boolean;
}
/**
 * What a transport may be given in place of a global of the runtime: the
 * generator of its identifiers, its logger and, for one that makes HTTP
 * requests, the `fetch` it makes them with.
 */
export interface TransportDependencies extends IdOptions {
  /**
   * A logger for what happens inside the transport, which its receipts do
   * not tell: the connections, upgrades and authentication of SMTP, the
   * retries of a request, a selector that throws (`debug`, `trace` for the
   * SMTP protocol, `warn` for a degradation).  The failures of messages are
   * in their receipts and are not logged again.  Without a logger the
   * transport writes nothing, except a warning through `console.warn` when it
   * sends mail without TLS or without the DKIM signature it was asked for.
   * Credentials and addresses are never logged.
   */
  readonly logger?: Logger;
  /**
   * The `fetch` of the requests, such as one bound to an undici `Agent` with
   * keep-alive and connection limits, a `ProxyAgent` or mTLS:
   * `(url, init) => undiciFetch(url, { ...init, dispatcher })`.  It is read at
   * each request, so a later replacement of the global one is seen too.  It
   * must take a streamed body with `duplex: 'half'` for the raw uploads of JMAP.
   * @default globalThis.fetch
   */
  readonly fetch?: typeof globalThis.fetch;
}
/**
 * Options of the functions and transports that generate identifiers.
 */
export interface IdOptions {
  /**
   * The generator of the identifiers.
   * @default () => crypto.randomUUID()
   */
  readonly generateId?: IdGenerator;
}
/**
 * Parses a message identifier, with or without the enclosing angle brackets,
 * into its bare form.
 *
 * This is the inverse of {@link formatMessageId}, and it returns `undefined`
 * rather than throwing, the way {@link parseAddress} does.
 *
 * It parses *one* identifier.  An `In-Reply-To` or `References` field arriving
 * from elsewhere may hold several identifiers, comments, folded whitespace, and
 * obsolete syntax, none of which this function accepts; splitting such a field
 * is the caller's job.
 *
 * @example
 * ```ts
 * import { parseMessageId } from "@alexify/mailer";
 * parseMessageId("<abc@example.com>");  // "abc@example.com"
 * parseMessageId("not an identifier");  // undefined
 * ```
 *
 * @param value The identifier to parse.
 * @returns The bare identifier, or `undefined` if the value is not one.
 */
export declare function parseMessageId(value: string): string | undefined;
/**
 * Formats a bare message identifier for a header field, by enclosing it in
 * angle brackets.
 *
 * This is the inverse of {@link parseMessageId}.  It takes the *bare* form, so
 * an already enclosed identifier is rejected rather than enclosed twice.  What
 * it guarantees is syntax; a header field also has to fit the line-length limit
 * the serializing transport enforces.
 *
 * @example
 * ```ts
 * import { formatMessageId } from "@alexify/mailer";
 * formatMessageId("abc@example.com");  // "<abc@example.com>"
 * ```
 *
 * @param id The bare identifier to format.
 * @returns The identifier enclosed in angle brackets.
 * @throws {TypeError} If the value is not a valid bare identifier.
 */
export declare function formatMessageId(id: string): string;
/**
 * Works out the reply threading header fields a transport should write for a
 * message, from {@link Message.inReplyTo} and {@link Message.references}.
 *
 * The three states those fields can be in map onto the result like this:
 *
 *  -  A field the message leaves unset is absent from the map.  The message
 *     does not own the header, so a transport may still write one supplied
 *     through {@link Message.headers}.
 *  -  A field set to an empty list maps to `null`.  The message owns the
 *     header and deliberately writes nothing, which suppresses a custom header
 *     of the same name.
 *  -  A field with identifiers in it maps to the formatted field value.
 *
 * Keys are the canonical field names, `In-Reply-To` and `References`.  A header
 * field name is case insensitive, so compare accordingly when deciding whether
 * a custom header is shadowed.
 *
 * @example
 * ```ts
 * import { resolveThreadingHeaders } from "@alexify/mailer";
 * // for a message replying to <122@example.com>:
 * // Map { "In-Reply-To" => "<122@example.com>" }
 * ```
 *
 * @param message The message being converted.
 * @returns The header fields the message owns, keyed by canonical name.
 * @throws {TypeError} If the message carries an invalid identifier.
 */
export declare function resolveThreadingHeaders(
  message: Message,
): ReadonlyMap<string, string | null>;

/**
 * The priority levels for email messages.
 */
export type Priority = 'high' | 'normal' | 'low';
/**
 * Compares two priority levels and returns a number indicating their
 * relative order.
 *
 * @example Sorting priorities
 * ```ts
 * import { comparePriority, type Priority } from "@alexify/mailer";
 * const priorities: Priority[] = ["normal", "low", "high"];
 * priorities.sort(comparePriority);
 * console.log(priorities); // ["high", "normal", "low"]
 * ```
 *
 * @param a The first priority to compare.
 * @param b The second priority to compare.
 * @return A negative number if `a` is less than `b`, a positive number
 *         if `a` is greater than `b`, and zero if they are equal.
 */
export declare function comparePriority(a: Priority, b: Priority): number;

/**
 * A machine-readable category for an email delivery failure.
 *
 * `validation` and `rejected` say that the message itself was refused: no
 * transport would take it, so `./pool` stops failing over.  `unsupported`
 * says that this transport cannot send the message as it is, a field it
 * cannot express (`scheduledAt`, a second tag) or a limit of its provider
 * (recipients, attachments): another transport may, so `./pool` fails over
 * with it.  Neither is retried.
 */
export type ReceiptErrorCategory =
  | 'auth'
  | 'rate-limit'
  | 'network'
  | 'timeout'
  | 'validation'
  | 'rejected'
  | 'unsupported'
  | 'server-error'
  | 'service-unavailable'
  | 'configuration'
  | 'unknown';
/**
 * Structured information about an email delivery failure.
 */
export interface ReceiptError<TProviderId extends string = string> {
  /**
   * Human-readable error message.
   */
  readonly message: string;
  /**
   * Machine-readable provider or protocol error code.
   */
  readonly code: string;
  /**
   * Coarse error category for programmatic handling.
   */
  readonly category: ReceiptErrorCategory;
  /**
   * Whether retrying the same message may succeed.
   */
  readonly retryable: boolean;
  /**
   * Provider or transport that produced this error.
   */
  readonly provider?: TProviderId;
  /**
   * HTTP status code, when the failure came from an HTTP API.
   */
  readonly statusCode?: number;
  /**
   * Provider-supplied retry delay in milliseconds, when available.
   */
  readonly retryAfterMilliseconds?: number;
  /**
   * Provider-specific error details, when available.
   */
  readonly providerDetails?: unknown;
}
/**
 * The response from the email service after sending an email message.
 *
 * This type uses a discriminated union to ensure type safety:
 *
 * - Successful sends have a `messageId` but no `errorMessages`
 * - Failed sends have `errorMessages` but no `messageId`
 *
 * Failed receipts may also include structured `errors` and summary metadata
 * for programmatic error handling.
 */
export type Receipt<TProviderId extends string = string> =
  | {
      /**
       * Indicates that the email was sent successfully.
       */
      readonly successful: true;
      /**
       * The delivery handle the transport or the provider reports back, such as
       * an SMTP queue identifier, a provider-assigned UUID, or a JMAP submission
       * id.  Its shape differs between transports.
       *
       * This is not the RFC 5322 `Message-ID` of the message; that one is chosen
       * by the sender and lives on {@link Message.messageId}.  Use this to look a
       * delivery up with the provider, and that one to correlate a reply.
       */
      readonly messageId: string;
      /**
       * Provider or transport that produced this receipt.
       */
      readonly provider?: TProviderId;
      /**
       * Number of attempts made before this receipt was produced.
       */
      readonly attempts?: number;
      /**
       * ISO 8601 timestamp for when this receipt was produced.
       */
      readonly timestamp?: string;
    }
  | {
      /**
       * Indicates that the email failed to send.
       */
      readonly successful: false;
      /**
       * An array of error messages that occurred during the sending process.
       */
      readonly errorMessages: readonly string[];
      /**
       * Structured errors for programmatic handling.
       */
      readonly errors?: readonly ReceiptError<TProviderId>[];
      /**
       * Whether retrying the same message may succeed.
       */
      readonly retryable?: boolean;
      /**
       * `true` when the transport cannot tell whether the message was
       * accepted: the request or the message data went out, but no usable
       * answer came back (a timeout or a lost connection after the request
       * went out or after the end of `DATA`, a 2xx that could not be read, a
       * gateway timeout).
       * Sending it again may deliver it twice, so such a receipt is never
       * retryable, `./retry` does not retry it and `./pool` does not pass it
       * to another transport; reconcile it from the provider's delivery
       * events instead.
       */
      readonly deliveryUnknown?: boolean;
      /**
       * Provider or transport that produced this receipt.
       */
      readonly provider?: TProviderId;
      /**
       * Number of attempts made before this receipt was produced.
       */
      readonly attempts?: number;
      /**
       * ISO 8601 timestamp for when this receipt was produced.
       */
      readonly timestamp?: string;
    };
/**
 * Result of classifying a delivery failure.
 */
export interface ReceiptErrorClassification {
  readonly category: ReceiptErrorCategory;
  readonly retryable: boolean;
  readonly code?: string;
}
/**
 * Options for creating a structured receipt error.
 */
export interface CreateReceiptErrorOptions<TProviderId extends string = string> {
  readonly code?: string;
  readonly category?: ReceiptErrorCategory;
  readonly retryable?: boolean;
  readonly provider?: TProviderId;
  readonly statusCode?: number;
  readonly retryAfterMilliseconds?: number;
  readonly providerDetails?: unknown;
}
/**
 * Options for creating a failed receipt.
 */
export interface CreateFailedReceiptOptions<
  TProviderId extends string = string,
> extends CreateReceiptErrorOptions<TProviderId> {
  readonly errors?: readonly ReceiptError<TProviderId>[];
  readonly attempts?: number;
  readonly timestamp?: string;
  /**
   * Marks the delivery as unknown; the receipt and the errors made for it are
   * then not retryable.  See {@link Receipt}.
   */
  readonly deliveryUnknown?: boolean;
}
/**
 * Classifies an HTTP status code for delivery error handling.
 *
 * @param statusCode The HTTP status code to classify.
 * @returns The receipt error category and retryability.
 */
export declare function classifyHttpStatus(statusCode: number): ReceiptErrorClassification;
/**
 * Classifies an arbitrary delivery failure: by the HTTP `statusCode` it
 * carries, then by the system `code` along its causes (a refused connection,
 * a timeout, a rejected certificate), and only then by the words of its
 * message, where a status code counts as a whole number only.
 *
 * @param error The error to classify.
 * @returns The receipt error category, retryability, and default code.
 */
export declare function classifyReceiptError(error: unknown): Required<ReceiptErrorClassification>;
/**
 * Creates structured information about a delivery failure.
 *
 * @param message Human-readable error message.
 * @param options Optional structured error metadata.
 * @returns A structured receipt error.
 */
export declare function createReceiptError<TProviderId extends string = string>(
  message: string,
  options?: CreateReceiptErrorOptions<TProviderId>,
): ReceiptError<TProviderId>;
/**
 * Creates a failed receipt with human-readable and structured errors.
 *
 * @param error Error message, structured error, or list of structured errors.
 * @param options Optional receipt and error metadata.
 * @returns A failed receipt.
 */
export declare function createFailedReceipt<TProviderId extends string = string>(
  error: string | readonly (string | ReceiptError<TProviderId>)[] | ReceiptError<TProviderId>,
  options?: CreateFailedReceiptOptions<TProviderId>,
): Receipt<TProviderId> & {
  readonly successful: false;
};
/**
 * Parses an HTTP `Retry-After` header value into milliseconds.  A delay
 * longer than a day is read as a day.
 *
 * @param value Header value to parse.
 * @param now Current time used when parsing HTTP dates.
 * @returns Retry delay in milliseconds, or `undefined` if invalid.
 */
export declare function parseRetryAfter(
  value: string | null | undefined,
  now?: Date,
): number | undefined;

/**
 * A common interface for email sending services.
 */
export interface Transport<TProviderId extends string = string> {
  /**
   * Stable provider identifier for receipts produced by this transport.
   */
  readonly id: TProviderId;
  /**
   * Sends a single message using the email service.
   * @param message The message to send.
   * @param options Optional parameters for sending the message.
   * @returns A promise that resolves to a receipt containing the result of
   *          the send operation.
   */
  send(message: Message, options?: TransportOptions): Promise<Receipt<TProviderId>>;
  /**
   * Sends multiple messages using the email service.
   * @param messages An iterable of messages to send.
   * @param options Optional parameters for sending the messages.
   * @return An async iterable that yields receipts for each sent message.
   */
  sendMany(
    messages: Iterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<TProviderId>>;
  /**
   * Sends multiple messages using the email service.
   * @param messages An async iterable of messages to send.
   * @param options Optional parameters for sending the messages.
   * @return An async iterable that yields receipts for each sent message.
   */
  sendMany(
    messages: AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<TProviderId>>;
}
/**
 * Options for operations on the email service.
 */
export interface TransportOptions {
  /**
   * The abort signal to cancel the operation if needed.
   */
  readonly signal?: AbortSignal;
  /**
   * Called before a request is sent again after a failure: by an HTTP
   * provider that retries its own requests (`retries`), and by the `./retry`
   * decorator.  The decorators pass it on to the transport they wrap, so one
   * callback hears the retries of every level.  An error it throws rejects
   * the send.  The JMAP transport calls it for the reads it retries, such as
   * its discovery; it never sends a submission again.
   */
  readonly onRetry?: (event: RetryEvent) => void;
}
/**
 * A retry about to happen, as {@link TransportOptions.onRetry} is told of it.
 */
export interface RetryEvent {
  /**
   * The attempt that failed, from 1.
   */
  readonly attempt: number;
  /**
   * How long the transport waits before the next attempt, in milliseconds.
   */
  readonly delayMilliseconds: number;
  /**
   * Why: the error of the failed request, such as the API error of a provider
   * with its `statusCode`, or, from `./retry`, the error a send threw or the
   * first `ReceiptError` of the receipt it returned.
   */
  readonly error: unknown;
}
/**
 * What a provider says happened to a message, as `./webhooks` reads it from
 * its events: `accepted` by the provider, `delivered` to the recipient's
 * server, `deferred` while it retries, `bounced`, `rejected` without an attempt
 * (a suppressed address, a refused message), `complained` as spam,
 * `unsubscribed`, `opened` and `clicked`; `unknown` for an event the model
 * has no name for, kept with its `raw` record.
 */
export type DeliveryEventType =
  | 'accepted'
  | 'delivered'
  | 'deferred'
  | 'bounced'
  | 'complained'
  | 'rejected'
  | 'opened'
  | 'clicked'
  | 'unsubscribed'
  | 'unknown';
/**
 * How a recipient bounced: `hard` for good (an address that does not exist),
 * `soft` for now (a full mailbox), `undetermined` when the provider does not
 * say.
 */
export interface DeliveryBounce {
  readonly kind: 'hard' | 'soft' | 'undetermined';
  /** The status the provider gives, such as `5.1.1` or `550`. */
  readonly code?: string;
  /** The reply of the recipient's server, or the provider's description. */
  readonly diagnostic?: string;
}
/**
 * One event of one message for one recipient, from a provider's webhook.
 * An event of several recipients is as many events.
 */
export interface DeliveryEvent<TProviderId extends string = string> {
  /** The provider that told it. */
  readonly provider: TProviderId;
  /** What happened. */
  readonly type: DeliveryEventType;
  /**
   * The id of the event, the same each time the provider sends it again:
   * the provider's own, with the place of the recipient when one event
   * holds several.
   */
  readonly id: string;
  /**
   * The provider's id of the message, the `messageId` of its receipt, so an
   * event finds the send it belongs to.
   */
  readonly messageId?: string;
  /**
   * The Message-ID of the message as the provider reports it, when the event
   * carries it (SES, SendGrid, Mailgun, MailerSend, SMTP2GO, Scaleway).  The
   * HTTP APIs write a Message-ID of their own, so it is not the one a
   * message was given; to find the events of a message, use
   * `correlationId`.
   */
  readonly rfcMessageId?: string;
  /**
   * The `correlationId` of the message's `metadata`, which the providers
   * that keep metadata (all but Azure) give back with its events: what a
   * receipt of unknown delivery, which has no `messageId` of the provider,
   * finds its events by.
   */
  readonly correlationId?: string;
  /**
   * The recipient, when the event names one, its domain in lower case so
   * that an address reads the same in the events of every provider.
   */
  readonly recipient?: string;
  /** When it happened, as the provider tells it. */
  readonly occurredAt?: Date;
  /** How the recipient bounced, for `bounced` and for a `deferred` bounce. */
  readonly bounce?: DeliveryBounce;
  /** Why, for a rejection, a deferral or a bounce, as the provider words it. */
  readonly reason?: string;
  /** The link of a click. */
  readonly url?: string;
  /** The tags of the message, as the transport sent them. */
  readonly tags: readonly string[];
  /** The metadata of the message, as the transport sent it. */
  readonly metadata: Readonly<Record<string, string>>;
  /** The provider's record the event was read from. */
  readonly raw: unknown;
}
// ─── Contracts of the reliability layer ──────────────────────────────────────

/**
 * The state of a message on its way: `queued` (and again before each
 * attempt after a failed one), `rendered`, `submitted` (handed to the
 * transport), `accepted` by the provider, then `delivered`, `bounced` or
 * `complained` as its events tell; `failed` when no attempt will be made
 * again, and `delivery_unknown` when an attempt may have been taken, which
 * only its events can settle.
 */
export type MessageState =
  | 'queued'
  | 'rendered'
  | 'submitted'
  | 'accepted'
  | 'delivered'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'delivery_unknown';
/** Why an attempt failed, in an audit event: no address in it. */
export interface AuditError {
  readonly category: ReceiptErrorCategory;
  readonly code: string;
  /** Its text, the addresses in it redacted. */
  readonly message: string;
  readonly retryable: boolean;
}
/**
 * One change of the state of a message, as `./queue` and `./audit` record it.
 * It holds no recipient: the message is found by `correlationId`.
 */
export interface AuditEvent {
  /**
   * The same for the same change, so that a sink can write it once however
   * often it is told: a job run again or a webhook delivered again.
   */
  readonly id: string;
  readonly state: MessageState;
  /** When, in ISO 8601. */
  readonly at: string;
  readonly source: 'producer' | 'worker' | 'webhook';
  /** What the events of one message share, from the queue to the webhooks. */
  readonly correlationId: string;
  /** The job of the queue; absent on the events of a webhook. */
  readonly jobId?: string;
  readonly tenantId?: string;
  /** The attempt, from 1; 0 at enqueue and for the events of a webhook. */
  readonly attempt: number;
  /** The SHA-256 of the job, as enqueued. */
  readonly payloadHash?: string;
  /** The SHA-256 of the message as rendered, as `./idempotency` takes it. */
  readonly messageHash?: string;
  /** The Message-ID. */
  readonly messageId?: string;
  readonly provider?: string;
  /** The provider's id of the message: the `messageId` of its receipt. */
  readonly providerMessageId?: string;
  readonly priority?: Priority;
  readonly template?: string;
  readonly tags?: readonly string[];
  readonly error?: AuditError;
  /** When the next attempt is due, for a message queued again. */
  readonly retryAt?: string;
  /** A run of an attempt a stopped worker did not finish. */
  readonly redelivered?: boolean;
  /** The event of the provider a webhook state comes from. */
  readonly deliveryEvent?: {
    readonly type: DeliveryEventType;
    readonly id: string;
    readonly bounce?: DeliveryBounce;
  };
}
/** What a sink is told with an event. */
export interface AuditContext {
  /** The transaction of the store, for a sink that writes in the one of the enqueue. */
  readonly transaction?: unknown;
}
/** Where audit events go: append-only, an event written once by its `id`. */
export interface AuditSink {
  append(event: AuditEvent, context?: AuditContext): void | Promise<void>;
  /** Appends several events in one write where it can (a bulk write): a queue's batch. */
  appendMany?(events: readonly AuditEvent[], context?: AuditContext): void | Promise<void>;
  /**
   * Whether an event of this id was written: lets a worker tell a run that
   * submitted its message before it died (the ids are deterministic).
   */
  has?(id: string): boolean | Promise<boolean>;
}

/** A value of JSON. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;
/** An object of JSON. */
export interface JsonObject {
  readonly [key: string]: JsonValue | undefined;
}
/** A job as a producer hands it to a queue driver. */
export interface QueueJobRequest {
  /** 1 to 128 printable ASCII characters, no `:`, not all digits: a key every driver takes. */
  readonly id: string;
  /** The kind of the job: `mail`. */
  readonly name: string;
  readonly data: JsonObject;
  /** The SHA-256 of `data`, which tells a job enqueued again from another under the same id. */
  readonly hash: string;
  readonly priority: Priority;
  /** The attempts in all, the first included, at least 1. */
  readonly maxAttempts: number;
  /** Not run before this time, in milliseconds since the epoch. */
  readonly availableAt?: number;
  /** When it was enqueued, in milliseconds since the epoch. */
  readonly enqueuedAt: number;
  /** Its id comes from a key of the caller's: an enqueue again is expected, and told. */
  readonly unique: boolean;
  /** The tenant of the job: a source may share its lanes among tenants, and pause one. */
  readonly tenantId?: string;
}
/** The options of an enqueue. */
export interface QueueEnqueueOptions {
  readonly signal?: AbortSignal;
  /** The transaction of the store (a session of MongoDB for an outbox); a driver without one throws. */
  readonly transaction?: unknown;
}
/** What a driver says of an enqueue. */
export interface QueueEnqueueResult {
  readonly id: string;
  /** true: the driver still holds a job of that id, and nothing was added; undefined: it cannot tell. */
  readonly duplicate: boolean | undefined;
  /** The hash of the job held, when it is a duplicate and the driver read it. */
  readonly existingHash?: string;
}
/** One run of a job, as a handler is given it. */
export interface QueueJob {
  readonly id: string;
  readonly name: string;
  /** As stored: whoever can write to the store may have written it, so it is checked. */
  readonly data: unknown;
  /** The attempt of this run, from 1. */
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly enqueuedAt?: number;
  /** A run of this attempt before did not finish: the worker stopped, or its lease ran out. */
  readonly redelivered: boolean;
  /**
   * How many runs of this job did not finish, never counted down: a job that
   * kills its worker each time is told by it. Absent from a source that does
   * not count them.
   */
  readonly redeliveries?: number;
  /** The tenant of the job, from its request, where the source keeps it. */
  readonly tenantId?: string;
}
/** What a handler makes of a run of a job. */
export type QueueOutcome =
  | { readonly type: 'ack'; readonly result?: JsonObject }
  /** The attempt is spent; the job runs again after the delay. `queue`: the whole queue waits (a rate limit). */
  | {
      readonly type: 'retry';
      readonly delayMilliseconds: number;
      readonly code: string;
      readonly reason: string;
      /** `queue`: the whole queue waits; `tenant`: the jobs of the job's tenant wait. */
      readonly scope?: 'job' | 'queue' | 'tenant';
    }
  /** No attempt again: the job is failed for good. */
  | { readonly type: 'fail'; readonly code: string; readonly reason: string }
  /** Not attempted (a shutdown, a lease lost before the send): back to the queue, no attempt spent. */
  | { readonly type: 'release'; readonly delayMilliseconds?: number };
/** Runs a job; it does not throw, and one that does is retried after the driver's delay. */
export type QueueHandler = (job: QueueJob, signal: AbortSignal) => Promise<QueueOutcome>;
/** The options of `consume()`. */
export interface QueueConsumeOptions {
  /** The jobs run at once. @default 1 */
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
  /**
   * The sink a driver tells of a job it gave up itself, which the handler
   * never settled (BullMQ's job stalled too often): `delivery_unknown`. A
   * mail queue's worker passes the queue's.
   */
  readonly audit?: AuditSink;
}
/** The options of closing a consumer. */
export interface QueueCloseOptions {
  /** How long the jobs in flight are waited for before their signals abort. @default 30000 */
  readonly timeoutMilliseconds?: number;
}
/** A consumer of a queue. */
export interface QueueConsumer {
  close(options?: QueueCloseOptions): Promise<void>;
}
/** A queue: BullMQ, a store's outbox, the memory one of the tests. */
export interface QueueDriver {
  readonly id: string;
  /**
   * true: `enqueue` writes in the `transaction` of its options, as an outbox
   * does. A driver without it refuses a transaction, which would not hold
   * the job with the application's writes.
   */
  readonly transactional?: boolean;
  enqueue(request: QueueJobRequest, options?: QueueEnqueueOptions): Promise<QueueEnqueueResult>;
  enqueueMany?(
    requests: readonly QueueJobRequest[],
    options?: QueueEnqueueOptions,
  ): Promise<readonly QueueEnqueueResult[]>;
  consume(handler: QueueHandler, options?: QueueConsumeOptions): QueueConsumer;
  close?(): Promise<void>;
}
/** A job a source lent: settled under its token. */
export interface QueueLease {
  readonly job: QueueJob;
  readonly token: string;
}
/** Why a job is retried or failed. */
export interface QueueFailure {
  readonly code: string;
  readonly reason: string;
}
/**
 * A queue that is read by lending its jobs, as a store's outbox is: what
 * `createPollingDriver` of `./queue` makes a driver of.  A settle under a
 * token that is no longer the job's does nothing.
 */
export interface QueueSource {
  readonly id: string;
  enqueue(request: QueueJobRequest, options?: QueueEnqueueOptions): Promise<QueueEnqueueResult>;
  /**
   * Lends the next ready job (by priority, then time, then order) for
   * `leaseMilliseconds`, its attempt counted; or tells when the next one is
   * due.
   */
  reserve(
    leaseMilliseconds: number,
  ): Promise<{ readonly lease?: QueueLease; readonly nextAvailableAt?: number }>;
  /** false: the lease was lost (it ran out, another took it). */
  extend(lease: QueueLease, leaseMilliseconds: number): Promise<boolean>;
  /**
   * Settles the job of a lease. Each settling write is fenced by the token:
   * `false` when the lease was lost and nothing was written (another worker
   * holds the job, and what this run did may be done twice).
   */
  ack(lease: QueueLease, result?: JsonObject): Promise<boolean | void>;
  retry(lease: QueueLease, availableAt: number, failure: QueueFailure): Promise<boolean | void>;
  fail(lease: QueueLease, failure: QueueFailure): Promise<boolean | void>;
  /** Back to ready at `availableAt` (now by default), its attempt not counted. */
  release(lease: QueueLease, availableAt?: number): Promise<boolean | void>;
  /** The whole queue waits until then; without it, a retry of the queue is one of the job. */
  pause?(until: number, scope?: { readonly tenantId?: string }): Promise<void>;
  /** Ends a pause of the whole queue, or of one tenant's jobs, before its time. */
  resume?(scope?: { readonly tenantId?: string }): Promise<void>;
  /** Wakes the readers when a job may be ready: an enqueue, a change stream. */
  subscribe?(listener: () => void): () => void;
}
/**
 * Optional capability for delivering already serialized MIME messages.
 * Wrappers must explicitly preserve this capability to expose it themselves.
 */
export interface RawTransport<TProviderId extends string = string> extends Transport<TProviderId> {
  /**
   * Delivers original MIME bytes using an explicit envelope.
   * @param message The serialized message and its delivery envelope.
   * @param options Optional cancellation signal.
   * @returns A delivery receipt; server-side processing may modify the message.
   * @throws {Error} If cancellation is requested.
   */
  sendRaw(message: RawMessage, options?: TransportOptions): Promise<Receipt<TProviderId>>;
}
/**
 * Checks whether a transport exposes raw MIME delivery.
 * @param transport The transport to inspect.
 * @returns Whether the transport implements the optional raw capability.
 */
export declare function isRawTransport<TProviderId extends string>(
  transport: Transport<TProviderId>,
): transport is RawTransport<TProviderId>;
/**
 * Optional capability for checking setup without sending a message.
 * Success describes the configuration at verification time, not acceptance of
 * any particular sender, recipient, message, or eventual delivery. Wrappers
 * must explicitly preserve this capability to expose it themselves.
 */
export interface VerifiableTransport<
  TProviderId extends string = string,
> extends Transport<TProviderId> {
  /**
   * Checks connectivity, configured authentication, and transport prerequisites.
   * @param options Optional cancellation signal.
   * @returns A promise that resolves when verification succeeds.
   * @throws {Error} If setup or verification fails; errors are transport-specific.
   * @throws The caller's abort reason if the operation is cancelled.
   */
  verify(options?: TransportOptions): Promise<void>;
}
/**
 * Checks whether a transport exposes configuration verification.
 * @param transport The transport to inspect.
 * @returns Whether the transport implements the optional verification capability.
 */
export declare function isVerifiableTransport<TProviderId extends string>(
  transport: Transport<TProviderId>,
): transport is VerifiableTransport<TProviderId>;

/** Replayable, already serialized MIME bytes. @since 0.6.0 */
export type RawMessageContent = AttachmentContent;
/**
 * Transport requirements of serialized bytes, not a request to transcode them.
 * With `8bit`, the caller guarantees ASCII MIME headers, including nested
 * parts. Upyo checks only the top-level headers and does not parse nested MIME.
 * `utf8` permits internationalized headers. Neither permits NUL or binary MIME
 * transfer.
 */
export type RawMessageEncoding = '7bit' | '8bit' | 'utf8';
/** Delivery addresses independent of the MIME headers. @since 0.6.0 */
export interface RawMessageEnvelope {
  /** Envelope sender, or null for a null reverse-path. */
  readonly from: EmailAddress | null;
  /** Nonempty list of envelope recipients, including any blind copies. */
  readonly to: readonly EmailAddress[];
}
/**
 * An already serialized message. The source must use CRLF, including its final
 * line ending, contain no NUL, and have lines of at most 998 octets. Headers
 * must not be empty; a body is optional. Upyo does not repair or compose MIME.
 */
export interface RawMessage {
  /** Explicit delivery addresses; never inferred from message headers. */
  readonly envelope: RawMessageEnvelope;
  /** Fresh, independent readers must reproduce identical bytes on every call. */
  readonly content: RawMessageContent;
  /**
   * With an explicit encoding, delivery reads the source once. Otherwise it
   * reads twice: analysis, then transmission. Any non-ASCII byte conservatively
   * selects `utf8`, even in a body that could be sent using `8bit`.
   */
  readonly encoding?: RawMessageEncoding;
}
/** Invalid raw-message metadata or wire structure. @since 0.6.0 */
export declare class RawMessageValidationError extends TypeError {
  /** The invalid message field. */
  readonly field: 'envelope' | 'content' | 'encoding';
  /** Zero-based byte offset, when the error refers to content. */
  readonly byteOffset?: number;
  /** One-based line number, when the error refers to content. */
  readonly lineNumber?: number;
  /**
   * Creates a raw-message validation error.
   * @param message Description of the failure.
   * @param field The invalid field.
   * @param byteOffset Optional zero-based content offset.
   * @param lineNumber Optional one-based line number.
   */
  constructor(
    message: string,
    field: 'envelope' | 'content' | 'encoding',
    byteOffset?: number,
    lineNumber?: number,
  );
}
/** @internal */
export interface RawMessagePlan extends RawMessage {
  /** Known byte length, excluding protocol framing. */
  readonly size?: number;
}
/**
 * Snapshots metadata and observes promised bytes before any asynchronous work.
 * @param message The raw message to validate.
 * @returns A replayable plan with a copied envelope.
 * @throws {RawMessageValidationError} If metadata or the source kind is invalid.
 * @internal
 */
export declare function createRawMessagePlan(message: RawMessage): RawMessagePlan;
/** @internal */
export interface RawMessageAnalysis {
  readonly size: number;
  readonly encoding: RawMessageEncoding;
}
/** @internal */
export interface RawMessageReadOptions {
  readonly signal?: AbortSignal;
  readonly expectedSize?: number;
  readonly encoding?: RawMessageEncoding;
  readonly onProgress?: (analysis: RawMessageAnalysis) => void;
}
/**
 * Validates and yields at most 32 KiB per chunk, without prefetching. Chunks
 * remain valid until the next read; HTTP consumers must copy before enqueueing.
 * The source's own errors and cancellation reasons are preserved.
 * @param plan Validated metadata and replayable source.
 * @param options Cancellation, analysis observations, and transmission checks.
 * @returns Original bytes in bounded windows.
 * @throws {RawMessageValidationError} If wire structure or encoding is invalid.
 * @throws {Error} If the source fails or reading is cancelled.
 * @internal
 */
export declare function iterateRawMessage(
  plan: RawMessagePlan,
  options?: RawMessageReadOptions,
): AsyncIterable<Uint8Array>;
/**
 * Analyzes one complete traversal without retaining the message in memory.
 * @param plan Validated metadata and replayable source.
 * @param signal Cancellation signal.
 * @param onProgress Optional incremental observations, also allowed to reject.
 * @returns The byte length and conservative transport encoding.
 * @throws {RawMessageValidationError} If the raw content is invalid.
 * @throws {Error} If the source or progress callback fails, or reading is cancelled.
 * @internal
 */
export declare function analyzeRawMessage(
  plan: RawMessagePlan,
  signal?: AbortSignal,
  onProgress?: (analysis: RawMessageAnalysis) => void,
): Promise<RawMessageAnalysis>;
