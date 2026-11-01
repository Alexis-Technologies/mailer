# План: канали в @alexify/mailer 1.3–1.5

Складено 2026-11-01. Замінює `messenger/PLAN-v1.md` (коміт `3e19a6a` у гілці `feature/v1`
репозиторію messenger): канали, заплановані для `@alexify/messenger`, переходять у mailer як нові
subpath-и, а messenger не публікується. План спирається на два проходи по коду mailer 1.2
(публічні типи — усі d.ts; runtime — `src/internal`, `src/core`, декоратори, черга, сховища,
вебхуки) і на код 11 конкурентів та 12 довідкових бібліотек, склонованих у
`~/Documents/open-source/messenger-alternatives/` (індекс з версіями й ліцензіями — `README.md`
тієї теки).

**Рішення:**

- SMS, RCS, WhatsApp, Messenger, Instagram, Telegram, Viber, Slack, Discord, Teams, Google Chat і
  push (FCM, APNs, Web Push) — у mailer, по subpath на провайдера; `@alexify/messenger` не
  публікується, його репозиторій архівується (розділ 12);
- **адитивно, у 1.x, без 2.0**: жоден рядок коду email-користувача не змінюється. Єдиний
  виняток — розширені об'єднання категорій помилок і станів, які ламають вичерпний `switch` у
  TypeScript; так уже зроблено в 1.1 з категорією `unsupported` (розділ 4.2);
- три релізи: **1.3** — канали й декоратори, **1.4** — замкнений цикл (вебхуки каналів,
  suppression, фолбек), **1.5** — черга, outbox і аудит для каналів;
- з конкурентів — feature-порт із заголовком походження, як у mailer 1.1; код mailer більше не
  копіюється — він узагальнюється на місці;
- Amazon SMS — через **AWS End User Messaging SMS** (`SendTextMessage`, pinpoint-sms-voice-v2);
- **e2e-акаунтів немає** — фейкові сервери, тест-вектори, заморожені фікстури (розділ 9);
- нова категорія помилки **`unreachable`**; WhatsApp, Messenger і Instagram — в одному **`./meta`**.

---

## 1. Коротко

1. **Надійний шар mailer здебільшого вже агностичний.** Із ~19 тис. рядків (`internal`, `core`,
   декоратори, черга, сховища, вебхуки) повідомлення каналу без змін проходять: HTTP-шар
   (`requestWithRetry` з правилом «не надсилати повторно запит невідомого результату без
   ключа»), receipts, retry, breaker, ratelimit, tee, pool, outbox, BullMQ, audit-сінки, сховище
   ідемпотентності й replay-сховище вебхуків. Падає з TypeError у п'яти місцях (fingerprint
   ідемпотентності, `checkMessage`, розмір повідомлення в otel, logger, `getMessagesTo` у mock),
   а hooks відмовляє. Узагальнення — ~2 тис. рядків замість ~15 тис. скопійованих у варіанті з
   двома пакетами.
2. **Контракти — адитивні.** `Transport<TProviderId, TMessage = Message>`; типи повідомлень
   каналів — у `index.d.ts` кореня (типи нічого не важать); runtime-будівник і хелпери — у новому
   `./channels`, бо корінь має ~100 Б запасу (9,9 з 10 КБ), а email-користувач не має платити за
   таблиці телефонних кодів і GSM-7.
3. **Машинерія лише для каналів — окремими entry:** `./channels` і `./channel-webhooks` (у
   `./webhooks` 15,3 з 15,5 КБ). Спільне з email переїжджає в `src/internal/`, щоб не додавати
   ребер між subpath-ами.
4. **Email не змінюється ні на байт** там, де байти зберігаються: fingerprint ідемпотентності,
   серіалізація mail job, id задачі. Інакше повторна постановка з тим самим ключем дає
   `key_reused`, а `messageHash` в аудиті міняється. Golden-тести фіксують значення 1.2.
5. **Синергія, якої немає ні в кого:** один список suppression на email і канали (пункт roadmap
   mailer, ще не зроблений), один фолбек WhatsApp → SMS → email за результатом, одна черга, один
   аудит, одне crypto-shredding одержувачів.
6. **Конкуренти — feature-порт, як і планувалося:** жоден не годиться як база файл у файл
   (розділ 3.1). Майже дослівно — лише чисті функції й таблиці (thinwrap, twilio-node, http_ece,
   message-segment-calculator, discord.js).
7. **Обсяг:** ~14 тис. рядків нового `src/` за три релізи (розділ 11) замість ~16 тис. нових і
   ~15 тис. скопійованих.

---

## 2. Що в mailer уже є і що змінюється

### 2.1 Використовується як є

- `internal/http.js`: `requestWithRetry`, `hasIdempotencyKey`, двозначна відповідь →
  `markDeliveryUnknown`, `Retry-After` понад 30 с — кинути для черги. Провайдер ставить
  `hasIdempotencyKey` лише там, де ключ відображається на дедуплікацію самого провайдера.
- `ProviderTransport` — готова база транспорту каналу; `refusal.js` (`unsupported`) — для лімітів
  каналу; `schedule.js` читає `scheduledAt`, яке має ту саму назву в повідомленні каналу;
  `uuid.js` — для `apns-id`; gate, batch, backoff, verify, unsent, polling-driver.
- `core/receipt.js`: категорії не валідуються, нові не потребують коду (лише значення
  `retryable` за замовчуванням — 2.2).
- `./retry`, `./breaker` (`FAILURE_CATEGORIES` — allowlist network, timeout, server-error,
  service-unavailable, тож нові категорії breaker уже не рахує), `./ratelimit` (ключ за
  замовчуванням `''`, вартість 1), `./tee`.
- `./mongodb` (outbox, audit-сінк, сховище ідемпотентності), `./bullmq`, `./audit`-сінки:
  документ outbox непрозорий для `data`, нічого email-специфічного.
- `webhooks/request.js`: `claimDelivery` з reserve/commit/release і токеном; ключі сховища —
  SHA-256 від id, тож id з номером телефону не зберігається відкрито; три резолвери опцій
  (з часом, без часу, облікові дані); `createSnsVerifier` — для подій AWS SMS лише новий
  `eventsOf`.

### 2.2 Узагальнюється на місці

