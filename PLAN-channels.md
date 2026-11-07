# План: канали в @alexify/mailer 2.0

Складено 2026-11-01, переглянуто 2026-11-06 після перевірки проти коду mailer 1.2.0 (додаток A).
Замінює `messenger/PLAN-v1.md` (коміт `3e19a6a` у гілці `feature/v1` репозиторію messenger):
канали, заплановані для `@alexify/messenger`, переходять у mailer як нові subpath-и, а messenger
не публікується. План спирається на проходи по коду mailer 1.2 (публічні типи — усі d.ts;
runtime — `src/internal`, `src/core`, декоратори, черга, сховища, вебхуки) і на код 11
конкурентів та 12 довідкових бібліотек, склонованих у
`~/Documents/open-source/messenger-alternatives/` (індекс з версіями й ліцензіями — `README.md`
тієї теки).

**Рішення:**

- SMS, RCS, WhatsApp, Messenger, Instagram, Telegram, Viber, Slack, Discord, Teams, Google Chat і
  push (FCM, APNs, Web Push) — у mailer, по subpath на провайдера; `@alexify/messenger` не
  публікується, його репозиторій архівується (розділ 12). Назва `@alexify/mailer` лишається;
- **2.0, а не адитивний 1.x:** адитивний шлях дав би дві паралельні родини назв (метрики,
  події логера й аудиту), два API черги і розрізнення email від каналу за наявністю поля. У 2.0
  — одна модель повідомлення, одна родина назв, одна черга. **Байти, що зберігаються, не
  змінюються й у 2.0**: формат email-задачі v1, id задачі, fingerprint, Message-ID задачі, id
  подій аудиту, ранги в MongoDB (розділ 2.3);
- три релізи: **2.0** — контракти, назви, черга, перебудова вебхуків, `./channels`, `./router`,
  декоратори і всі 19 провайдерів; **2.1** — замкнений цикл (вебхуки каналів, suppression,
  фолбек); **2.2** — сховища MongoDB для них, crypto-shredding, фолбек за дедлайном;
- **провайдер входить у реліз лише після живого прогону** `tests/e2e` на справжньому акаунті;
  провайдер без нього виходить пізніше мінорним релізом (розділ 9);
- **`./webhooks`** тримає спільний код, кожен верифікатор — subpath `./webhooks/<provider>`, як
  транспорт (`./webhooks/ses`, `./webhooks/telegram`);
- з конкурентів — feature-порт із заголовком походження, як у mailer 1.1; код mailer більше не
  копіюється — він узагальнюється на місці;
- Amazon SMS — через **AWS End User Messaging SMS** (`SendTextMessage`, pinpoint-sms-voice-v2);
- нова категорія помилки **`unreachable`**; WhatsApp, Messenger і Instagram — в одному **`./meta`**.

---

## 1. Коротко

1. **Надійний шар mailer здебільшого агностичний.** Без змін повідомлення каналу проходять:
   HTTP-шар (`requestWithRetry` з правилом «не надсилати повторно запит невідомого результату
   без ключа»), receipts, retry, breaker, ratelimit, tee, gate, outbox, BullMQ, audit-сінки,
   сховище ідемпотентності й replay-сховище вебхуків; ~88 % `./queue` не залежить від email.
   Ламаються: fingerprint ідемпотентності, `checkMessage`, розмір повідомлення в otel, logger
   (зокрема `recordMessage: 'inline'`), `getMessagesTo` і `getMessagesBySubject` у mock; hooks
   відмовляє; pool у змішаному складі зупиняє перехід не там; номери телефонів ніде не
   редагуються.
2. **Одна модель.** `Message` отримує `channel: 'email'`, `Channel` включає `'email'`,
   `AnyMessage = Message | ChannelMessage`. `tenantId?` — в обох моделях, кореляція — в
   `metadata.correlationId` для обох, як зараз. `Transport<TProviderId, TMessage = Message>`.
3. **Будівник і маршрутизатор — окремими entry:** `./channels` (будівник, телефони, сегменти,
   екранування) і `./router` (транспорт, що відправляє за `message.channel`), бо корінь має
   ~100 Б запасу (9,9 з 10 КБ), а email-користувач не має платити за таблиці GSM-7.
4. **Одна черга:** одне ядро зі стратегією на тип задачі; email-задача лишається v1 байт у байт,
   задача каналу — v2. API перейменовано без `Mail`: `createQueue`, `createJobHandler`.
5. **Вебхуки:** `./webhooks` — спільне, кожен провайдер — свій subpath, тож функція перевірки
   одного провайдера платить лише за нього.
6. **Синергія, якої немає ні в кого:** один список suppression на email і канали (пункт roadmap
   mailer, ще не зроблений), один фолбек WhatsApp → SMS → email за результатом, одна черга, один
   аудит, одне crypto-shredding одержувачів.
7. **Конкуренти — feature-порт:** жоден не годиться як база файл у файл (розділ 3.1). Майже
   дослівно — лише чисті функції й таблиці (thinwrap, twilio-node, http_ece,
   message-segment-calculator, discord.js).
8. **Обсяг:** ~15 тис. рядків нового `src/` за три релізи (розділ 11).

---

## 2. Що в mailer уже є і що змінюється

### 2.1 Використовується як є

- `internal/http.js`: `requestWithRetry`, `hasIdempotencyKey`, двозначна відповідь →
  `markDeliveryUnknown`, `Retry-After` понад 30 с — кинути для черги. Провайдер ставить
  `hasIdempotencyKey` лише там, де ключ відображається на дедуплікацію самого провайдера.
- `ProviderTransport` — готова база транспорту каналу (нічого не припускає про повідомлення);
  `refusal.js` (`unsupported`) — для лімітів каналу; `schedule.js` читає `scheduledAt`, яке має
  ту саму назву в повідомленні каналу; `uuid.js` — для `apns-id`; gate, batch, backoff, verify,
  unsent, polling-driver.
- `core/receipt.js`: категорії не валідуються, нові не потребують коду (лише значення
  `retryable` за замовчуванням — 2.2).
- `./retry`, `./breaker` (`FAILURE_CATEGORIES` — allowlist network, timeout, server-error,
  service-unavailable, тож нові категорії breaker уже не рахує), `./ratelimit` (ключ за
  замовчуванням `''`, вартість 1), `./tee`.
- `./mongodb` (outbox, audit-сінк, сховище ідемпотентності), `./bullmq`, `./audit`-сінки:
  документ outbox непрозорий для `data`, нічого email-специфічного.
- `webhooks/request.js`: `claimDelivery` з reserve/commit/release і токеном; ключі сховища —
  SHA-256 від id, тож id з номером телефону не зберігається відкрито; три резолвери опцій
  (з часом, без часу, облікові дані); `createSnsVerifier(options, service)` уже
  параметризований (`eventsOf`, `trust`…) і спільний для SES і Scaleway — для AWS SMS лише новий
  `eventsOf`.
- Рендерер `./templates` уже рендерить шаблон лише з `text`; `subject` вимагає тільки черга.

### 2.2 Узагальнюється на місці

