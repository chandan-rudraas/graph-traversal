"""
Build the ARGUS multi-layer knowledge graph from argus.events.json
following ARGUS_12_Graph_Structures.md, then bake it into argus_graph.html.

Usage:  python build_graph.py
Output: web/src/data/argus_graph.json  (nodes / edges / layers; consumed by the Vite app)
"""
import json, itertools, collections, pathlib

HERE = pathlib.Path(__file__).parent
SRC = HERE / "argus.events.json"
OUT = HERE / "web" / "src" / "data" / "argus_graph.json"

# ontology type per NER tag
ENT_TYPE = {"PER": "Person", "ORG": "Organization", "LOC": "Location"}

# domain codes -> readable names (inferred from sample headlines; "assumed")
DOMAINS = {
    "M": "Military & Security", "P": "Politics & Diplomacy", "E": "Economy & Business",
    "T": "Technology & Science", "L": "Law & Crime", "S": "Society", "H": "Humanitarian & Health",
    "I": "Infrastructure & Incidents", "N": "Nature & Environment", "C": "Cyber", "misc": "Miscellaneous",
}

# which of the 12 layers each relationship type belongs to
EDGE_LAYERS = {
    "MENTIONS": [1, 5, 6], "OCCURRED_AT": [1, 4], "LOCATED_IN": [1, 4], "REPORTED_BY": [1, 2, 7],
    "BELONGS_TO": [1, 2], "ABOUT": [1, 6], "HAS_KEYPHRASE": [6], "NEAR_DUPLICATE_OF": [2],
    "SHARES_ENTITIES_WITH": [2], "HAPPENED_BEFORE": [3, 10], "OCCURRED_DURING": [3],
    "CO_OCCURS_WITH": [5], "BELONGS_TO_COMMUNITY": [11], "HAS_RISK_LEVEL": [8],
    "HAS_URGENCY_LEVEL": [8], "HAS_IMPACT_LEVEL": [8], "CONTRIBUTES_TO": [12], "COVERS": [7],
}
LAYER_NAMES = {
    1: "Event-Entity KG", 2: "Similarity & Dedup", 3: "Temporal", 4: "Geospatial",
    5: "Entity Co-occurrence", 6: "Topic & Semantic", 7: "Source & Provenance", 8: "Risk & Impact",
    9: "Claims & Evidence", 10: "Incident Evolution", 11: "Community", 12: "Forecast & Trend",
}


