import http from 'node:http';
import neo4j from 'neo4j-driver';
import { createEngine } from './engine.js';
import { createNeo4jStore, statsStore } from './neo4jStore.js';

const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://neo4j:7687',
  neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD || 'argus-password'),
  { disableLosslessIntegers: true });
const engine = createEngine(createNeo4jStore(driver));

const send = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readBody = req => new Promise((ok, bad) => {
  let b = ''; req.on('data', c => { b += c; if (b.length > 1e5) req.destroy(); });
  req.on('end', () => ok(b)); req.on('error', bad);
});

http.createServer(async (req, res) => {
  try {
    if (req.url === '/api/health') {
      const s = driver.session();
      try { const r = await s.run('MATCH (n) RETURN count(n) AS nodes'); return send(res, 200, { ok: true, nodes: r.records[0].get('nodes') }); }
      finally { await s.close(); }
    }
    if (req.url === '/api/query' && req.method === 'POST') {
      const { q } = JSON.parse((await readBody(req)) || '{}');
      if (!q || typeof q !== 'string') return send(res, 400, { error: 'body must be {"q": "..."}' });
      const stats = { cypher: 0, cypherMs: 0 }, t0 = performance.now();
      const out = await statsStore.run(stats, () => engine.planJSON(q.slice(0, 500)));
      out.timing = { serverMs: performance.now() - t0, cypherQueries: stats.cypher, neo4jMs: stats.cypherMs };
      return send(res, 200, out);
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: String(e.message || e) });
  }
}).listen(3001, () => console.log('argus api on :3001'));
