// Not ported: a stubbed fetch for the tests of the HTTP providers of 1.1,
// keeping each request with its headers and its body.

const stubFetch = (t, respond) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const request = {
      url: String(input),
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      redirect: init.redirect,
      body: init.body,
      json: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
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
