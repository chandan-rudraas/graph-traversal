import './style.css';
import {Network, DataSet} from 'vis-network/standalone';
import G from './data/argus_graph.json';
import {createEngine, createMemoryStore, edgeKey} from './engine.js';
const vis = {Network, DataSet};
/* ------------------------------------------------------------------ graph index */
const N = new Map(G.nodes.map(n => [n.id, n]));
const E = G.edges;
const adj = new Map(G.nodes.map(n => [n.id, []]));
E.forEach((e, i) => { adj.get(e.s).push({e: i, o: e.t, dir: 'out'}); adj.get(e.t).push({e: i, o: e.s, dir: 'in'}); });
const deg = id => adj.get(id).length;
const COLORS = {Event:'#4f8cff',Person:'#f59e0b',Organization:'#34d399',Location:'#f472b6',Country:'#c084fc',Source:'#22d3ee',
  EventCluster:'#94a3b8',Topic:'#facc15',Keyphrase:'#64748b',Community:'#fb7185',RiskLevel:'#ef4444',UrgencyLevel:'#f97316',
  ImpactLevel:'#e11d48',TimeBucket:'#818cf8',Trend:'#2dd4bf'};
const HIDDEN_TYPES = new Set(['Keyphrase','Community','TimeBucket','RiskLevel','UrgencyLevel','ImpactLevel','Trend']);
const LAYERS = G.layers;
const fmtTime = t => t ? new Date(t).toISOString().replace('T',' ').slice(0,16) + 'Z' : 'n/a';
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const short = (s, n=70) => s.length > n ? s.slice(0, n-1) + '…' : s;

/* ------------------------------------------------------------------ query backends */
const ev = id => N.get(id).props;
const engine = createEngine(createMemoryStore(G));
const edgeIdx = new Map(E.map((e, i) => [edgeKey(e), i]));
async function runQuery(q) {
  let out;
  const t0 = performance.now();
  if ($('backend').value === 'api') {
    const r = await fetch('/api/query', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({q})});
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    out = await r.json();
    out.result.why = new Map(Object.entries(out.result.why || {}));
  } else {
    out = await engine.planJSON(q);
    out.result.why = new Map(Object.entries(out.result.why || {}));
  }
  out.steps.forEach(s => { s.edges = s.edges.map(k => edgeIdx.get(k)).filter(i => i !== undefined); });
  out.timing = {...(out.timing || {}), totalMs: performance.now() - t0, backend: $('backend').value};
  return out;
}

/* ------------------------------------------------------------------ visualisation */
const visNodes = new vis.DataSet(), visEdges = new vis.DataSet();
const typeOn = {}; Object.keys(COLORS).forEach(t => typeOn[t] = !HIDDEN_TYPES.has(t));
const layerOn = {}; Object.keys(LAYERS).forEach(l => layerOn[l] = true);
layerOn[5] = false;       // dense derived co-occurrence layer off by default
let forced = {nodes: new Set(), edges: new Set()};

const baseSize = n => n.type === 'Event' ? 7 + (n.props.risk || 0) / 14 : Math.min(18, 5 + Math.sqrt(deg(n.id)) * 1.6);
const showLabelIdle = n => ['Source', 'Topic', 'Country'].includes(n.type) || (['Person', 'Organization', 'Location'].includes(n.type) && deg(n.id) >= 4);
G.nodes.forEach(n => visNodes.add({id: n.id, label: showLabelIdle(n) ? short(n.label, 24) : '', color: {background: COLORS[n.type] || '#888', border: COLORS[n.type] || '#888'},
  size: baseSize(n), shape: n.type === 'Event' ? 'dot' : n.type === 'Source' || n.type === 'Topic' ? 'diamond' : n.type === 'EventCluster' ? 'square' : 'dot',
  font: {color: '#c9d4e0', size: 11, strokeWidth: 3, strokeColor: '#0e1116'}, title: `${n.type}: ${n.label}`, hidden: !typeOn[n.type]}));
E.forEach((e, i) => visEdges.add({id: i, from: e.s, to: e.t, arrows: {to: {enabled: true, scaleFactor: .35}}, color: {color: '#3a4656', opacity: .45}, width: .6,
  title: e.type, smooth: false, hidden: e.derived && !layerOn[5] ? true : !e.layers.some(l => layerOn[l])}));

