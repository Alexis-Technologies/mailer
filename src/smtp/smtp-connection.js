// Ported from upyo v0.7.0 (packages/smtp/src/smtp-connection.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { prepareRawSmtpStream, Smtp8BitMimeUnsupportedError } = require('./raw-message.js');
const { Buffer } = require('node:buffer');
const { isIP, Socket } = require('node:net');
const { StringDecoder } = require('node:string_decoder');
const { connect: tlsConnect, TLSSocket } = require('node:tls');
const { generateId } = require('../core/id.js');
const { createSmtpConfig } = require('./config.js');
const { SmtpDsnUnsupportedError } = require('./delivery-status.js');
const { checkSmtpPath } = require('./envelope.js');
const { isLoopbackAddress, isLoopbackHost } = require('../internal/loopback.js');
const {
  formatOauthbearer,
  formatXoauth2,
  OAuth2TokenManager,
  selectOAuth2Mechanism,
  SmtpAuthError,
} = require('./oauth2.js');
const { prepareMessageStream } = require('./message-stream.js');
const { prepareOnSocket, writeMessageData } = require('./data-stream.js');
const { parseEnhancedSmtpStatusCode } = require('./smtp-status-code.js');

// RFC 5321 §4.5.3.1.5 limits a reply line to 512 octets, but servers send
// longer text; these bound the memory a broken or hostile server can take
// rather than enforce the RFC.  The reply to DATA is bounded in data-stream.js.
const MAX_REPLY_LINE_LENGTH = 8192;
const MAX_REPLY_LINES = 1000;

const createReplyLimitError = () =>
  new RangeError(
    `SMTP reply exceeds ${MAX_REPLY_LINE_LENGTH} characters in a line ` +
      `or ${MAX_REPLY_LINES} lines.`,
  );

// RFC 5321 §4.2: the last line of a reply is its code, alone or followed by a
// space and text; every other line puts a hyphen after the code.
const isFinalReplyLine = (line) => line.length === 3 || (line.length > 3 && line[3] === ' ');

/**
 * Splits replies into lines as their bytes arrive.  The decoder keeps a
 * character split across chunks whole, and only the incomplete last line is
 * kept between chunks, so a server that never ends a line costs neither
 * memory nor a rescan of everything received.
 *
 * @returns A reader whose `read()` returns the complete lines of a chunk, or
 * `undefined` once a line is longer than {@link MAX_REPLY_LINE_LENGTH}.
 */
const createReplyReader = () => {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  return {
    get pending() {
      return pending;
    },
    read(data) {
      pending += decoder.write(data);
      const lines = [];
      let start = 0;
      let end;
      while ((end = pending.indexOf('\r\n', start)) !== -1) {
        if (end - start > MAX_REPLY_LINE_LENGTH) return undefined;
        lines.push(pending.slice(start, end));
        start = end + 2;
      }
      if (start > 0) pending = pending.slice(start);
      return pending.length > MAX_REPLY_LINE_LENGTH ? undefined : lines;
    },
  };
};

/**
 * Error thrown when a message exceeds the fixed limit advertised through the
 * SMTP SIZE extension.
 *
 * Known sizes are checked before `MAIL FROM`. Unknown source sizes are also
 * checked while writing DATA; those failures make the connection unusable.
 */
class SmtpMessageSizeError extends RangeError {
  /** Exact known size, or the octets counted when an unknown source is stopped. */
  actualSize;

  /** The fixed maximum advertised by the SMTP server. */
  maximumSize;

  /** Whether the failure occurred before or during DATA. */
  phase;

  /**
   * Creates an SMTP message-size error.
   *
   * @param actualSize The encoded message size in octets.
   * @param maximumSize The fixed maximum advertised by the SMTP server.
   * @param phase Whether the failure occurred before or during DATA.
   */
  constructor(actualSize, maximumSize, phase = 'preflight') {
    super(
      `Message size ${actualSize} octets exceeds the server's maximum of ` +
        `${maximumSize} octets.`,
    );
    this.phase = phase;
    this.name = 'SmtpMessageSizeError';
    this.actualSize = actualSize;
    this.maximumSize = maximumSize;
  }
}

/**
 * Error thrown when an internationalized message requires an SMTP extension
 * that the server did not advertise.
 *
 * The check happens before `MAIL FROM`, so the SMTP connection remains usable
 * for another message.
 */
class SmtpUtf8UnsupportedError extends Error {
  /** The required SMTP extension that the server did not advertise. */
  missingCapability;

  /**
   * Creates an SMTPUTF8 support error.
   *
   * @param missingCapability The required extension that was not advertised.
   */
  constructor(missingCapability) {
    super(
      missingCapability === 'SMTPUTF8'
        ? 'The SMTP server does not advertise SMTPUTF8.'
        : // oxlint-disable-next-line no-useless-concat -- upstream
          'The SMTP server advertises SMTPUTF8 without the required ' + '8BITMIME capability.',
    );
    this.name = 'SmtpUtf8UnsupportedError';
    this.missingCapability = missingCapability;
  }
}

