import net from 'node:net';
import tls from 'node:tls';
import type { EmailAdapter, EmailMessage, EmailSendResult } from './email.js';

export interface SmtpEmailAdapterOptions {
  host: string;
  port: number;
  from?: string;
  secure?: boolean;
  username?: string;
  password?: string;
  timeoutMs?: number;
}

function readSmtpResponse(socket: net.Socket): Promise<{ code: number; text: string }> {
  return new Promise((resolve, reject) => {
    let buffer = '';

    const cleanup = () => {
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const onClose = () => {
      cleanup();
      reject(new Error('SMTP socket closed unexpectedly'));
    };

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      // Last element is incomplete or empty
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i] ?? '';
        // Final response line has space after 3-digit code (e.g. "250 OK")
        const match = /^(\d{3}) (.*)$/.exec(line);
        if (match && match[1]) {
          cleanup();
          resolve({ code: Number(match[1]), text: buffer.trim() });
          return;
        }
      }
    };

    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}

async function sendCommand(
  socket: net.Socket,
  command: string,
  expectedCodes: number[],
): Promise<{ code: number; text: string }> {
  const responsePromise = readSmtpResponse(socket);
  socket.write(`${command}\r\n`);
  const resp = await responsePromise;
  if (!expectedCodes.includes(resp.code)) {
    throw new Error(
      `SMTP unexpected response for "${command.split(' ')[0]}": ${resp.code} ${resp.text}`,
    );
  }
  return resp;
}

function dotStuff(text: string): string {
  return text
    .replace(/\r?\n/g, '\r\n')
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

export class SmtpEmailAdapter implements EmailAdapter {
  readonly name = 'smtp';
  readonly configured = true;
  private readonly options: SmtpEmailAdapterOptions;

  constructor(options: SmtpEmailAdapterOptions) {
    this.options = options;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const from = message.from || this.options.from || 'alerts@marketsync.local';
    const timeoutMs = this.options.timeoutMs ?? 10000;

    let socket: net.Socket | null = null;
    try {
      socket = this.options.secure
        ? tls.connect({ host: this.options.host, port: this.options.port })
        : net.createConnection({ host: this.options.host, port: this.options.port });
      socket.setTimeout(timeoutMs);
      socket.on('timeout', () => {
        socket?.destroy(new Error('SMTP connection timed out'));
      });

      const greeting = await readSmtpResponse(socket);
      if (greeting.code !== 220) {
        throw new Error(`SMTP greeting failed: ${greeting.code} ${greeting.text}`);
      }

      await sendCommand(socket, 'EHLO marketsync.local', [250]);

      if (this.options.username && this.options.password) {
        await sendCommand(socket, 'AUTH LOGIN', [334]);
        await sendCommand(
          socket,
          Buffer.from(this.options.username, 'utf8').toString('base64'),
          [334],
        );
        await sendCommand(
          socket,
          Buffer.from(this.options.password, 'utf8').toString('base64'),
          [235],
        );
      }

      await sendCommand(socket, `MAIL FROM:<${from}>`, [250]);
      await sendCommand(socket, `RCPT TO:<${message.to}>`, [250, 251]);
      await sendCommand(socket, 'DATA', [354]);

      const payload = [
        `From: ${from}`,
        `To: ${message.to}`,
        `Subject: ${message.subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        dotStuff(message.text),
        '.',
      ].join('\r\n');

      await sendCommand(socket, payload, [250]);
      await sendCommand(socket, 'QUIT', [221, 250]).catch(() => undefined);

      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'SMTP send failed',
      };
    } finally {
      socket?.destroy();
    }
  }
}
