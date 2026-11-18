import neo4j from 'neo4j-driver';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ANCHOR_TYPES } from './engine.js';

/** per-request stats: {cypher: number of queries, cypherMs: time spent inside Neo4j} */
export const statsStore = new AsyncLocalStorage();

export function createNeo4jStore(driver) {
  const run = async (cypher, params = {}) => {
    const s = driver.session({ defaultAccessMode: neo4j.session.READ });
    const t0 = performance.now();
    try { return (await s.run(cypher, params)).records; }
    finally {
      await s.close();
      const st = statsStore.getStore();
      if (st) { st.cypher++; st.cypherMs += performance.now() - t0; }
    }
  };
  const toNode = r => {
    const { id, label, ...props } = r.get('p');
    return { id, label, type: r.get('t'), props };
  };
  const edgeOf = r => ({ s: r.get('s'), t: r.get('tt'), type: r.get('rt'), layers: r.get('layers') || [], derived: !!r.get('derived') });

  return {
    async anchorNodes() {
      const recs = await run(
        'MATCH (n) WHERE any(l IN labels(n) WHERE l IN $types) RETURN n.id AS id, n.label AS label, labels(n)[0] AS type, COUNT { (n)--() } AS deg',
        { types: ANCHOR_TYPES });
      return recs.map(r => ({ id: r.get('id'), label: r.get('label'), type: r.get('type'), deg: r.get('deg') }));
    },
    async nodes(ids) {
      if (!ids.length) return new Map();
      const recs = await run('MATCH (n) WHERE n.id IN $ids RETURN properties(n) AS p, labels(n)[0] AS t', { ids });
      return new Map(recs.map(r => { const n = toNode(r); return [n.id, n]; }));
    },
    async hop(ids, { types = null, targetType = null, dir = null, derived = false } = {}) {
      if (!ids.length) return [];
      const rel = dir === 'out' ? '-[r]->' : dir === 'in' ? '<-[r]-' : '-[r]-';
      const where = ['a.id IN $ids'];
      if (types) where.push('type(r) IN $types');
      if (!derived) where.push('coalesce(r.derived, false) = false');
      if (targetType) where.push('$tt IN labels(b)');
      const recs = await run(
        `MATCH (a)${rel}(b) WHERE ${where.join(' AND ')}
         RETURN a.id AS a, b.id AS b, labels(b)[0] AS bt, startNode(r).id AS s, endNode(r).id AS tt,
                type(r) AS rt, r.layers AS layers, r.derived AS derived`,
        { ids, types, tt: targetType });
      return recs.map(r => ({ a: r.get('a'), b: r.get('b'), bt: r.get('bt'), e: edgeOf(r) }));
    },
    async allEvents() {
      const recs = await run('MATCH (n:Event) RETURN properties(n) AS p, labels(n)[0] AS t');
      return recs.map(toNode);
    },
    async edgesAmong(ids, type) {
      const recs = await run(
        `MATCH (a)-[r]->(b) WHERE type(r) = $type AND a.id IN $ids AND b.id IN $ids
         RETURN a.id AS s, b.id AS tt, type(r) AS rt, r.layers AS layers, r.derived AS derived`, { ids, type });
      return recs.map(edgeOf);
    },
  };
}