| Модуль | Сьогодні з повідомленням каналу | Зміна | Реліз |
| --- | --- | --- | --- |
| `internal/fingerprint.js` | TypeError на `message.sender` → ламає `./idempotency` і подію `rendered` воркера | гілка каналу з першою міткою `channel\0<channel>` (не перетинається з email): from, to (підписка Web Push — канонічним JSON), text, media (url/id, тип, назва — без байтів), buttons, template, mentions, payload канонічним JSON, tags, scheduledAt, metadata; без idempotencyKey, correlationId, tenantId. Канонічний JSON — з `queue/hash.js` у `internal/`. Email-гілка без змін | 1.3 |
| `core/message.js` | `checkMessage` кидає; його єдиний виклик — hooks | `checkMetadata`, `checkScheduledAt` → `internal/message-checks.js` (корінь не росте); `checkChannelMessage` — у `internal/channel/` | 1.3 |
| `core/message-id.js` | `pinMessageId` — no-op (немає `sender`) | для каналу закріплюється клієнтський reference (ключ ідемпотентності або UUID) у тій самій WeakMap, тож кожна спроба retry і pool несе один id: TurboSMS `sequence_id`, Vonage `client-ref`, Sinch `client_reference`, RBM `messageId`, Discord `nonce` | 1.3 |
| `core/receipt.js` | `createFailedReceipt` пропускає лише відомі ключі; `retryable` — з HTTP-статусу | `channel?`, `segments?`, `state?` у receipt; `retryable` за замовчуванням з категорії (`unreachable` — так, інші шість — ні), email-категорій це не торкається. Словесних правил для нових категорій не додавати — вони перекласифікували б email | 1.3 |
| `internal/api-client.js` | `URLSearchParams` стає `{}`; Content-Type перезаписується; Retry-After лише з заголовка; текст «ok» → `deliveryUnknown` | розділ 4.4 | 1.3 |
| `internal/api.js` | тягне `core/address`, attachment, provider, а з ними calendar і message-id | `mergeBatch`, `checkCredential`, `sendConverted`, `sentWith` → новий internal-модуль, `api.js` їх реекспортує | 1.3 |
| `internal/redact-addresses.js`, `redact.js` | редагує лише email-адреси (від `@`); ключів каналів у `SECRET_KEYS` немає | новий `redactRecipients` (адреси + E.164 з `+`) на 14 місцях виклику; logger і otel додатково редагують точний `message.to`. `SECRET_KEYS` += `authtoken`, `bottoken`, `webhookurl`, `signingsecret`, `vapidprivatekey`, `serviceaccount`, `private_key`, `client_secret`, `access_token`, `refresh_token`, заголовки `x-viber-auth-token`, `x-goog-api-key`. Повний URL ніколи не логується (токен Telegram у шляху, секрет вебхуків Slack/Discord/Teams у самому URL) | 1.3 |
| `ses/http-client.js` | SigV4 живе всередині `./ses` | → `internal/sigv4.js` (`refactor:`), потрібен `./aws-sms` | 1.3 |
| `./hooks` | `isShaped` відмовляє (потрібні `sender.address`, `recipients[]`) | приймає `typeof channel === 'string'` і перевіряє `checkChannelMessage` | 1.3 |
| `./logger` | TypeError на `recipients`; повідомлення каналу потрапляє в гілку raw | гілка каналу: `{channel, recipientCount: 1, mediaCount, buttonCount, hasTemplate, hasPayload}`; події `message.sending/sent/failed/retrying` з `channel`, події `email.*` лишаються для email; `to` — лише з `recordMessage` | 1.3 |
| `./otel` | TypeError: `Buffer.byteLength(subject)` | span `${channel} send`; атрибути `mailer.channel`, `messaging.operation.type`, `messaging.message.id`, `mailer.message.size`, `.text.length`, `.media.count`, `.segments`, `.encoding`; `from` — лише з `recordSensitiveData`, `to` — ніколи; нові інструменти `mailer.channel.{attempts, messages, retries, duration, message.size, active_sends, segments}`. Імена `email.*` і `mailer.email.*` не змінюються (дашборди) | 1.3 |
| `./mock` | TypeError у `getMessagesTo` | збіг за `to` (і endpoint Web Push), `getMessagesByChannel`; `hasAddress` повертає false для `null` | 1.3 |
| `./pool` | `hasMessageRejection` зупиняє перехід лише на `validation`/`rejected` — `opted-out` пішов би до іншого провайдера | `STOP_FAILOVER` = validation, rejected, invalid-recipient, opted-out, outside-window, blocked, unregistered, not-on-channel; `unreachable` — переходить (інший маршрут SMS може дістатися апарата). `not-on-channel` зупиняє, бо члени пулу — один канал; WhatsApp → SMS — це `./fallback` | 1.3 |
| `./idempotency` | відхиляє відправлення через TypeError у fingerprint | гілка fingerprint; для повідомлення каналу з `tenantId` — namespace `${namespace}:${tenantId}:${key}` (у email `tenantId` немає) | 1.3 |
| `./retry`, `./breaker`, `./ratelimit`, `./tee` | працюють | лише d.ts (параметр `TMessage`) | 1.3 |
| `./audit` | стани не валідуються; таблиці закриті | ранги, `FINAL`, `STATES`, рівні логер-сінку (розділ 4.2); логер-сінк пише `message.*` для каналу і `mail.*` для email | 1.3 |
| `webhooks/request.js`, `sns.js` | агностичні; `recipientOf` лише нижній регістр домену, телефон не нормалізується | загальна частина → `src/internal/webhook/`, один клас `WebhookVerificationError` для обох entry (щоб `instanceof` працював); `WebhookRequest.url?` (Twilio підписує URL) | 1.4 |
| `./queue` | `parseMailJob` відмовляє на будь-якому ключі поза `V1_KEYS`; воркер 1.2 відпускає таку задачу кожні 5 хв до 7 днів | канальні двійники, окрема черга (розділ 7) | 1.5 |
| `./mongodb` | `eventsOfProviderMessage` з'єднує лише за `providerMessageId` | опційний `provider` + складений індекс `{provider, providerMessageId}` | 1.5 |

### 2.3 Інваріанти email

Не змінюються ні на байт, з golden-тестом на значення 1.2 у першому ж коміті етапу 1:
fingerprint email-повідомлення; серіалізація, hash і id mail job (без `channel: 'email'` і без
нових ключів); `ENVELOPE` запечатаної задачі (ключ `channel` у відкритій частині провалив би
задачу воркером 1.2 одразу); імена span-ів і метрик otel; події logger-а; `createMessage`.

### 2.4 Знахідки в mailer поза каналами

Аналіз знайшов кілька дрібних вад 1.2. Кожна — окремий `fix:`-коміт з тестом, їх можна випустити
й патчем 1.2.x до каналів:

- `internal/polling-driver.js:167/216/247` логує `error?.message` без редагування;
- `otel` (`extractNetworkAttributes`, `:403–416`): будь-який конфіг з `host` і `port` — це
  `smtp`, а з `domain` — URL Mailgun (перевіряти `id`);
- `./idempotency` (`:173`, `:199`): тексти receipt вставляють ключ без редагування, для email
  теж.

---

## 3. Звідки береться нове

### 3.1 Конкуренти й довідкові бібліотеки — feature-порт

| Джерело | Ліцензія | Що беремо | Куди | Режим |
| --- | --- | --- | --- | --- |
| **@thinwrap/notifications** 1.2.0 | MIT | запити й відповіді Twilio, Vonage, Infobip, Sinch, WhatsApp Cloud, Telegram, вебхуків Slack/Discord/Teams/Google Chat, FCM, APNs; таблиці кодів помилок; тести на форму запиту (15–42 на провайдера) | SMS, `./meta`, чати, push | FEATURE; кілька функцій і таблиць — майже дослівно |
| **@visulima/notification** 2.0.0 | MIT | Web Push (VAPID + RFC 8291, коректний), APNs (сесія HTTP/2, кеш JWT), верифікатори (Twilio, Slack v0, Discord/Telnyx Ed25519, Vonage JWT), парсери вхідних Twilio/Vonage для STOP, ~60–70 тестів | `./webpush`, `./apns`, `./channel-webhooks` | FEATURE (~1 000 з 8 968 рядків) |
| **@novu/providers** 2.6.5 | MIT | лише таблиці статусів `parseEventBody` (Twilio, Telnyx, Plivo) — з виправленнями | `./channel-webhooks` | REFERENCE |
| **twilio-node** 6.2.0 | MIT | алгоритм `X-Twilio-Signature` (варіанти URL, масиви, `bodySHA256`) і ~20 векторів; enum `MessageStatus` | `./channel-webhooks`, `./twilio` | FEATURE |
| **telnyx-node** 7.28.0 | MIT | Ed25519-верифікатор, статуси | довідка (Telnyx не у v1) | REFERENCE |
| **vonage-node-sdk** 3.30.1 | Apache-2.0 | 5 векторів підпису SMS (md5hash, md5, sha1, sha256, sha512) | тести `./channel-webhooks` | код — з документації, вектори — з атрибуцією |
| **sinch-sdk-node** 1.7.0 | Apache-2.0 | вектори DLR SMS і Conversation, enum статусів і `Reason` | тести `./channel-webhooks`, `./sinch` | так само |
| **plivo-node** 4.79.0 | MIT | V2/legacy вектори | довідка (Plivo не у v1) | REFERENCE |
| **node-telegram-bot-api** 2.1.0 | MIT | конверт `ok:false`, поля помилок, політика обов'язкового secret token, тести транспорту й вебхука, фейковий годинник лімітера | `./telegram` | FEATURE |
| **grammY** 1.46.0 | MIT | лише звірка | — | REFERENCE |
| **notifme-sdk** 1.16.25 | MIT | нічого (усе старше й гірше за інші джерела) | — | SKIP |
| **http_ece** 1.2.1 | MIT | aes128gcm одним записом, вектори RFC 8188 §3.1–3.2 | `./webpush` | FEATURE |
| **message-segment-calculator** 1.3.0 (Twilio) | MIT | таблиця GSM-7 (137 кодових точок), математика 1120 біт / UDH, `TestData`, опційна мапа smart encoding (~270) | `internal/channel/segments.js` | FEATURE, таблиці дослівно |
| **split-sms** 0.1.7 | MIT | правило розрізання (не розривати escape і сурогатну пару), кейси | `internal/channel/segments.js` | FEATURE |
| **@parse/node-apn** 8.1.1 | MIT | сесія HTTP/2 (reconnect на goaway, ping), таймаут з `NGHTTP2_CANCEL`, лічильник поколінь токена, заголовки, тестовий h2c-сервер | `./apns`, `internal/http2.js` | FEATURE |
| **@discordjs/rest** 2.5.0 | Apache-2.0 | алгоритм бакетів `X-RateLimit-*` і глобальний 50/с | `./discord` | код — з документації Discord, алгоритм як довідка |
| **firebase-admin** 14.5.0 | Apache-2.0 | вилучення коду помилки FCM (`details[].errorCode` перед `status`), таблиця кодів, політика кешу токена | `./fcm` | з документації + атрибуція таблиці |
| **@slack/bolt** 5.1.0, **@slack/web-api** 8.3.0 | MIT | верифікатор v0 (з виправленим вікном) і документований вектор; семантика 429 | `./slack` | FEATURE / REFERENCE |
| **botframework-connector** 4.1.6 | MIT | OpenID/JWKS, перевірка claims (`iss`, `aud`, endorsements, `serviceurl`), шляхи Connector API | `./teams` | FEATURE |
| **viber-bot** 1.0.18 | Apache-2.0 | ендпоінти, `X-Viber-Auth-Token`, вектор HMAC | `./viber` | REFERENCE + вектор |
| **@infobip-api/sdk** 0.3.2 | MIT | SMS v3 / WhatsApp запити | `./infobip` | REFERENCE |
| **@google/rcsbusinessmessaging** 1.0.10 | Apache-2.0 | ендпоінти `agentMessages` (`messageId`), capability check | `./rbm` | REFERENCE |

