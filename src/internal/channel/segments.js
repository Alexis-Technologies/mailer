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
  // Both counts in one pass, GSM-7 until a character it has not: a text is
  // GSM-7 only when every character is. The parts of a concatenated message
  // are filled as they go: a character that does not fit in what is left of
  // one starts the next.
  const gsmPart = LIMITS['GSM-7'].part;
  const ucsPart = LIMITS['UCS-2'].part;
  let gsm = true;
  let septets = 0;
  let gsmSegments = 1;
  let gsmUsed = 0;
  let codeUnits = 0;
  let ucsSegments = 1;
  let ucsUsed = 0;
  let characters = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (gsm) {
      const size = septetsOf(code);
      if (size === 0) {
        gsm = false;
      } else {
        septets += size;
        if (gsmUsed + size > gsmPart) {
          gsmSegments++;
          gsmUsed = 0;
        }
        gsmUsed += size;
      }
    }
    let size = 1;
    if (isHighSurrogate(code) && isLowSurrogate(text.charCodeAt(i + 1))) {
      size = 2;
      i++;
    }
    codeUnits += size;
    if (ucsUsed + size > ucsPart) {
      ucsSegments++;
      ucsUsed = 0;
    }
    ucsUsed += size;
    characters++;
  }
  const encoding = gsm ? 'GSM-7' : 'UCS-2';
  const units = gsm ? septets : codeUnits;
  const segments = gsm ? gsmSegments : ucsSegments;
  return {
    encoding,
    segments: units <= LIMITS[encoding].single ? 1 : segments,
    units,
    characters,
  };
};

module.exports = { countSegments };
