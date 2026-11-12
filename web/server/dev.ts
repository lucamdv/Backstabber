import { createServer } from 'node:http';
import { handleRequest } from './http';

const port = Number(process.env.BACKSTABBER_API_PORT ?? 8787);
createServer(async (incoming, outgoing) => {
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }
    const chunks: Uint8Array[] = [];
    let length = 0;
    for await (const chunk of incoming) {
      const bytes = Buffer.from(chunk);
      length += bytes.length;
      if (length > 16384) {
        outgoing.writeHead(413, { 'Content-Type': 'application/json' }).end('{"error":"PAYLOAD_TOO_LARGE"}');
        return;
      }
      chunks.push(bytes);
    }
    const request = new Request(new URL(incoming.url ?? '/', `http://127.0.0.1:${port}`), {
      method: incoming.method, headers, body: length ? Buffer.concat(chunks).toString('utf8') : undefined,
    });
    const response = await handleRequest(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(400, { 'Content-Type': 'application/json' }).end('{"error":"INVALID_REQUEST"}');
  }
}).listen(port, '127.0.0.1', () => console.log(`Backstabber API at http://127.0.0.1:${port}/api/v1`));