**Не копіюємо:** `web-push` (MPL-2.0, файловий копілефт) — Web Push будується з http_ece і RFC
8291/8292; офіційний WhatsApp Node SDK (Facebook Platform License, архів 2023, підпис через `==`);
решту Novu (SDK-обгортки); notifme; черги, middleware, wrappers, mock і otel visulima (у mailer
краще).

**Apache-2.0** (Vonage, Sinch, Viber, firebase-admin, discord.js): алгоритми — 5–15 рядків,
пишемо з публічної документації, щоб пакет лишався чистим MIT. Тест-вектори лежать у `tests/`,
яке не публікується, з рядком атрибуції в тестовому файлі.

### 3.2 Українські провайдери

Відкритого Node-коду немає (лише PHP-пакети `daaner/turbosms`, `developingw/turbosmsua` і старий
`node-alphasms`). Пишемо з документації: turbosms.ua/api.html (+ callback.html — DLR і вхідні
Viber), alphasms.ua (вебхуки статусів, підписані ключем API — за стороннім клієнтом, перевірити),
smsclub.mobi/en/api (`im.smsclub.mobi/sms/send` і `/sms/status`, до 100 id, 9 запитів/с, статуси
— лише опитуванням). Гібрид Viber → SMS усі троє роблять на своєму боці.

### 3.3 Правила порту

У `CLAUDE.md` mailer з'являється третій розділ поруч із «Code ported from upyo» і «Code ported
from nodemailer, unemail and sently» — **«Code ported for the channels»**:

- переноситься фіча на контракти mailer (`Receipt`, `createApiClient`, injected `fetch`,
  `signal`), а не HTTP-шар, ретраї й модель помилок джерела;
- відомий баг джерела виправляється **в тому ж `feat:`-коміті**, з тестом, що падає на поведінці
  джерела, і рядком у списку багів (префікси, що не перетинаються з N, U, S, R mailer: V —
  visulima, T — thinwrap, NV — Novu, TG — ntba/grammY, TW — twilio-node, VG — Vonage, SN — Sinch,
  AP — node-apn, FB — firebase-admin, DC — discord.js, SL — Slack SDK, VB — viber-bot, BB —
  botbuilder, EC — http_ece);
- заголовок `// Ported from @thinwrap/notifications v1.2.0 (src/providers/twilio/twilio.connector.ts)`
  + рядок нотиса; друге джерело — `// Also ported from …`; файл без джерела — `// Not ported:`;
- `tests/unit/attribution.test.js` отримує нові записи `SOURCES` (thinwrap, visulima,
  twilio-node, ntba, http_ece, message-segment-calculator, split-sms, node-apn, Slack,
  botbuilder), а `LICENSE` — їхні нотиси;
- портовані сюїти зберігають `describe`/`it`; `expect` → `node:assert`,
  `vi.stubGlobal('fetch')` → `t.mock.method(globalThis, 'fetch')`, `vi.useFakeTimers` →
  `t.mock.timers`, `vi.mock('node:http2')` → локальний h2c-сервер.

---

## 4. Архітектура

### 4.1 Типи кореня

Усе нове в корені — лише типи, крім кількох полів receipt (4.6):

```ts
export type Channel =
  | 'sms' | 'rcs' | 'whatsapp' | 'messenger' | 'instagram' | 'telegram'
  | 'viber' | 'slack' | 'discord' | 'teams' | 'googleChat' | 'push';

interface ChannelMessageBase<TChannel extends Channel, TPayload = JsonObject> {
  readonly channel: TChannel;
  readonly text?: string;
  readonly media?: readonly ChannelMedia[];   // { url } | { content, contentType, filename? }
  readonly buttons?: readonly ChannelButton[];
  readonly payload?: TPayload;                // Block Kit, Adaptive Card, embed — as is
  readonly mentions?: ChannelMentions;        // none unless allowed
  readonly tags: readonly string[];
  readonly metadata?: Readonly<Record<string, string>>;
  readonly tenantId?: string;
  readonly idempotencyKey?: string;
  readonly correlationId?: string;
  readonly scheduledAt?: Date;
  readonly expiresAt?: Date;                  // push TTL, SMS validity period
  readonly priority?: Priority;
}
// SmsMessage (to: E164, from, text), RcsMessage, WhatsAppMessage (template), MessengerMessage,
// InstagramMessage, TelegramMessage (to: string | number), ViberMessage, SlackMessage,
// DiscordMessage, TeamsMessage, GoogleChatMessage, PushMessage (to: { token } | subscription)
export type ChannelMessage = SmsMessage | RcsMessage | WhatsAppMessage | /* … */ PushMessage;
export type ChannelMessageOf<C extends Channel> = Extract<ChannelMessage, { readonly channel: C }>;
export type AnyMessage = Message | ChannelMessage;

export interface Transport<TProviderId extends string = string, TMessage = Message> { /* … */ }
export interface VerifiableTransport<TProviderId extends string = string, TMessage = Message>
  extends Transport<TProviderId, TMessage> { /* … */ }
// RawTransport and isRawTransport stay email-only.
```

- `Message`, `Address`, `createMessage`, `RawTransport`, `isRawTransport`, `DeliveryBounce` —
  без змін.
- Декоратори стають `<TProviderId, TMessage extends AnyMessage = Message>` разом зі своїми
  конфігами (`Hooks<M>`, `RateLimitConfig<M>`, `TeeConfig<M>`, `PoolConfig<P, M>`,
  `Strategy<P, M>`, `TransportSelector`), а `implements RawTransport<TProviderId>` міняється на
  `implements VerifiableTransport<TProviderId, TMessage>` — інакше `check:dts` падає з TS2416.
  `sendRaw` лишається: для транспорту каналу він дає збій `configuration`, а email-декоратори
  структурно лишаються `RawTransport`. Перевірено ескізом на tsc 7 `--strict`:
  `createRetryTransport(new MockTransport())` — точно `RetryTransport<'mock'>`, як і зараз;
  транспорт Twilio дає `RetryTransport<'twilio', SmsMessage>`; email-повідомлення в SMS-декоратор
  не проходить, і навпаки.
- `Receipt`: `channel?` (немає для email), `segments?` (SMS), `state?: 'accepted' | 'sent'`
  (`sent` — канал не звітує про доставку: робочі чати, push, тож пізнішого стану не буде).
- `DeliveryEvent`: `channel?`, `error?: { category, code }` (код DLR, класифікований, замість
  `bounce`); `AuditEvent`: `channel?`.

### 4.2 Категорії, стани, події

