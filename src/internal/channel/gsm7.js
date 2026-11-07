// Ported from message-segment-calculator v1.3.0 (src/libs/UnicodeToGSM.ts)
// https://github.com/TwilioDevEd/message-segment-calculator — MIT, Copyright 2021 Twilio Inc
// The table of the GSM 03.38 default alphabet as upstream has it, kept as the
// septets each code point takes: one for the basic set, two for the
// extension set, which goes after the escape 0x1B.

// The basic set: one septet each.
const BASIC =
  '\n\r !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz' +
  '¡£¤¥§¿ÄÅÆÉÑÖØÜßàäåæÇèéìñòöøùüΓΔΘΛΞΠΣΦΨΩ';
// The extension set: the escape and a septet.
const EXTENSION = '\f[\\]^{|}~€';

const SEPTETS = new Map();
for (let i = 0; i < BASIC.length; i++) SEPTETS.set(BASIC.charCodeAt(i), 1);
for (let i = 0; i < EXTENSION.length; i++) SEPTETS.set(EXTENSION.charCodeAt(i), 2);

/**
 * How many septets of GSM-7 a UTF-16 code unit takes: 1 for the basic set, 2
 * for the extension set, 0 for one GSM-7 has not.
 *
 * @internal
 */
const septetsOf = (code) => SEPTETS.get(code) ?? 0;

module.exports = { septetsOf };