def num(v):
    if isinstance(v, dict):
        v = v.get("$numberLong")
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def main():
    events = json.loads(SRC.read_text(encoding="utf8"))
    nodes, edges = {}, []
    eseen = set()

    def node(nid, typ, label, **props):
        if nid not in nodes:
            nodes[nid] = {"id": nid, "type": typ, "label": label, "props": props}
        return nid

    def edge(s, t, typ, derived=False, **props):
        key = (s, t, typ)
        if key in eseen:
            return
        eseen.add(key)
        edges.append({"s": s, "t": t, "type": typ, "derived": derived,
                      "layers": EDGE_LAYERS.get(typ, []), "props": props})

    ent_events = collections.defaultdict(set)      # entity node id -> event ids
    ev_ents = {}                                    # event id -> non-location entity ids
    cluster_members = collections.defaultdict(list)

    for e in events:
        eid = "event:" + e["event_id"]
        ts = num(e.get("published_at_ms")) or num(e.get("source_ts")) or num(e.get("ingested_at"))
        risk, urg, imp = e.get("risk") or {}, e.get("urgency") or {}, e.get("impact") or {}
        node(eid, "Event", e["title"], title=e["title"], url=e.get("url"), time=ts, domain=e.get("domain"),
             source=e.get("source_name"), risk=risk.get("score"), risk_level=risk.get("level"),
             urgency=urg.get("score"), impact=imp.get("score"),
             sentiment=(e.get("sentiment") or {}).get("label"), emotion=(e.get("emotion") or {}).get("primary"),
             lang=e.get("lang"), country=(e.get("geo") or {}).get("country_iso"))

        # --- layer 1/5/6: entities (taken from the dataset's own per-event knowledge_graph)
        kg = e.get("knowledge_graph") or {}
        kgn = {n["id"]: n for n in kg.get("nodes", [])}
        kg_loc_event = None
        for ed in kg.get("edges", []):
            if ed["type"] == "MENTIONS":
                n = kgn.get(ed["target"])
                if not n:
                    continue
                typ = ENT_TYPE.get(n["type"], n["type"])
                node(n["id"], typ, n["label"], ner=n["type"], kb_id=n.get("kb_id"))
                edge(eid, n["id"], "MENTIONS")
                ent_events[n["id"]].add(eid)
                if n["type"] != "LOC":
                    ev_ents.setdefault(eid, set()).add(n["id"])
            elif ed["type"] == "LOCATED_IN":     # event -> geo-resolved place
                n = kgn.get(ed["target"])
                if n:
                    cc = n["id"].split(":")[1]
                    node(n["id"], "Location", n["label"], country=cc)
                    edge(eid, n["id"], "OCCURRED_AT")
                    cnode = node("country:" + cc, "Country", cc)
                    edge(n["id"], cnode, "LOCATED_IN")
                    kg_loc_event = n["id"]
        ev_ents.setdefault(eid, set())

        # --- layer 7: source
        sid = node("source:" + e["source_name"], "Source", e["source_name"],
                   source_type=e.get("source_type"), domain=(e.get("credibility") or {}).get("domain"))
        edge(eid, sid, "REPORTED_BY")

        # --- layer 2: cluster / dedup
        dd = e.get("dedup_clustering") or {}
        if dd.get("cluster_id"):
            cid = node("cluster:" + dd["cluster_id"], "EventCluster", dd["cluster_id"][:10],
                       size=dd.get("cluster_size"))
            edge(eid, cid, "BELONGS_TO", similarity=dd.get("assign_similarity"))
            cluster_members[cid].append((ts or 0, eid))
        if dd.get("dup_of"):
            edge(eid, "event:" + dd["dup_of"], "NEAR_DUPLICATE_OF", score=dd.get("near_dup_score"))

        # --- layer 6: topic (domain) + keyphrases
        dom = e.get("domain") or "misc"
        tid = node("topic:" + dom, "Topic", f"{dom} · {DOMAINS.get(dom, dom)}", code=dom)
        edge(eid, tid, "ABOUT", confidence=(e.get("enrichment_local") or {}).get("domain_confidence"))
        for kp in sorted(e.get("keyphrases") or [], key=lambda k: -k["score"])[:4]:
            kid = node("kw:" + kp["text"].lower(), "Keyphrase", kp["text"])
            edge(eid, kid, "HAS_KEYPHRASE", score=kp["score"])

        # --- layer 11: communities
        for c in e.get("communities") or []:
            edge(eid, node(f"community:{c}", "Community", f"community {c}"), "BELONGS_TO_COMMUNITY")

        # --- layer 8: risk / urgency / impact levels
        for key, rel, d_ in (("risk", "HAS_RISK_LEVEL", risk), ("urgency", "HAS_URGENCY_LEVEL", urg),
                             ("impact", "HAS_IMPACT_LEVEL", imp)):
            if d_.get("level"):
                lid = node(f"{key}:{d_['level']}", key.capitalize() + "Level", f"{key} {d_['level']}")
                edge(eid, lid, rel, score=d_.get("score"))

        # --- layer 3: hour bucket
        if ts:
            b = ts // 3_600_000
            edge(eid, node(f"time:{b}", "TimeBucket", "hour " + str(b % 100000), bucket=b), "OCCURRED_DURING")

        # --- layer 12: trend (forecast per domain)
        fs = e.get("forecast_signal") or {}
        if fs.get("key"):
            trid = node("trend:" + fs["key"], "Trend", f"trend {fs['key']}", direction=fs.get("direction"),
                        forecast=fs.get("next_bucket_forecast"))
            edge(eid, trid, "CONTRIBUTES_TO")
            edge(trid, tid, "ABOUT")

    # --- layer 3/10: chain events inside each cluster by time
    for cid, mem in cluster_members.items():
        mem.sort()
        for (_, a), (_, b) in zip(mem, mem[1:]):
            edge(a, b, "HAPPENED_BEFORE", derived=True)

    # --- layer 5: entity co-occurrence (derived)
    pair = collections.Counter()
    for eid, ents in ev_ents.items():
        for a, b in itertools.combinations(sorted(ents), 2):
            pair[(a, b)] += 1
    for (a, b), w in pair.items():
        edge(a, b, "CO_OCCURS_WITH", derived=True, weight=w)

    # --- layer 2: events sharing >=2 non-location entities (derived)
    shared = collections.Counter()
    for ent, evs in ent_events.items():
        if nodes[ent]["type"] == "Location" or len(evs) > 25:
            continue
        for a, b in itertools.combinations(sorted(evs), 2):
            shared[(a, b)] += 1
    for (a, b), w in shared.items():
        if w >= 2:
            edge(a, b, "SHARES_ENTITIES_WITH", derived=True, shared=w)

    # --- layer 7: source covers topic (derived)
    cov = collections.Counter()
    for ed in list(edges):
        pass
    ev_src = {ed["s"]: ed["t"] for ed in edges if ed["type"] == "REPORTED_BY"}
    for ed in edges:
        if ed["type"] == "ABOUT" and ed["s"] in ev_src:
            cov[(ev_src[ed["s"]], ed["t"])] += 1
    for (s, t), w in cov.items():
        edge(s, t, "COVERS", derived=True, count=w)

    dangling = [e for e in edges if e["s"] not in nodes or e["t"] not in nodes]
    edges[:] = [e for e in edges if e["s"] in nodes and e["t"] in nodes]
    if dangling:
        print(f"dropped {len(dangling)} edge(s) pointing outside the 100-event sample "
              f"({collections.Counter(e['type'] for e in dangling)})")

    graph = {"layers": LAYER_NAMES, "nodes": list(nodes.values()), "edges": edges}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(graph, ensure_ascii=False), encoding="utf8")

    tc = collections.Counter(n["type"] for n in nodes.values())
    ec = collections.Counter(e["type"] for e in edges)
    print("nodes:", len(nodes), dict(tc))
    print("edges:", len(edges), dict(ec))


if __name__ == "__main__":
    main()