| Об'єднання | Додається |
| --- | --- |
| `ReceiptErrorCategory` (11) | `invalid-recipient`, `opted-out`, `outside-window`, `blocked`, `not-on-channel`, `unregistered`, `unreachable` |
| `DeliveryEventType` (10) | `sent`, `read`, `failed`, `expired`, `subscribed`; вхідний STOP — наявний `unsubscribed`, відмова до спроби — `rejected`, нерозпізнане — `unknown` |
| `MessageState` (9) | `sent`, `read`, `expired` |

- `unreachable` — апарат тимчасово недоступний (Twilio 30003, Vonage DLR 2/7, Sinch 404):
  повторюється пізніше і є приводом для фолбеку, а не `rejected`.
- Ранги `audit/states.js` дробові, щоб ранги, уже записані в MongoDB, лишились чинними:
  `sent` 3.5 (між `accepted` 3 і `delivered` 4), `expired` 4 (як `failed`), `read` 4.5.
  `FINAL` += `read`, `expired`. `isFinalState('delivered')` лишається true, хоча `read` може
  прийти пізніше: ранг усе одно посуне стан уперед.
- Розширення в CHANGELOG 1.3 — окремим пунктом «зламає вичерпний `switch`», з посиланням на
  прецедент `unsupported` в 1.1. Строго адитивна альтернатива (параметр типу категорії через
  `ReceiptError`, `Receipt`, `AuditError`, `AuditEvent`, `AuditSink`) важка і не варта того.
- tsd: `tests/types/index.test-d.ts:180` `expectError<DeliveryEventType>('sent')` перевертається.

### 4.3 `./channels`

Новий subpath, runtime лише для каналів (реалізація в `src/internal/channel/`, бо провайдери
тягнуть її без ребер між subpath-ами — `tests/unit/graph.test.js` дозволяє лише перелічені):

- **`createChannelMessage(input)`** — union за `channel`; валідує одержувача під канал, `buttons`,
  `mentions`, `template`, `payload`, `media`, спільні `metadata`/`scheduledAt` (з
  `internal/message-checks.js`). Окремий будівник, а не розширений `createMessage`: рядок `to`
  пройшов би через `parseAddress` і впав, `subject`/`content` там обов'язкові, а розширений тип
  повернення зламав би тих, хто чекає `Message`. `isChannelMessage`, `checkChannelMessage`.
- **`normalizePhone(input, { defaultCountry })`** → E.164: таблиця calling codes ITU (~250),
  зняття trunk-префікса (`067…` → `+38067…`), ≤15 цифр; `isE164`. Без libphonenumber.
- **`countSegments(text)`** → `{ encoding, segments, units, characters }`: GSM-7 + extension
  (escape не розривається), UCS-2 у code units (сурогатна пара не розривається), 160/153 і
  70/67; українська кирилиця завжди UCS-2.
- **екранування** Telegram HTML, Slack mrkdwn, Discord Markdown; масові згадки (`<!channel>`,
  `<!here>`, `@everyone`, `@here`) нейтралізуються за замовчуванням.
- **`createChannelRouter({ sms, telegram, … })`** — `Transport<'router', ChannelMessage>`, що
  відправляє за `message.channel`; потрібен воркеру черги (1.5) і замінює фасад
  `createMessenger`, якого в mailer немає (як і `createMailer`).

Ліміти каналів (Telegram 4096/1024, Discord 2000 / 10 embeds / 6000, Slack 40 000 і 50 blocks,
WhatsApp 4096 і 3 reply-кнопки, Messenger 2000, Web Push ≤3993 байт, APNs 4/5 КБ, FCM 4 КБ…)
перевіряють самі транспорти до запиту — збій `validation` або `unsupported`, як у email.

Таблиці (GSM-7, коди країн) — `.js`-файли: `scripts/check-pack.js` пропускає лише `.js` і `.d.ts`.

### 4.4 Спільний HTTP-шар

`internal/http.js` — без змін. Розширення:

1. `api-client.js`: `URLSearchParams`, рядок і байти проходять без `JSON.stringify` (Twilio,
   Vonage, AWS Query, обмін OAuth; Web Push `aes128gcm`); `Content-Type` ставиться `??=`
   (`application/x-amz-json-1.0` AWS SMS);
2. `classify` може повернути `retryAfterMilliseconds` (Telegram `parameters.retry_after`, Discord
   `retry_after` у тілі) і `rate-limit` з 400 (Graph: 4, 80007, 130429, 131056);
3. хук `read` для текстової відповіді (вебхук Slack відповідає `ok`);
4. `isAnswer` для відмови всередині 2xx уже є: Vonage `messages[].status`, Infobip REJECTED,
   Telegram і Slack `ok:false` (Slack `internal_error`/`fatal_error` лишаються
   `deliveryUnknown`), Viber `status != 0`, Teams legacy;
5. провайдери класифікують самі: `classifyHttpStatus` робить з 403 `auth`, а черга вважає `auth`
   помилкою оператора — тож «bot was blocked» Telegram → `blocked`, Twilio 21610 → `opted-out`,
   Meta 131047 → `outside-window`, Web Push 404/410 і APNs 410 → `unregistered`;
6. `authorize` з кешованим токеном і single-flight: **`internal/jwt.js`** (RS256/ES256 на
   `node:crypto`, `dsaEncoding: 'ieee-p1363'`), **`internal/google-auth.js`** (JWT сервісного
   акаунта → `oauth2.googleapis.com/token`, оновлення за 5 хв до кінця; спільний для FCM, RBM і
   Google Chat app), client credentials Bot Framework;
7. **`internal/http2.js`** — `fetch`-шим над `node:http2` для APNs: одна сесія на origin,
   reconnect на goaway/close, ping, `unref`, таймаут через `stream.close(NGHTTP2_CANCEL)`;
   `unsent.js` отримує REFUSED_STREAM і GOAWAY з last-stream-id нижче потоку (RFC 9113 §8.7).
   d.ts з `AsyncDisposable` потребує `/// <reference lib="esnext.disposable" />`;
8. **`internal/sigv4.js`** — з `ses/http-client.js`.

### 4.5 Subpath-и

| Реліз | Subpath-и |
| --- | --- |
| 1.3 спільне | `./channels` |
| 1.3 SMS/RCS | `./twilio`, `./vonage`, `./infobip`, `./sinch`, `./aws-sms`, `./turbosms`, `./alphasms`, `./smsclub`, `./rbm` |
| 1.3 месенджери | `./meta` (WhatsApp, Messenger, Instagram: один Graph-клієнт, одне вікно 24 год), `./telegram`, `./viber` |
| 1.3 робочі чати | `./slack`, `./discord`, `./teams`, `./google-chat` |
| 1.3 push | `./fcm`, `./apns`, `./webpush` |
| 1.4 | `./channel-webhooks`, `./suppression` (email і канали), `./fallback` |
| 1.5 | нових немає: `./queue`, `./mongodb`, `./audit`, `./otel` отримують канали |

- Колізій з нинішніми 41 entry немає. Subpath — на постачальника, і він може тримати кілька
  каналів (`./twilio`: SMS, MMS, WhatsApp-префікс, RCS; `./meta`: три), тож email Infobip чи SMS
  Azure Communication Services колись лягли б у `./infobip` чи `./azure`. Виняток — AWS: за
  сервісом, як `./ses`, тому `./aws-sms`.
- HTTP-клієнт провайдера каналу — `src/<sub>/client.js`, не `http-client.js`:
  `tests/unit/delivery.test.js` додає кожен `http-client.js` до email-матриці, що відправляє
  `createMessage`. Для каналів — своя матриця (4.6).
- Окремий `./channel-webhooks`, а не розширений `./webhooks`: у тому 15,3 з 15,5 КБ, а десяток
  верифікаторів каналів — ще ~10 КБ, які функція перевірки Mailgun платила б на холодному старті.

### 4.6 Розміри й тестова інфраструктура

- Корінь (9,9 з 10 КБ): `channel`, `segments`, `state` у `createFailedReceipt` і `retryable` за
  категорією — один крок +0,5 КБ у коміті етапу 1 («the root grows only for the contract they
  share» — це саме спільний контракт).
- Близькі до бюджету: `./queue` 19,3/19,5, `./audit` 2,0/2, `./otel` 6,1/6,5, `./idempotency`
  4,2/4,5, `./pool` 3,4/3,5, `./mongodb` 7,3/7,5 — кожен підніметься на крок 0,5 у коміті,
  якому потрібне місце.
