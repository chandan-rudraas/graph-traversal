/*
 * ARGUS query planner. Backend-agnostic: all graph access goes through a `store`
 *   store.anchorNodes()           -> [{id,label,type,deg}]   (entities/sources/keyphrases/clusters)
 *   store.nodes(ids)              -> Map id -> {id,type,label,props}
 *   store.hop(ids, opts)          -> [{a, b, bt, e:{s,t,type,layers,derived}}]
 *       opts: {types, targetType, dir:'out'|'in'|null, derived:boolean}
 *   store.allEvents()             -> [{id,type,label,props}]
 *   store.edgesAmong(ids, type)   -> [{s,t,type,layers,derived}]
 * Two stores exist: createMemoryStore (browser) and api/neo4jStore.js (Cypher).
 * Steps reference edges by key `s|t|type`.
 */
export const edgeKey = e => `${e.s}|${e.t}|${e.type}`;

const STOP = new Set('the a an of in on at to for and or is are was were be been with by from about what which who whom how why when where show me find list give tell all any events event news stories story related relation connected connect connection between link links path linking associated association similar duplicate duplicates same cluster clusters timeline latest recent newest oldest top most risk risks level levels high critical moderate low reports reported report that this these those there their it its as into than then do does did has have had can could would should please get'.split(' '));
const DOMAIN_WORDS = {M:['military','security','army','terror','terrorist','defence','defense'],P:['politics','political','diplomacy','government'],
  E:['economy','economic','business','market','finance'],T:['technology','tech','science'],L:['law','crime','legal','court'],S:['society','social'],
  H:['health','humanitarian'],I:['infrastructure','incident','accident'],N:['nature','environment','disaster','climate'],C:['cyber','hacking','breach']};
const ALL_DOMAIN_WORDS = Object.values(DOMAIN_WORDS).flat();
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const short = (s, n = 70) => s.length > n ? s.slice(0, n - 1) + '…' : s;
export const ANCHOR_TYPES = ['Person', 'Organization', 'Location', 'Source', 'Keyphrase', 'EventCluster'];

/* ---------------------------------------------------------------- in-memory store */
export function createMemoryStore(G) {
  const N = new Map(G.nodes.map(n => [n.id, n]));
  const adj = new Map(G.nodes.map(n => [n.id, []]));
  G.edges.forEach(e => { adj.get(e.s).push({e, o: e.t, dir: 'out'}); adj.get(e.t).push({e, o: e.s, dir: 'in'}); });
  return {
    async anchorNodes() { return G.nodes.filter(n => ANCHOR_TYPES.includes(n.type)).map(n => ({id: n.id, label: n.label, type: n.type, deg: adj.get(n.id).length})); },
    async nodes(ids) { return new Map(ids.filter(i => N.has(i)).map(i => [i, N.get(i)])); },
    async hop(ids, {types = null, targetType = null, dir = null, derived = false} = {}) {
      const rows = [];
      for (const a of ids) for (const x of adj.get(a) || []) {
        if (x.e.derived && !derived) continue;
        if (types && !types.includes(x.e.type)) continue;
        if (dir && x.dir !== dir) continue;
        const bt = N.get(x.o).type;
        if (targetType && bt !== targetType) continue;
        rows.push({a, b: x.o, bt, e: x.e});
      }
      return rows;
    },
    async allEvents() { return G.nodes.filter(n => n.type === 'Event'); },
    async edgesAmong(ids, type) { const s = new Set(ids); return G.edges.filter(e => e.type === type && s.has(e.s) && s.has(e.t)); },
  };
}

