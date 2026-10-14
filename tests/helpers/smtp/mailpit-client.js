// Ported from upyo v0.7.0 (packages/smtp/src/test-utils/mailpit-client.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

class MailpitClient {
  baseUrl;
  timeout;

  constructor(config) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.timeout = config.timeout ?? 30000;
  }

  async getMessages(limit = 50) {
    const response = await fetch(`${this.baseUrl}/api/v1/messages?limit=${limit}`, {
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch messages: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.messages ?? [];
  }

  async getMessage(messageId) {
    const response = await fetch(`${this.baseUrl}/api/v1/message/${messageId}`, {
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch message: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  async searchMessages(criteria) {
    const queryParts = [];

    if (criteria.subject) {
      queryParts.push(`subject:"${criteria.subject}"`);
    }
    if (criteria.from) {
      queryParts.push(`from:"${criteria.from}"`);
    }
    if (criteria.to) {
      queryParts.push(`to:"${criteria.to}"`);
    }
    if (criteria.hasAttachments) {
      queryParts.push('has:attachment');
    }

    const searchParams = new URLSearchParams();
    if (queryParts.length > 0) {
      searchParams.append('query', queryParts.join(' '));
    }
    if (criteria.limit) {
      searchParams.append('limit', criteria.limit.toString());
    }

    const response = await fetch(`${this.baseUrl}/api/v1/search?${searchParams}`, {
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to search messages: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.messages ?? [];
  }

  async deleteMessage(messageId) {
    const response = await fetch(`${this.baseUrl}/api/v1/message/${messageId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to delete message: ${response.status} ${response.statusText}`);
    }
  }

  async deleteAllMessages() {
    const response = await fetch(`${this.baseUrl}/api/v1/messages`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to delete all messages: ${response.status} ${response.statusText}`);
    }
  }

  async waitForMessage(criteria, timeout = 30000, pollInterval = 1000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const messages = await this.searchMessages(criteria);

      if (messages.length > 0) {
        // Get the full message details using the getMessage API
        // which includes complete attachment information
        return await this.getMessage(messages[0].ID);
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Message not found within ${timeout}ms timeout`);
  }

  async getInfo() {
    const response = await fetch(`${this.baseUrl}/api/v1/info`, {
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to get info: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Gets the raw source of a message including all headers.
   * This is useful for verifying DKIM-Signature and other headers.
   *
   * @param messageId The Mailpit message ID
   * @returns The raw message source as a string
   */
  async getMessageSource(messageId) {
    const response = await fetch(`${this.baseUrl}/api/v1/message/${messageId}/raw`, {
      headers: {
        'Content-Type': 'text/plain',
      },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch message source: ${response.status} ${response.statusText}`);
    }

    return await response.text();
  }

  /**
   * Gets the headers of a message.
   *
   * @param messageId The Mailpit message ID
   * @returns The message headers as an object
   */
  async getMessageHeaders(messageId) {
    const response = await fetch(`${this.baseUrl}/api/v1/message/${messageId}/headers`, {
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch message headers: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }
}

module.exports = { MailpitClient };
