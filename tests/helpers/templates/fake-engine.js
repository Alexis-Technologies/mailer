// Not ported: an engine for the tests of ./templates, which replaces
// `{{name}}` with the value of the context (HTML-escaped, `{{{name}}}` raw),
// and `{{> name}}` with the include of that name, read through the includes
// of the renderer; it counts what it compiles.

const escape = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

const fakeEngine = (options = {}) => {
  const compiled = [];
  const engine = {
    name: options.name ?? 'fake',
    extensions: options.extensions ?? ['.tpl'],
    compiled,
    async compile(source, context) {
      compiled.push({ name: context.name, part: context.part, source });
      if (source.includes('{{!syntax')) throw new SyntaxError('Unclosed tag');
      const pieces = [];
      const pattern = /\{\{(\{?)(>?)\s*([\w./-]+)\s*\}?\}\}/g;
      let at = 0;
      for (const match of source.matchAll(pattern)) {
        pieces.push({ text: source.slice(at, match.index) });
        if (match[2] === '>') {
          const found = await context.includes.lookup(match[3], context.name, engine.extensions);
          pieces.push({ text: found.source });
        } else {
          pieces.push({ name: match[3], raw: match[1] === '{' });
        }
        at = match.index + match[0].length;
      }
      pieces.push({ text: source.slice(at) });
      return (scope) => {
        if (scope.explode === true) throw new Error('A helper exploded');
        let out = '';
        for (const piece of pieces) {
          if (piece.text !== undefined) out += piece.text;
          else out += piece.raw ? String(scope[piece.name] ?? '') : escape(scope[piece.name]);
        }
        return options.async ? Promise.resolve(out) : out;
      };
    },
  };
  if (options.finish) engine.finish = options.finish;
  return engine;
};

module.exports = { fakeEngine };