- Канальний subpath, що тягне `core/receipt.js`, `internal/api-client.js` і
  `provider-transport.js`, важить від ~5,5 КБ без email-коду (`message`, `address`, `calendar`,
  `attachment`, `list`, `message-id`, `raw-message` — ~7 КБ — він не тягне).
- Exports map — з 41 до 64 entry (+20 у 1.3, +3 у 1.4). `export-parity` запускає `node` на
  кожен entry (+23 процеси),
  `bundle` — два esbuild-білди на entry; `scripts.test.js` вимагає бюджет для кожного; кожен —
  у `tests/runtime/exports.test.js` на Node, Bun і Deno; tsd-файл на кожен новий entry.
- Матриця доставки каналів (`tests/unit/delivery.test.js` або поруч): ті самі сценарії, що в
  email — двозначна відповідь → `deliveryUnknown` без повтору, `Retry-After`, редагування
  секретів і одержувачів — з повідомленням каналу на кожен провайдер.

---

## 5. Реліз 1.3 — канали й декоратори

Гілка `feature/messenger` (уже є в mailer, чиста), один PR, коміти по одному на subpath і на фікс,
як у 1.1 і 1.2.

### Етап 0. Позиціонування і перенесення з messenger (`docs:`/`chore:`)

- `CLAUDE.md`: «What this is» (email і канали), прибрати SMS/WhatsApp/push з «Out of scope»,
  roadmap каналів (з `messenger/CLAUDE.md`: правила каналів, рішення «HTTP APIs, not SDKs»,
  «Official APIs only», «Few providers per channel», «One message, the channel's own payload»,
  список «What the competitors appear to get wrong» для месенджингу), розділ «Code ported for the
  channels» (3.3), «Repository layout», «Architecture» (4.1–4.2);
- `package.json`: `description`, `keywords` (sms, whatsapp, telegram, viber, slack, discord,
  teams, push, fcm, apns, web-push, rcs); README — нове вступне речення і розділ каналів;
- порівняння: `messenger/docs/comparison.json` (11 бібліотек) → `docs/comparison-channels.json`,
  перший стовпець `@alexify/messenger` → `@alexify/mailer` (клітинки 🔜, як і були);
  `scripts/comparison.js` рендерить дві пари дані → сторінка (зараз `DATA` одна, `TARGETS`
  масив), CI перевіряє дрейф обох; `docs/guide/comparison-channels.md` — проза з messenger;
  клітинка `@alexify/mailer` у рядку «Multi-channel: SMS, WhatsApp, push» `docs/comparison.json`
  (зараз «❌ out of scope») → 🔜, таблиця перегенеровується;
- виправити два формулювання про thinwrap, перенесені з messenger: «an accepted SMS is always
  reported `sent`, never `queued`» замість «every SMS reported `sent`»; відсутній Web API Slack —
  не баг;
- `LICENSE` і `SOURCES` тесту атрибуції — нотиси джерел 3.1.

### Етап 1. Контракти (`feat(core):`, `refactor:`)

- golden-тести інваріантів 2.3 — першим комітом;
- типи кореня 4.1, об'єднання 4.2, поля receipt і `retryable` за категорією (+0,5 КБ кореня);
- таблиці `./audit` (ранги, `FINAL`, `STATES`, рівні логер-сінку);
- `refactor:` `checkMetadata`/`checkScheduledAt` → `internal/message-checks.js`; канонічний JSON
  → `internal/`; загальні хелпери `api.js` → internal-модуль; SigV4 → `internal/sigv4.js`;
- `./channels` (4.3) з тестами сегментів на `TestData` Twilio і кейсах split-sms;
- фікси 2.4 — окремими `fix:`-комітами, якщо не вийшли патчем 1.2.x раніше.

### Етап 2. Спільний шар (`feat:`)

`api-client.js` (4.4, пункти 1–3), `redactRecipients` і `SECRET_KEYS`, `internal/jwt.js`,
`internal/google-auth.js`, `internal/http2.js` з `unsent.js`, fingerprint із гілкою каналу,
`pinMessageId` із клієнтським reference.

### Етап 3. Декоратори (`feat(<subpath>):`)

`./mock` → `./hooks` → `./logger` → `./otel` → `./pool` → `./idempotency` (runtime 2.2), потім
d.ts `./retry`, `./breaker`, `./ratelimit`, `./tee`. Кожен — з тестом на повідомленні каналу,
що падає без зміни, і tsd на `TMessage`.

### Етап 4. Канали (`feat(<subpath>):`, по коміту на провайдера)

