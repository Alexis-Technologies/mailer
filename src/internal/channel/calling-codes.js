// Not ported: the country calling codes of ITU-T E.164 (the list of ITU-T
// Operational Bulletin, by ISO 3166-1 alpha-2), for normalizePhone to make a
// national number international, and the trunk prefix of the countries whose
// prefix is not a single 0.

// `<alpha-2><code>`, separated by spaces: one string, parsed once, rather than
// an object of 245 keys in every bundle.
const TABLE =
  'AC247 AD376 AE971 AF93 AG1 AI1 AL355 AM374 AO244 AR54 AS1 AT43 AU61 AW297 AX358 AZ994 ' +
  'BA387 BB1 BD880 BE32 BF226 BG359 BH973 BI257 BJ229 BL590 BM1 BN673 BO591 BQ599 BR55 BS1 ' +
  'BT975 BW267 BY375 BZ501 CA1 CC61 CD243 CF236 CG242 CH41 CI225 CK682 CL56 CM237 CN86 CO57 ' +
  'CR506 CU53 CV238 CW599 CX61 CY357 CZ420 DE49 DJ253 DK45 DM1 DO1 DZ213 EC593 EE372 EG20 ' +
  'EH212 ER291 ES34 ET251 FI358 FJ679 FK500 FM691 FO298 FR33 GA241 GB44 GD1 GE995 GF594 GG44 ' +
  'GH233 GI350 GL299 GM220 GN224 GP590 GQ240 GR30 GS500 GT502 GU1 GW245 GY592 HK852 HN504 ' +
  'HR385 HT509 HU36 ID62 IE353 IL972 IM44 IN91 IO246 IQ964 IR98 IS354 IT39 JE44 JM1 JO962 ' +
  'JP81 KE254 KG996 KH855 KI686 KM269 KN1 KP850 KR82 KW965 KY1 KZ7 LA856 LB961 LC1 LI423 ' +
  'LK94 LR231 LS266 LT370 LU352 LV371 LY218 MA212 MC377 MD373 ME382 MF590 MG261 MH692 MK389 ' +
  'ML223 MM95 MN976 MO853 MP1 MQ596 MR222 MS1 MT356 MU230 MV960 MW265 MX52 MY60 MZ258 NA264 ' +
  'NC687 NE227 NF672 NG234 NI505 NL31 NO47 NP977 NR674 NU683 NZ64 OM968 PA507 PE51 PF689 ' +
  'PG675 PH63 PK92 PL48 PM508 PN64 PR1 PS970 PT351 PW680 PY595 QA974 RE262 RO40 RS381 RU7 ' +
  'RW250 SA966 SB677 SC248 SD249 SE46 SG65 SH290 SI386 SJ47 SK421 SL232 SM378 SN221 SO252 ' +
  'SR597 SS211 ST239 SV503 SX1 SY963 SZ268 TC1 TD235 TG228 TH66 TJ992 TK690 TL670 TM993 ' +
  'TN216 TO676 TR90 TT1 TV688 TW886 TZ255 UA380 UG256 US1 UY598 UZ998 VA39 VC1 VE58 VG1 VI1 ' +
  'VN84 VU678 WF681 WS685 XK383 YE967 YT262 ZA27 ZM260 ZW263';

// The codes no country has: international freephone (800), shared cost
// (808), Inmarsat (870), the global satellite systems (881), international
// networks (882, 883), disaster relief (888) and premium rate (979).
const NON_GEOGRAPHIC = ['800', '808', '870', '881', '882', '883', '888', '979'];

// The trunk prefixes that are not a single 0, longest first: the 1 of the
// North American Numbering Plan, the 8 of Russia and of some of its
// neighbours, the 06 of Hungary.  A country of none keeps a leading 0, which
// is part of its numbers (Italy, San Marino, the Vatican, Côte d'Ivoire,
// Benin, the Republic of the Congo).
const TRUNKS = new Map([
  ['BY', ['80', '8']],
  ['HU', ['06']],
  ['KZ', ['8']],
  ['LT', ['8', '0']],
  ['RU', ['8']],
  ['TJ', ['8']],
  ['TM', ['8']],
  ['UZ', ['8']],
  ['IT', []],
  ['SM', []],
  ['VA', []],
  ['CI', []],
  ['BJ', []],
  ['CG', []],
]);
const DEFAULT_TRUNK = ['0'];
const NANP_TRUNK = ['1'];
// The length of a national number of the countries of an 8 for a trunk,
// which a number of their own may begin with too (812 is St Petersburg):
// the 8 is a trunk only before a number of this length.
const NATIONAL_LENGTHS = new Map([
  ['RU', 10],
  ['KZ', 10],
  ['BY', 9],
  ['TJ', 9],
  ['UZ', 9],
  ['TM', 8],
  ['LT', 8],
]);
// The international prefixes beside 00: 011 of the North American Numbering
// Plan, 0011 of Australia, 810 of Russia, Kazakhstan and Belarus.
const PREFIXES = new Map([
  ['AU', ['0011']],
  ['RU', ['810']],
  ['KZ', ['810']],
  ['BY', ['810']],
]);
const NANP_PREFIXES = ['011'];
const NO_PREFIXES = [];

const COUNTRIES = new Map();
const CODES = new Set(NON_GEOGRAPHIC);
for (let start = 0; start < TABLE.length;) {
  let end = TABLE.indexOf(' ', start);
  if (end === -1) end = TABLE.length;
  const code = TABLE.slice(start + 2, end);
  COUNTRIES.set(TABLE.slice(start, start + 2), code);
  CODES.add(code);
  start = end + 1;
}

/**
 * The calling code of a country, by its ISO 3166-1 alpha-2 code.
 *
 * @internal
 */
const callingCodeOf = (country) => COUNTRIES.get(country);

/**
 * The trunk prefixes a national number of a country may begin with.
 *
 * @internal
 */
const trunksOf = (country) =>
  TRUNKS.get(country) ?? (COUNTRIES.get(country) === '1' ? NANP_TRUNK : DEFAULT_TRUNK);

/**
 * The length of a national number of a country of an 8 for a trunk, or
 * none for the others.
 *
 * @internal
 */
const nationalLengthOf = (country) => NATIONAL_LENGTHS.get(country);

/**
 * The international prefixes of a country beside 00, longest first.
 *
 * @internal
 */
const prefixesOf = (country) =>
  PREFIXES.get(country) ?? (COUNTRIES.get(country) === '1' ? NANP_PREFIXES : NO_PREFIXES);

// The codes of the countries whose numbers keep their leading 0 (those of no
// trunk above): a 0 after any other code is a trunk written by mistake.
const KEEPS_ZERO = new Set();
for (const entry of TRUNKS) {
  if (entry[1].length === 0) KEEPS_ZERO.add(COUNTRIES.get(entry[0]));
}

/**
 * Whether the numbers of a calling code keep a 0 after it (Italy, Côte
 * d'Ivoire…), where of the others it is a trunk prefix written by mistake.
 *
 * @internal
 */
const keepsZero = (code) => KEEPS_ZERO.has(code);

/**
 * The calling code an international number begins with: E.164 codes are
 * prefix-free, so the first of one, two or three digits that is a code.
 *
 * @internal
 */
const callingCodeIn = (digits) => {
  for (let length = 1; length <= 3; length++) {
    const code = digits.slice(0, length);
    if (CODES.has(code)) return code;
  }
  return undefined;
};

module.exports = {
  CODES,
  COUNTRIES,
  callingCodeIn,
  callingCodeOf,
  keepsZero,
  nationalLengthOf,
  prefixesOf,
  trunksOf,
};
