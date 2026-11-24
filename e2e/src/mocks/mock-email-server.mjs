import http from 'node:http';
import net from 'node:net';

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function parseSmtpMessage(raw, envelope) {
  const normalized = raw.replace(/\r\n/g, '\n');
  const splitIdx = normalized.indexOf('\n\n');
  const headerPart = splitIdx >= 0 ? normalized.slice(0, splitIdx) : normalized;
  const bodyPart = splitIdx >= 0 ? normalized.slice(splitIdx + 2) : '';
  const subjectMatch = headerPart.match(/^Subject:\s*(.+)$/im);
  const toMatch = headerPart.match(/^To:\s*(.+)$/im);
  return {
    to: envelope.rcptTo[0] || (toMatch ? toMatch[1].trim() : ''),
    from: envelope.mailFrom || '',
    subject: subjectMatch ? subjectMatch[1].trim() : '(smtp message)',
    text: bodyPart,
    transport: 'smtp',
  };
}

export async function startMockEmailServer(options = {}) {
  const emails = [];
  let nextId = 1;

  function recordEmail(entry) {
    const item = {
      id: `msg_${nextId++}`,
      timestamp: new Date().toISOString(),
      to: entry.to,
      from: entry.from || 'alerts@marketsync.local',
      subject: entry.subject,
      text: entry.text ?? entry.body ?? '',
      html: entry.html ?? null,
      metadata: entry.metadata ?? null,
      transport: entry.transport || 'http',
    };
    emails.push(item);
    return item;
  }

  const httpServer = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = reqUrl.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      });
      return res.end();
    }

    if ((pathname === '/send' || pathname === '/webhook' || pathname === '/api/send') && req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        if (!body.to || !body.subject) {
          return sendJson(res, 400, { ok: false, error: 'Fields "to" and "subject" are required' });
        }
        const saved = recordEmail(body);
        const accepted = Array.isArray(saved.to) ? saved.to : [saved.to];
        return sendJson(res, 202, { ok: true, id: saved.id, accepted });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message });
      }
    }

    if (pathname === '/emails' && req.method === 'GET') {
      const toFilter = reqUrl.searchParams.get('to');
      const filtered = toFilter
        ? emails.filter((e) => (Array.isArray(e.to) ? e.to.includes(toFilter) : e.to === toFilter))
        : [...emails];
      return sendJson(res, 200, { count: filtered.length, emails: filtered });
    }

    if (pathname === '/emails' && req.method === 'DELETE') {
      const cleared = emails.length;
      emails.length = 0;
      return sendJson(res, 200, { ok: true, cleared });
    }

    return sendJson(res, 404, { ok: false, error: 'Not Found' });
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port ?? 0, '127.0.0.1', () => {
      httpServer.removeListener('error', reject);
      resolve();
    });
  });

  const httpAddr = httpServer.address();
  const url = `http://127.0.0.1:${httpAddr.port}`;

  // Optional lightweight SMTP capture server for SmtpEmailAdapter testing
  let smtpServer = null;
  let smtpPort = null;

  if (options.enableSmtp !== false) {
    smtpServer = net.createServer((socket) => {
      let buffer = '';
      let inData = false;
      let dataBuf = '';
      const envelope = { mailFrom: '', rcptTo: [] };

      socket.write('220 localhost MockSMTP ESMTP\r\n');

      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        while (true) {
          const nlIdx = buffer.indexOf('\n');
          if (nlIdx < 0) break;
          const line = buffer.slice(0, nlIdx).replace(/\r$/, '');
          buffer = buffer.slice(nlIdx + 1);

          if (inData) {
            if (line === '.') {
              inData = false;
              const parsed = parseSmtpMessage(dataBuf, envelope);
              recordEmail(parsed);
              dataBuf = '';
              envelope.mailFrom = '';
              envelope.rcptTo = [];
              socket.write('250 2.0.0 Ok: queued\r\n');
            } else {
              dataBuf += (line.startsWith('..') ? line.slice(1) : line) + '\r\n';
            }
            continue;
          }

          const upper = line.toUpperCase();
          if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
            socket.write('250-localhost\r\n250 OK\r\n');
          } else if (upper.startsWith('MAIL FROM:')) {
            envelope.mailFrom = line.slice(10).trim().replace(/^<|>$/g, '');
            socket.write('250 2.1.0 Ok\r\n');
          } else if (upper.startsWith('RCPT TO:')) {
            envelope.rcptTo.push(line.slice(8).trim().replace(/^<|>$/g, ''));
            socket.write('250 2.1.5 Ok\r\n');
          } else if (upper === 'DATA') {
            inData = true;
            dataBuf = '';
            socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
          } else if (upper === 'QUIT') {
            socket.write('221 2.0.0 Bye\r\n');
            socket.end();
          } else if (upper === 'RSET') {
            envelope.mailFrom = '';
            envelope.rcptTo = [];
            socket.write('250 2.0.0 Ok\r\n');
          } else {
            socket.write('250 OK\r\n');
          }
        }
      });
    });

    await new Promise((resolve, reject) => {
      smtpServer.once('error', reject);
      smtpServer.listen(options.smtpPort ?? 0, '127.0.0.1', () => {
        smtpServer.removeListener('error', reject);
        resolve();
      });
    });

    smtpPort = smtpServer.address().port;
  }

  return {
    port: httpAddr.port,
    smtpPort,
    url,
    sendUrl: `${url}/send`,
    webhookUrl: `${url}/webhook`,
    getEmails() {
      return [...emails];
    },
    clearEmails() {
      const count = emails.length;
      emails.length = 0;
      return count;
    },
    async waitForEmail(predicate = () => true, timeoutMs = 3000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const match = emails.find(predicate);
        if (match) return match;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error(`Timed out after ${timeoutMs}ms waiting for matching email`);
    },
    async close() {
      const closes = [
        new Promise((resolve) => httpServer.close(() => resolve())),
      ];
      if (smtpServer) {
        closes.push(new Promise((resolve) => smtpServer.close(() => resolve())));
      }
      await Promise.all(closes);
    },
  };
}
