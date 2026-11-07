// Not ported: a stubbed fetch for the tests of the HTTP providers, keeping
// each request with its headers and its body, read as JSON or as a form by
// its Content-Type.

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const stubFetch = (t, respond) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const headers = new Headers(init.headers);
    const isText = typeof init.body === 'string';
    const isForm = headers.get('content-type') === 'application/x-www-form-urlencoded';
    const request = {
      url: String(input),
      method: init.method ?? 'GET',
      headers,
      redirect: init.redirect,
      body: init.body,
      json: isText && !isForm ? parseJson(init.body) : undefined,
      form: isText && isForm ? new URLSearchParams(init.body) : undefined,
    };
    requests.push(request);
    return respond(request, requests.length - 1);
  });
  return requests;
};

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

module.exports = { json, stubFetch };