| Модуль | Сьогодні з повідомленням каналу | Зміна | Реліз |
| --- | --- | --- | --- |
| `internal/fingerprint.js` | TypeError на `message.sender` (поза `try` в `./idempotency`) → ламає `./idempotency` і подію `rendered` воркера | гілка каналу з першою міткою `channel\0<channel>` (не перетинається з email): from, to (підписка Web Push — канонічним JSON), text, media (url/id, тип, назва — без байтів), buttons, template, mentions, payload канонічним JSON, tags, scheduledAt, metadata; без idempotencyKey і tenantId. Канонічний JSON — з `queue/hash.js` у `internal/`. Email-гілка без змін, `channel` і `tenantId` не читає | 2.0 |
| `core/message.js` | `checkMessage` кидає; його єдиний виклик — hooks | `checkMetadata`, `checkScheduledAt` і перевірка `tenantId` → `internal/message-checks.js` (корінь не росте); `checkChannelMessage` — у `internal/channel/`; `createMessage` ставить `channel: 'email'` і приймає `tenantId?` | 2.0 |
| `core/message-id.js` | `pinMessageId` — no-op (немає `sender`) | для каналу закріплюється клієнтський reference (ключ ідемпотентності або UUID) у тій самій WeakMap, тож кожна спроба retry і pool несе один id: TurboSMS `sequence_id`, Vonage `client-ref`, Sinch `client_reference`, RBM `messageId`, Discord `nonce` | 2.0 |
| `core/receipt.js` | `createFailedReceipt` пропускає лише відомі ключі; `retryable` — з HTTP-статусу | `channel?`, `segments?`, `state?` у receipt; `retryable` за замовчуванням з категорії (`unreachable` — так, інші шість — ні), email-категорій це не торкається. Словесних правил для нових категорій не додавати — вони перекласифікували б email | 2.0 |
| `internal/api-client.js` | `URLSearchParams` стає `{}`; Content-Type перезаписується (а `content-type` склеюється); Retry-After лише з заголовка; текст «ok» → `deliveryUnknown`; `accepts`, `retryDelayMs`, `sleep` не передаються | розділ 4.5 | 2.0 |
| `internal/api.js` | тягне `core/address`, attachment, provider (а з ним calendar і message-id) | `mergeBatch`, `checkCredential`, `sendConverted`, `sentWith` → новий internal-модуль, `api.js` їх реекспортує | 2.0 |
| `internal/redact-addresses.js`, `redact.js` | редагує лише email-адреси (від `@`); ключів каналів у `SECRET_KEYS` немає, `authtoken` теж | новий `redactRecipients` (адреси + E.164 з `+`) на всіх 16 місцях виклику, `queue/outcome.js` `reasonOf` (сховище й аудит) і `./bullmq` включно; logger і otel додатково редагують точний `message.to`. `SECRET_KEYS` += `authtoken`, `bottoken`, `webhookurl`, `signingsecret`, `vapidprivatekey`, `serviceaccount`, `private_key`, `client_secret`, `access_token`, `refresh_token`, заголовки `x-viber-auth-token`, `x-goog-api-key`. Повний URL ніколи не логується (токен Telegram у шляху, секрет вебхуків Slack/Discord/Teams у самому URL) | 2.0 |
| `ses/http-client.js` | SigV4 живе всередині `./ses` | → `internal/sigv4.js` (`refactor:`), потрібен `./aws-sms` | 2.0 |
| `./hooks` | `isShaped` відмовляє (потрібні `sender.address`, `recipients[]`) як `rejected`, а pool на цьому зупиняє перехід | приймає повідомлення з `channel` і перевіряє `checkChannelMessage` | 2.0 |
| `./logger` | TypeError на `recipients`; з `recordMessage: 'inline'` — на `message.content` | події `message.sending/sent/failed/retrying` з `channel` для всіх (було `email.*`), текст «Sending message.»; гілка каналу: `{channel, recipientCount: 1, mediaCount, buttonCount, hasTemplate, hasPayload}`; `inline` для каналу пише `text`; `to` — лише з `recordMessage` | 2.0 |
| `./otel` | TypeError: `Buffer.byteLength(subject)` | метрики `mailer.message.{attempts, messages, retries, duration, message.size, attachments, active_sends, segments}` з атрибутом `mailer.channel` (було `mailer.email.*`), атрибут метрик `mailer.priority` (було `email.priority`); span `${channel} send` (для email — те саме `email send`), `spanPrefix` лишається перевизначенням; атрибути каналу `mailer.channel`, `mailer.message.text.length`, `.media.count`, `.segments`, `.encoding`, `mailer.tenant.id` (лише span); `from` — лише з `recordSensitiveData`, `to` — ніколи; email-атрибути span-ів без змін | 2.0 |
| `./mock` | TypeError у `getMessagesTo`; `getMessagesBySubject(undefined)` повертає всі повідомлення каналів | збіг за `to` (і endpoint Web Push), `getMessagesByChannel`; `getMessagesBySubject` лише по email; `hasAddress` повертає false для `null` | 2.0 |
| `./pool` | `hasMessageRejection` зупиняє перехід лише на `validation`/`rejected` — `opted-out` пішов би до іншого провайдера; у змішаному пулі email-транспорт своєю `validation` зупиняє SMS | `STOP_FAILOVER` = validation, rejected, invalid-recipient, opted-out, outside-window, blocked, unregistered, not-on-channel; `unreachable` — переходить (інший маршрут SMS може дістатися апарата). Члени пулу — один канал (тип `PoolConfig<P, M>` це тримає); змішані канали — `./router`, WhatsApp → SMS — `./fallback` | 2.0 |
| `./idempotency` | відхиляє відправлення через TypeError у fingerprint; без гілки каналу дві різні SMS під одним ключем збіглися б | гілка fingerprint; namespace `${namespace}:${key}` для обох моделей, без `tenantId` (інакше задача, яку почав відправляти 1.2, після оновлення шукала б ключ в іншому namespace); тенант у ключі задає застосунок через `key` чи `namespace` | 2.0 |
| `./retry`, `./breaker`, `./ratelimit`, `./tee` | працюють | лише d.ts (параметр `TMessage`) | 2.0 |
| `./audit` | стани не валідуються; таблиці закриті | ранги й `FINAL` (`states.js`), `STATES` (`delivery-event.js`), рівні логер-сінку (розділ 4.2); логер-сінк пише `message.<state>` з `channel` для всіх (було `mail.<state>`) | 2.0 |
| `./queue` | `parseMailJob` відмовляє на будь-якому ключі поза `V1_KEYS`; воркер 1.2 відпускає таку задачу кожні 5 хв до 7 днів | одне ядро зі стратегіями, задача каналу v2, API без `Mail` (розділ 4.6) | 2.0 |
| `./webhooks` | 15 верифікаторів в одному entry (15,3 з 15,5 КБ); `WebhookRequest` без `url`; `recipientOf` лише знижує регістр домену | спільне лишається в `./webhooks`, верифікатори — `./webhooks/<provider>`; `WebhookRequest.url?` (Twilio підписує URL); телефон нормалізується `normalizePhone` (розділ 4.7) | 2.0 (перебудова), 2.1 (канали) |
| `tests/unit/delivery.test.js` | матриця пишеться вручну, тест звіряє її з кожним subpath, що має `http-client.js` | файл провайдера каналу — теж `http-client.js`; тест звіряє кожен такий subpath з email-матрицею або з матрицею каналів (`delivery-channels.test.js`) | 2.0 |
| `./mongodb` | `eventsOfProviderMessage` з'єднує лише за `providerMessageId` | опційний `provider` + складений індекс `{provider, providerMessageId}` | 2.2 |

### 2.3 Що ламається в 2.0 і що не змінюється ні на байт

**Ламається** (розділ «Upgrading from 1.x» у CHANGELOG):

1. `Message.channel: 'email'` — `createMessage` ставить його; у типі обов'язковий, а в runtime
   повідомлення без `channel` вважається email, тож ручні об'єкти працюють далі. `Channel`
   включає `'email'`; `AnyMessage = Message | ChannelMessage`; `MessageOf<C>` охоплює і email.
2. Розширені об'єднання (розділ 4.2): `ReceiptErrorCategory`, `DeliveryEventType`,
   `MessageState` — ламають вичерпний `switch`.
3. Назви спостережуваності: метрики `mailer.email.*` → `mailer.message.*` з `mailer.channel`,
   атрибут метрик `email.priority` → `mailer.priority`; події логера `email.*` → `message.*`;
   події логер-сінку аудиту `mail.<state>` → `message.<state>`. Назви span-ів і email-атрибути
   span-ів не змінюються.
4. `./queue`: `createMailQueue` → `createQueue`, `createMailJobHandler` → `createJobHandler`,
   `prepareMailJob`/`parseMailJob` → `prepareJob`/`parseJob`, `MailQueueError` → `QueueError`
   (коди `queue.*` ті самі), `MailJobData` → `JobData`, константи відповідно.
5. `./webhooks`: верифікатори переїжджають у `./webhooks/<provider>`, назви функцій ті самі; у
   `./webhooks` лишаються `WebhookVerificationError`, сховища replay і типи.
6. `DeliveryEvent.channel` — обов'язковий (15 email-верифікаторів ставлять `'email'`);
   додається `error?: { category, code }`.

**Додається, нічого не ламаючи:** `Message.tenantId?`.

**Не змінюється ні на байт** (golden-тести на значеннях 1.2 — першим комітом етапу 2):
fingerprint email-повідомлення (він не читає `channel` і `tenantId`); JSON, hash, MAC, id і
Message-ID/Content-ID email-задачі (задача v1 без нових ключів, той самий seed
`ns\0tenant\0key`); `ENVELOPE` запечатаної задачі (ключ `channel` у відкритій частині провалив би
задачу воркером 1.2 одразу, `queue.invalid_job`); id подій аудиту; ранги станів 1.2; namespace
`./idempotency`; `createMessage`, крім поля `channel`; назви span-ів.

### 2.4 Знахідки в mailer поза каналами — патч 1.2.1

Кожна — окремий `fix:`-коміт з тестом, що падає без неї, на гілці від `main`, до 2.0; знахідка,
що не відтворюється, відпадає:

