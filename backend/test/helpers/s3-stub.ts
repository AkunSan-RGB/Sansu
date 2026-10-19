/** Peladen S3 tiruan (path-style) di memori untuk menguji penyimpanan objek tanpa bucket sungguhan. */
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';

export interface S3Stub { url: string; objects: Map<string, { body: Buffer; type: string }>; server: Server; failPut: boolean; close: () => Promise<void> }

export async function startS3Stub(bucket: string): Promise<S3Stub> {
  const objects = new Map<string, { body: Buffer; type: string }>();
  const stub = { failPut: false } as S3Stub;
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const parts = decodeURIComponent(u.pathname).split('/').filter(Boolean); // [bucket, ...key]
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (parts[0] !== bucket) return void res.writeHead(404).end();
      const key = parts.slice(1).join('/');
      if (req.method === 'PUT') {
        if (stub.failPut) return void res.writeHead(500).end();
        // aws-sdk v3 dapat membungkus badan dengan aws-chunked; keluarkan isinya
        let data = body;
        if ((req.headers['content-encoding'] ?? '').includes('aws-chunked') || (req.headers['x-amz-content-sha256'] ?? '').toString().startsWith('STREAMING')) {
          const out: Buffer[] = [];
          let i = 0;
          while (i < body.length) {
            const nl = body.indexOf('\r\n', i);
            const size = parseInt(body.subarray(i, nl).toString().split(';')[0], 16);
            if (!size) break;
            out.push(body.subarray(nl + 2, nl + 2 + size));
            i = nl + 2 + size + 2;
          }
          data = Buffer.concat(out);
        }
        objects.set(key, { body: data, type: String(req.headers['content-type'] ?? 'application/octet-stream') });
        return void res.writeHead(200, { ETag: '"x"' }).end();
      }
      if (req.method === 'GET' && !key) {
        const prefix = u.searchParams.get('prefix') ?? '';
        const keys = [...objects.keys()].filter((k) => k.startsWith(prefix));
        const xml = `<?xml version="1.0"?><ListBucketResult><Name>${bucket}</Name><IsTruncated>false</IsTruncated><KeyCount>${keys.length}</KeyCount>${keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join('')}</ListBucketResult>`;
        return void res.writeHead(200, { 'content-type': 'application/xml' }).end(xml);
      }
      if (req.method === 'GET') {
        const o = objects.get(key);
        if (!o) return void res.writeHead(404, { 'content-type': 'application/xml' }).end('<Error><Code>NoSuchKey</Code></Error>');
        return void res.writeHead(200, { 'content-type': o.type, 'content-length': o.body.length }).end(o.body);
      }
      if (req.method === 'DELETE') {
        objects.delete(key);
        return void res.writeHead(204).end();
      }
      if (req.method === 'POST' && u.searchParams.has('delete')) {
        for (const m of body.toString().matchAll(/<Key>([^<]+)<\/Key>/g)) objects.delete(m[1]);
        return void res.writeHead(200, { 'content-type': 'application/xml' }).end('<DeleteResult></DeleteResult>');
      }
      res.writeHead(405).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  Object.assign(stub, { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, objects, server, close: () => new Promise<void>((r) => server.close(() => r())) });
  return stub;
}
