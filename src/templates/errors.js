// Not ported: the errors of ./templates.  Each has a stable `code`, which a
// queue reads, as it holds across two copies of the package.  A template that
// is missing or does not render has `retryable: false`, so that a queue fails
// its job at once rather than retrying what fails again the same way; a
// loader that fails may pass on another attempt.

// The names a message lists, of all those tried.
const MAX_NAMES = 8;

const listOf = (names) => {
  let text = '';
  const count = names.length < MAX_NAMES ? names.length : MAX_NAMES;
  for (let index = 0; index < count; index++) {
    text += index === 0 ? names[index] : `, ${names[index]}`;
  }
  return names.length > MAX_NAMES ? `${text} and ${names.length - MAX_NAMES} more` : text;
};

/**
 * No template, include, partial or layout by that name.
 */
class TemplateNotFoundError extends Error {
  /**
   * @param template The name asked for.
   * @param tried The names looked up, in order.
   * @param options `from`, the template that included it, and `cause`.
   */
  constructor(template, tried, options = {}) {
    const from = options.from === undefined ? '' : ` (included by ${options.from})`;
    const looked = tried.length === 0 ? '' : `: tried ${listOf(tried)}`;
    super(`No template ${JSON.stringify(template)}${from}${looked}.`, options);
    this.name = 'TemplateNotFoundError';
    this.code = 'MAILER_TEMPLATE_NOT_FOUND';
    this.retryable = false;
    this.template = template;
    if (options.from !== undefined) this.from = options.from;
    this.tried = Object.freeze([...tried]);
  }
}

/**
 * A template that does not render: its syntax, a value it cannot read, a
 * helper that threw, MJML that does not validate.  The engine's error is its
 * cause.
 */
class TemplateRenderError extends Error {
  /**
   * @param template The template that failed.
   * @param phase Where: `front-matter`, `compile`, `render`, `layout`,
   * `finish` or `inline-css`.
   * @param message What happened.
   * @param options `engine`, the name of the engine, and `cause`.
   */
  constructor(template, phase, message, options = {}) {
    super(`The template ${JSON.stringify(template)} failed to ${phase}: ${message}`, options);
    this.name = 'TemplateRenderError';
    this.code = 'MAILER_TEMPLATE_RENDER';
    this.retryable = false;
    this.template = template;
    this.phase = phase;
    if (options.engine !== undefined) this.engine = options.engine;
  }
}

// The errors a loader throws for a bug of its own, or of its caller.
const BUGS = [TypeError, RangeError, ReferenceError, SyntaxError];

const isBug = (error) => {
  for (const type of BUGS) {
    if (error instanceof type) return true;
  }
  return false;
};

/**
 * A loader that failed to read a template: a file system that refused it, a
 * database that timed out.  The loader's error is its cause.  It is
 * retryable, as it may pass on another attempt, unless the loader's error is
 * a bug or says it is not, when `retryable` is left unset for a queue to
 * classify by the cause.
 */
class TemplateLoadError extends Error {
  /**
   * @param template The name the loader was asked for.
   * @param options `from`, the template that included it, and `cause`, the
   * loader's error.
   */
  constructor(template, options = {}) {
    const { cause } = options;
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`The template ${JSON.stringify(template)} failed to load: ${reason}`, options);
    this.name = 'TemplateLoadError';
    this.code = 'MAILER_TEMPLATE_LOAD';
    if (cause?.retryable !== false && !isBug(cause)) this.retryable = true;
    this.template = template;
    if (options.from !== undefined) this.from = options.from;
  }
}

/**
 * The missing template or the failed load an engine wrapped in its own
 * error: the error itself or one of its causes.
 *
 * @returns The error of ./templates, or `undefined` when there is none.
 * @internal
 */
const templateErrorOf = (error) => {
  let current = error;
  for (let depth = 0; depth < 8 && typeof current === 'object' && current !== null; depth++) {
    if (current instanceof TemplateNotFoundError || current instanceof TemplateLoadError) {
      return current;
    }
    current = current.cause;
  }
  return undefined;
};

module.exports = {
  TemplateLoadError,
  TemplateNotFoundError,
  TemplateRenderError,
  templateErrorOf,
};
