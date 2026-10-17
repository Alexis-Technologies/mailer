import { createRequire } from 'node:module';
import { defineConfig } from 'vitepress';

// The nav version label is read from package.json at config load, so a release
// needs no hand-edit here.
const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

const ogTitle = '@alexify/mailer — email for Node.js, with a reliability layer';
const ogDescription =
  'Zero-dependency email for Node.js: its own SMTP client, MIME builder, DKIM, Amazon SES and ' +
  'seven more HTTP providers, JMAP, failover, retries and OpenTelemetry; a reliability layer ' +
  '(persistent queue, audit log, delivery events) is next.';
const repo = 'https://github.com/Alexis-Technologies/mailer';
const base = '/';
const hostname = 'https://mailerat.vercel.app/';
const ogImage = `${hostname}logo.png`;

const keywords = [
  '@alexify/mailer',
  'node.js email',
  'nodemailer alternative',
  'smtp client',
  'mime builder',
  'dkim',
  'amazon ses',
  'transactional email',
  'email queue',
  'email outbox',
  'email audit log',
  'email idempotency',
  'zero dependency email',
].join(', ');

// schema.org structured data: helps search and AI engines read the site as a
// software package rather than plain text.
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: '@alexify/mailer',
  alternateName: 'mailer',
  description: ogDescription,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Node.js >= 22',
  url: hostname,
  downloadUrl: 'https://www.npmjs.com/package/@alexify/mailer',
  codeRepository: repo,
  license: 'https://opensource.org/licenses/MIT',
  keywords,
  author: { '@type': 'Organization', name: 'Alexis Technologies' },
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
};

// One sidebar for the guide, the messages and the transports, so that reading
// flows from one to the next.
const guide = [
  {
    text: 'Introduction',
    items: [
      { text: 'Why @alexify/mailer?', link: '/guide/why' },
      { text: 'Getting Started', link: '/guide/getting-started' },
      { text: 'Compared with alternatives', link: '/guide/comparison' },
      { text: 'Known issues', link: '/guide/known-issues' },
    ],
  },
  {
    text: 'Messages',
    items: [
      { text: 'Composing messages', link: '/messages/compose' },
      { text: 'Attachments', link: '/messages/attachments' },
      { text: 'Rendering templates', link: '/messages/render' },
      { text: 'Calendar invitations', link: '/messages/calendar' },
      { text: 'MIME composition', link: '/messages/mime' },
    ],
  },
  {
    text: 'Transports',
    items: [
      { text: 'SMTP', link: '/transports/smtp' },
      { text: 'Sendmail', link: '/transports/sendmail' },
      { text: 'Amazon SES', link: '/transports/ses' },
      { text: 'Resend', link: '/transports/resend' },
      { text: 'SendGrid', link: '/transports/sendgrid' },
      { text: 'Mailgun', link: '/transports/mailgun' },
      { text: 'Mailtrap', link: '/transports/mailtrap' },
      { text: 'Maileroo', link: '/transports/maileroo' },
      { text: 'Lettermint', link: '/transports/lettermint' },
      { text: 'Plunk', link: '/transports/plunk' },
      { text: 'Postmark', link: '/transports/postmark' },
      { text: 'Brevo', link: '/transports/brevo' },
      { text: 'Mailjet', link: '/transports/mailjet' },
      { text: 'MailerSend', link: '/transports/mailersend' },
      { text: 'SparkPost', link: '/transports/sparkpost' },
      { text: 'ZeptoMail', link: '/transports/zeptomail' },
      { text: 'SMTP2GO', link: '/transports/smtp2go' },
      { text: 'Azure Communication Services', link: '/transports/azure' },
      { text: 'Scaleway', link: '/transports/scaleway' },
      { text: 'Cloudflare', link: '/transports/cloudflare' },
      { text: 'JMAP', link: '/transports/jmap' },
      { text: 'Mock', link: '/transports/mock' },
      { text: 'Custom transports', link: '/transports/custom' },
    ],
  },
  {
    text: 'Decorators',
    items: [
      { text: 'Pool', link: '/transports/pool' },
      { text: 'Retry', link: '/transports/retry' },
      { text: 'OpenTelemetry', link: '/transports/otel' },
      { text: 'Logger', link: '/transports/logger' },
      { text: 'Circuit breaker', link: '/transports/breaker' },
      { text: 'Rate limit', link: '/transports/ratelimit' },
      { text: 'Idempotency', link: '/transports/idempotency' },
      { text: 'Hooks', link: '/transports/hooks' },
      { text: 'Tee', link: '/transports/tee' },
    ],
  },
];

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: '@alexify/mailer',
  titleTemplate: ':title — mailer',
  description: ogDescription,
  lang: 'en-US',
  base,
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname },

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }],
    ['link', { rel: 'icon', type: 'image/png', href: `${base}favicon.png` }],
    ['meta', { name: 'theme-color', content: '#14998C' }],
    ['meta', { name: 'author', content: 'Alexis Technologies' }],
    ['meta', { name: 'keywords', content: keywords }],
    ['meta', { name: 'robots', content: 'index, follow' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: '@alexify/mailer' }],
    ['meta', { property: 'og:title', content: ogTitle }],
    ['meta', { property: 'og:description', content: ogDescription }],
    ['meta', { property: 'og:image', content: ogImage }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: ogTitle }],
    ['meta', { name: 'twitter:description', content: ogDescription }],
    ['meta', { name: 'twitter:image', content: ogImage }],
    ['script', { type: 'application/ld+json' }, JSON.stringify(jsonLd)],
  ],

  // Per-page canonical + og:url for clean SEO indexing
  transformPageData(pageData) {
    const path = pageData.relativePath.replace(/index\.md$/, '').replace(/\.md$/, '');
    const canonical = `${hostname}${path}`;
    pageData.frontmatter.head ??= [];
    pageData.frontmatter.head.push(
      ['link', { rel: 'canonical', href: canonical }],
      ['meta', { property: 'og:url', content: canonical }],
    );
  },

  themeConfig: {
    logo: { light: '/logo-mark.svg', dark: '/logo-mark-dark.svg', alt: 'mailer' },

    nav: [
      { text: 'Guide', link: '/guide/getting-started', activeMatch: '/guide/' },
      { text: 'Messages', link: '/messages/compose', activeMatch: '/messages/' },
      { text: 'Transports', link: '/transports/smtp', activeMatch: '/transports/' },
      { text: 'API', link: '/api/exports', activeMatch: '/api/' },
      {
        text: `v${version}`,
        items: [
          { text: 'Changelog', link: `${repo}/blob/main/CHANGELOG.md` },
          { text: 'npm', link: 'https://www.npmjs.com/package/@alexify/mailer' },
          { text: 'Releases', link: `${repo}/releases` },
        ],
      },
    ],

    sidebar: {
      '/guide/': guide,
      '/messages/': guide,
      '/transports/': guide,
      '/api/': [
        {
          text: 'API',
          items: [{ text: 'Exports', link: '/api/exports' }],
        },
      ],
    },

    search: { provider: 'local' },

    socialLinks: [{ icon: 'github', link: repo }],

    editLink: {
      pattern: `${repo}/edit/main/docs/:path`,
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Alexis Technologies',
    },

    docFooter: {
      prev: 'Previous page',
      next: 'Next page',
    },
  },
});
