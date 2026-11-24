import { createServer, request as requestLocal } from 'node:http';
import { request as requestSecure } from 'node:https';
import { readFile } from 'node:fs/promises';

const preview = 'http://127.0.0.1:18094';
const wenilla = `http://127.0.0.1:${process.env.MARKETSYNC_WENILLA_PORT || '18093'}`;
const market = 'https://mstest.bl4ut0.dev';
const moduleSource = await readFile(new URL('./marketsync-walk.mjs', import.meta.url));

function forward(client, reply, destination, patchIndex) {
  const send = destination.protocol === 'https:' ? requestSecure : requestLocal;
  const requestHeaders = {};
  if (!patchIndex && client.headers['accept-encoding']) {
    requestHeaders['accept-encoding'] = client.headers['accept-encoding'];
  }
  const upstream = send(destination, { method: client.method, headers: requestHeaders }, (incoming) => {
    const headers = { ...incoming.headers };
    delete headers['set-cookie'];
    if (destination.origin === market) {
      // The same-origin auction iframe and its worker inherit Wenilla’s embedder policy.
      headers['cross-origin-embedder-policy'] = 'require-corp';
      headers['cross-origin-resource-policy'] = 'same-origin';
    }
    if (!patchIndex || incoming.statusCode !== 200 || client.method === 'HEAD') {
      reply.writeHead(incoming.statusCode || 502, headers);
      incoming.pipe(reply);
      return;
    }
    const chunks = [];
    incoming.on('data', (chunk) => chunks.push(chunk));
    incoming.on('end', () => {
      delete headers['content-length'];
      reply.writeHead(200, headers);
      reply.end(`${Buffer.concat(chunks).toString('utf8')}\n<script type="module" src="/marketsync-walk.mjs"></script>`);
    });
  });
  upstream.setTimeout(15_000, () => upstream.destroy());
  upstream.on('error', () => {
    if (!reply.headersSent) reply.writeHead(502);
    reply.end('Preview service unavailable');
  });
  upstream.end();
}

createServer((client, reply) => {
  if (client.method !== 'GET' && client.method !== 'HEAD') {
    reply.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const url = new URL(client.url || '/', preview);
  if (url.pathname === '/marketsync-walk.mjs') {
    reply.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }).end(moduleSource);
    return;
  }
  const entry = url.pathname === '/' || url.pathname === '/index.html';
  if (entry && url.searchParams.get('marketsync_walk') !== '1') {
    url.searchParams.set('marketsync_walk', '1');
    reply.writeHead(302, { Location: `${url.pathname}${url.search}` }).end();
    return;
  }
  const marketPath = url.pathname === '/harbor-auction' || /^\/(api|assets)\//.test(url.pathname);
  const destination = new URL(marketPath ? market : wenilla);
  destination.pathname = url.pathname;
  destination.search = url.search;
  forward(client, reply, destination, entry);
}).listen(18094, '127.0.0.1', () => console.log(`Local MarketSync walk preview at ${preview}/`));