- `internal/polling-driver.js:167/216/247` логує `error?.message` без редагування;
- `otel` (`extractNetworkAttributes`, `:403–416`): будь-який конфіг з `host` і `port` — це
  `smtp`, а з `domain` — URL Mailgun (перевіряти `id`);
- `./idempotency` (`:173`, `:199`): тексти receipt вставляють ключ без редагування, а
  `#storeFailure` (`:212`) — сирий `messageOf(error)`;
- `./mock`: `reset()` не чистить `sentRawMessages`;
- `breaker:32`, `logger:375`, `pool:292`, `otel:486`, `tee:26` читають `errors` невдалого
  receipt як масив, хоча в типі він необов'язковий (власний транспорт може його не дати);
- `./pool` логує помилку селектора без редагування (`pool-transport.js:377`);
- `./pool` перехоплює будь-який throw, TypeError теж, і переходить далі, ховаючи баг, — те, що
  65 виправив для `./retry`.

---

## 3. Звідки береться нове

### 3.1 Конкуренти й довідкові бібліотеки — feature-порт

| Джерело | Ліцензія | Що беремо | Куди | Режим |
| --- | --- | --- | --- | --- |
| **@thinwrap/notifications** 1.2.0 | MIT | запити й відповіді Twilio, Vonage, Infobip, Sinch, WhatsApp Cloud, Telegram, вебхуків Slack/Discord/Teams/Google Chat, FCM, APNs; таблиці кодів помилок; тести на форму запиту (15–42 на провайдера) | SMS, `./meta`, чати, push | FEATURE; кілька функцій і таблиць — майже дослівно |
| **@visulima/notification** 2.0.0 | MIT | Web Push (VAPID + RFC 8291, коректний), APNs (сесія HTTP/2, кеш JWT), верифікатори (Twilio, Slack v0, Discord/Telnyx Ed25519, Vonage JWT), парсери вхідних Twilio/Vonage для STOP, ~60–70 тестів | `./webpush`, `./apns`, `./webhooks/<provider>` | FEATURE (~1 000 з 8 968 рядків) |
| **@novu/providers** 2.6.5 | MIT | лише таблиці статусів `parseEventBody` (Twilio, Telnyx, Plivo) — з виправленнями | `./webhooks/<provider>` | REFERENCE |
| **twilio-node** 6.2.0 | MIT | алгоритм `X-Twilio-Signature` (варіанти URL, масиви, `bodySHA256`) і ~20 векторів; enum `MessageStatus` | `./webhooks/twilio`, `./twilio` | FEATURE |
| **telnyx-node** 7.28.0 | MIT | Ed25519-верифікатор, статуси | довідка (Telnyx не в плані) | REFERENCE |
| **vonage-node-sdk** 3.30.1 | Apache-2.0 | 5 векторів підпису SMS (md5hash, md5, sha1, sha256, sha512) | тести `./webhooks/vonage` | код — з документації, вектори — з атрибуцією |
| **sinch-sdk-node** 1.7.0 | Apache-2.0 | вектори DLR SMS і Conversation, enum статусів і `Reason` | тести `./webhooks/sinch`, `./sinch` | так само |
| **plivo-node** 4.79.0 | MIT | V2/legacy вектори | довідка (Plivo не в плані) | REFERENCE |
| **node-telegram-bot-api** 2.1.0 | MIT | конверт `ok:false`, поля помилок, політика обов'язкового secret token, тести транспорту й вебхука, фейковий годинник лімітера | `./telegram`, `./webhooks/telegram` | FEATURE |
| **grammY** 1.46.0 | MIT | лише звірка | — | REFERENCE |
| **notifme-sdk** 1.16.25 | MIT | нічого (усе старше й гірше за інші джерела) | — | SKIP |
| **http_ece** 1.2.1 | MIT | aes128gcm одним записом, вектори RFC 8188 §3.1–3.2 | `./webpush` | FEATURE |
| **message-segment-calculator** 1.3.0 (Twilio) | MIT | таблиця GSM-7 (137 кодових точок), математика 1120 біт / UDH, `TestData`, опційна мапа smart encoding (~270) | `internal/channel/segments.js` | FEATURE, таблиці дослівно |
| **split-sms** 0.1.7 | MIT | правило розрізання (не розривати escape і сурогатну пару), кейси | `internal/channel/segments.js` | FEATURE |
| **@parse/node-apn** 8.1.1 | MIT | сесія HTTP/2 (reconnect на goaway, ping), таймаут з `NGHTTP2_CANCEL`, лічильник поколінь токена, заголовки, тестовий h2c-сервер | `./apns`, `internal/http2.js` | FEATURE |
| **@discordjs/rest** 2.5.0 | Apache-2.0 | алгоритм бакетів `X-RateLimit-*` і глобальний 50/с | `./discord` | код — з документації Discord, алгоритм як довідка |
| **firebase-admin** 14.5.0 | Apache-2.0 | вилучення коду помилки FCM (`details[].errorCode` перед `status`), таблиця кодів, політика кешу токена | `./fcm` | з документації + атрибуція таблиці |
| **@slack/bolt** 5.1.0, **@slack/web-api** 8.3.0 | MIT | верифікатор v0 (з виправленим вікном) і документований вектор; семантика 429 | `./slack` | FEATURE / REFERENCE |
| **botframework-connector** 4.1.6 | MIT | OpenID/JWKS, перевірка claims (`iss`, `aud`, endorsements, `serviceurl`), шляхи Connector API | `./teams`, `./webhooks/teams` | FEATURE |
| **viber-bot** 1.0.18 | Apache-2.0 | ендпоінти, `X-Viber-Auth-Token`, вектор HMAC | `./viber`, `./webhooks/viber` | REFERENCE + вектор |
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
— лише опитуванням). Гібрид Viber → SMS усі троє роблять на своєму боці. Акаунти платні, а
альфа-ім'я відправника може потребувати реєстрації в операторів — починати рано (розділ 9).

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

Усе нове в корені — лише типи, крім `channel` і `tenantId` у `createMessage` та кількох полів
receipt (4.9):

```ts
export type Channel =
  | 'email' | 'sms' | 'rcs' | 'whatsapp' | 'messenger' | 'instagram' | 'telegram'
  | 'viber' | 'slack' | 'discord' | 'teams' | 'google-chat' | 'push';

interface ChannelMessageBase<TChannel extends Exclude<Channel, 'email'>, TPayload = JsonObject> {
  readonly channel: TChannel;
  readonly text?: string;
  readonly media?: readonly ChannelMedia[];   // { url } | { content, contentType, filename? }
  readonly buttons?: readonly ChannelButton[];
  readonly payload?: TPayload;                // Block Kit, Adaptive Card, embed — as is
  readonly mentions?: ChannelMentions;        // none unless allowed
  readonly tags: readonly string[];
  readonly priority: Priority;
  readonly metadata?: Readonly<Record<string, string>>; // correlationId goes here, as for email
  readonly tenantId?: string;
  readonly idempotencyKey?: string;
  readonly scheduledAt?: Date;
  readonly expiresAt?: Date;                  // push TTL, SMS validity period
}
// SmsMessage (to: E164, from, text), RcsMessage, WhatsAppMessage (template), MessengerMessage,
// InstagramMessage, TelegramMessage (to: string | number), ViberMessage, SlackMessage,
// DiscordMessage, TeamsMessage, GoogleChatMessage, PushMessage (to: { token } | subscription)
export type ChannelMessage = SmsMessage | RcsMessage | WhatsAppMessage | /* … */ PushMessage;
export type AnyMessage = Message | ChannelMessage;
export type MessageOf<C extends Channel> = Extract<AnyMessage, { readonly channel: C }>;

export interface Message {
  readonly channel: 'email';                  // new in 2.0; absent at run time means email
  readonly tenantId?: string;                 // new in 2.0
  /* … as in 1.2 … */
}

export interface Transport<TProviderId extends string = string, TMessage extends AnyMessage = Message> { /* … */ }
export interface VerifiableTransport<TProviderId extends string = string, TMessage extends AnyMessage = Message>
  extends Transport<TProviderId, TMessage> { /* … */ }
// RawTransport and isRawTransport stay email-only.
```

- **Кореляція:** окремого `correlationId` немає ні в `Message`, ні в повідомленні каналу. Як і
  в 1.2 (R32), це `metadata.correlationId`: транспорт передає його провайдеру тим способом, який
  провайдер повертає у вебхуку (Twilio — query `StatusCallback`, Meta —
  `biz_opaque_callback_data`, Infobip — `callbackData`), і верифікатор кладе його в
  `DeliveryEvent.correlationId`. Задача черги й `AuditEvent` мають свій `correlationId`, як і
  зараз.
