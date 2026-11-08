// Not ported: text of the application's own put into the markup of a channel
// as text, not markup: the HTML of Telegram, the mrkdwn of Slack and the
// Markdown of Discord, each escaped as its documentation says; and the
// mentions that notify a whole channel, which a text must not carry unless
// asked.

const TELEGRAM_HTML = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
]);
// Slack's mrkdwn needs these three alone; the angle brackets are what a link,
// a mention and `<!channel>` are made of.
const SLACK_TEXT = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
]);
// A backslash makes any of these literal in Discord's Markdown, wherever it
// stands: emphasis, code, spoilers, quotes, headings, lists and masked links.
const DISCORD_MARKDOWN = new Set([
  '\\',
  '*',
  '_',
  '~',
  '`',
  '|',
  '>',
  '#',
  '-',
  '[',
  ']',
  '(',
  ')',
]);

const LINE_START = 0;
const LINE_NUMBER = 1;
const LINE_OTHER = 2;

const replaceEach = (text, table) => {
  let result = '';
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const replacement = table.get(text[i]);
    if (replacement !== undefined) {
      result += text.slice(from, i) + replacement;
      from = i + 1;
    }
  }
  return from === 0 ? text : result + text.slice(from);
};

/**
 * A text for the HTML of Telegram (`parse_mode: 'HTML'`): `&`, `<`, `>` and
 * `"` as the entities it takes.
 *
 * @internal
 */
const escapeTelegramHtml = (text) => replaceEach(text, TELEGRAM_HTML);

/**
 * A text for the mrkdwn of Slack: `&`, `<` and `>` as entities, so that no
 * link, mention or `<!channel>` of its own is read.
 *
 * @internal
 */
const escapeSlackText = (text) => replaceEach(text, SLACK_TEXT);

/**
 * A text for the Markdown of Discord: each character of its syntax after a
 * backslash, and the dot of a number that begins a line, which makes an
 * ordered list.  Its mentions are not markup: see {@link neutralizeMentions}.
 *
 * @internal
 */
const escapeDiscordMarkdown = (text) => {
  let result = '';
  let from = 0;
  // Where a line stands: blank so far, a number so far, or past them, as the
  // dot after the number that begins a line makes a list.
  let line = LINE_START;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (DISCORD_MARKDOWN.has(char) || (char === '.' && line === LINE_NUMBER)) {
      // The character itself goes with the next slice, after its backslash.
      result += `${text.slice(from, i)}\\`;
      from = i;
    }
    if (char === '\n') line = LINE_START;
    else if (char >= '0' && char <= '9') line = line === LINE_OTHER ? LINE_OTHER : LINE_NUMBER;
    else if (!(line === LINE_START && (char === ' ' || char === '\t'))) line = LINE_OTHER;
  }
  return result + text.slice(from);
};

// `@everyone` and `@here` of Discord and Microsoft Teams, as a word.
const AT_MENTION = /@(everyone|here)\b/g;
// `<!channel>`, `<!here>` and `<!everyone>` of Slack, with a label or not.
const SLACK_MENTION = /<!(channel|here|everyone)(\|[^>]*)?>/g;

/**
 * A text whose mentions of a whole channel notify no one: `@everyone` and
 * `@here` with a zero-width space after the `@`, and `<!channel>`,
 * `<!here>` and `<!everyone>` of Slack as their text.  A transport of a work
 * chat passes its text through it unless the message's `mentions` allow
 * `everyone`.
 *
 * @internal
 */
const neutralizeMentions = (text) =>
  text.replace(AT_MENTION, '@​$1').replace(SLACK_MENTION, '&lt;!$1$2&gt;');

module.exports = {
  escapeDiscordMarkdown,
  escapeSlackText,
  escapeTelegramHtml,
  neutralizeMentions,
};
