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

/**
 * Reads the bytes of a body, refusing one over `maxBytes` by its
 * `Content-Length` or as it comes.
 *
 * @param response The response.
 * @param maxBytes The most bytes to read.
 * @returns The bytes, in one buffer.
 * @throws {RangeError} If the body is longer.
 * @internal
 */
const readBytes = async (response, maxBytes) => {
  const tooLong = () => new RangeError(`The response body exceeds ${maxBytes} bytes.`);
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw tooLong();
  }
  if (response.body == null) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks = [];
  let sizeBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    sizeBytes += value.byteLength;
    if (sizeBytes > maxBytes) {
      await reader.cancel();
      throw tooLong();
    }
    chunks.push(value);
  }
  return joinChunks(chunks, sizeBytes);
};

// One buffer of the chunks, without a copy when there is one.
const joinChunks = (chunks, sizeBytes) => {
  if (chunks.length === 1) return chunks[0];
  const bytes = new Uint8Array(sizeBytes);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    bytes.set(chunks[i], offset);
    offset += chunks[i].byteLength;
  }
  return bytes;
};

module.exports = { joinChunks, readBytes, readJson, readText };
