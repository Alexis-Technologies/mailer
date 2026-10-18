// Not ported: the errors of ./templates.  Each has a stable `code` and
// `retryable: false`, so that a queue fails a job whose template is missing
// or does not render at once, rather than retrying what fails again the same
// way; a queue reads the code, which holds across two copies of the package.

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

module.exports = { TemplateNotFoundError, TemplateRenderError };
