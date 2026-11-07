// Ported from message-segment-calculator v1.3.0 (src/libs/SegmentedMessage.ts)
// https://github.com/TwilioDevEd/message-segment-calculator — MIT, Copyright 2021 Twilio Inc
// Also ported from split-sms v0.1.7 (lib/gsmsplitter.js, lib/unicodesplitter.js)
// https://github.com/Codesleuth/split-sms — MIT, Copyright 2014 David Wood
// The segments of an SMS as a carrier counts them: 140 octets each, of which a
// concatenated message gives 6 to its header, so 160 septets of GSM-7 or 70
// code units of UCS-2 alone, 153 or 67 in each of several parts. A character
// is never split between two parts: an escape of the extension set of GSM-7
// (split-sms), a surrogate pair of UCS-2. Unlike upstream, the text is read
// by code point, not by grapheme, as carriers split it, so no Intl.Segmenter
// is needed; for the texts of upstream's tests both count the same segments.

const { septetsOf } = require('./gsm7.js');

const LIMITS = {
  'GSM-7': { single: 160, part: 153 },
  'UCS-2': { single: 70, part: 67 },
};

const isGsm7 = (text) => {
  for (let i = 0; i < text.length; i++) {
    if (septetsOf(text.charCodeAt(i)) === 0) return false;
  }
  return true;
};

const isHighSurrogate = (code) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code) => code >= 0xdc00 && code <= 0xdfff;

/**
 * How a text goes as an SMS: its encoding, the segments a carrier bills, the
 * units it takes (septets of GSM-7, an escape counted, or UTF-16 code units of
 * UCS-2) and its characters (code points).  Ukrainian and every other
 * Cyrillic text is UCS-2: no national table of GSM 03.38 is sent.
 *
 * @param text The text.
 * @returns `{ encoding, segments, units, characters }`.
 * @throws {TypeError} If the text is not a string.
 * @internal
 */
const countSegments = (text) => {
  if (typeof text !== 'string') throw new TypeError('countSegments needs a string.');
  const encoding = isGsm7(text) ? 'GSM-7' : 'UCS-2';
  const limits = LIMITS[encoding];
  let units = 0;
  let characters = 0;
  // The parts of a concatenated message, filled as they go: a character
  // that does not fit in what is left of one starts the next.
  let segments = 1;
  let used = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    let size;
    if (encoding === 'GSM-7') {
      size = septetsOf(code);
    } else if (isHighSurrogate(code) && isLowSurrogate(text.charCodeAt(i + 1))) {
      size = 2;
      i++;
    } else {
      size = 1;
    }
    units += size;
    characters++;
    if (used + size > limits.part) {
      segments++;
      used = 0;
    }
    used += size;
  }
  return { encoding, segments: units <= limits.single ? 1 : segments, units, characters };
};

module.exports = { countSegments };
