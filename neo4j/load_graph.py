"""Load web/src/data/argus_graph.json into Neo4j (idempotent: uses MERGE on node id)."""
import json, os, pathlib, time, collections
from neo4j import GraphDatabase

URI = os.environ.get("NEO4J_URI", "bolt://neo4j:7687")
AUTH = (os.environ.get("NEO4J_USER", "neo4j"), os.environ["NEO4J_PASSWORD"])
SRC = pathlib.Path(os.environ.get("GRAPH_JSON", "/data/argus_graph.json"))
BATCH = 500


def flat(d):
    return {k: v for k, v in (d or {}).items() if isinstance(v, (str, int, float, bool))}


def chunks(xs):
    for i in range(0, len(xs), BATCH):
        yield xs[i:i + BATCH]


g = json.loads(SRC.read_text(encoding="utf8"))
driver = None
for _ in range(30):
    try:
        driver = GraphDatabase.driver(URI, auth=AUTH)
        driver.verify_connectivity()
        break
    except Exception as e:
        print("waiting for neo4j...", e)
        time.sleep(3)
assert driver, "neo4j not reachable"

by_type = collections.defaultdict(list)
for n in g["nodes"]:
    by_type[n["type"]].append({"id": n["id"], "label": n["label"], "props": flat(n["props"])})
nodes_by_id = {n["id"]: n["type"] for n in g["nodes"]}

grouped = collections.defaultdict(list)   # (rel, derived, src label, dst label) -> rows
for e in g["edges"]:
    grouped[(e["type"], e["derived"], nodes_by_id[e["s"]], nodes_by_id[e["t"]])].append(
        {"s": e["s"], "t": e["t"], "layers": e["layers"], "props": flat(e["props"])})

with driver.session() as s:
    for typ, rows in by_type.items():
        s.run(f"CREATE CONSTRAINT {typ.lower()}_id IF NOT EXISTS FOR (n:`{typ}`) REQUIRE n.id IS UNIQUE")
        for c in chunks(rows):
            s.run(f"UNWIND $rows AS r MERGE (n:`{typ}` {{id: r.id}}) SET n.label = r.label, n += r.props", rows=c)
    for (rel, derived, st, tt), rows in grouped.items():
        for c in chunks(rows):
            s.run(f"UNWIND $rows AS r MATCH (a:`{st}` {{id: r.s}}), (b:`{tt}` {{id: r.t}}) "
                  f"MERGE (a)-[x:`{rel}`]->(b) SET x.layers = r.layers, x.derived = $d, x += r.props",
                  rows=c, d=derived)
    nodes = s.run("MATCH (n) RETURN count(n) AS c").single()["c"]
    rels = s.run("MATCH ()-[r]->() RETURN count(r) AS c").single()["c"]
    print(f"{nodes} nodes, {rels} relationships loaded")
driver.close()