class SmtpPipelineTerminatedError extends Error {
  responseIndex;
  response;

  constructor(responseIndex, response) {
    super('SMTP pipeline terminated by the server.');
    this.name = 'SmtpPipelineTerminatedError';
    this.responseIndex = responseIndex;
    this.response = response;
  }
}

/**
 * An authentication failure backed by an SMTP server reply.
 *
 * This keeps {@link SmtpAuthError} as the public authentication error while
 * retaining the reply fields needed to build structured transport receipts.
 */
class SmtpAuthResponseError extends SmtpAuthError {
  /** The numeric SMTP reply code returned by the server. */
  code;

  /** The authentication command that produced the reply. */
  command;

  /** The textual SMTP reply returned by the server. */
  response;

  /**
   * Creates an authentication response error.
   *
   * @param message A human-readable description of the authentication failure.
   * @param code The numeric SMTP reply code.
   * @param command The authentication command that produced the reply.
   * @param response The textual SMTP reply returned by the server.
   */
  constructor(message, code, command, response) {
    super(message);
    this.name = 'SmtpAuthResponseError';
    this.code = code;
    this.command = command;
    this.response = response;
  }
}

/**
 * The maximum length of an SMTP command line, including the terminating CRLF,
 * as specified by RFC 5321 §4.5.3.1.4.
 */
const MAX_COMMAND_LINE_LENGTH = 512;

/** The length of the CRLF terminator appended to every command. */
const CRLF_LENGTH = 2;

/**
 * Finds the RFC 1870 SIZE extension and its optional fixed maximum.
 *
 * A zero maximum and an omitted maximum both mean that no fixed limit is in
 * force.  A malformed parameter does not prevent use of the extension, but it
 * cannot be used as a local limit.
 *
 * @param capabilities The extension lines returned by EHLO.
 * @returns The SIZE capability, or `null` when it was not advertised.
 */
// The capability lines by keyword (up to a space, a tab or the "=" of the
// old AUTH=LOGIN form, in upper case), the first line of a keyword winning.
const indexCapabilities = (lines) => {
  const index = new Map();
  for (const line of lines) {
    let end = 0;
    while (end < line.length) {
      const code = line.charCodeAt(end);
      if (code === 0x20 || code === 0x09 || code === 0x3d) break;
      end++;
    }
    const keyword = line.slice(0, end).toUpperCase();
    if (!index.has(keyword)) index.set(keyword, line);
  }
  return index;
};

const parseSizeCapability = (capability) => {
  if (capability == null) return null;

  const match = /^SIZE(?:[ \t]+([0-9]+))?[ \t]*$/i.exec(capability);
  if (match?.[1] == null) return { maximum: null };

  const maximum = BigInt(match[1]);
  return { maximum: maximum === 0n ? null : maximum };
};

/**
 * How long, in milliseconds, to wait for the graceful `QUIT` to flush during
 * teardown before giving up, so an unresponsive server cannot block shutdown
 * for the full socket timeout.
 */
const QUIT_TIMEOUT_MS = 5000;

// The name a TLS client sends for SNI (RFC 6066 §3): the host without a final
// dot, and none for an IP address, which SNI does not carry.  Node sends none
// unless it is given, so a server with a certificate per name could only
// answer with its default one.
const serverNameOf = (host) => (isIP(host) === 0 ? host.replace(/\.$/, '') : undefined);

/**
 * Whether the SMTP connection is local enough to permit cleartext
 * authentication during development.
 *
 * @param socket The connected SMTP socket, if available.
 * @param host The configured SMTP host.
 * @returns `true` if the connected peer or fallback host is loopback.
 */
const isLoopbackConnection = (socket, host) => {
  const remoteAddress = socket?.remoteAddress;
  return remoteAddress == null ? isLoopbackHost(host) : isLoopbackAddress(remoteAddress);
};

class SmtpConnection {
  socket = null;
  config;
  #indexedCapabilities = null;
  #capabilityIndex = new Map();
  authenticated = false;
  capabilities = [];
  tokenManager;
  active = false;
  /** Whether the connection sits in a pool and must be reset before reuse. */
  needsReset = false;

  get usable() {
    return this.socket != null && !this.socket.destroyed && this.socket.writable;
  }

  observeSocket(socket) {
    socket.on('error', () => socket.destroy());
    socket.on('timeout', () => {
      if (!this.active) socket.destroy();
    });
  }

  constructor(config, tokenManager) {
    this.config = createSmtpConfig(config);
    this.tokenManager = tokenManager ?? null;
  }

