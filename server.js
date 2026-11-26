import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number(process.env.PORT ?? 4173);
const host = '127.0.0.1';
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml' };
const assets = /^\/(?:index\.html|style\.css|(?:example|ui|worker)\.js|(?:engine|ui)\/[a-zA-Z0-9_-]+\.js|favicon\.svg)$/;

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const path = pathname === '/' ? '/index.html' : pathname;
    if (!assets.test(path)) {
      response.writeHead(404).end();
      return;
    }
    const file = await readFile(new URL('.' + path, import.meta.url));
    response.writeHead(200, {
      'Content-Type': types[path.split('.').at(-1)] + '; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    response.end(request.method === 'HEAD' ? undefined : file);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
  }
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE' && process.env.PORT === undefined) {
    server.listen(0, host);
    return;
  }
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${port} is in use. Choose another with PORT=4174 npm start.`
    : error.message);
  process.exitCode = 1;
});
server.on('listening', () => {
  console.log(`River solver is ready at http://${host}:${server.address().port}/`);
});
server.listen(port, host);