/* ---------------------------------------------------------------- engine */
export function createEngine(store) {
  let ready = null, labelIndex, sortedLabels, degOf;
  const cache = new Map(), meta = new Map();
  const init = () => ready || (ready = (async () => {
    labelIndex = new Map(); degOf = new Map();
    for (const n of await store.anchorNodes()) {
      degOf.set(n.id, n.deg);
      const l = n.label.toLowerCase().trim();
      if (l.length < 3 || STOP.has(l)) continue;
      if (!labelIndex.has(l)) labelIndex.set(l, []);
      labelIndex.get(l).push(n.id);
    }
    sortedLabels = [...labelIndex.keys()].sort((a, b) => b.length - a.length);
  })());

  const need = async ids => {
    const miss = [...new Set(ids)].filter(i => !cache.has(i));
    if (miss.length) (await store.nodes(miss)).forEach((v, k) => cache.set(k, v));
  };
  const node = id => cache.get(id) || {id, type: '?', label: id, props: {}};
  const ev = id => node(id).props;

  async function hop(from, o) {
    const rows = await store.hop(from, o);
    const edges = new Set(), targets = new Map(), types = new Map();
    for (const r of rows) {
      const k = edgeKey(r.e); edges.add(k); meta.set(k, r.e);
      if (!targets.has(r.b)) targets.set(r.b, []);
      targets.get(r.b).push(r.a); types.set(r.b, r.bt);
    }
    return {edges: [...edges], targets, types, rows};
  }
  const layersOf = keys => [...new Set(keys.flatMap(k => meta.get(k)?.layers || []))].sort((a, b) => a - b);
  const typeCount = keys => { const c = {}; keys.forEach(k => { const t = meta.get(k)?.type; c[t] = (c[t] || 0) + 1; }); return Object.entries(c).map(([k, v]) => `${k}×${v}`).join(', '); };

  function findAnchors(q) {
    let rest = ' ' + q.toLowerCase().replace(/[^\p{L}\p{N}\s\-']/gu, ' ') + ' ';
    const groups = [];
    for (const l of sortedLabels) {
      if (rest.indexOf(l) < 0) continue;
      const re = new RegExp('(?<![\\p{L}\\p{N}])' + reEsc(l) + '(?![\\p{L}\\p{N}])', 'u');
      if (re.test(rest)) { groups.push({text: l, ids: labelIndex.get(l), fuzzy: false}); rest = rest.replace(new RegExp(re.source, 'gu'), ' '); }
    }
    const toks = rest.split(/\s+/).filter(t => t.length >= 4 && !STOP.has(t) && !ALL_DOMAIN_WORDS.includes(t));
    for (const t of toks) {
      const hits = [];
      const re = new RegExp('(?<![\\p{L}\\p{N}])' + reEsc(t) + '(?![\\p{L}\\p{N}])', 'u');
      for (const l of sortedLabels) if (re.test(l)) hits.push(...labelIndex.get(l));
      if (hits.length) { hits.sort((a, b) => degOf.get(b) - degOf.get(a)); groups.push({text: t, ids: hits.slice(0, 6), fuzzy: true}); }
    }
    return groups;
  }

  function parseQuery(q) {
    const ql = q.toLowerCase();
    const f = {risk: null, domain: null, sentiment: null, sort: 'rank', limit: 8, intent: 'events'};
    const rm = ql.match(/\b(critical|high|moderate|low)\b(?=[^.]*\b(risk|threat|danger)\b)|\b(risk|threat|danger)\w*\s+(?:level\s+)?(critical|high|moderate|low)\b|\bcritical\b/);
    if (rm) f.risk = (rm[1] || rm[4] || 'critical').replace(/^./, c => c.toUpperCase());
    for (const [code, ws] of Object.entries(DOMAIN_WORDS)) if (ws.some(w => new RegExp('\\b' + w + '\\w*').test(ql))) { f.domain = code; break; }
    if (/\bnegative\b/.test(ql)) f.sentiment = 'negative'; else if (/\bpositive\b/.test(ql)) f.sentiment = 'positive';
    if (/\b(latest|recent|newest|last)\b/.test(ql)) f.sort = 'newest';
    else if (/\b(oldest|earliest)\b/.test(ql)) f.sort = 'oldest';
    else if (/\b(riskiest|most (risky|dangerous)|highest risk)\b/.test(ql)) f.sort = 'risk';
    const tn = ql.match(/\btop\s+(\d+)\b/); if (tn) f.limit = Math.min(30, +tn[1]);
    if (/\b(between|connect|connection|link|linked|path|relationship|how .* (related|connected))\b/.test(ql)) f.intent = 'path';
    else if (/\b(associated|co-?occur|network|allies|ally|who works|affiliat|frequently with)\b/.test(ql)) f.intent = 'network';
    else if (/\b(similar|duplicate|same story|cluster|corroborat|other sources)\b/.test(ql)) f.intent = 'cluster';
    else if (/\b(timeline|chronolog|sequence|before|after|evolution|unfold)\b/.test(ql)) f.intent = 'timeline';
    return f;
  }

  function rankEvents(ids, scoreMap, sort) {
    const arr = [...ids];
    const key = id => [scoreMap.get(id) || 0, ev(id).risk || 0, ev(id).time || 0];
    if (sort === 'newest') arr.sort((a, b) => (ev(b).time || 0) - (ev(a).time || 0));
    else if (sort === 'oldest') arr.sort((a, b) => (ev(a).time || 1e18) - (ev(b).time || 1e18));
    else if (sort === 'risk') arr.sort((a, b) => (ev(b).risk || 0) - (ev(a).risk || 0));
    else arr.sort((a, b) => { const ka = key(a), kb = key(b); return kb[0] - ka[0] || kb[1] - ka[1] || kb[2] - ka[2]; });
    return arr;
  }

  async function finish(steps, result, why) {
    const top = result.events.slice(0, 8);
    const prov = await hop(top, {types: ['REPORTED_BY', 'OCCURRED_AT', 'BELONGS_TO', 'ABOUT'], dir: 'out'});
    steps.push({title: 'Enrich answer with provenance', detail: 'Follow REPORTED_BY (L7), OCCURRED_AT (L4), BELONGS_TO (L2), ABOUT (L6) from the result events.', nodes: [...prov.targets.keys()], edges: prov.edges, focus: top});
    result.why = why;
    return {steps, result};
  }

  async function plan(q) {
    await init();
    const steps = [], f = parseQuery(q);
    const S = (title, detail, o = {}) => steps.push({title, detail, nodes: o.nodes || [], edges: o.edges || [], focus: o.focus || null});
    const anchors = findAnchors(q);
    let intent = f.intent;
    if (intent === 'path' && anchors.length < 2) intent = 'events';
    if (intent !== 'events' && intent !== 'path' && !anchors.length) intent = 'events';
    if (intent === 'timeline') f.sort = 'oldest';

    const anchorDesc = anchors.map(a => `"${a.text}"${a.fuzzy ? ' (fuzzy)' : ''} → ${a.ids.length} node(s)`).join('; ') || 'none';
    S('Parse query', `Intent: ${intent}. Anchors: ${anchorDesc}. Filters: ` +
      ([f.risk && 'risk=' + f.risk, f.domain && 'domain=' + f.domain, f.sentiment && 'sentiment=' + f.sentiment, f.sort !== 'rank' && 'sort=' + f.sort].filter(Boolean).join(', ') || 'none'));
    if (anchors.length) S('Entity linking', 'Match query phrases to graph nodes (layer 1 entities / layer 7 sources / layer 6 keyphrases).',
      {nodes: anchors.flatMap(a => a.ids), focus: anchors.flatMap(a => a.ids)});

    const result = {intent, anchors, filters: f, events: [], extra: null, answer: ''};

    /* ---------------- PATH */
    if (intent === 'path') {
      const A = anchors[0], B = anchors[1];
      const skip = new Set(['Topic','Country','TimeBucket','RiskLevel','UrgencyLevel','ImpactLevel','Trend','Community','Keyphrase','EventCluster']);
      const bfs = async restrict => {
        const parent = new Map(A.ids.map(i => [i, null])), levels = [], target = new Set(B.ids);
        let frontier = [...A.ids], found = A.ids.find(i => target.has(i)) || null;
        for (let d = 1; d <= 6 && !found && frontier.length; d++) {
          const rows = await store.hop(frontier, {});
          const nxt = [], used = [];
          for (const r of rows) {
            if (parent.has(r.b)) continue;
            if (restrict && skip.has(r.bt) && !target.has(r.b)) continue;
            const k = edgeKey(r.e); meta.set(k, r.e);
            parent.set(r.b, {from: r.a, k, e: r.e}); nxt.push(r.b); used.push(k);
            if (target.has(r.b) && !found) found = r.b;
          }
          levels.push({d, nodes: nxt, edges: used}); frontier = nxt;
        }
        return {parent, levels, found};
      };
      let r = await bfs(true), mode = 'entity/event hops only';
      if (!r.found) { r = await bfs(false); mode = 'all node types (topics, clusters, …)'; }
      r.levels.forEach(l => S(`BFS depth ${l.d} from "${A.text}"`, `Expanded ${l.nodes.length} node(s) via ${layersOf(l.edges).map(x => 'L' + x).join(',') || '-'} edges (${mode}).`,
        {nodes: l.nodes.slice(0, 150), edges: l.edges.slice(0, 250)}));
      if (r.found) {
        const pn = [r.found], pk = [], pe = [];
        for (let c = r.found; r.parent.get(c);) { const p = r.parent.get(c); pk.unshift(p.k); pe.unshift(p.e); pn.unshift(p.from); c = p.from; }
        await need(pn);
        S(`Reached "${B.text}"`, `Shortest path has ${pe.length} hop(s).`, {nodes: pn, edges: pk, focus: pn});
        const parts = [esc(node(pn[0]).label)];
        pe.forEach((e, i) => { const fwd = e.s === pn[i]; const nl = node(pn[i + 1]); parts.push(`<span class="kv">${fwd ? '' : '←'}${e.type}${fwd ? '→' : ''}</span> ${esc(nl.type === 'Event' ? short(nl.label, 60) : nl.label)}`); });
        result.events = pn.filter(id => node(id).type === 'Event');
        result.answer = `<b>${esc(A.text)}</b> and <b>${esc(B.text)}</b> are connected in ${pe.length} hop(s):<br>${parts.join(' ')}`;
      } else result.answer = `No path found between <b>${esc(A.text)}</b> and <b>${esc(B.text)}</b> within 6 hops.`;
      return {steps, result};
    }

    /* ---------------- NETWORK */
    if (intent === 'network') {
      await need(anchors[0].ids);
      const ids = anchors[0].ids.filter(i => !['Source', 'Keyphrase', 'EventCluster'].includes(node(i).type));
      const h1 = await hop(ids.length ? ids : anchors[0].ids, {types: ['MENTIONS'], targetType: 'Event'});
      S(`Entity → events: "${anchors[0].text}"`, `${h1.targets.size} event(s) mention it (${typeCount(h1.edges)}).`, {edges: h1.edges, focus: [...h1.targets.keys()]});
      const h2 = await hop([...h1.targets.keys()], {types: ['MENTIONS'], dir: 'out'});
      const cnt = new Map();
      for (const [t, froms] of h2.targets) if (!ids.includes(t) && ['Person', 'Organization'].includes(h2.types.get(t))) cnt.set(t, new Set(froms).size);
      const top = [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      const topIds = new Set(top.map(t => t[0]));
      const keep = h2.edges.filter(k => topIds.has(meta.get(k).t) || ids.includes(meta.get(k).t));
      S('Events → co-mentioned entities (layer 5)', `Counted co-occurrences; keeping top ${top.length} people/organisations.`, {edges: keep, nodes: [...topIds], focus: [...topIds]});
      await need([...topIds, ...h1.targets.keys()]);
      result.extra = top;
      result.answer = top.length ? `Entities most associated with <b>${esc(anchors[0].text)}</b> (co-occurrence ≠ proven affiliation):<ol>` +
        top.map(([id, c]) => `<li>${esc(node(id).label)} <span class="kv">(${node(id).type}, ${c} shared event${c > 1 ? 's' : ''})</span></li>`).join('') + '</ol>' : 'No co-mentioned people/organisations found.';
      result.events = rankEvents(h1.targets.keys(), new Map(), 'rank').slice(0, f.limit);
      return {steps, result};
    }

    /* ---------------- candidate generation */
    const cand = new Map(), why = new Map();
    const addWhy = (id, r) => { if (!why.has(id)) why.set(id, []); if (!why.get(id).includes(r)) why.get(id).push(r); };
    if (anchors.length) {
      const sets = [];
      for (const a of anchors) {
        const h = await hop(a.ids, {targetType: 'Event'});
        S(`Traverse from "${a.text}"`, `${h.targets.size} event(s) via ${typeCount(h.edges) || 'no edges'}  [layers ${layersOf(h.edges).join(', ')}]`,
          {edges: h.edges, nodes: a.ids, focus: [...h.targets.keys()]});
        h.targets.forEach((_, id) => addWhy(id, a.text));
        sets.push(new Set(h.targets.keys()));
      }
      let comb;
      if (sets.length > 1) {
        const inter = [...sets[0]].filter(x => sets.every(s => s.has(x)));
        if (inter.length) { comb = new Set(inter); S('Intersect anchors (AND)', `${comb.size} event(s) connect to every anchor.`, {nodes: inter, focus: inter}); }
        else { comb = new Set(sets.flatMap(s => [...s])); S('Union anchors (OR)', `No event links all anchors; ranking ${comb.size} event(s) by number of anchors hit.`, {nodes: [...comb].slice(0, 200)}); }
      } else comb = sets[0];
      comb.forEach(id => cand.set(id, sets.filter(s => s.has(id)).length));
    } else {
      const toks = q.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(t => t.length > 2 && !STOP.has(t) && !ALL_DOMAIN_WORDS.some(w => t.startsWith(w)));
      if (toks.length) {
        for (const n of await store.allEvents()) {
          const t = (n.props.title || n.label).toLowerCase(), s = toks.filter(w => t.includes(w)).length;
          if (s) { cand.set(n.id, s); addWhy(n.id, 'text match'); }
        }
        S('Keyword seed (no entity matched)', `Matched ${toks.join(', ')} against event titles → ${cand.size} event(s).`, {nodes: [...cand.keys()].slice(0, 200), focus: [...cand.keys()]});
      } else if (f.risk || f.domain || f.sentiment || f.sort !== 'rank') {
        (await store.allEvents()).forEach(n => cand.set(n.id, 0));
      }
    }

    const applyNodeFilter = async (nid, label, layer) => {
      if (!(await store.nodes([nid])).size) return;
      const h = await hop([nid], {targetType: 'Event'});
      const ok = new Set(h.targets.keys()), before = cand.size;
      if (!anchors.length && !before) ok.forEach(i => cand.set(i, 0)); else for (const id of [...cand.keys()]) if (!ok.has(id)) cand.delete(id);
      const kept = h.edges.filter(k => cand.has(meta.get(k).s) || cand.has(meta.get(k).t));
      S(`Filter: ${label}`, `Follow ${typeCount(h.edges.slice(0, 1))} (layer ${layer}) → ${cand.size} event(s) remain${before ? ` of ${before}` : ''}.`,
        {nodes: [nid], edges: kept.slice(0, 300), focus: [...cand.keys()].slice(0, 200)});
      cand.forEach((_, id) => addWhy(id, label));
    };
    if (f.risk) await applyNodeFilter('risk:' + f.risk, 'risk level ' + f.risk, 8);
    if (f.domain) await applyNodeFilter('topic:' + f.domain, 'topic ' + f.domain, 6);
    await need([...cand.keys()]);
    if (f.sentiment) {
      const before = cand.size;
      for (const id of [...cand.keys()]) if (ev(id).sentiment !== f.sentiment) cand.delete(id);
      S(`Filter: sentiment ${f.sentiment}`, `Property check on event nodes → ${cand.size} of ${before}.`, {nodes: [...cand.keys()].slice(0, 200), focus: [...cand.keys()]});
    }
    if (!cand.size) { result.answer = 'No matching events found. Try an entity, place, source or keyword present in the data.'; return {steps, result}; }

    if (intent === 'cluster') {
      const base = rankEvents(cand.keys(), cand, 'rank').slice(0, 6);
      const hc = await hop(base, {types: ['BELONGS_TO'], targetType: 'EventCluster'});
      S('Events → their dedup clusters (layer 2)', `${hc.targets.size} cluster(s).`, {edges: hc.edges, focus: [...hc.targets.keys()]});
      const sib = await hop([...hc.targets.keys()], {types: ['BELONGS_TO'], targetType: 'Event'});
      const sibIds = [...sib.targets.keys()].filter(i => !base.includes(i));
      await need(sibIds);
      const sibRanked = rankEvents(sibIds, new Map(), 'newest').slice(0, 12);
      const keep = sib.edges.filter(k => base.includes(meta.get(k).s) || sibRanked.includes(meta.get(k).s));
      S('Cluster → sibling events (same story)', `${sibIds.length} sibling event(s); showing ${sibRanked.length}.`, {edges: keep, focus: sibRanked});
      const shr = await hop(base, {types: ['SHARES_ENTITIES_WITH'], targetType: 'Event', derived: true});
      if (shr.edges.length) S('Shared-entity neighbours (layer 2, derived)', `${shr.targets.size} event(s) share ≥2 people/organisations.`, {edges: shr.edges.slice(0, 120), focus: [...shr.targets.keys()].slice(0, 80)});
      await need([...hc.targets.keys()]);
      result.events = [...base, ...sibRanked];
      result.answer = `Found ${base.length} matching event(s) belonging to ${hc.targets.size} cluster(s) (sizes ${[...hc.targets.keys()].map(c => node(c).props.size).join(', ')}). Shown: matches first, then sibling reports of the same story.`;
      return finish(steps, result, why);
    }
    if (intent === 'timeline') {
      const ordered = rankEvents(cand.keys(), cand, 'oldest').slice(0, Math.max(f.limit, 10));
      const ht = await store.edgesAmong(ordered, 'HAPPENED_BEFORE');
      const hk = ht.map(e => { const k = edgeKey(e); meta.set(k, e); return k; });
      S('Order events by time (layer 3)', `Sorted ${ordered.length} event(s) by publication time; ${ht.length} HAPPENED_BEFORE link(s) among them.`, {nodes: ordered, edges: hk, focus: ordered});
      result.events = ordered;
      result.answer = `Chronological view of ${ordered.length} event(s), oldest first.`;
      return finish(steps, result, why);
    }

    result.events = rankEvents(cand.keys(), cand, f.sort).slice(0, f.limit);
    S(`Rank & select top ${result.events.length}`, `Sort by ${f.sort === 'rank' ? 'anchors hit → risk score → recency' : f.sort}.`, {nodes: result.events, focus: result.events});
    result.answer = `${cand.size} event(s) matched${cand.size > result.events.length ? `; showing top ${result.events.length}` : ''}.`;
    return finish(steps, result, why);
  }

  // JSON-safe output (adds per-step layers; converts `why` Map)
  async function planJSON(q) {
    const {steps, result} = await plan(q);
    steps.forEach(s => { s.layers = layersOf(s.edges); });
    return {steps, result: {...result, why: Object.fromEntries(result.why || [])}};
  }
  return {plan, planJSON, layersOf: () => []};
}