- **`tenantId?`** — в обох моделях; провайдеру не надсилається; воркер ставить його з задачі;
  читають suppression (2.1), функція ключа ratelimit, span (`mailer.tenant.id`, не метрики —
  кардинальність), логер і аудит; fingerprint і namespace ідемпотентності — ні.
- `Address`, `RawTransport`, `isRawTransport`, `DeliveryBounce` — без змін.
- Декоратори стають `<TProviderId, TMessage extends AnyMessage = Message>` разом зі своїми
  конфігами (`Hooks<M>`, `RateLimitConfig<M>`, `TeeConfig<M>`, `PoolConfig<P, M>`,
  `Strategy<P, M>`, `TransportSelector<M>`, `IdempotencyConfig<M>`), а
  `implements RawTransport<TProviderId>` міняється на
  `implements VerifiableTransport<TProviderId, TMessage>` — інакше `check:dts` падає з TS2416.
  `sendRaw` лишається: для транспорту каналу він дає збій `configuration` (`refuseUnlessRaw`), а
  email-декоратори структурно лишаються `RawTransport`. Перевірено ескізом на tsc 7 `--strict`:
  `createRetryTransport(new MockTransport())` — точно `RetryTransport<'mock'>`, як і зараз;
  транспорт Twilio дає `RetryTransport<'twilio', SmsMessage>`; email-повідомлення в SMS-декоратор
  не проходить, і навпаки.
- `Receipt`: `channel?` (транспорт може не ставити), `segments?` (SMS),
  `state?: 'accepted' | 'sent'` (`sent` — канал не звітує про доставку: робочі чати, push, тож
  пізнішого стану не буде).
- `DeliveryEvent`: `channel` (обов'язковий), `error?: { category, code }` (код DLR,
  класифікований, замість `bounce`); `AuditEvent`: `channel?` (відсутнє — email, так записані
  події 1.2).

### 4.2 Категорії, стани, події

| Об'єднання | Додається |
| --- | --- |
| `ReceiptErrorCategory` (11) | `invalid-recipient`, `opted-out`, `outside-window`, `blocked`, `not-on-channel`, `unregistered`, `unreachable` |
| `DeliveryEventType` (10) | `sent`, `read`, `failed`, `expired`, `subscribed`; вхідний STOP — наявний `unsubscribed`, відмова до спроби — `rejected`, нерозпізнане — `unknown` |
| `MessageState` (9) | `sent`, `read`, `expired` |

- `unreachable` — апарат тимчасово недоступний (Twilio 30003, Vonage DLR 2/7, Sinch 404):
  повторюється пізніше і є приводом для фолбеку, а не `rejected`.
- Ранги `audit/states.js` записуються в MongoDB (`rank` у `audit-sink.js`, індекс
  `mailer_correlation`), тому дробові, щоб записані ранги лишились чинними: `sent` 3.5 (між
  `accepted`/`delivery_unknown` 3 і `delivered` 4), `expired` 4 (як `failed`), `read` 4.5.
  `FINAL` += `read`, `expired`. `isFinalState('delivered')` лишається true, хоча `read` може
  прийти пізніше: ранг усе одно посуне стан уперед. `STATES` (`audit/delivery-event.js`) += `sent`,
  `read`, `failed`, `expired`.
- У 2.0 це чесний мажор, а не виняток з прецедентом `unsupported` 1.1.
- tsd: `tests/types/index.test-d.ts:180` `expectError<DeliveryEventType>('sent')` перевертається.

### 4.3 `./channels`

Новий subpath, runtime лише для каналів (реалізація в `src/internal/channel/`, бо провайдери
тягнуть її без ребер між subpath-ами — `tests/unit/graph.test.js` дозволяє лише перелічені):

- **`createChannelMessage(input)`** — union за `channel` (крім `email`); валідує одержувача під
  канал, `buttons`, `mentions`, `template`, `payload`, `media`, спільні
  `metadata`/`scheduledAt`/`tenantId` (з `internal/message-checks.js`). Окремий будівник, а не
  розширений `createMessage`: рядок `to` пройшов би через `parseAddress` і впав,
  `subject`/`content` там обов'язкові, а email-користувач платив би за правила каналів.
  `isChannelMessage`, `checkChannelMessage`.
- **`normalizePhone(input, { defaultCountry })`** → E.164: таблиця calling codes ITU (~250),
  зняття trunk-префікса (`067…` → `+38067…`), ≤15 цифр; `isE164`. Без libphonenumber.
- **`countSegments(text)`** → `{ encoding, segments, units, characters }`: GSM-7 + extension
  (escape не розривається), UCS-2 у code units (сурогатна пара не розривається), 160/153 і
  70/67; українська кирилиця завжди UCS-2.
- **екранування** Telegram HTML, Slack mrkdwn, Discord Markdown; масові згадки (`<!channel>`,
  `<!here>`, `@everyone`, `@here`) нейтралізуються за замовчуванням.

Ліміти каналів (Telegram 4096/1024, Discord 2000 / 10 embeds / 6000, Slack 40 000 і 50 blocks,
WhatsApp 4096 і 3 reply-кнопки, Messenger 2000, Web Push ≤3993 байт, APNs 4/5 КБ, FCM 4 КБ…)
перевіряють самі транспорти до запиту — збій `validation` або `unsupported`, як у email.

Таблиці (GSM-7, коди країн) — `.js`-файли: `scripts/check-pack.js` пропускає лише `.js` і `.d.ts`.

### 4.4 `./router`

Новий subpath замість `createChannelRouter`: `createRouter({ email, sms, telegram, … })` —
`Transport<'router', AnyMessage>`, що відправляє за `message.channel ?? 'email'`. `sendMany` іде
поспіль за каналами, зберігаючи порядок receipts і пакетні API транспортів; `verify` перевіряє
всі; dispose звільняє кожен один раз (WeakSet, як `./pool`); канал без транспорту — збій
`unsupported`. Потрібен воркеру черги і замінює фасад `createMessenger`, якого в mailer немає
(як і `createMailer`).

### 4.5 Спільний HTTP-шар

`internal/http.js` — без змін. Розширення:

1. `api-client.js`: `URLSearchParams`, рядок і байти проходять без `JSON.stringify` (Twilio,
   Vonage, AWS Query, обмін OAuth; Web Push `aes128gcm`); `Content-Type` ставиться `??=` з
   порівнянням назви без урахування регістру (`application/x-amz-json-1.0` AWS SMS); передаються
   `accepts`, `retryDelayMs`, `sleep`;
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
8. **`internal/sigv4.js`** — з `ses/http-client.js`;
9. `isPublicUrl` з `./attachments` → `internal/` (SSRF-перевірка endpoint Web Push).

### 4.6 Черга

- **Одне ядро** зі стратегією на тип задачі: `{ keys, checkBody, build, fingerprint,
  needsSubject }`. Email-стратегія — нинішній код (`V1_KEYS`, перевірки адрес і вкладень,
  `createMessage`, Message-ID); стратегія каналу — нова. Двійників модулів немає: спільні
  `mail-queue.js` (→ `queue.js`), `handler.js`, `job.js`, `parse.js`, а `envelope`, `signing`,
  `hash`, `derive`, `json`, `outcome`, `memory-queue` уже нейтральні.
- **Email-задача** — v1 байт у байт: без `channel`, той самий seed id `ns\0tenant\0key`, той
  самий hash, MAC, Message-ID і Content-ID, ті самі id подій аудиту. Тож 2.0-продюсер і
  1.2-воркери далі обробляють email, а повторна постановка з тим самим ключем після оновлення —
  дублікат, а не `key_reused`.
- **Задача каналу** — `v: 2`: `{ v: 2, channel, kind, template?/context?/locale? | content:
  { text?, media?, buttons?, payload?, providerTemplate? }, to, from?, priority, tags?, metadata,
  idempotencyKey, tenantId?, correlationId, notBefore?, expiresAt?, enqueuedAt, hash, mac?, kid?,
  trace? }`. Шаблон WhatsApp — у `content.providerTemplate`, бо `template` — це назва локального
  шаблону. Seed id — `ns\0tenant\0key\0channel` (SMS і email під одним ключем не зіткнуться).
  `channel` у запечатаній задачі лежить усередині `enc`, ніколи в `ENVELOPE`; `v` лежить у
  `ENVELOPE`, тож воркер 1.2 відпускає задачу v2 як `unsupported_version` і відкриту, і
  запечатану.
- **API:** `createQueue`, `prepareJob`, `parseJob`, `createJobHandler({ transport })` з
  `./router` для змішаних черг; `EnqueueResult` без обов'язкового `messageId` для задачі каналу.
