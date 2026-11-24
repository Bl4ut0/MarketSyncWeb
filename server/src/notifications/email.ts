export interface EmailMessage {
  to: string;
  from?: string;
  subject: string;
  text: string;
  html?: string;
  metadata?: Record<string, unknown>;
}

export interface EmailSendResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export interface EmailAdapter {
  readonly name: string;
  readonly configured: boolean;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export class NullEmailAdapter implements EmailAdapter {
  readonly name = 'null';
  readonly configured = false;

  async send(_message: EmailMessage): Promise<EmailSendResult> {
    return {
      ok: false,
      error: 'Email delivery is not configured.',
    };
  }
}

export class MockEmailAdapter implements EmailAdapter {
  readonly name = 'mock';
  readonly configured = true;
  readonly sent: Array<EmailMessage & { id: string; sentAt: string }> = [];
  private seq = 1;

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const id = `mock_email_${this.seq++}`;
    this.sent.push({
      ...message,
      id,
      sentAt: new Date().toISOString(),
    });
    return { ok: true, id };
  }

  clear(): void {
    this.sent.length = 0;
  }
}

export interface WebhookEmailAdapterOptions {
  webhookUrl: string;
  from?: string;
  authToken?: string;
  fetchImpl?: typeof fetch;
}

export class WebhookEmailAdapter implements EmailAdapter {
  readonly name = 'webhook';
  readonly configured = true;
  private readonly webhookUrl: string;
  private readonly defaultFrom: string;
  private readonly authToken?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: WebhookEmailAdapterOptions) {
    this.webhookUrl = options.webhookUrl;
    this.defaultFrom = options.from || 'alerts@marketsync.local';
    this.authToken = options.authToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }

    const res = await this.fetchImpl(this.webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        to: message.to,
        from: message.from || this.defaultFrom,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(message.metadata ? { metadata: message.metadata } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        ok: false,
        error: `Webhook email delivery failed (${res.status}): ${body}`,
      };
    }

    try {
      const data = (await res.json()) as { id?: string };
      return { ok: true, id: data.id };
    } catch {
      return { ok: true };
    }
  }
}
