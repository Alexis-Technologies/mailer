# Compared for the channels

@alexify/mailer 2.0 adds SMS, RCS, chat apps and push to the email of 1.x, on the same reliability
layer: the queue, the outbox, the audit, idempotency and the decorators. The table compares it
with eleven Node.js solutions for those channels in four directions: unified libraries over many
channels and providers (@visulima/notification, @thinwrap/notifications, notifme-sdk), a
notification platform with a code-first SDK (Novu), the official SDKs of five providers of SMS and
WhatsApp (Twilio, Telnyx, Vonage, Plivo, Sinch), and two Telegram libraries (grammY,
node-telegram-bot-api). As in the [comparison of the email libraries](/guide/comparison), every
feature is in one table rather than a few convenient libraries in a few convenient rows.
@alexify/mailer is the first column; no channel is in its code yet, so its cells are the plan of
2.0 (🔜), with the release named where a feature comes later.

## What the table shows

- **No library has one model of delivery receipts.** @visulima/notification parses the statuses
  of Twilio alone, and maps an unknown event of Standard Webhooks, and every Slack and SNS
  event, to `delivered`; @thinwrap/notifications exports status enums it never uses and reports
  an accepted SMS as `sent`, never `queued`; the SDKs type their own receipts at best (Telnyx,
  Sinch). Telegram has no receipts at all.
