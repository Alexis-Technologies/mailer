// The types of the root entry of @alexify/mailer, written by hand: the message
// model and the transport contract (src/core/), ported from @upyo/core 0.7.0
// (https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee).

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
 * @returns A new {@link Message} object with all properties normalized and
 *          validated.
 * @throws {TypeError} When any email address string cannot be parsed, when an
 *                     address or attachment carries a carriage return or line
 *                     feed that could forge header fields, when an attachment
 *                     object is invalid, when a message identifier is not
 *                     valid, when the date is not one RFC 5322 can express, or
 *                     when the calendar content is not a single well-formed
 *                     iCalendar object declaring one supported method.
 */
export declare function createMessage(constructor: MessageConstructor): Message;

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
 * @returns A bare message identifier, without angle brackets.
 * @throws {TypeError} If the domain is not a valid identifier right-hand side.
 */
export declare function generateMessageId(domain: string): string;
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
 */
export type ReceiptErrorCategory =
  | 'auth'
  | 'rate-limit'
  | 'network'
  | 'timeout'
  | 'validation'
  | 'rejected'
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
       * accepted: the request or the message data went out, but no answer
       * came back (a timeout or a closed connection after the end of `DATA`).
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
 * Classifies an arbitrary delivery failure.
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