const net = new vis.Network(document.getElementById('net'), {nodes: visNodes, edges: visEdges}, {
  physics: {solver: 'forceAtlas2Based', forceAtlas2Based: {gravitationalConstant: -38, springLength: 70, springConstant: .06, damping: .6}, stabilization: {iterations: 250}},
  interaction: {hover: true, tooltipDelay: 120, hideEdgesOnDrag: true}, nodes: {borderWidth: 1}});
net.once('stabilizationIterationsDone', () => { net.setOptions({physics: false}); net.fit({animation: false}); });

function isNodeVisible(id) { return forced.nodes.has(id) || typeOn[N.get(id).type]; }
function isEdgeVisible(i) { const e = E[i]; if (forced.edges.has(i)) return true; if (!(e.derived && e.type === 'CO_OCCURS_WITH' ? layerOn[5] : e.layers.some(l => layerOn[l]))) return false; return isNodeVisible(e.s) && isNodeVisible(e.t); }

function paint(mode) {   // mode: null (idle) or {done:Set,cur:Set,curE:Set,doneE:Set,focus:Set}
  const nu = [], eu = [];
  G.nodes.forEach(n => {
    const id = n.id, c = COLORS[n.type] || '#888';
    let o = {id, hidden: !isNodeVisible(id), opacity: 1, size: baseSize(n), label: showLabelIdle(n) ? short(n.label, 24) : '', borderWidth: 1,
      color: {background: c, border: c}};
    if (mode) {
      if (mode.cur.has(id)) { o.size = baseSize(n) + 5; o.borderWidth = 3; o.color = {background: c, border: '#ff9f1c'}; o.label = short(n.label, 34); }
      else if (mode.done.has(id)) { o.label = short(n.label, 24); }
      else { o.opacity = .09; o.label = ''; }
      if (mode.focus.has(id)) { o.size = baseSize(n) + 9; o.borderWidth = 4; o.color = {background: c, border: '#ffffff'}; o.opacity = 1; o.label = short(n.label, 40); }
    }
    nu.push(o);
  });
  E.forEach((e, i) => {
    let o = {id: i, hidden: !isEdgeVisible(i), width: .6, color: {color: '#3a4656', opacity: .45}, label: undefined};
    if (mode) {
      if (mode.curE.has(i)) { o.width = 3; o.color = {color: '#ff9f1c', opacity: 1}; o.label = e.type; o.font = {size: 9, color: '#ffd28a', strokeWidth: 3, strokeColor: '#0e1116', align: 'middle'}; }
      else if (mode.doneE.has(i)) { o.width = 1.8; o.color = {color: '#4f8cff', opacity: .85}; }
      else o.color = {color: '#3a4656', opacity: .04};
    }
    eu.push(o);
  });
  visNodes.update(nu); visEdges.update(eu);
}

/* ------------------------------------------------------------------ UI state */
let cur = {steps: [], result: null}, idx = -1, timer = null;
const $ = id => document.getElementById(id);

function stepSets(i) {
  const done = new Set(), doneE = new Set(), cs = new Set(), ce = new Set();
  for (let k = 0; k <= i; k++) {
    const s = cur.steps[k], tgtN = new Set(s.nodes), tgtE = new Set(s.edges);
    s.edges.forEach(ei => { tgtN.add(E[ei].s); tgtN.add(E[ei].t); });
    (s.focus || []).forEach(x => tgtN.add(x));
    if (k === i) { tgtN.forEach(x => cs.add(x)); tgtE.forEach(x => ce.add(x)); }
    else { tgtN.forEach(x => done.add(x)); tgtE.forEach(x => doneE.add(x)); }
  }
  return {done, doneE, cur: cs, curE: ce, focus: new Set(i >= 0 ? (cur.steps[i].focus || []).slice(0, 60) : [])};
}