- **Обробник:** шаблон каналу рендериться в `text` через `./templates`, без перевірки `subject`
  (рендерер змін не потребує); media — через `resolveAttachment`; збирання —
  `createChannelMessage`; `tenantId` і `metadata.correlationId` — з задачі, як для email; після
  `accepted` — подія `sent`, коли receipt каже `state: 'sent'`.
- **Окрема черга для каналів** (BullMQ `queueName`, інша колекція outbox) — правило експлуатації
  в docs: `job.name` нічим не маршрутизується, воркер 1.2 на спільній черзі відпускав би задачі
  каналу кожні 5 хв до 7 днів (погано для одноразових кодів), а пауза 429 Telegram з
  `rateLimitScope: 'queue'` не має зупиняти email.
- **`./otel`:** `instrumentHandler` з атрибутом `mailer.channel`.

### 4.7 Вебхуки

- `src/webhooks/` тримає спільне: `request.js` (`claimDelivery`, резолвери, хелпери перевірки),
  `sns.js`, сховища replay, `WebhookVerificationError`, типи, `WebhookRequest.url?`;
  `src/webhooks/index.js` — entry `./webhooks`.
- Кожен провайдер — `src/webhooks/<provider>/index.js` + `index.d.ts`, subpath
  `./webhooks/<provider>` з назвою транспорту (`./webhooks/ses`, `./webhooks/aws-sms`,
  `./webhooks/meta`). Назви функцій (`createSesWebhookVerifier`…) не змінюються.
- `graph.test.js` отримує правило: вкладений subpath може вимагати модулі батьківського.
  Таблиці кодів, спільні з транспортом (коди помилок Twilio, Meta, Vonage), лежать у теці
  транспорту (`src/twilio/codes.js`), а вебхук бере їх ребром у `SUBPATH_EDGES`, як
  `mongodb/audit-sink.js -> audit/states.js`.
- Функція, що перевіряє одного провайдера, платить за спільне й одного провайдера, а не за 27.

### 4.8 Subpath-и

| Реліз | Subpath-и |
| --- | --- |
| 2.0 спільне | `./channels`, `./router`; `./webhooks/<p>` для 15 email-провайдерів |
| 2.0 SMS/RCS | `./twilio`, `./vonage`, `./infobip`, `./sinch`, `./aws-sms`, `./turbosms`, `./alphasms`, `./smsclub`, `./rbm` |
| 2.0 месенджери | `./meta` (WhatsApp, Messenger, Instagram: один Graph-клієнт, одне вікно 24 год), `./telegram`, `./viber` |
| 2.0 робочі чати | `./slack`, `./discord`, `./teams`, `./google-chat` |
| 2.0 push | `./fcm`, `./apns`, `./webpush` |
| 2.1 | `./webhooks/<p>` каналів, `./suppression` (email і канали), `./fallback` |
| 2.2 | нових немає: `./mongodb`, `./audit`, `./queue` отримують сховища, crypto-shredding, фолбек за дедлайном |

- Колізій з нинішніми 41 entry немає. Subpath — на постачальника, і він може тримати кілька
  каналів (`./twilio`: SMS, MMS, WhatsApp-префікс, RCS; `./meta`: три), тож email Infobip чи SMS
  Azure Communication Services колись лягли б у `./infobip` чи `./azure`. Виняток — AWS: за
  сервісом, як `./ses`, тому `./aws-sms`.
- HTTP-клієнт провайдера каналу — `src/<sub>/http-client.js`, як в email; матриця доставки
  каналів — `tests/unit/delivery-channels.test.js` (4.9).

### 4.9 Розміри й тестова інфраструктура

- Корінь (9,9 з 10 КБ): `channel` і `tenantId` у `createMessage`, `channel`, `segments`, `state`
  у `createFailedReceipt` і `retryable` за категорією — один крок +0,5 КБ у коміті етапу 2
  («the root grows only for the contract they share» — це саме спільний контракт).
- `./webhooks` зменшується до спільної частини; кожен `./webhooks/<p>` отримує свій бюджет.
- Близькі до бюджету: `./queue` 19,3/19,5, `./audit` 2,0/2, `./otel` 6,1/6,5, `./idempotency`
  4,2/4,5, `./pool` 3,4/3,5, `./mongodb` 7,3/7,5 — кожен підніметься на крок 0,5 у коміті,
  якому потрібне місце.
- Канальний subpath, що тягне `core/receipt.js`, `internal/api-client.js` і
  `provider-transport.js`, важить від ~5,5 КБ без email-коду (`message`, `address`, `calendar`,
  `attachment`, `list`, `message-id`, `raw-message` — ~7 КБ — він не тягне).
- Exports map — з 41 до ~77 у 2.0 (+19 провайдерів, `./channels`, `./router`, +15 email-вебхуків)
  і ~91 у 2.1 (+~12 вебхуків каналів, `./suppression`, `./fallback`). `export-parity` запускає
  `node` на кожен entry, `bundle` — два esbuild-білди на entry; `scripts.test.js` вимагає бюджет
  для кожного; кожен — у `tests/runtime/exports.test.js` на Node, Bun і Deno; tsd-файл на кожен
  новий entry.
- Матриця доставки каналів: ті самі сценарії, що в email — двозначна відповідь →
  `deliveryUnknown` без повтору, `Retry-After`, редагування секретів і одержувачів — з
  повідомленням каналу на кожен провайдер; `delivery.test.js` звіряє кожен subpath з
  `http-client.js` з однією з двох матриць.

---

## 5. Реліз 2.0

Гілка `feature/messenger`, один PR, коміти по одному на subpath і на фікс, як у 1.1 і 1.2.

### Етап 0. Патч 1.2.1 (опційно, до 2.0)

Знахідки 2.4 — гілка від `main`, `fix:`-коміт на кожну, з тестом; реліз 1.2.1; потім
`feature/messenger` оновлюється від `main`.

### Етап 1. Документи (`docs:`/`chore:`)

- `CLAUDE.md`: «What this is» (email і канали), Status 2.0, прибрати SMS/WhatsApp/push з «Out of
  scope», roadmap каналів (з `messenger/CLAUDE.md`: правила каналів, рішення «HTTP APIs, not
  SDKs», «Official APIs only», «Few providers per channel», «One message, the channel's own
  payload», «No phone-number library», список «What the competitors appear to get wrong» для
  месенджингу), рішення «One `./webhooks` entry» → «спільний `./webhooks` і subpath на
  провайдера», «Eighteen providers» → 37, розділ «Code ported for the channels» (3.3),
  «Repository layout», «Architecture» (4.1–4.2), Testing notes (матриця каналів, живий прогін),
  Release process (живий прогін кожного нового провайдера);
- `package.json`: `description`, `keywords` (sms, whatsapp, telegram, viber, slack, discord,
  teams, push, fcm, apns, web-push, rcs); README — нове вступне речення і розділ каналів;
- порівняння: `messenger/docs/comparison.json` (12 бібліотек: messenger і 11 конкурентів) →
  `docs/comparison-channels.json`, перший стовпець `@alexify/messenger` → `@alexify/mailer`
  (клітинки 🔜, як і були); `scripts/comparison.js` рендерить дві пари дані → сторінка (зараз
  `DATA` одна, `TARGETS` масив), CI перевіряє дрейф обох; `docs/guide/comparison-channels.md` —
  проза з messenger; клітинка `@alexify/mailer` у рядку «Multi-channel: SMS, WhatsApp, push»
  `docs/comparison.json` (зараз «❌ out of scope») → 🔜, таблиця перегенеровується;
- виправити два формулювання про thinwrap, перенесені з messenger: «an accepted SMS is always
  reported `sent`, never `queued`» замість «every SMS reported `sent`»; відсутній Web API Slack —
  не баг;
- `LICENSE` і `SOURCES` тесту атрибуції — нотиси джерел 3.1.

### Етап 2. Контракти (`test:`, `feat(core)!:`, `refactor:`)

- golden-тести інваріантів 2.3 — першим комітом, разом із замороженим JSON задачі v1 від 1.2,
  який обробник 2.0 читає й відправляє з тим самим Message-ID;
- типи кореня 4.1, об'єднання 4.2, `Message.channel`, `tenantId?` в обох моделях (golden-тест:
  fingerprint повідомлення з `tenantId` і без нього однаковий), поля receipt і `retryable` за
  категорією (+0,5 КБ кореня);
- таблиці `./audit` (ранги, `FINAL`, `STATES`, рівні логер-сінку);
- `refactor:` `checkMetadata`/`checkScheduledAt` → `internal/message-checks.js`; канонічний JSON
  → `internal/`; нейтральні хелпери `api.js` → internal-модуль; SigV4 → `internal/sigv4.js`;
- `./channels` (4.3) з тестами сегментів на `TestData` Twilio і кейсах split-sms; `./router`
  (4.4).