| Subpath | Джерело | Нове | Баги джерела, що виправляються | ~src | Розмір |
| --- | --- | --- | --- | --- | --- |
| `./twilio` (SMS, MMS, WhatsApp-префікс, RCS `rcs:`) | thinwrap (запит, хости), twilio-node (статуси) | `num_segments` у receipt, коди → категорії (21610 → `opted-out`, 21211/21614 → `invalid-recipient`, 21408 → `configuration`, 63016 → `outside-window`, 30003 → `unreachable`), correlation id у query `StatusCallback` (підпис його покриває) | T1, T6, T11, V7, V8 | 300 | M |
| `./vonage` (SMS API) | thinwrap | усі `messages[]`, `message-count` → segments, `client-ref` | T2 | 220 | S |
| `./infobip` (SMS v3, RCS) | thinwrap, Infobip SDK | REJECTED у 200 → відмова за назвою групи, `callbackData` → correlation | NV4 | 200 | S |
| `./sinch` (SMS batches) | thinwrap | `client_reference`, регіони | — | 130 | S |
| `./aws-sms` (End User Messaging SMS) | `internal/sigv4.js` | `SendTextMessage`, configuration set, `MessageId`, коди помилок AWS | — | 220 | S–M |
| `./turbosms` (SMS, Viber, гібрид) | документація | `sequence_id` = клієнтський reference → `hasIdempotencyKey` (дедуплікація провайдера, 30 днів) | — | 250 | M |
| `./alphasms` (SMS, Viber, гібрид) | документація | — | — | 250 | M |
| `./smsclub` (SMS, Viber, гібрид) | документація | ліміт 9 запитів/с, статуси опитуванням (1.4) | — | 250 | M |
| `./rbm` (Google RCS Business Messaging) | документація, @google/rcsbusinessmessaging як довідка | `google-auth`, `messageId` клієнта = ідемпотентність, capability check → `not-on-channel` до відправлення | — | 300 | M |
| `./meta` | thinwrap (WhatsApp Cloud: text/template/interactive, таблиця `mapWhatsAppCode`) | Messenger Send API і Instagram (нові), шаблон обов'язковий поза вікном, `biz_opaque_callback_data` → correlation, версія Graph як опція з датованим значенням | T10 | 600 | L |
| `./telegram` | ntba (конверт, поля помилок), thinwrap | опис → категорія (403 blocked/kicked → `blocked`, «can't initiate conversation» → `not-on-channel`, 400 «chat not found» → `invalid-recipient`, `migrate_to_chat_id`), HTML-екранування, ліміти, inline-кнопки, media через нативний `FormData` | T7, V11, TG1 | 580 | M |
| `./viber` (Bot API) | документація, viber-bot як довідка | `status != 0` → помилка; 5/6 → `not-on-channel` | VB1 (у 1.4) | 250 | M |
| `./slack` (Web API + incoming webhook) | thinwrap, visulima (`chat.postMessage`) | `ok:false` → категорії, mrkdwn, `ts` як id, без повтору `chat.postMessage` після мережевої помилки, `state: 'sent'` | SL1 | 280 | M |
| `./discord` (бот REST + webhook) | thinwrap (webhook `?wait=true`) | бот REST, `allowed_mentions: { parse: [] }` за замовчуванням, `thread_id` у query, `nonce` + `enforce_nonce` (безпечний повтор), бакети з `X-RateLimit-*` | T8, V10, DC1 | 300 | M |
| `./teams` (Workflows webhook + Bot Framework) | thinwrap (конверт Adaptive Card, `failureStatusFor2xx`) | Workflows 202 → `accepted`; бот: токен client credentials, `serviceUrl` лише з allowlist, відправлення за відомою conversation reference | T9, V-MessageCard, BB1 | 320 | M–L |
| `./google-chat` (webhook + Chat API app) | thinwrap (webhook) | Chat API app через `google-auth`, `name` як id, `threadKey` | — | 250 | M |
| `./fcm` (HTTP v1) | thinwrap (JWT, oneof цілі), firebase-admin як довідка | `details[].errorCode` перед `status` (UNREGISTERED → `unregistered`, SENDER_ID_MISMATCH → `invalid-recipient`, QUOTA_EXCEEDED → `rate-limit`), зарезервовані ключі data, TTL у `android`/`apns`/`webpush` | T3, T5, V16, FB1 | 350 | M |
| `./apns` (HTTP/2, token) | thinwrap (`createApnsJwt`, `finalizePushType`, таблиця reasons), node-apn і visulima (сесія) | `internal/http2.js`, `apns-id` як id, явне середовище (не `NODE_ENV`), priority 5 для background, ліміт 4/5 КБ, `ExpiredProviderToken` → новий токен один раз | T3, T4, V15, AP1 | 400 | M–L |
| `./webpush` (VAPID) | http_ece, visulima (звірка), RFC 8291/8292 | `node:crypto` (`createECDH`, `hkdfSync`), JWT на аудиторію в кеші, ≤3993 байт, перевірка `p256dh`/`auth`, `Topic`, 404/410 → `unregistered`, 413 → `validation`, SSRF-перевірка endpoint (`isPublicUrl` з `./attachments` → `internal/`) | V14, EC1 | 250 | M |

Разом ~5 700 рядків `src/` провайдерів, плюс d.ts (~40 %) і тести (1,5–2×). Кожен subpath
отримує бюджет у `scripts/size-budgets.json` (орієнтир mailer: провайдер 7–9,5 КБ поверх кореня).

**Хвилі всередині етапу 4** (від того, що закриває одноразові коди й алерти): SMS-провайдери →
`./telegram` → `./meta` → push → робочі чати → `./viber`, `./rbm`, українські.

### Етап 5. Ревʼю, продуктивність, документація

- хвиля ревʼю (`fix:`/`perf:`), як R1–R42 у 1.1: кожна знахідка — коміт з тестом;
- `pnpm bench` для гарячих шляхів (сегменти, екранування, підпис), оновлення `bench/baseline.json`;
- docs: розділ «Channels» у сайдбарі (`docs/.vitepress/config.mts`), сторінка на кожен subpath,
  `Known issues` (неперевірені на живому API провайдери), клітинки `docs/comparison-channels.json`
  (🔜 → ✅ лише для зробленого); CHANGELOG з пунктом про розширені об'єднання;
  `chore(release): 1.3.0`.

---

## 6. Реліз 1.4 — замкнений цикл

### 6.1 `./channel-webhooks`

Спільна частина `request.js` і `sns.js` — у `src/internal/webhook/` (етап `refactor:`, розмір
`./webhooks` не змінюється), один `WebhookVerificationError`. Наявні хелпери закривають більшість
схем: `checkBodyHmac` (Viber, Meta), `tokenCheckOf` (Telegram), `basicCredentialsOf` (Infobip,
українські з Basic), `hmacOf` + `checkSignedSeconds` (Slack v0, Sinch), `createSnsVerifier` (AWS
SMS). Нові: Twilio (HMAC-SHA1 від URL + відсортованих параметрів, base64), порівняння
base64-підпису, Vonage JWT HS256 з `payload_hash`, хелпер GET `hub.challenge` Meta. Верифікатор
будує `id` події з id провайдера, ніколи з `To` (воно потрапляє в `deliveryEvent.id` аудиту), і
нормалізує одержувача через `normalizePhone` (Vonage шле `447…` без `+`).

| Провайдер | Схема | Джерело | Вектори |
| --- | --- | --- | --- |
| Twilio | HMAC-SHA1 від URL + відсортованих параметрів, `bodySHA256` для JSON; URL лише з опцій (`WebhookRequest.url`), не із заголовка; дедуплікація за `I-Twilio-Idempotency-Token` | twilio-node (FEATURE) | ~20 з `spec/validation.spec.js` |
| Vonage | SMS `sig` (4 алгоритми) з вікном `timestamp`; Messages JWT лише HS256 + `payload_hash` = sha256(body) + вікно `iat` + `jti` | документація | 5 з SDK |
| Sinch | HMAC-SHA256 `body.nonce.timestamp` над сирими байтами, вікно, nonce у сховище | документація | DLR SMS і Conversation |
| Infobip | облікові дані з налаштувань вебхука (Basic або токен) | документація | згенерувати й заморозити |
| AWS End User Messaging SMS | SNS v1/v2 (вже є) | mailer | з mailer |
| Meta (WhatsApp, Messenger, Instagram) | `X-Hub-Signature-256` HMAC над сирим body (резолвер без часу) + GET `hub.challenge` | документація | згенерувати |
| Viber | `X-Viber-Content-Signature` HMAC-SHA256 ключем-токеном (без часу) | документація | 1 з viber-bot |
| RBM | `X-Goog-Signature` HMAC-SHA512 від base64-тіла, `clientToken` (звірити з документацією Google) | документація | згенерувати |
| Telegram | `X-Telegram-Bot-Api-Secret-Token` обов'язковий, дедуплікація `update_id`; `my_chat_member` → `kicked` = `blocked` | ntba (політика) | тести ntba 224–268 |
| TurboSMS, AlphaSMS | колбеки DLR за документацією; SMSClub — лише опитування | документація | з прикладів документації |
| Teams bot (опційно) | Bot Framework JWT: OpenID → JWKS, RS256/384/512, `iss`, `aud`, endorsements `msteams`, `serviceurl` = `activity.serviceUrl` | botbuilder (FEATURE) | згенерувати |

**Таблиці статусів** (з рангом, закріплені тестом мапінгу на кожного провайдера; правило
`docs/guide/webhooks.md`: `unknown` замість здогадки):

- Twilio: accepted/scheduled/queued/sending → `accepted`; sent → `sent`; delivered → `delivered`;
  read → `read`; undelivered/failed → `failed` (категорія з ErrorCode); canceled → `failed`;
  partially_delivered → `unknown` з `raw` (Novu губить scheduled, read, canceled,
  partially_delivered — NV1);
- Vonage DLR: accepted/buffered → `sent`, delivered, expired, failed/rejected → `failed`,
  unknown → `unknown`;
- Sinch SMS: Queued → `accepted`, Dispatched → `sent`, Delivered, Expired,
  Failed/Rejected/Aborted/Cancelled/Deleted → `failed`, Unknown → `unknown`;
- Meta: sent, delivered, read, failed (131047 → `outside-window`, 131026 → `not-on-channel`,
  131050 → `opted-out`); Messenger/Instagram — за watermark;
- Viber: delivered, seen → `read`, failed; subscribed/unsubscribed → `subscribed`/`unsubscribed`.

**Звірка без вебхуків:** `pollStatus(ids)` на транспортах, що вміють (SMSClub, TurboSMS), і
функція `reconcile`, яку в 1.5 викликає воркер черги.

### 6.2 `./suppression` — один список для email і каналів

Пункт Phase 2 roadmap mailer («a suppression list per tenant and stream, checked before a message
is queued, with a bypass policy for transactional mail») і opt-out messenger — одна річ:

- `SuppressionStore`: `isSuppressed(tenantId, recipientHash, channel | 'email' | '*', stream?)`,
  `suppress`, `unsuppress`; одержувач — HMAC під ключем застосунку (email — адреса в нижньому
  регістрі, телефон — E.164), не відкрито; сховище в пам'яті (MongoDB — 1.5);
- `SuppressionTransport` — декоратор над будь-яким транспортом; відмова — **невдалий** receipt
  `opted-out`, а не успіх (баг V1 visulima), тож фолбек і pool бачать її правильно;
- транзакційні (одноразові коди, скидання пароля) обходять лише явним прапорцем;
- джерела: email — `bounced` (hard), `complained`, `unsubscribed` з `./webhooks`; канали — Twilio
  `OptOutType` (STOP/START/HELP), Vonage inbound, Sinch `OPT_OUT`, WhatsApp 131050, Viber
  `unsubscribed`/`subscribed`, Telegram `kicked`, помилки відправлення (21610 тощо).

### 6.3 24-годинне вікно (у `./meta`)

`ConversationWindowStore` оновлюється з вхідних вебхуків (час останнього повідомлення
користувача на пару сторінка/номер — одержувач); поза вікном вільний текст відмовляється з
`outside-window` (шаблон або message tag Messenger `HUMAN_AGENT`, 7 днів).

### 6.4 `./fallback` — між каналами, разом з email

Кроки — `{ transport, message }`, бо повідомлення в кожного каналу своє (WhatsApp → SMS →
email). Наступний крок — на `rejected`, `invalid-recipient`, `not-on-channel`, `outside-window`,
`unregistered`, `unreachable`; ніколи на `opted-out`; на `blocked` — лише якщо дозволено опцією;
ніколи після `deliveryUnknown` без ключа ідемпотентності. Пригнічене чи дедупліковане відправлення
не є успіхом (V1). Результат — receipt останнього кроку і перелік спроб. Фолбек «немає receipt до
дедлайну» потребує черги — у 1.5.

### 6.5 Rate limits каналів

`./ratelimit` + `rules: [{ key?, limit, intervalMs, burst }]`, атомарне резервування за всіма
правилами (GCRA: `t = max(now, maxᵢ(TATᵢ − τᵢ))`), пауза ключа на `retry_after` з 429. Пресети:
Telegram 30/с глобально + 1/с на чат (20/хв, якщо `chat_id < 0`); Slack ~1/с на канал; WhatsApp —
тири; вартість SMS — `countSegments`. Ключ зі спільного сховища — хеш `to`, не номер. Discord —
бакети із заголовків усередині `./discord` (алгоритм discord.js: очікування до відправлення,
глобальні 50/с, переназначення хешів бакетів, ліміт повторів на 429). Лімітер ntba — лише довідка
(послідовне захоплення токенів перевищує ліміт — TG3).

---

## 7. Реліз 1.5 — черга, outbox і аудит для каналів

- **Задача каналу** (`./queue`): ім'я `'channel'`, а не `'mail'`; `CHANNEL_V1_KEYS` окремо від
  `V1_KEYS`; `parse` розгалужується на `typeof data.channel === 'string'` до перевірки ключів.
  Форма: `{ v: 1, channel, kind, template?/context?/locale? | content: { text?, media?, buttons?,
  payload?, providerTemplate? }, to, from?, priority, tags?, metadata, idempotencyKey, tenantId?,
  correlationId, notBefore?, expiresAt?, enqueuedAt, hash, mac?, kid?, trace? }`. Шаблон WhatsApp —
  у `content.providerTemplate`, бо `template` — це назва локального шаблону. Id задачі —
  `ns\0tenant\0key\0channel` (SMS і email під одним ключем не зіткнуться). `priority`
  обов'язковий (`internal/priority.js`).
- **API:** `prepareChannelJob`, `parseChannelJob`, `createChannelQueue`,
  `createChannelJobHandler({ transport })` з роутером `./channels`; `ChannelEnqueueResult` без
  обов'язкового `messageId`. `parseMailJob`, `MailJobData` і `createMailJobHandler` не
  змінюються.
- **Окрема черга для каналів** (BullMQ `queueName`, інша колекція outbox) — правило експлуатації,
  записане в docs: воркер 1.2 на спільній черзі відпускав би задачі каналів кожні 5 хв до 7 днів
  (погано для одноразових кодів), а пауза 429 Telegram з `rateLimitScope: 'queue'` не зупиняє email.
  Ключ `channel` ніколи не йде у відкритий `ENVELOPE`.
- **Воркер:** рендер `text` через `./templates` (`channel` у вході рендеру, без перевірки
  subject), media через `resolveAttachment`, будівник `createChannelMessage`; після `accepted`
  подія `sent`, коли receipt каже `state: 'sent'`.
- **`./mongodb`:** сховища suppression і вікна 24 год; `eventsOfProviderMessage` з `provider` і
  складеним індексом (Telegram `message_id` і Slack `ts` унікальні лише в межах чату).
- **`./audit`:** `channel` у `AuditEvent`; **crypto-shredding одержувачів** — HMAC + зашифрований
  блок, ключ на одержувача, стирання ключа = стирання; пункт roadmap mailer, робиться один раз для
  адрес і номерів (~400 рядків).
- **`./otel`:** `instrumentHandler` з атрибутом `mailer.channel` для задач каналів.
- **Фолбек за дедлайном:** відкладена задача, що читає стан з аудиту й запускає наступний крок,
  якщо немає `delivered`/`read`.
- **Ідемпотентність через провайдера:** клієнтський reference 1.3 стає ключем для TurboSMS
  `sequence_id`, RBM `messageId`, Discord `nonce` + `enforce_nonce`; деінде — `delivery_unknown`
  і звірка (`reconcile` 6.1).

---

## 8. Баги конкурентів, які не повторюємо (виправляються в порті)

| Id | Джерело, місце | Що не так | Як у нас |
| --- | --- | --- | --- |
| V1 | visulima `suppression.ts:57`, `dedupe.ts:35`, `routing/index.ts:83` | пригнічене/дедупліковане = успіх, фолбек зупиняється | невдалий receipt `opted-out` / `deliveryUnknown` |
| V2 | visulima `queue/worker.ts:55` | збій одного каналу перевідправляє всі | задача на одне повідомлення каналу |
| V3 | visulima `webhooks/standard.ts:63`, `slack.ts:38`, `sns.ts:232` | невідома подія → `delivered` | `unknown` |
| V4 | visulima `http.ts:94`, `retry.ts:22`, `worker.ts:43` | повтори на трьох рівнях (до 80 POST), без Retry-After | один рівень, Retry-After |
| V5 | visulima `circuit-breaker.ts:23`, `rate-limit.ts:22` | один breaker і лімітер на всі канали | декоратор на транспорт |
| V7 | visulima `http.ts:103` | POST повторюється після таймауту | `deliveryUnknown` |
| V8 | visulima `utils/sms.ts:12` | частковий збій прихований | receipt на одержувача |
| V9 | visulima SNS `:167`, APNs `:153` | вигадані id як id провайдера | `MessageId`, `apns-id` |
| V12 | visulima `webhooks/twilio.ts:101` | підписаний URL береться із заголовка запиту | URL лише з опцій |
| V14 | visulima `push/web-push` | немає ліміту розміру, поганий ключ кидає з `send()`, 404/410 не класифіковані | ліміт до запиту, ключ перевіряється при створенні, `unregistered` |
| V15 | visulima `push/apns` | немає таймауту, GOAWAY, `unref`; reasons сирим текстом | `internal/http2.js`, таблиця reasons |
| T1 | thinwrap `twilio.connector.ts:214` і ще 7 | прийняте SMS завжди `sent` | `accepted` + статус провайдера |
| T2 | thinwrap `vonage.connector.ts:161` | перевіряється лише `messages[0]`, сегменти губляться | усі частини, `segments` |
| T3 | thinwrap apns `:94`, fcm `:136` | немає кешу токена → `TooManyProviderTokenUpdates` | кеш + single-flight |
| T5 | thinwrap fcm `:545` | `details[].errorCode` не читається | читається першим |
| T6 | thinwrap twilio `:330` | 21610 (STOP) → `invalid_recipient` | `opted-out` |
| T7 | thinwrap telegram `:153` | будь-який 403 → `invalid_recipient` | `blocked` / `not-on-channel` |
| T8, V10 | thinwrap discord `:77`, visulima discord `:42` | немає `allowed_mentions`, `@everyone` пінгує | `parse: []` за замовчуванням |
| T9 | thinwrap ms-teams `:184` | Workflows 202 = `sent` | `accepted` |
| T10 | thinwrap whatsapp `:84` | `type: 'template'` без шаблону | `validation` до запиту |
| T11 | thinwrap `base.connector.ts:85` | без signal і таймауту; abort → `invalid_request` | `signal`, `timeout` |
| NV1 | Novu twilio `:82`, `:88` | губить scheduled, read, canceled, partially_delivered | таблиця 6.1 |
| NV2 | Novu telnyx `:58` | кореляція за id події, не повідомлення | `data.payload.id` |
| NV4 | Novu infobip `:45` | REJECTED у 200 = успіх | `isAnswer` |
| TG1 | ntba `transport.ts:165–191` | `sendMessage` повторюється після таймауту, 5xx і збою читання після 200 | повторюється лише 429 |
| TG2 | grammY `webhook.ts:39` | без secret приймає все; ранній вихід за довжиною | secret обов'язковий, HMAC-порівняння |
| TG3 | ntba `ratelimiter.ts:115` | токени захоплюються послідовно → перевищення | GCRA атомарно |
| TW1 | twilio-node `webhooks.ts:450`, `:433` | токен з `process.env`, `validate: false` вимикає перевірку | лише опції, перевірка завжди |
| VG1 | vonage `sms.ts:185`; `jwt/verifySignature.ts:47` | `===`, без вікна; JWT без `payload_hash`, RS256+HS256 | 6.1 |
| SN1 | sinch `authorization.helper.ts:55`, `:64` | `===`, час не перевіряється, тіло пересеріалізується | 6.1 |
| AP1 | node-apn `client.js:565`, `:142`, `config.js:27` | `Retry-After` з великої літери в HTTP/2, повтори 500/503, середовище з `NODE_ENV` | малі літери, без повтору, явне середовище |
| FB1 | firebase-admin `api-request.ts:250` | `messages:send` повторюється після ETIMEDOUT | `deliveryUnknown` |
| DC1 | discord.js `SequentialHandler.ts:428`, `utils.ts:140` | 429 не рахується → безмежні повтори; таймаут повторюється | ліміт; `nonce` + `enforce_nonce` |
| SL1 | @slack/web-api `WebClient.ts:664`; bolt `verify-request.ts:47` | `chat.postMessage` повторюється після мережевої помилки; вікно лише в минуле | `deliveryUnknown`; модуль різниці |
| VB1 | viber-bot `middleware.js:60`, `message-validator.js:13` | заголовок ніколи не читається, `==`, підписи в лог | 6.1 |
| BB1 | botbuilder `openIdMetadata.ts:45` | збій оновлення метаданих через 24 год відкидає все; немає single-flight | кеш лишається, single-flight |
| EC1 | http_ece `ece.js:28` | `ECE_KEYLOG=1` друкує ключі | не переноситься |

---

## 9. Тестування без e2e-акаунтів

- **Інваріанти email** — golden-тести 2.3 (fingerprint, hash і id mail job на значеннях 1.2); уся
  наявна сюїта mailer лишається зеленою без змін, крім перевернутого tsd 4.2.
- **Провайдери** — проти фейкових серверів (`node:http`, h2c для APNs за патерном
  `node-apn/test/client.js`) або `t.mock.method(globalThis, 'fetch')`; форма запиту, помилки в
  2xx, Retry-After, редагування секретів і одержувачів — з тестів thinwrap і visulima, плюс
  канальна матриця доставки (4.6).
- **Вебхуки** — проти векторів: Twilio (~20), Vonage (5), Sinch (2), Viber (1), Slack (1), RFC
  8188 §3.1–3.2 і RFC 8291 Appendix A для Web Push; для решти — згенерувати ключі один раз і
  заморозити тіло й підпис у `tests/fixtures/channel-webhooks/` (LF, порівняння байт у байт).
- **Тіла відповідей і колбеків** — з прикладів офіційної документації; у тестах і в docs
  позначати «перевірено за документацією, не на живому API».
- **Deno** — тест повтору запиту на перевикористаному з'єднанні для провайдерів без ключа
  ідемпотентності (як у email-провайдерів).
- **`tests/e2e/`** — набори пишуться одразу, але пропускаються без змінних середовища. Безкоштовні
  акаунти, які варто створити першими: Telegram-бот (BotFather), Slack і Discord (робочий
  простір), Firebase-проєкт (FCM), тестовий номер WhatsApp Cloud API (Meta for Developers),
  пробний Twilio, AWS sandbox. Українські провайдери платні; без акаунта їхні колбеки й коди
  статусів лишаються неперевіреними — головний ризик 1.4.

---

## 10. Ризики й відкриті питання

1. **Назва.** `@alexify/mailer` гірше знаходиться в пошуку npm за «sms» чи «whatsapp»;
   компенсується `description`, `keywords`, README і сторінкою порівняння каналів, але не
   повністю. Свідома ціна об'єднання.
2. **Розширені об'єднання** ламають вичерпний `switch` у TypeScript-користувачів (4.2). Якщо
   узгодження станів email і каналів вийде незграбним настільки, що доведеться змінити
   runtime-поведінку для email, — це вже 2.0, а не 1.3; поки аналіз такого не знайшов.
3. **Змішані розгортання 1.2/1.5** на одній черзі — лише правилом експлуатації (окрема черга),
   кодом це не закрити (7).
4. **Бюджети розмірів** — корінь і шість entry за крок від межі (4.6); кожне підвищення — у
   коміті, якому воно потрібне, з поясненням у повідомленні.
5. **Ширший semver і довший CI:** 64 entry, `export-parity` запускає процес на кожен; зміна API
   WhatsApp — реліз mailer.
6. **TurboSMS, AlphaSMS, SMSClub** — документація неповна (формат колбеків, підпис AlphaSMS,
   статуси Viber), джерела коду й акаунта немає. Робимо в 1.3 за документацією і позначаємо як
   неперевірені до першого користувача з акаунтом.
7. **Teams Bot Framework** — найскладніший канал (токени, JWKS, `serviceUrl`, проактивні розмови
   потребують вхідної події інсталяції). У 1.3 — відправлення за відомою conversation reference;
   прийом activity — у 1.4.
8. **Telnyx** — не в плані, але дешевий (~1–2 дні) і єдиний SMS-провайдер з власним
   `Idempotency-Key`. За правилом «few providers per channel» — чекає користувача.
9. **Версії Graph API** дрейфують: версія — опція `./meta` з датованим значенням за
   замовчуванням.
10. **HTTP/2 на Bun і Deno** — через Node-сумісність; `tests/runtime` має надіслати на локальний
    HTTP/2-сервер на всіх трьох.

---

## 11. Обсяг

| Реліз | Нове `src/` (оцінка) | Основне |
| --- | --- | --- |
| 1.3 | ~7 700: узагальнення ядра й декораторів ~1 000, `./channels` ~1 000, спільний шар (jwt, google-auth, http2, api-client) ~700, провайдери ~5 700; d.ts кореня +~400 | 20 провайдерів, декоратори для каналів |
| 1.4 | ~4 100: верифікатори й мапінг ~2 500, suppression ~600, вікно і фолбек ~600, ratelimit ~400 | замкнений цикл, один suppression для email і каналів |
| 1.5 | ~2 200: задача й воркер каналу ~900, сховища MongoDB ~300, crypto-shredding ~400, фолбек за дедлайном ~250, решта ~350 | черга, outbox, аудит каналів |

Разом ~14 тис. рядків нового коду; тести ≈1,5–2× від коду. Для порівняння, варіант із двома
пакетами — ~16 тис. нових і ~15 тис. скопійованих рядків, які далі жили б окремо.

---

## 12. Перехід: що робиться з messenger

1. **npm** — нічого: `@alexify/messenger` ніколи не публікувався (npm 404), користувачів немає.
2. **Що переїжджає в mailer** (етап 0): `docs/comparison.json` (11 бібліотек) і проза сторінки
   порівняння; із `CLAUDE.md` — правила каналів, рішення, список помилок конкурентів, платформні
   нотатки (Deno повторює запит, APNs через `node:http2`); цей план замінює `PLAN-v1.md`.
   Каркас (інструменти, тести, CI) не переїжджає — у mailer він той самий.
3. **Репозиторій `Alexis-Technologies/messenger`** — останній коміт у `main`: README «moved to
   @alexify/mailer» з посиланням; потім архівування в налаштуваннях GitHub (робить власник).
   Локальна гілка `feature/v1` з `PLAN-v1.md` не запушена: запушити для історії перед
   архівуванням або лишити локально.
4. **Vercel-проєкт `messengerat.vercel.app`** — видалити або перенаправити на
   `mailerat.vercel.app` (вручну в Vercel).
5. **Бренд** — індиговий знак messenger не потрібен; лишається бренд mailer.
6. **Індекс клонів** `~/Documents/open-source/messenger-alternatives/README.md` посилається на
   цей план.

---

## 13. Перші кроки

1. Етап 0 у mailer на `feature/messenger`: позиціонування, перенесення порівняння й тексту з
   messenger, `LICENSE`, розділ правил порту.
2. Фікси 2.4 — окремими `fix:`-комітами (за бажання — патчем 1.2.x до каналів).
3. Етап 1 (контракти з golden-тестами) і етап 2 (спільний шар) — після них кожен декоратор і
   провайдер незалежний, тож етапи 3–4 можна вести паралельно по subpath-ах.