  connect(signal) {
    if (this.socket) {
      throw new Error('Connection already established');
    }

    signal?.throwIfAborted();

    // Implicit TLS is established once its handshake completes, not when the
    // TCP connection opens, so the connection timeout covers the handshake.
    const establishedEvent = this.config.secure ? 'secureConnect' : 'connect';

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        onError(new TypeError('Connection timeout.'));
        this.socket?.destroy();
      }, this.config.connectionTimeout);

      const cleanup = () => {
        clearTimeout(timeout);
        this.socket?.off(establishedEvent, onConnect);
        this.socket?.off('error', onError);
        this.socket?.off('close', onClose);
        this.socket?.off('timeout', onTimeout);
        signal?.removeEventListener('abort', onAbort);
      };

      const onAbort = () => {
        cleanup();
        this.socket?.destroy();
        reject(signal?.reason);
      };

      const onConnect = () => {
        cleanup();
        resolve();
      };

      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const onClose = () => {
        onError(new TypeError('SMTP connection closed before establishment.'));
      };
      const onTimeout = () => {
        onError(new TypeError('Socket timeout.'));
        this.socket?.destroy();
      };

      try {
        if (this.config.secure) {
          this.socket = tlsConnect({
            host: this.config.host,
            servername: serverNameOf(this.config.host),
            port: this.config.port,
            rejectUnauthorized: this.config.tls?.rejectUnauthorized ?? true,
            ca: this.config.tls?.ca,
            key: this.config.tls?.key,
            cert: this.config.tls?.cert,
            minVersion: this.config.tls?.minVersion,
            maxVersion: this.config.tls?.maxVersion,
          });
        } else {
          this.socket = new Socket();
          this.socket.connect(this.config.port, this.config.host);
        }

        this.socket.setTimeout(this.config.socketTimeout);
        this.observeSocket(this.socket);
        this.socket.once(establishedEvent, onConnect);
        this.socket.once('error', onError);
        this.socket.once('close', onClose);
        this.socket.once('timeout', onTimeout);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
      } catch (error) {
        cleanup();
        this.socket?.destroy();
        reject(error);
      }
    });
  }

  sendCommand(command, signal) {
    return this.sendCommands([command], signal).then((responses) => responses[0]);
  }

  /**
   * Sends a group of commands in one write and reads one reply per command.
   *
   * SMTP multiline replies are kept together and complete replies are matched
   * to commands by their position in the returned array, as required for
   * command pipelining by RFC 2920.
   */
  sendCommands(commands, signal) {
    if (!this.socket) {
      throw new Error('Not connected');
    }

    signal?.throwIfAborted();

    return new Promise((resolve, reject) => {
      const reader = createReplyReader();
      let responseLines = [];
      const responses = [];
      const startTimeout = () =>
        setTimeout(() => {
          cleanup();
          reject(new Error('Command timeout'));
        }, this.config.socketTimeout);
      let timeout = startTimeout();
      const resetTimeout = () => {
        clearTimeout(timeout);
        timeout = startTimeout();
      };

      const onData = (data) => {
        const lines = reader.read(data);
        if (lines === undefined) {
          failOnLimit();
          return;
        }

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
          const line = lines[lineIndex];
          responseLines.push(line);
          if (!isFinalReplyLine(line)) {
            if (responseLines.length > MAX_REPLY_LINES) {
              failOnLimit();
              return;
            }
          } else {
            const code = parseInt(line.substring(0, 3), 10);
            const message = line.substring(4);
            const response = {
              code,
              message,
              raw: responseLines.join('\r\n'),
            };
            const responseIndex = responses.length;
            responses.push(response);
            responseLines = [];

            if (responses.length === commands.length) {
              cleanup();
              if (
                commands[0] === 'DATA' &&
                (lineIndex + 1 < lines.length || reader.pending.length > 0)
              ) {
                this.socket?.destroy();
                reject(new TypeError('Premature SMTP reply after DATA readiness.'));
                return;
              }
              resolve(responses);
              return;
            }

            if (response.code === 421) {
              cleanup();
              reject(new SmtpPipelineTerminatedError(responseIndex, response));
              return;
            }

            resetTimeout();
          }
        }
      };

      const onError = (error) => {
        cleanup();
        reject(error);
      };

      const failOnLimit = () => {
        cleanup();
        this.socket?.destroy();
        reject(createReplyLimitError());
      };

      const onClose = () => {
        cleanup();
        const responseIndex = responses.findIndex(
          (response, index) => response.code === 421 || (index === 0 && response.code >= 400),
        );
        if (responseIndex >= 0) {
          reject(new SmtpPipelineTerminatedError(responseIndex, responses[responseIndex]));
          return;
        }
        const completedFailures = responses.flatMap((response, index) =>
          response.code >= 400 ? [`${commands[index]}: ${response.code} ${response.message}`] : [],
        );
        const failureDetails =
          completedFailures.length > 0
            ? ` Completed failures: ${completedFailures.join('; ')}.`
            : '';
        reject(new Error(`Connection closed before all command responses.${failureDetails}`));
      };

      const onAbort = () => {
        cleanup();
        try {
          signal?.throwIfAborted();
        } catch (error) {
          reject(error);
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.socket?.off('data', onData);
        this.socket?.off('error', onError);
        this.socket?.off('close', onClose);
        signal?.removeEventListener('abort', onAbort);
      };

      this.socket.on('data', onData);
      this.socket.on('error', onError);
      this.socket.on('close', onClose);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.socket.write(commands.map((command) => `${command}\r\n`).join(''));
    });
  }

  greeting(signal) {
    if (!this.socket) {
      throw new Error('Not connected');
    }

    signal?.throwIfAborted();

    return new Promise((resolve, reject) => {
      const reader = createReplyReader();
      const replyLines = [];
      const timeout = setTimeout(() => {
        onError(new Error('Greeting timeout.'));
      }, this.config.socketTimeout);

      // Only complete lines count: a final line still waiting for its CRLF
      // could be cut short.
      const onData = (data) => {
        const lines = reader.read(data);
        if (lines === undefined) {
          this.socket?.destroy();
          onError(createReplyLimitError());
          return;
        }

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          replyLines.push(line);
          if (isFinalReplyLine(line)) {
            const code = parseInt(line.substring(0, 3), 10);
            const message = line.substring(4);

            cleanup();
            resolve({ code, message, raw: replyLines.join('\r\n') });
            return;
          }
          if (replyLines.length > MAX_REPLY_LINES) {
            this.socket?.destroy();
            onError(createReplyLimitError());
            return;
          }
        }
      };

      const onError = (error) => {
        cleanup();
        reject(error);
      };

      const onClose = () => onError(new TypeError('SMTP connection closed before greeting.'));
      const onAbort = () => {
        cleanup();
        this.socket?.destroy();
        reject(signal?.reason);
      };
      const cleanup = () => {
        clearTimeout(timeout);
        this.socket?.off('data', onData);
        this.socket?.off('error', onError);
        this.socket?.off('close', onClose);
        signal?.removeEventListener('abort', onAbort);
      };

      this.socket.on('data', onData);
      this.socket.on('error', onError);
      this.socket.on('close', onClose);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }

  async ehlo(signal) {
    const response = await this.sendCommand(`EHLO ${this.config.localName}`, signal);
    if (response.code === 500 || response.code === 502) {
      const heloResponse = await this.sendCommand(`HELO ${this.config.localName}`, signal);
      if (heloResponse.code !== 250) {
        throw new SmtpResponseError(
          `HELO failed: ${heloResponse.message}`,
          heloResponse.code,
          'HELO',
          heloResponse.message,
        );
      }
      this.capabilities = [];
      return;
    }
    if (response.code !== 250) {
      throw new SmtpResponseError(
        `EHLO failed: ${response.message}`,
        response.code,
        'EHLO',
        response.message,
      );
    }

    // Parse capabilities: the lines of the reply after the greeting line, in
    // one pass.
    const capabilities = [];
    const lines = response.raw.split('\r\n');
    let isGreeting = true;
    for (const line of lines) {
      if (!line.startsWith('250-') && !line.startsWith('250 ')) continue;
      if (isGreeting) {
        isGreeting = false;
        continue;
      }
      if (line.length > 4) capabilities.push(line.substring(4));
    }
    this.capabilities = capabilities;
  }

  /**
   * The capability line of a keyword, from an index built again whenever
   * `capabilities` is replaced: a send asks for several, which used to scan
   * the list each time, with a new RegExp for some.
   *
   * @param keyword The keyword, in upper case, such as `SIZE`.
   * @returns The whole line, or `undefined` when the server lacks it.
   */
  capabilityLine(keyword) {
    if (this.#indexedCapabilities !== this.capabilities) {
      this.#capabilityIndex = indexCapabilities(this.capabilities);
      this.#indexedCapabilities = this.capabilities;
    }
    return this.#capabilityIndex.get(keyword);
  }

  hasCapability(keyword) {
    return this.capabilityLine(keyword) !== undefined;
  }

  async starttls(signal) {
    if (!this.socket) {
      throw new Error('Not connected');
    }

    if (this.socket instanceof TLSSocket) {
      throw new Error('Connection is already using TLS');
    }

    signal?.throwIfAborted();

    // Send STARTTLS command
    const response = await this.sendCommand('STARTTLS', signal);
    if (response.code !== 220) {
      throw new SmtpResponseError(
        `STARTTLS failed: ${response.message}`,
        response.code,
        'STARTTLS',
        response.message,
      );
    }

    signal?.throwIfAborted();

    // Own the upgraded socket throughout its handshake, including cancellation.
    const plainSocket = this.socket;
    plainSocket.setTimeout(0);
    const tlsSocket = tlsConnect({
      socket: plainSocket,
      host: this.config.host,
      servername: serverNameOf(this.config.host),
      rejectUnauthorized: this.config.tls?.rejectUnauthorized ?? true,
      ca: this.config.tls?.ca,
      key: this.config.tls?.key,
      cert: this.config.tls?.cert,
      minVersion: this.config.tls?.minVersion,
      maxVersion: this.config.tls?.maxVersion,
    });
    this.socket = tlsSocket;
    this.observeSocket(tlsSocket);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => fail(new Error('STARTTLS upgrade timeout.')),
        this.config.connectionTimeout,
      );
      const cleanup = () => {
        clearTimeout(timeout);
        tlsSocket.off('secureConnect', onSecureConnect);
        tlsSocket.off('error', fail);
        tlsSocket.off('close', onClose);
        signal?.removeEventListener('abort', onAbort);
      };
      const fail = (error) => {
        cleanup();
        tlsSocket.destroy();
        reject(error);
      };
      const onAbort = () => fail(signal?.reason);
      // Node's TLSSocket reports a peer that leaves during the handshake as an
      // error before the close, so this guard does not run on Node.
      /* c8 ignore next */
      const onClose = () => fail(new TypeError('SMTP connection closed during STARTTLS.'));
      const onSecureConnect = () => {
        cleanup();
        tlsSocket.setTimeout(this.config.socketTimeout);
        resolve();
      };
      tlsSocket.once('secureConnect', onSecureConnect);
      tlsSocket.once('error', fail);
      tlsSocket.once('close', onClose);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }

  async authenticate(signal) {
    const auth = this.config.auth;
    if (!auth) {
      return;
    }

    if (this.authenticated) {
      return;
    }

    if (!this.hasCapability('AUTH')) {
      throw new SmtpAuthError('Server does not support authentication.');
    }

    // Refuse to send credentials over a cleartext connection.  Loopback hosts
    // are excepted for local testing and development.
    if (
      !(this.socket instanceof TLSSocket) &&
      !isLoopbackConnection(this.socket, this.config.host)
    ) {
      throw new SmtpAuthError(
        'SMTP authentication requires a TLS-secured connection to protect ' +
          'credentials; use `secure: true` or STARTTLS.',
      );
    }

    if ('accessToken' in auth || 'refreshToken' in auth) {
      const mechanism = auth.method ?? selectOAuth2Mechanism(this.capabilities);
      switch (mechanism) {
        case 'xoauth2':
          await this.authXoauth2(auth, signal);
          break;
        case 'oauthbearer':
          await this.authOauthbearer(auth, signal);
          break;
        default:
          throw new SmtpAuthError(`Unsupported authentication method: ${mechanism}`);
      }
    } else {
      const method = auth.method ?? 'plain';
      switch (method) {
        case 'plain':
          await this.authPlain(auth, signal);
          break;
        case 'login':
          await this.authLogin(auth, signal);
          break;
        default:
          throw new Error(`Unsupported authentication method: ${method}`);
      }
    }

    this.authenticated = true;
  }

  async authPlain(auth, signal) {
    const { user, pass } = auth;
    const credentials = Buffer.from(`\0${user}\0${pass}`).toString('base64');
    const response = await this.sendCommand(`AUTH PLAIN ${credentials}`, signal);

    if (response.code !== 235) {
      throw new SmtpAuthResponseError(
        `Authentication failed: ${response.message}`,
        response.code,
        'AUTH PLAIN',
        response.message,
      );
    }
  }

  async authLogin(auth, signal) {
    const { user, pass } = auth;

    let response = await this.sendCommand('AUTH LOGIN', signal);
    if (response.code !== 334) {
      throw new SmtpAuthResponseError(
        `AUTH LOGIN failed: ${response.message}`,
        response.code,
        'AUTH LOGIN',
        response.message,
      );
    }

    response = await this.sendCommand(Buffer.from(user).toString('base64'), signal);
    if (response.code !== 334) {
      throw new SmtpAuthResponseError(
        `Username authentication failed: ${response.message}`,
        response.code,
        'AUTH LOGIN',
        response.message,
      );
    }

    response = await this.sendCommand(Buffer.from(pass).toString('base64'), signal);
    if (response.code !== 235) {
      throw new SmtpAuthResponseError(
        `Password authentication failed: ${response.message}`,
        response.code,
        'AUTH LOGIN',
        response.message,
      );
    }
  }

  /**
   * Resolves an OAuth 2.0 access token via the connection's token manager,
   * creating a standalone manager from the auth config if none was injected.
   */
  async getOAuth2Token(auth, signal) {
    this.tokenManager ??= new OAuth2TokenManager(auth, this.config.fetch);
    return await this.tokenManager.getAccessToken(signal);
  }

  async authXoauth2(auth, signal) {
    const token = await this.getOAuth2Token(auth, signal);
    const initialResponse = formatXoauth2(auth.user, token);
    const response = await this.sendSaslAuth('XOAUTH2', initialResponse, signal);
    // On failure XOAUTH2 servers send a 334 challenge; the client replies with
    // an empty line to receive the final failure response.
    await this.finishOAuth2(response, 'XOAUTH2', '', signal);
  }

  async authOauthbearer(auth, signal) {
    const token = await this.getOAuth2Token(auth, signal);
    const initialResponse = formatOauthbearer(auth.user, token, this.config.host, this.config.port);
    const response = await this.sendSaslAuth('OAUTHBEARER', initialResponse, signal);
    // RFC 7628: on failure the client replies with a single 0x01 ("AQ==") to
    // receive the final failure response.
    await this.finishOAuth2(response, 'OAUTHBEARER', 'AQ==', signal);
  }

  /**
   * Sends a SASL `AUTH` command with its Base64 initial response.
   *
   * When the resulting command line would exceed the SMTP command-line length
   * limit (e.g. a long Outlook JWT access token), RFC 4954 requires the client
   * to omit the initial response and send it on its own line after the server's
   * `334` challenge.  This method transparently falls back to that two-step
   * form, since some servers reject the over-long single-line command outright.
   *
   * @param mechanism The SASL mechanism name (e.g. `XOAUTH2`).
   * @param initialResponse The Base64-encoded initial client response.
   * @param signal An optional {@link AbortSignal}.
   * @returns The server's response to the initial response.
   */
  async sendSaslAuth(mechanism, initialResponse, signal) {
    const inlineCommand = `AUTH ${mechanism} ${initialResponse}`;
    if (inlineCommand.length + CRLF_LENGTH <= MAX_COMMAND_LINE_LENGTH) {
      return await this.sendCommand(inlineCommand, signal);
    }

    const challenge = await this.sendCommand(`AUTH ${mechanism}`, signal);
    if (challenge.code !== 334) {
      return challenge;
    }
    return await this.sendCommand(initialResponse, signal);
  }

  /**
   * Interprets the server's reply to an OAuth SASL initial response, draining
   * the failure challenge continuation when authentication is rejected.
   *
   * @throws {SmtpAuthError} If authentication did not succeed.
   */
  async finishOAuth2(response, mechanism, continuation, signal) {
    if (response.code === 235) {
      return;
    }
    if (response.code === 334) {
      let finalResponse;
      let finalMessage = '';
      try {
        finalResponse = await this.sendCommand(continuation, signal);
        finalMessage = ` (${finalResponse.message})`;
      } catch {
        // Some servers close the connection after rejecting authentication, so
        // sending the continuation fails; keep the decoded challenge as the
        // error detail rather than masking it with a socket error.
        signal?.throwIfAborted();
      }
      const message =
        `${mechanism} authentication failed: ` +
        `${decodeOAuth2Challenge(response.message)}${finalMessage}`;
      if (finalResponse != null) {
        throw new SmtpAuthResponseError(
          message,
          finalResponse.code,
          `AUTH ${mechanism}`,
          finalResponse.message,
        );
      }
      throw new SmtpAuthError(message);
    }
    throw new SmtpAuthResponseError(
      `${mechanism} authentication failed: ${response.message}`,
      response.code,
      `AUTH ${mechanism}`,
      response.message,
    );
  }

  async sendMessage(message, signal) {
    this.active = true;
    this.socket?.setTimeout(0);
    try {
      return await this.sendPreparedMessage(message, signal);
    } finally {
      this.active = false;
      if (this.usable) this.socket?.setTimeout(this.config.socketTimeout);
    }
  }

  async sendPreparedMessage(message, signal) {
    signal?.throwIfAborted();
    checkSmtpPath(message.envelope.from ?? '');
    for (const recipient of message.envelope.to) checkSmtpPath(recipient);

    let smtpUtf8Parameters = '';
    const negotiate = (encoding) => {
      const supports = (name) => this.hasCapability(name);
      if (message.requiresSmtpUtf8 || encoding === 'utf8') {
        if (!supports('SMTPUTF8')) {
          throw new SmtpUtf8UnsupportedError('SMTPUTF8');
        }
        if (!supports('8BITMIME')) {
          throw new SmtpUtf8UnsupportedError('8BITMIME');
        }
        smtpUtf8Parameters = ' BODY=8BITMIME SMTPUTF8';
      } else if (encoding === '8bit') {
        if (!supports('8BITMIME')) throw new Smtp8BitMimeUnsupportedError();
        smtpUtf8Parameters = ' BODY=8BITMIME';
      }
    };
    negotiate('rawMessage' in message ? message.rawMessage.encoding : undefined);

    const sizeCapability = parseSizeCapability(this.capabilityLine('SIZE'));
    let sizeParameter = '';

    const dsn = message.envelope.dsn;
    if (dsn != null && !/^DSN[ \t]*$/i.test(this.capabilityLine('DSN') ?? '')) {
      throw new SmtpDsnUnsupportedError();
    }
    const mailDsnParameters =
      dsn == null || dsn.mailParameters.length === 0 ? '' : ` ${dsn.mailParameters.join(' ')}`;

    const checkSize = (size, phase = 'preflight') => {
      if (!Number.isSafeInteger(size)) {
        throw new RangeError('Message size exceeds the safe integer range.');
      }
      if (sizeCapability?.maximum != null && BigInt(size) > sizeCapability.maximum) {
        throw new SmtpMessageSizeError(size, sizeCapability.maximum, phase);
      }
    };
    if (!this.socket || !this.usable) {
      throw new TypeError('SMTP connection is closed.');
    }
    const stream =
      'rawMessage' in message
        ? await prepareOnSocket(
            this.socket,
            this.config.socketTimeout,
            // oxlint-disable-next-line no-shadow -- upstream
            (signal, progress) =>
              prepareRawSmtpStream(message.rawMessage, negotiate, checkSize, progress, signal),
            signal,
          )
        : 'raw' in message
          ? {
              size: Buffer.byteLength(message.raw) + 2,
              // oxlint-disable-next-line no-shadow -- upstream
              async *read(signal) {
                signal?.throwIfAborted();
                yield Buffer.from(message.raw + '\r\n');
              },
            }
          : await prepareOnSocket(
              this.socket,
              this.config.socketTimeout,
              // oxlint-disable-next-line no-shadow -- upstream
              (signal, progress) => prepareMessageStream(message, checkSize, progress, signal),
              signal,
            );
    negotiate(stream.encoding);
    if (stream.size != null) {
      checkSize(stream.size);
      if (sizeCapability != null) sizeParameter = ` SIZE=${stream.size}`;
    }

    const mailCommand =
      `MAIL FROM:<${message.envelope.from ?? ''}>` +
      `${sizeParameter}${smtpUtf8Parameters}${mailDsnParameters}`;
    const recipientCommands = message.envelope.to.map((recipient, index) => {
      const parameters = dsn?.recipientParameters[index] ?? [];
      const suffix = parameters.length === 0 ? '' : ` ${parameters.join(' ')}`;
      return `RCPT TO:<${recipient}>${suffix}`;
    });
    const pipelining = this.hasCapability('PIPELINING');

    let mailResponse;
    let recipientResponses;
    if (pipelining) {
      try {
        const envelopeResponses = await this.sendCommands(
          [mailCommand, ...recipientCommands],
          signal,
        );
        mailResponse = envelopeResponses[0];
        recipientResponses = envelopeResponses.slice(1);
      } catch (error) {
        if (!(error instanceof SmtpPipelineTerminatedError)) {
          throw error;
        }

        const { response, responseIndex } = error;
        if (responseIndex === 0) {
          throw new SmtpResponseError(
            `MAIL FROM failed: ${response.message}`,
            response.code,
            'MAIL FROM',
            response.message,
          );
        }

        const recipient = message.envelope.to[responseIndex - 1];
        throw new SmtpResponseError(
          `RCPT TO failed for ${recipient}: ${response.message}`,
          response.code,
          'RCPT TO',
          response.message,
        );
      }
    } else {
      mailResponse = await this.sendCommand(mailCommand, signal);
      recipientResponses = [];
    }

    if (mailResponse.code !== 250) {
      throw new SmtpResponseError(
        `MAIL FROM failed: ${mailResponse.message}`,
        mailResponse.code,
        'MAIL FROM',
        mailResponse.message,
      );
    }

    // RCPT TO
    const rejectedRecipients = [];
    for (const [index, recipient] of message.envelope.to.entries()) {
      signal?.throwIfAborted();
      const rcptResponse = pipelining
        ? recipientResponses[index]
        : await this.sendCommand(recipientCommands[index], signal);
      if (rcptResponse.code === 421) {
        throw new SmtpResponseError(
          `RCPT TO failed for ${recipient}: ${rcptResponse.message}`,
          rcptResponse.code,
          'RCPT TO',
          rcptResponse.message,
        );
      }
      if (rcptResponse.code !== 250 && rcptResponse.code !== 251) {
        const enhancedStatusCode = parseEnhancedSmtpStatusCode(
          rcptResponse.code,
          rcptResponse.message,
        );
        rejectedRecipients.push({
          recipient,
          code: rcptResponse.code,
          response: rcptResponse.message,
          retryable: rcptResponse.code >= 400 && rcptResponse.code < 500,
          ...(enhancedStatusCode == null ? {} : { enhancedStatusCode }),
        });
      }
    }

    if (rejectedRecipients.length > 0 && rejectedRecipients.length === message.envelope.to.length) {
      const rejection = rejectedRecipients.find((item) => item.retryable) ?? rejectedRecipients[0];
      const details = rejectedRecipients
        .map((item) => `${item.recipient}: ${item.code} ${item.response}`)
        .join('; ');
      throw new SmtpResponseError(
        `RCPT TO failed for every recipient: ${details}`,
        rejection.code,
        'RCPT TO',
        rejection.response,
        rejectedRecipients,
      );
    }

    // DATA
    const dataResponse = await this.sendCommand('DATA', signal);
    if (dataResponse.code !== 354) {
      throw new SmtpResponseError(
        `DATA failed: ${dataResponse.message}`,
        dataResponse.code,
        'DATA',
        dataResponse.message,
      );
    }

    // Message content
    const finalResponse = await writeMessageData(
      this.socket,
      // oxlint-disable-next-line no-shadow -- upstream
      (signal, progress) => stream.read(signal, progress),
      this.config.socketTimeout,
      (size) => checkSize(size, 'data'),
      signal,
    );
    if (finalResponse.code !== 250) {
      throw new SmtpResponseError(
        `Message send failed: ${finalResponse.message}`,
        finalResponse.code,
        'DATA_END',
        finalResponse.message,
      );
    }

    // Extract message ID from response
    const messageId = this.extractMessageId(finalResponse.message);
    return { messageId, rejectedRecipients };
  }

  extractMessageId(response) {
    const match = response.match(/(?:Message-ID:|id=)[\s<]*([^>\s]+)/i);
    return match ? match[1] : `smtp-${generateId('receipt-id', this.config.generateId)}`;
  }

  async quit(signal) {
    const socket = this.socket;
    if (!socket) {
      return;
    }

    // Only attempt a graceful QUIT on a writable socket; a socket that never
    // finished connecting (e.g. a refused or timed-out connection) would
    // otherwise error or leave a dangling command timeout.
    if (socket.writable && !signal?.aborted) {
      // Send QUIT best-effort and wait only until it has been flushed (bounded
      // by QUIT_TIMEOUT_MS) rather than for the server's reply, so an
      // unresponsive server cannot block teardown for the full socket timeout.
      await new Promise((resolve) => {
        const done = () => {
          clearTimeout(timer);
          socket.off('error', done);
          socket.off('close', done);
          signal?.removeEventListener('abort', onAbort);
          resolve();
        };
        const onAbort = () => {
          socket.destroy();
          done();
        };
        const timer = setTimeout(done, QUIT_TIMEOUT_MS);
        // Teardown is best-effort: an asynchronous socket error or close must
        // not surface as an unhandled error event, so settle on those too.
        socket.once('error', done);
        socket.once('close', done);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) {
          onAbort();
          return;
        }
        try {
          socket.write('QUIT\r\n', done);
        } catch {
          done();
        }
      });
    }

    try {
      socket.destroy();
    } catch {
      // Ignore errors while tearing down the socket
    }
    this.socket = null;
    this.authenticated = false;
    this.capabilities = [];
  }

  async reset(signal) {
    if (!this.socket) {
      throw new Error('Not connected');
    }

    const response = await this.sendCommand('RSET', signal);
    if (response.code !== 250) {
      throw new Error(`RESET failed: ${response.message}`);
    }
  }
}