### Етап 3. Спільний шар (`feat:`)

`api-client.js` (4.5, пункти 1–3), `redactRecipients` і `SECRET_KEYS`, `internal/jwt.js`,
`internal/google-auth.js`, `internal/http2.js` з `unsent.js`, `isPublicUrl` → `internal/`,
fingerprint із гілкою каналу, `pinMessageId` із клієнтським reference.

### Етап 4. Декоратори й назви (`feat(<subpath>)!:`)

`./mock` → `./hooks` → `./logger` → `./otel` → `./pool` → `./idempotency` (runtime 2.2), потім
d.ts `./retry`, `./breaker`, `./ratelimit`, `./tee`; логер-сінк `./audit`. Перейменування
спостережуваності 2.3 — у комітах свого subpath-а. Кожен — з тестом на повідомленні каналу, що
падає без зміни, і tsd на `TMessage`.

### Етап 5. Черга (`feat(queue)!:`, `feat(mongodb):`, `feat(bullmq):`)

Ядро зі стратегіями, перейменування API, задача v2 каналу, обробник (4.6), `instrumentHandler`;
контракт джерела (`tests/helpers/queue/source-contract.js`) — і з задачами каналу; `pnpm
test:stores` з обома типами задач на окремих чергах.

### Етап 6. Вебхуки (`refactor(webhooks)!:`)

Спільне — у `./webhooks`, 15 email-верифікаторів — у `./webhooks/<p>` (4.7), бюджети, tsd на
кожен entry, правило вкладених subpath-ів у `graph.test.js`, `docs/guide/webhooks.md` з новими
шляхами імпорту.

### Етап 7. Провайдери (`feat(<subpath>):`, по коміту на провайдера)