function showStep(i) {
  idx = Math.max(-1, Math.min(cur.steps.length - 1, i));
  const m = idx >= 0 ? stepSets(idx) : null;
  forced = {nodes: new Set(), edges: new Set()};
  if (m) { [m.done, m.cur].forEach(s => s.forEach(x => forced.nodes.add(x))); [m.doneE, m.curE].forEach(s => s.forEach(x => forced.edges.add(x))); }
  paint(m);
  document.querySelectorAll('.step').forEach((el, k) => { el.classList.toggle('cur', k === idx); el.classList.toggle('done', k < idx); });
  const act = document.querySelector('.step.cur'); if (act) act.scrollIntoView({block: 'nearest', behavior: 'smooth'});
  if (m) {
    const ids = [...m.cur].filter(x => visNodes.get(x)); if (ids.length) net.fit({nodes: ids.slice(0, 120), animation: {duration: 600, easingFunction: 'easeInOutQuad'}});
    $('banner').style.display = 'block'; $('banner').textContent = `Step ${idx + 1}/${cur.steps.length}: ${cur.steps[idx].title}`;
  } else $('banner').style.display = 'none';
  $('stepcount').textContent = cur.steps.length ? `(${Math.max(idx + 1, 0)}/${cur.steps.length})` : '';
}

function stop() { if (timer) { clearInterval(timer); timer = null; $('play').textContent = '▶ Play'; } }
function play() {
  if (timer) return stop();
  if (idx >= cur.steps.length - 1) showStep(-1);
  $('play').textContent = '⏸ Pause';
  const tick = () => { if (idx >= cur.steps.length - 1) return stop(); showStep(idx + 1); };
  tick(); timer = setInterval(tick, +$('spd').value);
}
$('spd').oninput = () => { if (timer) { clearInterval(timer); timer = setInterval(() => { if (idx >= cur.steps.length - 1) return stop(); showStep(idx + 1); }, +$('spd').value); } };
$('play').onclick = play; $('next').onclick = () => { stop(); showStep(idx + 1); }; $('prev').onclick = () => { stop(); showStep(idx - 1); };
$('first').onclick = () => { stop(); showStep(-1); net.fit({animation: true}); }; $('last').onclick = () => { stop(); showStep(cur.steps.length - 1); };

const ms = v => v < 10 ? v.toFixed(1) + ' ms' : v < 1000 ? Math.round(v) + ' ms' : (v / 1000).toFixed(2) + ' s';
function showTiming(t) {
  const el = $('timing'); if (!t) { el.innerHTML = ''; return; }
  const parts = [`<b>⏱ ${ms(t.totalMs)}</b> total`];
  if (t.backend === 'api') {
    parts.push(`server ${ms(t.serverMs)}`, `Neo4j ${ms(t.neo4jMs)} over ${t.cypherQueries} Cypher quer${t.cypherQueries === 1 ? 'y' : 'ies'}`,
      `network ${ms(Math.max(0, t.totalMs - t.serverMs))}`);
  } else parts.push('in-browser graph');
  const hist = (window.__qh = (window.__qh || []).concat({b: t.backend, ms: t.totalMs}).slice(-6));
  el.innerHTML = parts.join(' · ') + `<div class="kv" style="margin-top:3px">recent: ${hist.map(h => (h.b === 'api' ? 'Neo4j ' : 'local ') + ms(h.ms)).join(' · ')}</div>`;
}
async function run(q) {
  q = q.trim(); if (!q) return; stop(); $('q').value = q;
  try { cur = await runQuery(q); } catch (err) { $('answer').innerHTML = `<span style="color:#f87171">Query failed (${esc($('backend').selectedOptions[0].text)}): ${esc(err.message)}</span>`; return; }
  const r = cur.result;
  showTiming(cur.timing);
  $('answer').innerHTML = r.answer || '';
  $('steps').innerHTML = cur.steps.map((s, i) => {
    const ls = s.layers || [];
    return `<div class="step" data-i="${i}"><b>${i + 1}. ${esc(s.title)}</b><small>${esc(s.detail)}</small>${ls.length ? '<div>' + ls.map(l => `<span class="lay">L${l} ${LAYERS[l]}</span>`).join('') + '</div>' : ''}</div>`;
  }).join('');
  document.querySelectorAll('.step').forEach(el => el.onclick = () => { stop(); showStep(+el.dataset.i); });
  $('results').innerHTML = (r.events || []).map(id => {
    const p = ev(id), w = r.why && r.why.get(id);
    return `<div class="res" data-id="${esc(id)}"><div class="t">${esc(p.title)}</div><div class="m"><span class="badge ${p.risk_level}">${p.risk_level || '-'} ${p.risk ?? ''}</span>${esc(p.source || '')} · ${fmtTime(p.time)} · domain ${esc(p.domain || '')}${w ? ' · via ' + esc(w.join(', ')) : ''}</div></div>`;
  }).join('') || '<span class="kv">none</span>';
  document.querySelectorAll('.res').forEach(el => el.onclick = () => { selectNode(el.dataset.id); net.focus(el.dataset.id, {scale: 1.4, animation: true}); });
  showStep(-1); net.fit({animation: true});
  setTimeout(play, 500);
}
$('go').onclick = () => run($('q').value);
$('q').addEventListener('keydown', e => { if (e.key === 'Enter') run($('q').value); });