- **Fallback between channels moves on only when a send fails.** @visulima/notification's
  `route()` stops at the first send that did not throw, a suppressed or deduplicated one
  included; Novu's steps can skip only on the read state of its in-app channel; notifme-sdk sends
  every channel at once. The providers that fall back on the outcome (Vonage's `failover`,
  Sinch's `channel_priority_order`, RCS to SMS at Twilio and Telnyx) do it inside their own
  network.
- **A retry can send a message twice.** Telnyx retries a POST without an idempotency key unless
  one is passed, node-telegram-bot-api retries `sendMessage` after a timeout, and grammY's
  auto-retry plugin retries network errors without a limit. Only Telnyx takes an
  `Idempotency-Key`; @visulima/notification deduplicates in memory.
- **Nothing is recorded outside Novu's server.** No library keeps a log of the states of a
  message. @visulima/notification has adapters for four queues, but reading its code shows a
  worker that sends every channel again when one failed, reservations that never expire, and a
  BullMQ adapter that calls a method a `Queue` does not have.
- **Webhook signatures are checked unevenly.** Vonage (SMS), Plivo and Sinch compare signatures
  with `===` rather than in constant time; Sinch never checks the age of its timestamp; Vonage
  checks the JWT but not the hash of the body; Novu's bridge skips its HMAC unless `NODE_ENV`
  says production; grammY and @visulima/notification accept any request when no Telegram secret
  is set, where node-telegram-bot-api refuses to start without one.
- **The rules of a channel are left to the application or the provider.** No library checks an
  E.164 number or counts the segments of an SMS itself; the SDKs offer the providers' lookup and
  encoding APIs. WhatsApp's Cloud API is reached directly only by @thinwrap/notifications and
  Novu, and no library tracks the 24-hour window.
- **Meta's channels, Viber and Ukraine come with single providers.** No unified library sends to
  Messenger, Instagram or Viber: Messenger is in the SDKs of Twilio, Vonage and Sinch, Instagram
  in Sinch's alone, Viber in Vonage's and Sinch's, and Telegram among the SDKs in Sinch's alone.
  No library has TurboSMS, AlphaSMS, SMSClub or SMS-Fly.
- **Work chats are mostly incoming webhooks.** None of the five SDKs posts to Slack, Discord,
  Teams or Google Chat. @thinwrap/notifications reaches all four, through their incoming
  webhooks, by design; @visulima/notification has Slack's Web API but Discord through a webhook
  alone, and posts to Teams in the legacy `MessageCard` of the Office 365 connectors unless given
  an Adaptive Card; Novu runs Slack, Discord and Teams on its server and lists Google Chat as
  coming soon.
- **Push is uneven.** @visulima/notification sends FCM, APNs and Web Push; @thinwrap/notifications
  has no Web Push of its own and needs an HTTP/2 `fetch` injected for APNs; notifme-sdk's FCM
  path reads settings it never sets, from reading its code; of the SDKs, only Twilio's Notify
  sends push.
- **Zero dependencies is not rare, CommonJS with state is.** @visulima/notification,
  @thinwrap/notifications, Telnyx and node-telegram-bot-api 2 have none; but the first is ESM
  only, and the others send and keep nothing. Twilio brings axios, Vonage seventeen packages, and
  Plivo fifteen, the deprecated `request` among them.

This is the gap the channels of @alexify/mailer are built for: what its email already has, a
queue that survives a restart, an audit of every state and no second send of unknown outcome,
for every channel, with one suppression list and one fallback across them and email; see
[Why @alexify/mailer?](/guide/why).

<!-- comparison:start -->
<!-- generated by `pnpm docs:comparison` from docs/comparison-channels.json — edit the data, not this block -->

<div class="ml-matrix">

<table>
<thead>
<tr>
<th>Feature</th>
<th><a href="https://github.com/Alexis-Technologies/mailer">@alexify/mailer</a><br><sub>unified + reliability</sub></th>
<th><a href="https://github.com/visulima/visulima">@visulima/notification 2</a><br><sub>unified, multi-channel</sub></th>
<th><a href="https://github.com/thinwrap/notifications-ts">@thinwrap/notifications 1</a><br><sub>stateless send facade</sub></th>
<th><a href="https://github.com/novuhq/novu">@novu/framework 2</a><br><sub>workflows + Novu server</sub></th>
<th><a href="https://github.com/notifme/notifme-sdk">notifme-sdk 1</a><br><sub>unified, multi-channel</sub></th>
<th><a href="https://github.com/grammyjs/grammY">grammy 1</a><br><sub>Telegram bot framework</sub></th>
<th><a href="https://github.com/yagop/node-telegram-bot-api">node-telegram-bot-api 2</a><br><sub>Telegram Bot API client</sub></th>
<th><a href="https://github.com/twilio/twilio-node">twilio 6</a><br><sub>Twilio SDK</sub></th>
<th><a href="https://github.com/team-telnyx/telnyx-node">telnyx 7</a><br><sub>Telnyx SDK</sub></th>
<th><a href="https://github.com/Vonage/vonage-node-sdk">@vonage/server-sdk 3</a><br><sub>Vonage SDK</sub></th>
<th><a href="https://github.com/plivo/plivo-node">plivo 4</a><br><sub>Plivo SDK</sub></th>
<th><a href="https://www.npmjs.com/package/@sinch/sdk-core">@sinch/sdk-core 1</a><br><sub>Sinch SDK</sub></th>
</tr>
</thead>
<tbody>
<tr class="ml-matrix-group"><td colspan="13"><strong>Runtimes (from imports and package metadata, not run)</strong></td></tr>
<tr><td>Node.js, minimum version</td><td>✅ ≥22, CI on 22 and 24</td><td>✅ ≥22.14; not 23 or 24.0–24.9<sup>1</sup></td><td>✅ ≥18</td><td>⚠️ not declared (no <code>engines</code>)</td><td>⚠️ not declared (no <code>engines</code>)</td><td>✅ ≥12.20 / ≥14.13.1</td><td>✅ ≥18</td><td>✅ ≥20</td><td>⚠️ not declared<sup>2</sup></td><td>✅ ≥22 (<code>engineStrict</code>)</td><td>⚠️ not declared</td><td>⚠️ not declared</td></tr>
<tr><td>Deno</td><td>✅ CI: unit and runtime suites<sup>3</sup></td><td>❌ dropped in 2.0.0<sup>4</sup></td><td>❌ not declared</td><td>❌ not declared</td><td>❌ not declared</td><td>✅ Deno-first (<code>deno.land/x/grammy</code>)</td><td>✅ declared in README, web-standard core</td><td>❌ not declared</td><td>✅ declared (README), fetch-based</td><td>⚠️ <code>deno</code> export condition only<sup>5</sup></td><td>❌ not declared</td><td>❌ not declared</td></tr>
<tr><td>Bun</td><td>✅ CI: unit and runtime suites</td><td>✅ declared; <code>fetch</code> + Web Crypto</td><td>❌ not declared</td><td>❌ not declared</td><td>❌ not declared</td><td>✅ <code>bun</code> webhook adapter</td><td>✅ declared, tests use <code>bun test</code></td><td>❌ not declared</td><td>✅ declared (README)</td><td>⚠️ <code>bun</code> export condition only</td><td>❌ not declared</td><td>❌ not declared</td></tr>
<tr><td>Cloudflare Workers / edge</td><td>❌ not a target yet</td><td>✅ declared; no <code>node:*</code> outside APNs<sup>6</sup></td><td>⚠️ <code>crypto</code> import; needs <code>nodejs_compat</code><sup>7</sup></td><td>⚠️ Hono/h3 adapters, but imports Node built-ins<sup>8</sup></td><td>❌ node-fetch, nodemailer, <code>crypto</code></td><td>✅ web bundle, <code>cloudflare-mod</code> adapter</td><td>✅ core has no <code>node:*</code></td><td>❌ Node <code>https</code>, <code>fs</code>, <code>crypto</code><sup>9</sup></td><td>✅ Workers, Vercel Edge declared; fetch only</td><td>⚠️ <code>workerd</code> condition, but Node APIs<sup>10</sup></td><td>❌ Node <code>http</code>/<code>https</code>, axios agents</td><td>❌ node-fetch 2, Node <code>crypto</code>/<code>stream</code></td></tr>
<tr><td>Browser</td><td>❌ credentials stay on a server</td><td>❌ not declared</td><td>❌ server-only (README)</td><td>❌ server-side bridge</td><td>❌</td><td>✅ <code>browser</code> export (<code>out/web.mjs</code>)</td><td>⚠️ web-standard core, not declared</td><td>❌ Node-only</td><td>✅ declared; no browser guard<sup>11</sup></td><td>❌ <code>browser</code> export throws (Node-only)</td><td>❌ Node-only</td><td>❌ Node-only</td></tr>
<tr class="ml-matrix-group"><td colspan="13"><strong>Channels</strong></td></tr>
<tr><td>SMS</td><td>🔜 Twilio, Vonage, Infobip, Sinch, AWS End User Messaging</td><td>✅ Twilio, Vonage, Plivo, MessageBird, Telnyx, SNS</td><td>✅ 10, incl. Twilio, Vonage, Infobip, Sinch</td><td>✅ 38 SMS provider ids, on Novu server</td><td>✅ 9 providers</td><td>—</td><td>—</td><td>✅ Messages API</td><td>✅ Messages API (long/short code, alphanumeric)</td><td>✅ Messages API and SMS API</td><td>✅ Message API</td><td>✅ SMS API (batches)</td></tr>
<tr><td>RCS</td><td>🔜 Google RBM, the SMS providers' RCS</td><td>❌ no RCS code<sup>12</sup></td><td>⚠️ Twilio <code>contentSid</code> via a Messaging Service<sup>13</sup></td><td>❌ no provider id</td><td>❌</td><td>—</td><td>—</td><td>✅ Messages API, RCS senders (<code>rcs:</code>)</td><td>✅ <code>messages.rcs.send()</code>, RCS agents</td><td>✅ Messages API <code>rcs</code> channel<sup>14</sup></td><td>❌ none</td><td>✅ Conversation API <code>RCS</code></td></tr>
<tr><td>WhatsApp</td><td>🔜 Meta Cloud API</td><td>⚠️ Twilio <code>whatsapp:</code> prefix only<sup>15</sup></td><td>✅ Meta Cloud API</td><td>✅ Cloud API (<code>whatsapp-business</code>)<sup>16</sup></td><td>✅ Infobip (BSP) only</td><td>—</td><td>—</td><td>✅ official, Twilio as BSP</td><td>✅ official, <code>messages.whatsapp()</code></td><td>✅ official, Messages API</td><td>✅ official, <code>type: 'whatsapp'</code></td><td>✅ Conversation API (official BSP)</td></tr>
<tr><td>Facebook Messenger</td><td>🔜 Send API of a page</td><td>❌</td><td>❌</td><td>❌ no provider id</td><td>❌ listed as a TODO in the source</td><td>—</td><td>—</td><td>✅ Conversations <code>messenger</code> address type<sup>17</sup></td><td>❌ none</td><td>✅ Messages API <code>messenger</code> channel</td><td>❌ none</td><td>✅ Conversation API <code>MESSENGER</code></td></tr>
<tr><td>Instagram Direct</td><td>🔜 Instagram messaging API</td><td>❌</td><td>❌</td><td>❌ no provider id</td><td>❌</td><td>—</td><td>—</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>✅ Conversation API <code>INSTAGRAM</code></td></tr>
<tr><td>Telegram Bot API</td><td>🔜 Bot API</td><td>✅ <code>sendMessage</code> text + webhook receiver<sup>18</sup></td><td>✅ Bot API <code>sendMessage</code></td><td>✅ <code>telegram</code> chat provider and agents<sup>19</sup></td><td>❌ listed as a TODO in the source</td><td>✅ Bot API 10.3</td><td>✅ Bot API 10.3</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>✅ Conversation API <code>TELEGRAM</code> channel</td></tr>
<tr><td>Viber</td><td>🔜 Bot API, Ukrainian providers</td><td>❌</td><td>❌</td><td>❌ no provider id</td><td>❌</td><td>—</td><td>—</td><td>❌ none</td><td>❌ none</td><td>✅ <code>viber_service</code> (Viber Business)</td><td>❌ none</td><td>✅ <code>VIBER</code>, <code>VIBERBM</code> channels</td></tr>
<tr><td>Slack</td><td>🔜 Web API and incoming webhooks</td><td>✅ Web API <code>chat.postMessage</code> or incoming webhook<sup>20</sup></td><td>✅ incoming webhook only; blocks, threads<sup>21</sup></td><td>✅ <code>slack</code>, <code>novu-slack</code>: OAuth app, webhooks, Novu server<sup>22</sup></td><td>✅ incoming webhook only</td><td>—</td><td>—</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td></tr>
<tr><td>Discord</td><td>🔜 bot REST API and webhooks</td><td>✅ incoming webhook only, plus interactions receiver<sup>23</sup></td><td>✅ incoming webhook only; embeds, components</td><td>✅ <code>discord</code>: incoming webhook, on the Novu server<sup>24</sup></td><td>❌</td><td>—</td><td>—</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td></tr>
<tr><td>Microsoft Teams</td><td>🔜 Workflows webhooks, Bot Framework</td><td>✅ incoming webhook + outgoing-webhook receiver<sup>25</sup></td><td>✅ Workflows or legacy webhook, Adaptive Card<sup>26</sup></td><td>✅ <code>msteams</code>: Azure Bot, on the Novu server<sup>27</sup></td><td>❌</td><td>—</td><td>—</td><td>❌ none</td><td>❌ none (Teams Phone voice only)<sup>28</sup></td><td>❌ none</td><td>❌ none</td><td>❌ none</td></tr>
<tr><td>Google Chat</td><td>🔜 space webhooks, Chat API</td><td>❌</td><td>✅ space webhook; cards v2, threads</td><td>🔜 <code>google-chat</code> is marked <code>comingSoon</code><sup>29</sup></td><td>❌</td><td>—</td><td>—</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td></tr>
<tr><td>Push (FCM, APNs, Web Push)</td><td>🔜 FCM HTTP v1, APNs, Web Push<sup>30</sup></td><td>✅ FCM HTTP v1, APNs, Web Push, Expo<sup>31</sup></td><td>✅ FCM v1, APNs, Expo, OneSignal, Beams, WonderPush<sup>32</sup></td><td>✅ <code>fcm</code>, <code>apns</code>, <code>expo</code>, <code>one-signal</code>, <code>pushpad</code>…, Novu server<sup>33</sup></td><td>⚠️ APNs, Web Push (VAPID), WNS, ADM; FCM broken<sup>34</sup></td><td>—</td><td>—</td><td>✅ Notify: APNs, FCM (GCM legacy)<sup>35</sup></td><td>❌ none (call push credentials only)<sup>36</sup></td><td>❌ none</td><td>❌ none</td><td>❌ none</td></tr>
<tr><td>Other channels</td><td>✅ email: SMTP, sendmail, JMAP, 18 HTTP providers<sup>37</sup></td><td>✅ email, in-app inbox, outbound webhook<sup>38</sup></td><td>✅ email, LINE, Mattermost, Rocket.Chat<sup>39</sup></td><td>email, in-app, LINE, iMessage, Webex, Mattermost, Zulip…<sup>40</sup></td><td>email, voice (Twilio)</td><td>—</td><td>—</td><td>✅ MMS, voice, video, email, in-app chat, Apple Messages<sup>41</sup></td><td>✅ MMS, voice, video rooms, fax, email</td><td>✅ MMS, email, voice, video</td><td>✅ MMS, voice, number masking</td><td>✅ MMS, LINE, WeChat, KakaoTalk, Apple, voice, fax<sup>42</sup></td></tr>
<tr><td>Ukrainian providers</td><td>🔜 TurboSMS, AlphaSMS, SMSClub</td><td>❌</td><td>❌</td><td>❌</td><td>❌</td><td>—</td><td>—</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td></tr>
<tr class="ml-matrix-group"><td colspan="13"><strong>Providers and delivery reliability</strong></td></tr>
<tr><td>Providers, count</td><td>🔜 19 in 2.0, few per channel</td><td>16 + email via <code>@visulima/email</code><sup>43</sup></td><td>35 across SMS, chat, push, email<sup>44</sup></td><td>86 provider ids (38 SMS)<sup>45</sup></td><td>24 plus <code>custom</code><sup>46</sup></td><td>1 (Telegram Bot API)</td><td>1 (Telegram Bot API)</td><td>1 (its own)</td><td>1 (its own)</td><td>1 (its own)</td><td>1 (its own)</td><td>1 (its own)</td></tr>
<tr><td>Failover between providers</td><td>🔜 <code>./pool</code>, between providers of a channel</td><td>✅ <code>createFailoverProvider</code>, round-robin<sup>47</sup></td><td>❌</td><td>❌ routing by <code>primary</code>/conditions, no failover<sup>48</sup></td><td>✅ <code>fallback</code> (default), <code>roundrobin</code>, custom function</td><td>—</td><td>—</td><td>❌ single provider</td><td>❌ single provider</td><td>❌ single provider</td><td>❌ single provider</td><td>❌ single provider</td></tr>
<tr><td>Fallback between channels</td><td>🔜 on refusal (2.1), or no receipt in time (2.2)<sup>49</sup></td><td>✅ <code>route()</code> best-of channel order<sup>50</sup></td><td>❌</td><td>⚠️ step <code>skip</code> on in-app read state<sup>51</sup></td><td>❌ channels are sent in parallel<sup>52</sup></td><td>—</td><td>—</td><td>⚠️ provider-side RCS → SMS <code>fallbackFrom</code></td><td>⚠️ provider-side RCS → SMS/MMS fallback</td><td>⚠️ provider-side <code>failover</code> array<sup>53</sup></td><td>❌ none</td><td>⚠️ provider-side <code>channel_priority_order</code></td></tr>
<tr><td>Retry / backoff</td><td>🔜 <code>./retry</code>: classified errors, <code>Retry-After</code></td><td>✅ HTTP retries + <code>retryMiddleware</code><sup>54</sup></td><td>❌ none; error codes + <code>Retry-After</code> exposed</td><td>⚠️ on the Novu server<sup>55</sup></td><td>❌ moves to the next provider, no backoff</td><td>⚠️ plugin <code>@grammyjs/auto-retry</code><sup>56</sup></td><td>✅ 429, network and 5xx errors, jittered backoff<sup>57</sup></td><td>⚠️ opt-in <code>autoRetry</code>, HTTP 429 only<sup>58</sup></td><td>✅ 2 retries, backoff + jitter, Retry-After<sup>59</sup></td><td>❌ none</td><td>❌ none for messages<sup>60</sup></td><td>⚠️ HTTP 429 only, Retry-After + jitter<sup>61</sup></td></tr>
<tr><td>Rate limiting</td><td>🔜 <code>./ratelimit</code>, per channel and provider</td><td>✅ token-bucket middleware, in memory<sup>62</sup></td><td>❌</td><td>⚠️ throttle step, on the Novu server</td><td>❌</td><td>⚠️ plugin <code>transformer-throttler</code> (bottleneck)</td><td>✅ opt-in token bucket, global and per chat</td><td>❌ none (agent <code>maxSockets</code> only)</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td></tr>
<tr><td>Circuit breaker</td><td>🔜 <code>./breaker</code>, one probe when half-open</td><td>⚠️ one breaker for all channels<sup>63</sup></td><td>❌</td><td>❌</td><td>❌</td><td>❌</td><td>❌</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td></tr>
<tr><td>Timeout / AbortSignal</td><td>🔜 <code>AbortSignal</code></td><td>⚠️ per-provider <code>timeout</code> (30 s), no <code>AbortSignal</code></td><td>⚠️ only through an injected <code>fetch</code></td><td>❌ trigger <code>fetch</code> has no timeout or signal</td><td>❌ node-fetch without a timeout</td><td>✅ <code>timeoutSeconds</code> (500 s), AbortSignal</td><td>✅ 300 s by default, AbortSignal</td><td>✅ <code>timeout</code> (30 s default); no AbortSignal</td><td>✅ 60 s default, per request; AbortSignal</td><td>⚠️ opt-in <code>timeout</code>, no default<sup>64</sup></td><td>⚠️ opt-in <code>timeout</code>, no default</td><td>✅ <code>timeoutSeconds</code> (60 s default); no AbortSignal</td></tr>
<tr><td>Persistent queue (survives a restart)</td><td>🔜 <code>./queue</code>: outbox in MongoDB, BullMQ</td><td>✅ BullMQ, pg-boss, SQS, unstorage adapters<sup>65</sup></td><td>❌</td><td>⚠️ jobs persisted on the Novu server</td><td>⚠️ separate RabbitMQ plugin (2017)<sup>66</sup></td><td>❌ no outbound queue</td><td>❌</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td></tr>
<tr class="ml-matrix-group"><td colspan="13"><strong>Messages</strong></td></tr>
<tr><td>Phone numbers checked (E.164)</td><td>🔜 without libphonenumber-js</td><td>❌ a type comment only</td><td>❌</td><td>❌ subscriber <code>phone</code> is a free string</td><td>❌ only strips <code>+</code> for Infobip</td><td>—</td><td>—</td><td>⚠️ Lookups API (provider side)</td><td>⚠️ Number Lookup API (provider side)</td><td>⚠️ Number Insight API (provider side)</td><td>⚠️ Lookup API (provider side)</td><td>⚠️ Number Lookup API (provider side)</td></tr>
<tr><td>SMS encoding and segments</td><td>🔜 GSM-7 / UCS-2, before sending</td><td>❌</td><td>❌</td><td>❌</td><td>❌ a <code>type: 'unicode'</code> flag only</td><td>—</td><td>—</td><td>⚠️ provider-side <code>smartEncoded</code>, <code>numSegments</code></td><td>⚠️ provider-side <code>encoding</code>, <code>parts</code></td><td>⚠️ provider-side <code>encodingType</code></td><td>❌ none</td><td>⚠️ provider-side <code>dryRun</code> (parts, encoding)</td></tr>
<tr><td>Media</td><td>🔜</td><td>⚠️ MMS URLs on Twilio, Telnyx<sup>67</sup></td><td>⚠️ Twilio/Telnyx MMS; WhatsApp via passthrough</td><td>⚠️ chat card images, agent file replies<sup>68</sup></td><td>✅ WhatsApp media URLs, email attachments</td><td>✅ <code>InputFile</code>, <code>InputMediaBuilder</code></td><td>✅ streaming <code>InputFile</code>, media groups</td><td>✅ <code>mediaUrl</code> (MMS, WhatsApp)</td><td>✅ <code>media_urls</code>, WhatsApp media</td><td>✅ image, video, audio, file classes</td><td>✅ <code>media_urls</code>/<code>media_ids</code> (MMS, WhatsApp)</td><td>✅ media messages, MMS</td></tr>
<tr><td>Buttons / keyboards</td><td>🔜</td><td>⚠️ raw Slack blocks, Teams cards<sup>69</sup></td><td>✅ Telegram keyboards, WhatsApp interactive, Slack blocks</td><td>✅ chat cards (<code>Button</code>), in-app actions</td><td>⚠️ Slack and web-push actions only</td><td>✅ <code>InlineKeyboard</code>, <code>Keyboard</code></td><td>✅ inline and reply keyboard builders</td><td>✅ Content API (quick reply, card, list)</td><td>✅ WhatsApp <code>interactive</code>, RCS suggestions</td><td>✅ RCS suggestions, Viber button, WA custom</td><td>✅ WhatsApp <code>interactive</code> (joi-validated)</td><td>✅ choice, card, carousel, list messages</td></tr>
<tr><td>WhatsApp templates</td><td>🔜</td><td>❌</td><td>✅ <code>type: 'template'</code>, Meta's shape</td><td>⚠️ raw <code>template</code> object pass-through<sup>70</sup></td><td>✅ <code>templateName</code>/<code>templateData</code> (Infobip)</td><td>—</td><td>—</td><td>✅ <code>contentSid</code> + <code>contentVariables</code></td><td>✅ <code>template</code> + templates API</td><td>✅ <code>WhatsAppTemplate</code> class</td><td>✅ <code>template</code> param (joi-validated)</td><td>✅ Conversation templates API</td></tr>
<tr><td>WhatsApp 24-hour window</td><td>🔜 from inbound timestamps (2.1)</td><td>❌</td><td>❌ error 131047 is just <code>invalid_request</code></td><td>❌</td><td>❌</td><td>—</td><td>—</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td></tr>
<tr><td>Built-in text templates</td><td>🔜 <code>./templates</code>: text by name, engines passed in</td><td>✅ <code>{{var}}</code>, Liquid, Handlebars, i18n<sup>71</sup></td><td>❌</td><td>✅ Liquid (liquidjs) in step controls</td><td>⚠️ separate <code>notifme-template</code> (2017)</td><td>⚠️ plugins: i18n, fluent</td><td>❌ <code>EntityBuilder</code> formatting only</td><td>⚠️ provider-side Content API only</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>⚠️ provider-side <code>parameters</code>, templates API</td></tr>
<tr><td>Batch / bulk</td><td>🔜</td><td>✅ <code>sendMany</code> with concurrency, multi-recipient <code>to</code><sup>72</sup></td><td>⚠️ push multi-token <code>sendMessage()</code> only</td><td>⚠️ many subscribers or topics in <code>to</code></td><td>❌</td><td>❌</td><td>❌</td><td>⚠️ Notify <code>toBinding</code> (provider side)</td><td>❌ none (group MMS only)</td><td>❌ none</td><td>⚠️ <code>dst</code> array joined with <code>&lt;</code><sup>73</sup></td><td>⚠️ provider batches (<code>to[]</code>)</td></tr>
<tr><td>Scheduled sending</td><td>🔜 a delay of the queue</td><td>✅ <code>scheduledAt</code> on queue enqueue<sup>74</sup></td><td>⚠️ provider <code>sendAt</code> (Twilio, Infobip, Sinch)</td><td>⚠️ delay steps (cron, date), on the Novu server</td><td>❌</td><td>❌</td><td>❌</td><td>⚠️ provider-side <code>sendAt</code> + <code>scheduleType</code></td><td>⚠️ provider-side <code>send_at</code>, cancel</td><td>❌ none</td><td>❌ none</td><td>⚠️ provider-side SMS <code>send_at</code></td></tr>
<tr><td>Idempotency key</td><td>🔜 <code>./idempotency</code>, outbox + provider’s own keys</td><td>⚠️ in-memory <code>dedupeMiddleware</code> only<sup>75</sup></td><td>❌</td><td>⚠️ <code>transactionId</code>, sent with the trigger<sup>76</sup></td><td>❌</td><td>❌ the Bot API has none</td><td>❌ the Bot API has none</td><td>❌ none on Messages<sup>77</sup></td><td>⚠️ typed <code>Idempotency-Key</code> (provider), not automatic</td><td>❌ none</td><td>❌ none</td><td>❌ none</td></tr>
<tr class="ml-matrix-group"><td colspan="13"><strong>Delivery status and compliance</strong></td></tr>
<tr><td>Delivery receipts, one model</td><td>🔜 one model, every channel</td><td>⚠️ one event type; only Twilio parses status<sup>78</sup></td><td>❌ status enums exported, never used<sup>79</sup></td><td>⚠️ <code>message.*</code> events, on the Novu server<sup>80</sup></td><td>❌</td><td>— the Bot API has none</td><td>— the Bot API has none</td><td>⚠️ provider status enum; callbacks untyped</td><td>⚠️ one Telnyx model (SMS/MMS/RCS/WA)</td><td>⚠️ provider-side; no Messages status types</td><td>⚠️ provider-side only; untyped</td><td>⚠️ typed per API (SMS, Conversation)<sup>81</sup></td></tr>
<tr><td>Status webhooks: parsing</td><td>🔜 status of every provider (2.1)</td><td>⚠️ Twilio status, Standard Webhooks, SNS</td><td>⚠️ callback URL options, no parsing<sup>82</sup></td><td>⚠️ 13 providers parsed, on the Novu server<sup>83</sup></td><td>⚠️ voice <code>statusCallback</code> pass-through only</td><td>— updates only, no status events</td><td>— updates only, no status events</td><td>⚠️ <code>statusCallback</code> URL only; no parser</td><td>✅ typed <code>webhooks.unwrap()</code> events<sup>84</sup></td><td>⚠️ SMS DLR type only; no parser</td><td>⚠️ status <code>url</code> param; no parser</td><td>✅ <code>parseEvent</code> for SMS and Conversation</td></tr>
<tr><td>Webhook signature verification</td><td>🔜 verified before parsing (2.1)</td><td>✅ HMAC, Ed25519, JWT, SNS certificates<sup>85</sup></td><td>❌</td><td>⚠️ HMAC on the bridge only<sup>86</sup></td><td>❌</td><td>✅ <code>secretToken</code>, constant-time compare<sup>87</sup></td><td>✅ secret token required by default<sup>88</sup></td><td>✅ <code>validateRequest</code> HMAC-SHA1, Express middleware<sup>89</sup></td><td>✅ Ed25519 (WebCrypto), 5-minute window</td><td>⚠️ JWT <code>verifySignature</code>; SMS HMAC<sup>90</sup></td><td>⚠️ <code>validateV3Signature</code> HMAC-SHA256 + nonce<sup>91</sup></td><td>⚠️ HMAC-SHA256 with nonce + timestamp<sup>92</sup></td></tr>
<tr><td>Inbound messages</td><td>🔜 STOP and the WhatsApp window (2.1)</td><td>✅ 8 receivers: SMS, Twilio WhatsApp, chat</td><td>❌</td><td>⚠️ agents' <code>onMessage</code>, through the Novu server<sup>93</sup></td><td>❌</td><td>✅ long polling and 20+ webhook adapters</td><td>✅ long polling and a web-standard webhook</td><td>⚠️ TwiML <code>MessagingResponse</code>; no parser</td><td>✅ typed <code>message.received</code> event</td><td>⚠️ SMS <code>InboundMessage</code> type only</td><td>⚠️ Plivo XML replies; no parser</td><td>✅ MO events parsed (SMS, Conversation)</td></tr>
<tr><td>Opt-out (STOP) / suppression</td><td>🔜 one list across channels and email (2.1)</td><td>⚠️ suppression hook; the list is yours<sup>94</sup></td><td>❌</td><td>⚠️ subscriber preferences, on the Novu server</td><td>❌</td><td>❌</td><td>❌</td><td>⚠️ provider-side (Messaging Service, consents API)</td><td>⚠️ provider opt-out list (read only)</td><td>❌ none</td><td>❌ none</td><td>⚠️ provider consents API, <code>OPT_OUT</code> events</td></tr>
<tr><td>Quiet hours / user preferences</td><td>❌ not planned</td><td>⚠️ per-channel opt-outs, no quiet hours</td><td>❌</td><td>⚠️ preferences and weekly schedule, on the Novu server</td><td>❌</td><td>❌</td><td>❌</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td></tr>
<tr class="ml-matrix-group"><td colspan="13"><strong>Observability and extensibility</strong></td></tr>
<tr><td>OpenTelemetry</td><td>🔜 <code>./otel</code></td><td>✅ <code>telemetryMiddleware</code>: spans, counter, histogram<sup>95</sup></td><td>❌</td><td>❌</td><td>❌</td><td>❌ <code>debug</code> logs only</td><td>❌ <code>DEBUG</code> tracing only</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td></tr>
<tr><td>Hooks / middleware</td><td>🔜 <code>./hooks</code></td><td>✅ middleware via <code>use()</code></td><td>❌ none; wrap the injected <code>fetch</code></td><td>⚠️ step <code>skip</code>, provider overrides</td><td>⚠️ <code>customize</code> callback, custom providers and strategies</td><td>✅ middleware and API transformers</td><td>✅ koa-style update middleware<sup>96</sup></td><td>⚠️ custom <code>httpClient</code> only</td><td>⚠️ custom <code>fetch</code>, <code>logger</code> only</td><td>❌ none (global <code>fetch</code>, <code>debug</code> logs)</td><td>❌ none</td><td>✅ request/response plugins</td></tr>
<tr><td>Mock / test mode</td><td>🔜 <code>./mock</code></td><td>✅ <code>mockProvider</code> records sends, <code>failWith</code></td><td>⚠️ inject <code>fetch</code> or your own connector</td><td>⚠️ preview with mocked payloads</td><td>✅ notification catcher, logger provider<sup>97</sup></td><td>⚠️ transformers, test DC, custom <code>fetch</code></td><td>⚠️ injectable <code>fetch</code></td><td>❌ none<sup>98</sup></td><td>❌ none</td><td>❌ none</td><td>❌ none<sup>99</sup></td><td>⚠️ Jest <code>*ApiFixture</code> classes</td></tr>
<tr><td>Local audit log / event journal</td><td>🔜 <code>./audit</code>, append-only; numbers erasable (2.2)</td><td>⚠️ in-memory event store, fed by hand<sup>100</sup></td><td>❌</td><td>⚠️ activity feed, on the Novu server</td><td>❌ winston console logs only</td><td>❌</td><td>❌</td><td>❌ none (debug console logging)</td><td>❌ none (logger only)</td><td>❌ none (<code>debug</code> logs)</td><td>❌ none</td><td>❌ none (logger only)</td></tr>
<tr class="ml-matrix-group"><td colspan="13"><strong>Quality, license, maturity</strong></td></tr>
<tr><td>TypeScript types</td><td>✅ hand-written, tsd</td><td>✅ built in</td><td>✅ built in</td><td>✅ built in</td><td>⚠️ Flow in the package, <code>@types/notifme-sdk</code></td><td>✅ built in (TS source)</td><td>✅ built in, generated from Bot API docs</td><td>✅ built in</td><td>✅ built in</td><td>✅ built in</td><td>✅ bundled <code>.d.ts</code></td><td>✅ built in</td></tr>
<tr><td>Runtime dependencies</td><td>0</td><td>0 (11 optional peers)<sup>101</sup></td><td>0</td><td>11 (ajv, liquidjs, sanitize-html, <code>chat</code>…)<sup>102</sup></td><td>8 (winston, nodemailer, node-fetch 2, web-push…)</td><td>4 (node-fetch 2, debug, abort-controller, types)</td><td>0</td><td>6: axios, jsonwebtoken, qs, dayjs, …<sup>103</sup></td><td>0 (optional peer <code>ws</code>)<sup>104</sup></td><td>17 (all <code>@vonage/*</code>)<sup>105</sup></td><td>15, incl. deprecated <code>request</code><sup>106</sup></td><td>9 (all <code>@sinch/*</code>)<sup>107</sup></td></tr>
<tr><td>Module format</td><td>CJS, ESM <code>import</code></td><td>ESM only</td><td>ESM + CJS</td><td>ESM + CJS</td><td>CJS only (Babel)</td><td>CJS for Node, ESM web bundle</td><td>ESM + CJS</td><td>CJS</td><td>both (CJS + ESM)</td><td>both (CJS + ESM)</td><td>CJS</td><td>CJS</td></tr>
<tr><td>License</td><td>MIT</td><td>MIT</td><td>MIT</td><td>ISC</td><td>MIT</td><td>MIT</td><td>MIT</td><td>MIT</td><td>MIT</td><td>Apache-2.0</td><td>MIT</td><td>Apache-2.0</td></tr>
<tr><td>Version (2026-10-22)</td><td>1.2.1 (2026-11-07); channels in 2.0</td><td>2.0.0</td><td>1.2.0</td><td>2.14.0</td><td>1.16.25</td><td>1.46.0</td><td>2.1.0 (2.2.0-rc2 on <code>next</code>)</td><td>6.2.0</td><td>7.28.0</td><td>3.30.1</td><td>4.79.0</td><td>1.7.0</td></tr>
<tr><td>Last release</td><td>2026-11-07</td><td>2026-10-15</td><td>2026-10-18</td><td>2026-09-28</td><td>2025-03-25</td><td>2026-08-26</td><td>2026-08-24</td><td>2026-10-12</td><td>2026-10-22</td><td>2026-09-09</td><td>2026-07-28</td><td>2026-10-15</td></tr>
<tr><td>npm downloads / week</td><td>—</td><td>14k</td><td>494</td><td>43k</td><td>705</td><td>2.5M</td><td>125k<sup>108</sup></td><td>3.7M</td><td>238k</td><td>73k</td><td>23k</td><td>11k</td></tr>
<tr><td>Owner / maintenance risk</td><td>1 author, Alexis Technologies</td><td>1 author (Anolilab), 52 versions since June</td><td>1 author, 5 versions since June 2026<sup>109</sup></td><td>company (Novu), active</td><td>2 maintainers, no release since Mar 2025</td><td>1 npm maintainer, active org</td><td>2 maintainers, two rewrites in 2026<sup>110</sup></td><td>Twilio (company), active</td><td>Telnyx (company), Stainless-generated<sup>111</sup></td><td>Vonage (company), active</td><td>Plivo (company), active</td><td>Sinch (company), active</td></tr>
</tbody>
</table>

</div>

✅ in the code · ⚠️ partial, or only on the provider side · ❌ none · 🔜 planned by the author, no code yet · — does not apply. Every cell was decided by reading the package as published on npm as of 2026-10-22, not its README; the column of @alexify/mailer is its plan for the channels as of 2026-11-07 (2.0 unless a release is named): its reliability layer is in the code for email (1.2), and takes the messages of the channels in 2.0.

1. <code>engines</code>: <code>^22.14.0 || &gt;=24.10.0</code>.
2. No <code>engines</code> field; the bundled README lists Node.js 20 LTS or later.
3. Through <code>npm:@alexify/mailer</code>.
4. The 2.0.0 major release exists only to remove Deno as a supported runtime (CHANGELOG).
5. package.json maps a long list of runtime conditions (deno, bun, workerd, …) to the same build; the README only mentions Node.js.
6. Every SMS and chat provider and every webhook verifier uses only <code>fetch</code> and Web Crypto; APNs (<code>node:http2</code>) and the BullMQ / pg-boss / SQS queue adapters are Node-only.
7. The <code>Sms</code> and <code>Push</code> facades statically import the SNS, FCM and APNs connectors, which use Node's <code>crypto</code> and <code>Buffer</code>; the chat connectors use only <code>fetch</code>.
8. The main entry statically imports <code>path</code>, <code>process</code>, <code>url</code> and <code>async_hooks</code> and reads <code>process.env</code> and <code>process.hrtime</code>, so a Worker needs <code>nodejs_compat</code>. Nothing in the package declares edge support. Sending itself runs on the Novu server.
9. <code>lib/base/RequestClient.js</code> builds an <code>https.Agent</code> for axios and reads <code>fs</code>; <code>lib/webhooks/webhooks.js</code> uses Node <code>crypto</code>.
10. <code>@vonage/auth</code> imports Node <code>fs</code> and <code>crypto</code> at load, JWTs use <code>jsonwebtoken</code>, and <code>@vonage/server-client</code> reads <code>process.version</code> on every request.
11. There is no <code>dangerouslyAllowBrowser</code>-style check, so client-side use ships the API key.
12. Plain text sent through a Twilio Messaging Service that has an RCS sender may be upgraded to RCS on Twilio's side; nothing in the library knows about it.
13. No RCS connector: Twilio Content API templates (<code>contentSid</code>, <code>contentVariables</code>) can go out as RCS when the Messaging Service has an RCS sender; the Infobip and Sinch connectors use SMS endpoints only.
14. The bundled <code>@vonage/messages</code> README lists RCS as Beta.
15. No Cloud API provider and no template support; the Twilio receiver detects WhatsApp and <code>reply()</code> re-adds the <code>whatsapp:</code> prefix.
16. The <code>whatsapp-business</code> provider posts to <code>graph.facebook.com</code> (Meta's official API). Novu agents can also reply on WhatsApp.
17. Notify's Facebook Messenger option (<code>facebookMessengerPageId</code>) is marked Deprecated in <code>lib/rest/notify/v1/service.d.ts</code>; Conversations is the remaining path.
18. The provider sends text and <code>parse_mode</code> only: <code>blocks</code>, <code>threadId</code> and media are dropped. The receiver checks the secret token only when <code>secretToken</code> is set.
19. The <code>telegram</code> id is in <code>@novu/shared</code> 2.10.0 and in the framework's provider schemas. The last <code>@novu/providers</code> on npm (2.6.6, Feb 2025) has no Telegram code, so the sending code ships only inside the Novu server.
20. Blocks and threads are sent; the Slack receiver verifies signatures and parses events, slash commands and interactions.
21. Incoming webhooks by design, with no Web API (<code>chat.postMessage</code>): <code>providerMessageId</code> is <code>null</code>.
22. In <code>@novu/providers</code> 2.6.6, <code>slack</code> posts to the subscriber's incoming <code>webhookUrl</code>. <code>@novu/shared</code> 2.10.0 adds <code>slack_channel</code>/<code>slack_user</code> endpoints and a signing secret, and Slack is also an agent platform for inbound messages.
23. No bot API, so no DMs; <code>blocks</code> become <code>embeds</code>. When a handler takes over 2 s the receiver defers the interaction, but <code>reply()</code> posts through the channel webhook, not as the interaction follow-up.
24. Discord as an agent platform (inbound) is marked <code>comingSoon</code> in <code>@novu/shared</code>.
25. Without <code>blocks</code> it posts a legacy <code>MessageCard</code>, the Office 365 connector format Microsoft is retiring; a Workflows webhook needs an Adaptive Card envelope you pass as <code>blocks</code>.
26. Wraps the text in an Adaptive Card envelope and treats a legacy connector's HTTP 200 error body as a failure.
27. In <code>@novu/providers</code> 2.6.6, <code>msteams</code> posts to an incoming <code>webhookUrl</code>. <code>@novu/shared</code> 2.10.0 asks for a Microsoft App ID, client secret and tenant ID (Azure Bot / Bot Framework) and adds <code>ms_teams_channel</code>/<code>ms_teams_user</code> endpoints.
28. The Teams resources (Operator Connect, direct routing, meeting bots) are telephony, not Teams messaging.
29. The framework's provider override schemas already have a <code>google-chat</code> key, but the integration catalog in <code>@novu/shared</code> 2.10.0 has no Google Chat provider. It appears only in the list of coming-soon agent platforms.
30. APNs requires HTTP/2, which Node’s <code>fetch</code> does not speak: it goes over <code>node:http2</code>. The tokens of FCM and APNs and the encryption of Web Push are <code>node:crypto</code>.
31. FCM needs an OAuth access token you obtain yourself; APNs uses <code>node:http2</code> and <code>node:crypto</code> (Node-only) and targets the sandbox unless <code>production: true</code>. Web Push is VAPID + RFC 8291 on Web Crypto.
32. No VAPID Web Push of its own. APNs refuses to send without an HTTP/2-capable <code>fetch</code> you inject (Node's is HTTP/1.1) and needs a <code>tokenCache</code> in production.
33. The ids <code>pusher-beams</code>, <code>appio</code> and <code>push-webhook</code> also exist. Web Push works only through FCM's <code>webPush</code> override, Pushpad or OneSignal; no provider sends VAPID Web Push directly.
34. From reading the code, not running it: the <code>fcm</code> provider passes its config as <code>gcm</code> settings (<code>lib/providers/push/fcm.js</code>). node-pushnotifications 3.1.1 sends Android tokens through its FCM v1 path, which reads <code>fcm</code> settings that are never set, and its <code>gcm</code> path uses Google's legacy API, shut down in 2024.
35. No Web Push. The package does not mark Notify itself deprecated, only its Messenger and Alexa options; Conversations has separate APN/FCM credentials for its own client SDKs.
36. <code>mobilePushCredentials</code> (iOS/Android) only attach to SIP connections so Telnyx can wake its own calling SDK; there is no API to send push notifications.
37. Email is the channel of 1.x. LINE, WeChat, KakaoTalk, Zalo, Mattermost, Rocket.Chat or Matrix may follow 2.0, each when a user needs it; Signal and iMessage have no official API for this.
38. Email delegates to a <code>@visulima/email</code> instance; the in-app inbox has memory and unstorage stores.
39. 10 email providers: SES, Resend, Mailgun, SendGrid, Postmark, MailerSend, Mailtrap, Brevo, SparkPost, Scaleway.
40. Also Rocket.Chat, Ryver, GetStream, Grafana OnCall, a generic chat webhook, and tool steps (PagerDuty, Opsgenie, webhook). There is no voice channel.
41. Conversations still lists <code>gbm</code> (Google Business Messages), a channel Google shut down in 2024.
42. Apple Messages for Business is the Conversation channel <code>APPLEBC</code>; verification is in <code>@sinch/verification</code>.
43. 6 SMS, 4 chat, 4 push, in-app, outbound webhook; plus <code>failover</code>, <code>roundrobin</code>, <code>opentelemetry</code> and <code>mock</code> wrappers.
44. 10 SMS, 9 chat (WhatsApp and Telegram included), 6 push, 10 email; you can also pass a connector of your own.
45. Counted in <code>@novu/shared</code> 2.10.0 <code>types/providers.js</code>: 23 email, 38 SMS, 16 chat, 8 push and 1 in-app. These include Novu's own demo and webhook providers. <code>@novu/providers</code> 2.6.6, the last version on npm, has 66 implementations.
46. 7 email, 9 SMS, 4 push, and 1 each for voice (Twilio), web push, Slack and WhatsApp.
47. Tries the next provider on any failure (no error classification), each after its own HTTP retries.
48. An integration has <code>primary</code>, <code>priority</code> and <code>conditions</code> fields. The published packages show no retry on another provider after an error.
49. A message moves on when the provider refused it, when the recipient is not on the channel, or when no receipt says it was delivered within a deadline; never after a send of unknown outcome without an idempotency key. Email is one of the channels to fall back to.
50. Moves on only when a send fails: a suppressed or deduplicated send counts as success, and nothing waits for a delivery receipt.
51. Only the in-app step returns a result (<code>seen</code>, <code>read</code>). The SMS, chat, email and push result schemas are empty, so a step cannot react to an SMS or WhatsApp delivery failure.
52. <code>send()</code> sends every channel in the request at once with <code>Promise.all</code>. Nothing falls back from one channel to another.
53. <code>MessageWithFailover</code> passes a <code>failover</code> list of channel messages to the Messages API; the SDK does not act on it.
54. Each provider retries its POST 3 times on network errors, timeouts, 408/429 and 5xx (ignoring <code>Retry-After</code>); <code>retryMiddleware</code> and the queue worker retry again on top, and no idempotency key reaches the provider, so a timed-out SMS can go out more than once.
55. The package never retries a trigger. Retries happen in the server's job runner (the execution-details model in <code>@novu/shared</code> has an <code>isRetry</code> field).
56. The core retries only <code>getMe</code>, <code>deleteWebhook</code> (when polling starts) and <code>getUpdates</code>, never a send. The plugin's defaults are unlimited attempts and unlimited wait, and it also retries network errors, so a lost response can send a message twice.
57. Two retries by default, on every method. A timed-out <code>sendMessage</code> is sent again, so a lost response can send a message twice.
58. Full-jitter exponential backoff, 3 retries by default; 5xx and network errors are never retried, and <code>maxRetries: 0</code> silently becomes 3 because of <code>||</code> (<code>lib/base/RequestClient.js</code>).
59. Retries 408/409/429/5xx and timeouts, message POSTs included, but adds no idempotency key by itself; pass <code>Idempotency-Key</code> to avoid duplicate sends (<code>client.js</code>).
60. Only voice API calls are retried: twice on 5xx, immediately, without backoff (<code>dist/rest/axios.js</code>).
61. On by default (3 retries, configurable <code>retryPolicy</code>); 5xx and network errors are not retried (<code>@sinch/sdk-client/dist/client/retry-policy.js</code>).
62. One bucket per <code>Notification</code>, shared by every channel and provider.
63. <code>circuitBreakerMiddleware</code> keeps a single state per instance, so failures of one SMS provider open it for push, chat and email too.
64. <code>@vonage/server-client</code> uses an AbortController only when <code>timeout</code> is set; callers cannot pass their own AbortSignal.
65. The worker re-sends the whole message when any one channel fails; <code>UnstorageQueue</code> reservations never expire, so a crashed worker's job is stuck; <code>BullMqQueue</code> calls <code>getNextJob</code>, which a BullMQ <code>Queue</code> (as its docs say to pass) does not have.
66. <code>notifme-sdk-queue-rabbitmq</code> 4.0.0 was last published in 2017 and gets ~9 downloads a week.
67. Plivo advertises <code>media: true</code> but never sends <code>mediaUrls</code>; Telegram sends no media.
68. The SMS step has <code>body</code> only and the email step has no attachments field.
69. The Telegram provider drops <code>blocks</code>, so no inline keyboards; the Slack and Telegram receivers parse button callbacks.
70. In <code>@novu/providers</code> 2.6.6, <code>whatsapp-business</code> sends a template only when it receives <code>customData.template</code>. The framework has no model for WhatsApp templates.
71. Liquid, Handlebars and ICU messages need optional peers; rendering is a separate step, not part of <code>send()</code>.
72. A multi-recipient SMS counts as sent when any recipient succeeds, and the facade's receipt drops the per-recipient breakdown.
73. Bulk is done by the provider: the SDK only joins an array <code>dst</code> into Plivo's <code>&lt;</code>-delimited form (<code>dist/resources/messages.js</code>).
74. No provider reads the payload's <code>scheduledAt</code>, though Twilio and Telnyx advertise <code>scheduling: true</code>; the SQS adapter caps delays at 15 minutes.
75. The key never reaches a provider (despite its type doc), is not scoped per channel and is stored only after success, so after a partial failure a retry also skips the channel that failed.
76. The package sends <code>transactionId</code> and uses it to cancel a trigger. The package does not show whether the server rejects a duplicate.
77. Only a few other APIs (Conversations v2, call Payments, user-defined messages) accept an idempotency key.
78. <code>NotificationEvent</code> (queued … read) is shared, but Standard Webhooks maps unknown types to <code>delivered</code>, the Slack and SNS parsers always return <code>delivered</code>, and nothing links events to sends.
79. <code>getMessageId</code> and <code>parseEventBody</code> from Novu are not implemented (MIGRATION.md).
80. <code>@novu/shared</code> defines events such as <code>message.sent</code>, <code>message.delivered</code>, <code>message.failed</code> and <code>message.read</code> for Novu's outbound webhooks.
81. Conversation delivery events share one model across its channels; SMS delivery reports are a separate model.
82. Twilio <code>statusCallback</code>, Infobip <code>notifyUrl</code>, Telnyx <code>webhookUrl</code>, Sinch <code>callbackUrl</code> are passed through.
83. In <code>@novu/providers</code> 2.6.6, <code>parseEventBody</code> exists for 8 email providers and 5 SMS providers (Twilio, Plivo, Telnyx, Termii, RingCentral).
84. <code>JSON.parse</code> plus a TypeScript cast, with no runtime schema check (<code>lib/webhooks.js</code>).
85. Twilio verification needs the public URL passed in; Telegram's secret token is optional.
86. The bridge checks a <code>novu-signature</code> HMAC with a 5-minute window, but only when <code>NODE_ENV</code> is set to something other than <code>development</code>/<code>dev</code>, or when <code>strictAuthentication</code> is on. The provider code verifies no signatures on status webhooks.
87. The check is optional: when no <code>secretToken</code> is set, <code>webhookCallback</code> accepts every request. Telegram sends a shared secret header and does not sign payloads.
88. <code>webhookCallback</code> throws at setup unless you set <code>secretToken</code> or pass <code>allowUnauthenticated: true</code>. The comparison runs in constant time.
89. Timing-safe compare, tries the URL with and without port, and <code>validateRequestWithBody</code> checks <code>bodySHA256</code> for JSON bodies (<code>lib/webhooks/webhooks.js</code>). The scheme has no timestamp, so replays are not rejected.
90. <code>@vonage/jwt</code> <code>verifySignature</code> checks the JWT but not its <code>payload_hash</code> against the body and is not re-exported by <code>@vonage/server-sdk</code>; SMS <code>verifySignature</code> compares with <code>===</code>, not timing-safe.
91. Compares with <code>===</code> (not timing-safe) and does not track nonces against replay (<code>dist/utils/v3Security.js</code>).
92. <code>validateWebhookSignature</code> compares with <code>===</code> (not timing-safe), never checks the timestamp's age, and re-serializes object bodies with <code>JSON.stringify</code> (<code>@sinch/sdk-client/dist/utils/authorization.helper.js</code>).
93. The conversational providers are Slack, Telegram, WhatsApp Business, MS Teams, Sendblue and Novu email (<code>@novu/shared</code> <code>conversational-providers.js</code>).
94. A suppressed send is reported as <code>successful: true</code>, so <code>route()</code> stops there and does not try the next channel.
95. Duck-typed: pass a tracer and meter; <code>@opentelemetry/api</code> is never imported.
96. The only way to hook outgoing API calls is to inject your own <code>fetch</code>.
97. A channel with no providers configured silently falls back to the logger provider. It logs the whole request (recipient included) to the console and reports success with a random id.
98. Twilio test credentials work on the provider side; a custom <code>httpClient</code> can stub requests.
99. <code>dist/rest/client-test.js</code> is the SDK's own fixture client with hard-coded responses, not a documented test mode.
100. <code>NotificationEventBus</code> and <code>MemoryEventStore</code> exist, but the library never emits an event to them.
101. bullmq, pg-boss, <code>@aws-sdk/client-sqs</code>, unstorage, liquidjs, handlebars, croner, intl-messageformat, <code>@opentelemetry/api</code>, <code>@visulima/email</code>, <code>@visulima/workflow</code>.
102. There are also 13 optional peer dependencies (express, next, hono, zod, ai, langchain…).
103. Also <code>https-proxy-agent@5</code> and <code>xmlbuilder</code> (TwiML).
104. <code>ws</code> is needed only for the speech WebSocket helpers.
105. Third-party packages arrive transitively: <code>debug</code>, <code>jsonwebtoken</code>, <code>uuid</code>.
106. <code>request</code> backs only the bundled test client; runtime deps also include <code>@types/node@14</code> and the <code>querystring</code> shim. Importing the client overwrites the global <code>axios.defaults.httpAgent</code>/<code>httpsAgent</code> (<code>dist/rest/axios.js</code>).
107. Sub-packages bring <code>node-fetch@2.7.0</code> and <code>form-data</code>; <code>@sinch/sdk-client</code> requires <code>@sinch/sdk-core/package.json</code> without declaring it.
108. Most downloads are of 0.66/0.67. Version 2.1.0 gets ~8.7k a week (npm per-version API).
109. The README lists the Vonage id as <code>nexmo</code>, but only <code>vonage</code> is accepted; MIGRATION.md says the alias was removed in 1.0.
110. Version 1.0.0 came out on 2026-06-12 and 2.0.0 on 2026-08-16. The README says v2 is a from-scratch redesign with no v1 compatibility.
111. Ships several releases a month (7.25 → 7.28 between 2026-10-06 and 2026-10-22).

<!-- comparison:end -->

## How the table was made

- **From the published code, not the README.** Every cell was decided by reading the package as
  published on npm (`npm pack`), with its `package.json` and the registry's metadata, as of
  2026-10-22. The repositories were not read, so the tests and the CI of a project are not in the
  table.
- **Defects were not reproduced.** A cell that names a bug is a finding from reading the code;
  reproduce it before relying on it.
- **Runtimes were not run.** Deno, Bun and Workers support is inferred from imports, `exports`
  maps and the metadata of the package.
- **Downloads** are npm's count for the week of 2026-10-12 to 2026-10-18.
- **Novu** is judged as what an application gets: `@novu/framework` defines the workflows, and the
  Novu server (Novu Cloud or self-hosted) runs them, with the providers, retries and preferences.
  A feature of the server is marked as such.
- **Design references outside Node.js,** not in the table: [Symfony Notifier](https://symfony.com/doc/current/notifier.html)
  (PHP; texters and chatters behind DSNs, `||` for failover, a channel policy by importance, and a
  bridge for TurboSMS), [Apprise](https://github.com/caronc/apprise) (Python; some 200 services by
  URL), and [noticed](https://github.com/excid3/noticed) (Ruby; a notification per recipient, and
  a delivery that waits to see if the first was read).
