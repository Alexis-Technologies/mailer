// Not ported: reads the body of a response within a bound, so that
// a broken or hostile server cannot fill the memory of a sender.

// Far above any answer of a provider (a batch of receipts, a JMAP session or
// mailbox list), far below what would hurt a process.
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/**
 * Reads the body of a response as text, refusing one longer than the bound:
 * from its `Content-Length` before reading, or while it streams.
 *
 * @param response The response to read.
 * @param maxBytes The longest body accepted, in bytes.
 * @returns The body, decoded as UTF-8.
 * @throws {RangeError} If the body is longer than `maxBytes`.
 * @internal
 */
const readText = async (response, maxBytes = MAX_RESPONSE_BYTES) => {
  const tooLong = () => new RangeError(`The response body exceeds ${maxBytes} bytes.`);
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw tooLong();
  }
  if (response.body == null) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let sizeBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    sizeBytes += value.byteLength;
    if (sizeBytes > maxBytes) {
      await reader.cancel();
      throw tooLong();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
};

/**
 * Reads the body of a response as JSON, within the bound of {@link readText}.
 *
 * @param response The response to read.
 * @returns The parsed body.
 * @throws {SyntaxError} If the body is not JSON.
 * @throws {RangeError} If the body is too long.
 * @internal
 */
const readJson = async (response) => JSON.parse(await readText(response));

module.exports = { readJson, readText };