/**
 * Error thrown when an SMTP command receives an unsuccessful server reply.
 */
class SmtpResponseError extends Error {
  /**
   * The numeric SMTP reply code returned by the server.
   */
  code;

  /**
   * The SMTP command that produced the reply.
   */
  command;

  /**
   * The textual SMTP reply returned by the server.
   */
  response;

  /** Recipient-level failures collected for an unsuccessful transaction. */
  rejectedRecipients;

  /**
   * Creates an SMTP response error.
   *
   * @param message Human-readable error message.
   * @param code The numeric SMTP reply code.
   * @param command The SMTP command that produced the reply.
   * @param response The textual SMTP reply returned by the server.
   * @param rejectedRecipients Recipient-level failures collected for the
   *                           transaction.
   */
  constructor(message, code, command, response, rejectedRecipients) {
    super(message);
    this.name = 'SmtpResponseError';
    this.code = code;
    this.command = command;
    this.response = response;
    this.rejectedRecipients = rejectedRecipients;
  }
}

/**
 * Decodes the Base64 JSON error challenge a server sends after a failed OAuth
 * SASL exchange, falling back to the raw message when it is not valid Base64.
 *
 * The bytes are decoded as UTF-8 (via `TextDecoder`) so non-ASCII challenge
 * messages are not corrupted, unlike decoding `atob`'s Latin-1 output directly.
 *
 * @param message The challenge text from the server's 334 response.
 * @returns A human-readable description of the failure.
 */
const decodeOAuth2Challenge = (message) => {
  try {
    // atob refuses text that is not Base64, which Buffer would skip.
    return Buffer.from(atob(message.trim()), 'latin1').toString('utf8');
  } catch {
    return message;
  }
};

module.exports = {
  SmtpMessageSizeError,
  SmtpUtf8UnsupportedError,
  SmtpAuthResponseError,
  SmtpConnection,
  SmtpResponseError,
};
