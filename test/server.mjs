import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

/**
 * Serves the fixtures on an ephemeral port.
 *
 * Port 0 on purpose: a fixed port collided with a service already running on
 * this machine, the fixture silently served someone else's page, and the tests
 * passed against the wrong HTML.
 */
export async function serveFixtures() {
  const server = createServer(async (req, res) => {
    const path = resolve(join(here, 'fixtures', decodeURIComponent(req.url.split('?')[0])));
    if (!path.startsWith(join(here, 'fixtures'))) {
      res.writeHead(403).end('no');
      return;
    }
    try {
      const body = await readFile(path);
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    }
  });

  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const { port } = server.address();

  return {
    url: (file) => `http://127.0.0.1:${port}/${file}`,
    close: () => new Promise((ok) => server.close(ok)),
  };
}