/* node details */
function selectNode(id) {
  const n = N.get(id); if (!n) return;
  const rows = Object.entries(n.props).filter(([k, v]) => v != null && v !== '').map(([k, v]) => `<div><span class="kv">${k}:</span> ${esc(k === 'time' ? fmtTime(v) : v)}</div>`).join('');
  const out = adj.get(id).filter(a => !E[a.e].derived).slice(0, 25).map(a => `<div class="kv">${a.dir === 'out' ? '→' : '←'} ${E[a.e].type} ${esc(short(N.get(a.o).label, 40))}</div>`).join('');
  $('info').style.display = 'block';
  $('info').innerHTML = `<b style="color:${COLORS[n.type]}">${n.type}</b><div style="font-weight:600;margin:3px 0">${esc(n.label)}</div>${rows}<div style="margin-top:6px">degree ${deg(id)}</div>${out}` +
    (n.props.url ? `<div><a href="${esc(n.props.url)}" target="_blank" rel="noopener">open article</a></div>` : '');
}
net.on('click', p => { if (p.nodes.length) selectNode(p.nodes[0]); else $('info').style.display = 'none'; });

/* legend & filters */
$('legend').innerHTML = '<b>Node types</b>' + Object.entries(COLORS).map(([t, c]) => `<div><span class="dot" style="background:${c}"></span>${t}</div>`).join('');
$('filters').innerHTML = '<div><b>Show node types</b> ' + Object.keys(COLORS).map(t => `<label><input type="checkbox" data-t="${t}" ${typeOn[t] ? 'checked' : ''}> ${t}</label>`).join('') + '</div>' +
  '<div><b>Show layers</b> ' + Object.entries(LAYERS).map(([l, nme]) => `<label><input type="checkbox" data-l="${l}" ${layerOn[l] ? 'checked' : ''}> ${l}·${nme}</label>`).join('') + '</div>';
$('filters').onchange = e => { const t = e.target.dataset.t, l = e.target.dataset.l; if (t) typeOn[t] = e.target.checked; if (l) layerOn[l] = e.target.checked; paint(idx >= 0 ? stepSets(idx) : null); };

/* example chips - built from the actual data */
(() => {
  const top = type => G.nodes.filter(n => n.type === type).sort((a, b) => deg(b.id) - deg(a.id));
  const orgs = top('Organization').slice(0, 3), locs = top('Location').filter(n => !n.id.startsWith('LOC:') || true).slice(0, 3), per = top('Person').slice(0, 3), src = top('Source')[0];
  const ex = [];
  if (locs[0]) ex.push(`events in ${locs[0].label}`);
  if (orgs[0] && locs[0]) ex.push(`${orgs[0].label} ${locs[0].label}`);
  ex.push('critical risk events in military and security');
  if (per[0] && orgs[0]) ex.push(`how is ${per[0].label} connected to ${orgs[0].label}`);
  if (orgs[0]) ex.push(`who is associated with ${orgs[0].label}`);
  if (locs[1]) ex.push(`latest events in ${locs[1].label}`);
  if (src) ex.push(`top 5 high risk stories from ${src.label}`);
  if (orgs[1]) ex.push(`similar stories to ${orgs[1].label}`);
  if (orgs[0]) ex.push(`timeline of ${orgs[0].label}`);
  $('chips').innerHTML = ex.map(x => `<span class="chip">${esc(x)}</span>`).join('');
  document.querySelectorAll('.chip').forEach(c => c.onclick = () => run(c.textContent));
})();
