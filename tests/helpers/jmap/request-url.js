// The URL a stubbed fetch was called with, whether it got a string, a URL or a
// Request.

const requestUrl = (input) => {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
};

module.exports = { requestUrl };