| Subpath | Джерело | Нове | Баги джерела, що виправляються | ~src | Розмір |
| --- | --- | --- | --- | --- | --- |
| `./twilio` (SMS, MMS, WhatsApp-префікс, RCS `rcs:`) | thinwrap (запит, хости), twilio-node (статуси) | `num_segments` у receipt, коди → категорії (21610 → `opted-out`, 21211/21614 → `invalid-recipient`, 21408 → `configuration`, 63016 → `outside-window`, 30003 → `unreachable`) у `src/twilio/codes.js`, `metadata.correlationId` у query `StatusCallback` (підпис його покриває) | T1, T6, T11, V7, V8 | 300 | M |
| `./vonage` (SMS API) | thinwrap | усі `messages[]`, `message-count` → segments, `client-ref` | T2 | 220 | S |
| `./infobip` (SMS v3, RCS) | thinwrap, Infobip SDK | REJECTED у 200 → відмова за назвою групи, `callbackData` → correlation | NV4 | 200 | S |
| `./sinch` (SMS batches) | thinwrap | `client_reference`, регіони | — | 130 | S |
| `./aws-sms` (End User Messaging SMS) | `internal/sigv4.js` | `SendTextMessage`, configuration set, `MessageId`, коди помилок AWS | — | 220 | S–M |
| `./turbosms` (SMS, Viber, гібрид) | документація | `sequence_id` = клієнтський reference → `hasIdempotencyKey` (дедуплікація провайдера, 30 днів) | — | 250 | M |
| `./alphasms` (SMS, Viber, гібрид) | документація | — | — | 250 | M |
| `./smsclub` (SMS, Viber, гібрид) | документація | ліміт 9 запитів/с, статуси опитуванням (2.1) | — | 250 | M |
| `./rbm` (Google RCS Business Messaging) | документація, @google/rcsbusinessmessaging як довідка | `google-auth`, `messageId` клієнта = ідемпотентність, capability check → `not-on-channel` до відправлення | — | 300 | M |
| `./meta` | thinwrap (WhatsApp Cloud: text/template/interactive, таблиця `mapWhatsAppCode`) | Messenger Send API і Instagram (нові), шаблон обов'язковий поза вікном, `biz_opaque_callback_data` → correlation, версія Graph як опція з датованим значенням | T10 | 600 | L |
| `./telegram` | ntba (конверт, поля помилок), thinwrap | опис → категорія (403 blocked/kicked → `blocked`, «can't initiate conversation» → `not-on-channel`, 400 «chat not found» → `invalid-recipient`, `migrate_to_chat_id`), HTML-екранування, ліміти, inline-кнопки, media через нативний `FormData` | T7, V11, TG1 | 580 | M |
| `./viber` (Bot API) | документація, viber-bot як довідка | `status != 0` → помилка; 5/6 → `not-on-channel` | VB1 (у 2.1) | 250 | M |
| `./slack` (Web API + incoming webhook) | thinwrap, visulima (`chat.postMessage`) | `ok:false` → категорії, mrkdwn, `ts` як id, без повтору `chat.postMessage` після мережевої помилки, `state: 'sent'` | SL1 | 280 | M |
| `./discord` (бот REST + webhook) | thinwrap (webhook `?wait=true`) | бот REST, `allowed_mentions: { parse: [] }` за замовчуванням, `thread_id` у query, `nonce` + `enforce_nonce` (безпечний повтор), бакети з `X-RateLimit-*` | T8, V10, DC1 | 300 | M |
| `./teams` (Workflows webhook + Bot Framework) | thinwrap (конверт Adaptive Card, `failureStatusFor2xx`) | Workflows 202 → `accepted`; бот: токен client credentials, `serviceUrl` лише з allowlist, відправлення за відомою conversation reference | T9, V-MessageCard, BB1 | 320 | M–L |
| `./google-chat` (webhook + Chat API app) | thinwrap (webhook) | Chat API app через `google-auth`, `name` як id, `threadKey` | — | 250 | M |
| `./fcm` (HTTP v1) | thinwrap (JWT, oneof цілі), firebase-admin як довідка | `details[].errorCode` перед `status` (UNREGISTERED → `unregistered`, SENDER_ID_MISMATCH → `invalid-recipient`, QUOTA_EXCEEDED → `rate-limit`), зарезервовані ключі data, TTL у `android`/`apns`/`webpush` | T3, T5, V16, FB1 | 350 | M |
| `./apns` (HTTP/2, token) | thinwrap (`createApnsJwt`, `finalizePushType`, таблиця reasons), node-apn і visulima (сесія) | `internal/http2.js`, `apns-id` як id, явне середовище (не `NODE_ENV`), priority 5 для background, ліміт 4/5 КБ, `ExpiredProviderToken` → новий токен один раз | T3, T4, V15, AP1 | 400 | M–L |
| `./webpush` (VAPID) | http_ece, visulima (звірка), RFC 8291/8292 | `node:crypto` (`createECDH`, `hkdfSync`), JWT на аудиторію в кеші, ≤3993 байт, перевірка `p256dh`/`auth`, `Topic`, 404/410 → `unregistered`, 413 → `validation`, SSRF-перевірка endpoint (`isPublicUrl` з `internal/`) | V14, EC1 | 250 | M |

Разом ~5 700 рядків `src/` провайдерів, плюс d.ts (~40 %) і тести (1,5–2×). Кожен subpath
отримує бюджет у `scripts/size-budgets.json` (орієнтир mailer: провайдер 7–9,5 КБ поверх кореня),
місце в матриці каналів і рядок у `tests/e2e/channels.e2e.test.js` (одна таблиця, як
`providers.e2e.test.js`, кожен рядок пропускається без своїх змінних середовища).

**Порядок — за готовністю акаунтів** (розділ 9): спершу безкоштовні (Telegram, Slack, Discord,
FCM, Web Push, тестовий номер WhatsApp Cloud, пробний Twilio, AWS sandbox), далі з пробними
кредитами (Vonage, Infobip, Sinch), далі ті, що потребують оплати або схвалення (APNs, RBM,
Viber, Teams, TurboSMS, AlphaSMS, SMSClub).

### Етап 8. Ревʼю, продуктивність, документація, реліз

- хвиля ревʼю (`fix:`/`perf:`), як R1–R42 у 1.1: кожна знахідка — коміт з тестом;
- `pnpm bench` для гарячих шляхів (сегменти, екранування, підпис), оновлення `bench/baseline.json`;
- docs: розділ «Channels» у сайдбарі (`docs/.vitepress/config.mts`), сторінка на кожен subpath,
  `/guide/queue` (окрема черга, нові назви API), `Known issues`, клітинки
  `docs/comparison-channels.json` (🔜 → ✅ лише для зробленого);
- CHANGELOG 2.0.0 з розділом «Upgrading from 1.x» (2.3);
- **ворота живого прогону:** провайдер без зеленого `pnpm test:e2e` на живому акаунті знімається
  з exports map, docs і CHANGELOG релізу й виходить мінорним 2.x, коли прогін буде (додавання
  провайдера адитивне);
- `chore(release): 2.0.0`.

---

## 6. Реліз 2.1 — замкнений цикл

### 6.1 Вебхуки каналів (`./webhooks/<provider>`)

Спільна частина вже в `./webhooks` (етап 6 релізу 2.0). Наявні хелпери закривають більшість
схем: `checkBodyHmac` (Viber, Meta), `tokenCheckOf` (Telegram), `basicCredentialsOf` (Infobip,
українські з Basic), `hmacOf` + `checkSignedSeconds` (Slack v0, Sinch), `createSnsVerifier` (AWS
SMS). Нові: Twilio (HMAC-SHA1 від URL + відсортованих параметрів, base64), порівняння
base64-підпису, Vonage JWT HS256 з `payload_hash`, хелпер GET `hub.challenge` Meta. Верифікатор
будує `id` події з id провайдера, ніколи з `To` (воно потрапляє в `deliveryEvent.id` аудиту),
нормалізує одержувача через `normalizePhone` (Vonage шле `447…` без `+`) і ставить `channel`.

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

**Таблиці статусів** (з рангом, закріплені тестом мапінгу на кожного провайдера, як
`tests/unit/webhooks-mapping.test.js`; правило `docs/guide/webhooks.md`: `unknown` замість
здогадки):

- Twilio: accepted/scheduled/queued/sending → `accepted`; sent → `sent`; delivered → `delivered`;
  read → `read`; undelivered/failed → `failed` (категорія з ErrorCode, таблиця
  `src/twilio/codes.js`); canceled → `failed`; partially_delivered → `unknown` з `raw` (Novu
  губить scheduled, read, canceled, partially_delivered — NV1);
- Vonage DLR: accepted/buffered → `sent`, delivered, expired, failed/rejected → `failed`,
  unknown → `unknown`;
- Sinch SMS: Queued → `accepted`, Dispatched → `sent`, Delivered, Expired,
  Failed/Rejected/Aborted/Cancelled/Deleted → `failed`, Unknown → `unknown`;
- Meta: sent, delivered, read, failed (131047 → `outside-window`, 131026 → `not-on-channel`,
  131050 → `opted-out`); Messenger/Instagram — за watermark;
- Viber: delivered, seen → `read`, failed; subscribed/unsubscribed → `subscribed`/`unsubscribed`.

**Звірка без вебхуків:** `pollStatus(ids)` на транспортах, що вміють (SMSClub, TurboSMS), і
функція `reconcile`, яку в 2.2 викликає воркер черги.

### 6.2 `./suppression` — один список для email і каналів

Пункт Phase 2 roadmap mailer («a suppression list per tenant and stream, checked before a message
is queued, with a bypass policy for transactional mail») і opt-out messenger — одна річ:

- `SuppressionStore`: `isSuppressed(tenantId, recipientHash, channel | '*', stream?)`,
  `suppress`, `unsuppress`; тенант — `message.tenantId`; одержувач — HMAC під ключем застосунку
  (email — адреса в нижньому регістрі, телефон — E.164), не відкрито; сховище в пам'яті
  (MongoDB — 2.2);
- `SuppressionTransport` — декоратор над будь-яким транспортом, і перевірка в
  `createQueue({ suppression })` до постановки; відмова — **невдалий** receipt `opted-out`, а не
  успіх (баг V1 visulima), тож фолбек і pool бачать її правильно;
- транзакційні (одноразові коди, скидання пароля) обходять лише явним прапорцем;
- джерела: email — `bounced` (hard), `complained`, `unsubscribed` з `./webhooks/<p>`; канали —
  Twilio `OptOutType` (STOP/START/HELP), Vonage inbound, Sinch `OPT_OUT`, WhatsApp 131050, Viber
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
не є успіхом (V1). Результат — receipt останнього кроку і перелік спроб. Правила зупинки спільні з
`./pool` (`STOP_FAILOVER`) в одному internal-модулі. Фолбек «немає receipt до дедлайну» потребує
черги — у 2.2.

### 6.5 Rate limits каналів

`./ratelimit` + `rules: [{ key?, limit, intervalMs, burst }]`, атомарне резервування за всіма
правилами (GCRA: `t = max(now, maxᵢ(TATᵢ − τᵢ))`), пауза ключа на `retry_after` з 429. Пресети:
Telegram 30/с глобально + 1/с на чат (20/хв, якщо `chat_id < 0`); Slack ~1/с на канал; WhatsApp —
тири; вартість SMS — `countSegments`. Ключ зі спільного сховища — хеш `to`, не номер. Discord —
бакети із заголовків усередині `./discord` (алгоритм discord.js: очікування до відправлення,
глобальні 50/с, переназначення хешів бакетів, ліміт повторів на 429). Лімітер ntba — лише довідка
(послідовне захоплення токенів перевищує ліміт — TG3).

---

## 7. Реліз 2.2 — сховища, crypto-shredding, дедлайни

- **`./mongodb`:** сховища suppression і вікна 24 год; `eventsOfProviderMessage` з `provider` і
  складеним індексом (Telegram `message_id` і Slack `ts` унікальні лише в межах чату).
- **`./audit`:** **crypto-shredding одержувачів** — HMAC + зашифрований блок, ключ на
  одержувача, стирання ключа = стирання; пункт roadmap mailer, робиться один раз для адрес і
  номерів (~400 рядків).
- **Фолбек за дедлайном:** відкладена задача, що читає стан з аудиту й запускає наступний крок,
  якщо немає `delivered`/`read`.
- **Звірка:** воркер викликає `reconcile` (6.1) для задач `delivery_unknown` у провайдерів без
  ключа ідемпотентності; клієнтський reference 2.0 уже є ключем для TurboSMS `sequence_id`, RBM
  `messageId`, Discord `nonce` + `enforce_nonce`.
- **Подія аудиту для задачі, що чекала понад 7 днів** (`unsupported_version` чи `codec_missing`):
  зараз вона падає без події й застрягає в `queued`.

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

## 9. Тестування й ворота живого прогону

- **Інваріанти email** — golden-тести 2.3 (fingerprint, hash і id mail job на значеннях 1.2,
  `tenantId` поза fingerprint) і заморожена задача v1 від 1.2; уся наявна сюїта mailer лишається
  зеленою, змінюючись лише там, де 2.3 перелічує зміни (назви, шляхи імпорту, tsd 4.2).
- **Сумісність черги:** задача v2 у логіці розбору 1.2 — `unsupported_version`, не `invalid_job`;
  повторна постановка email-задачі з тим самим ключем після оновлення — дублікат, не
  `key_reused`; `pnpm test:stores` з обома типами задач.
- **Провайдери** — проти фейкових серверів (`node:http`, h2c для APNs за патерном
  `node-apn/test/client.js`) або `t.mock.method(globalThis, 'fetch')`; форма запиту, помилки в
  2xx, Retry-After, редагування секретів і одержувачів — з тестів thinwrap і visulima, плюс
  матриця доставки каналів (4.9).
- **Вебхуки** — проти векторів: Twilio (~20), Vonage (5), Sinch (2), Viber (1), Slack (1), RFC
  8188 §3.1–3.2 і RFC 8291 Appendix A для Web Push; для решти — згенерувати ключі один раз і
  заморозити тіло й підпис у `tests/fixtures/webhooks/<provider>/` (LF, порівняння байт у байт);
  після живого прогону — справжні тіла, знеособлені.
- **Тіла відповідей і колбеків** — з прикладів офіційної документації, звірені живим прогоном.
- **Deno** — тест повтору запиту на перевикористаному з'єднанні для провайдерів без ключа
  ідемпотентності (як у email-провайдерів); `tests/runtime` надсилає на локальний HTTP/2-сервер
  на Node, Bun і Deno.
- **Ворота живого прогону:** `tests/e2e/channels.e2e.test.js` — одна таблиця провайдерів, кожен
  рядок пропускається без своїх змінних середовища; перед релізом кожен новий провайдер має
  зелений прогін на живому акаунті, інакше виходить пізніше мінорним релізом (етап 8). Release
  process у `CLAUDE.md` і скіл `npm-publish` це вимагають.
- **Акаунти** — безкоштовні: Telegram-бот (BotFather), Slack і Discord (робочий простір),
  Firebase-проєкт (FCM), Web Push (VAPID-ключі, браузер), тестовий номер WhatsApp Cloud API
  (Meta for Developers), пробний Twilio, AWS sandbox; з пробними кредитами: Vonage, Infobip,
  Sinch; з оплатою або схваленням — перевірити умови й почати рано: APNs (Apple Developer
  Program), RBM (реєстрація агента, тестові пристрої), Viber (умови для ботів), Teams (тенант
  M365), TurboSMS, AlphaSMS, SMSClub (платні; альфа-ім'я відправника).

---

## 10. Ризики й відкриті питання

1. **Обсяг 2.0** — контракти, назви, черга, вебхуки й 19 провайдерів в одному мажорі. Етапи 2–6
   не залежать від провайдерів; ворота живого прогону прибирають неготових без затримки решти.
2. **Акаунти** — частина провайдерів платна або потребує схвалення; що не встигне до релізу,
   вийде мінорним 2.x.
3. **Назва.** `@alexify/mailer` гірше знаходиться в пошуку npm за «sms» чи «whatsapp»;
   компенсується `description`, `keywords`, README і сторінкою порівняння каналів. Свідома ціна,
   рішення 2026-11-06.
4. **Користувачі otel і логів** оновлюють дашборди й алерти (`mailer.email.*` →
   `mailer.message.*`, `email.*` → `message.*`, `mail.*` → `message.*`) і шляхи імпорту
   вебхуків — розділ «Upgrading from 1.x».
5. **Змішані розгортання 1.2/2.0** на одній черзі: email-задачі обробляються далі, задачі каналу
   на воркері 1.2 чекають до 7 днів — окрема черга, правило docs, кодом не закрити (4.6).
6. **Бюджети розмірів і CI:** корінь і шість entry за крок від межі (4.9); ~77–91 entry,
   `export-parity` запускає процес на кожен — можливо, імпорт за назвою доведеться звести в один
   процес. Зміна API WhatsApp — реліз mailer.
7. **TurboSMS, AlphaSMS, SMSClub** — документація неповна (формат колбеків, підпис AlphaSMS,
   статуси Viber), джерела коду немає; живий прогін на платному акаунті обов'язковий.
8. **Teams Bot Framework** — найскладніший канал (токени, JWKS, `serviceUrl`, проактивні розмови
   потребують вхідної події інсталяції). У 2.0 — відправлення за відомою conversation reference;
   прийом activity — у 2.1.
9. **Telnyx** — не в плані, але дешевий (~1–2 дні) і єдиний SMS-провайдер з власним
   `Idempotency-Key`. За правилом «few providers per channel» — чекає користувача.
10. **Версії Graph API** дрейфують: версія — опція `./meta` з датованим значенням за
    замовчуванням.
11. **HTTP/2 на Bun і Deno** — через Node-сумісність; `tests/runtime` має надіслати на локальний
    HTTP/2-сервер на всіх трьох.

---

## 11. Обсяг

| Реліз | Нове `src/` (оцінка) | Основне |
| --- | --- | --- |
| 2.0 | ~9 700: узагальнення ядра й декораторів ~1 000, `./channels` ~1 000, `./router` ~150, спільний шар (jwt, google-auth, http2, api-client) ~700, черга каналів (стратегії) ~900, перебудова вебхуків ~200, провайдери ~5 700; d.ts кореня +~400 | 19 провайдерів, одна модель, одна черга, назви |
| 2.1 | ~4 100: верифікатори й мапінг ~2 500, suppression ~600, вікно і фолбек ~600, ratelimit ~400 | замкнений цикл, один suppression для email і каналів |
| 2.2 | ~1 200: сховища MongoDB ~300, crypto-shredding ~400, фолбек за дедлайном ~250, решта ~250 | сховища, аудит каналів |

Разом ~15 тис. рядків нового коду; тести ≈1,5–2× від коду. Для порівняння, варіант із двома
пакетами — ~16 тис. нових і ~15 тис. скопійованих рядків, які далі жили б окремо.

---

## 12. Перехід: що робиться з messenger

1. **npm** — нічого: `@alexify/messenger` ніколи не публікувався (npm 404), користувачів немає.
2. **Що переїжджає в mailer** (етап 1): `docs/comparison.json` (12 бібліотек) і проза сторінки
   порівняння; із `CLAUDE.md` — правила каналів, рішення, список помилок конкурентів, платформні
   нотатки (Deno повторює запит, APNs через `node:http2`); цей план замінює `PLAN-v1.md`.
   Каркас (інструменти, тести, CI) не переїжджає — у mailer він той самий.
3. **Репозиторій `Alexis-Technologies/messenger`** — останній коміт у `main`: README «moved to
   @alexify/mailer» з посиланням; потім архівування в налаштуваннях GitHub (робить власник).
   Локальна гілка `feature/v1` з `PLAN-v1.md` на 1 коміт попереду `origin`: запушити для історії
   перед архівуванням або лишити локально.
4. **Vercel-проєкт `messengerat.vercel.app`** — видалити або перенаправити на
   `mailerat.vercel.app` (вручну в Vercel).
5. **Бренд** — індиговий знак messenger не потрібен; лишається бренд mailer.
6. **Індекс клонів** `~/Documents/open-source/messenger-alternatives/README.md` посилається на
   цей план.

---

## 13. Перші кроки

1. Почати реєстрацію акаунтів, що потребують оплати або схвалення (розділ 9) — це найдовший шлях.
2. Етап 0: патч 1.2.1 зі знахідками 2.4 (гілка від `main`), за бажання.
3. Етап 1 у mailer на `feature/messenger`: позиціонування, перенесення порівняння й тексту з
   messenger, `LICENSE`, розділ правил порту, оновлені рішення `CLAUDE.md`.
4. Етапи 2–6 (контракти з golden-тестами, спільний шар, декоратори, черга, вебхуки) — після них
   кожен провайдер незалежний, тож етап 7 можна вести паралельно по subpath-ах.

---

## Додаток A. Перевірка плану 1.3–1.5 (2026-11-06)

Перша редакція цього плану (коміт `b8c48d3`) пропонувала адитивні 1.3–1.5. Три перевірки проти
коду 1.2.0 підтвердили розміри (корінь 9,9/10 КБ, `./webhooks` 15,3/15,5, `./queue` 19,3/19,5),
41 entry, місця падінь, правила pool і breaker, поведінку `api-client`, `V1_KEYS` і `ENVELOPE`,
відпускання задачі з невідомим ключем, `check-pack`, tsd `'sent'`, відсутність `url` у
`WebhookRequest` і знахідки 2.4. Що змінилося:

| Перша редакція | Тепер |
| --- | --- |
| адитивний 1.x з виключенням для об'єднань | 2.0: інакше дві родини назв метрик, подій логера й аудиту і два API черги |
| `tenantId?`, `correlationId?` лише в повідомленні каналу | сьогодні їх не має жодне повідомлення — лише задача черги й `AuditEvent`; `tenantId?` — в обох моделях, кореляція — `metadata.correlationId` для обох |
| namespace ідемпотентності з `tenantId` для каналів | namespace без `tenantId` для обох (сумісність задач, які почав 1.2) |
| `client.js` замість `http-client.js`, щоб обійти `delivery.test.js` | матриця там ручна; `http-client.js` лишається, тест звіряє з однією з двох матриць |
| `STATES` в `audit/states.js` | `STATES` — `audit/delivery-event.js`; ранги записані в MongoDB, тому дробові |
| `channel` у вході рендеру | не потрібен: рендерер уже вміє лише `text`; `subject` вимагає тільки черга |
| двійники `prepareChannelJob`, `createChannelQueue`, `createChannelJobHandler` | одне ядро зі стратегіями (~88 % `./queue` нейтральні), API без `Mail` |
| черга каналів у 1.5 | у 2.0, бо перейменування API ламає, а ламати треба один раз |
| `./channel-webhooks` поруч із `./webhooks` | `./webhooks` — спільне, `./webhooks/<provider>` — кожен верифікатор |
| `createChannelRouter` у `./channels` | `./router`, що маршрутизує й email |
| «20 провайдерів» (§11), «+20 entry» (§4.6) | 19 провайдерів; «20» рахувало і `./channels`; набір той самий |
| провайдери без живих акаунтів | провайдер входить у реліз лише після живого прогону |

Пропущені першою редакцією місця, тепер у плані: logger `recordMessage: 'inline'`;
`getMessagesBySubject` і `reset()` у mock; pool, що ховає TypeError і зупиняється на `validation`
чужого каналу; відмова hooks як `rejected`; колізія fingerprint двох SMS під одним ключем;
номери телефонів не редагуються на жодному з 16 місць, `queue/outcome.js` включно; `authtoken`
поза `SECRET_KEYS`; `accepts`/`retryDelayMs`/`sleep` і `content-type` у нижньому регістрі в
`api-client`; необов'язковий `errors` у п'яти декораторах; лог селектора pool; `channel` у
відкритій частині запечатаної задачі — `invalid_job`; задача, що чекала 7 днів, без події
аудиту.
