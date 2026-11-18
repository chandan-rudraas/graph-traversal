# ARGUS Knowledge Graph Ontology — 12 Graph Structures

All 12 structures are logical graph layers that can coexist in a single Neo4j database. They share core nodes such as `Event`, `Entity`, `Location`, `Source`, and `Topic`.

## 1. Event–Entity Knowledge Graph

```cypher
(Event)-[:INVOLVES]->(Person)
(Event)-[:INVOLVES]->(Organization)
(Event)-[:INVOLVES]->(Group)
(Event)-[:INVOLVES]->(Asset)

(Event)-[:TARGETS]->(Person)
(Event)-[:TARGETS]->(Organization)
(Event)-[:TARGETS]->(Infrastructure)

(Event)-[:OCCURRED_AT]->(Location)
(Location)-[:LOCATED_IN]->(Location)
(Location)-[:PART_OF]->(Location)

(Person)-[:MEMBER_OF]->(Organization)
(Organization)-[:AFFILIATED_WITH]->(Organization)
(Organization)-[:OPERATES_IN]->(Location)
(Organization)-[:OWNS]->(Asset)

(Event)-[:USES]->(Weapon)
(Event)-[:REPORTED_BY]->(Source)
(Event)-[:BELONGS_TO]->(EventCluster)
(Event)-[:DEVELOPMENT_OF]->(Incident)
(Event)-[:ABOUT]->(Topic)
```

## 2. Event Similarity & Deduplication Graph

```cypher
(Event)-[:SAME_EVENT_AS]->(Event)
(Event)-[:NEAR_DUPLICATE_OF]->(Event)
(Event)-[:SEMANTICALLY_SIMILAR_TO]->(Event)
(Event)-[:SHARES_ENTITIES_WITH]->(Event)
(Event)-[:SHARES_KEYPHRASES_WITH]->(Event)

(Event)-[:BELONGS_TO]->(EventCluster)
(EventCluster)-[:CONTAINS]->(Event)
(EventCluster)-[:REPRESENTS]->(Event)

(Event)-[:REPORTED_BY]->(Source)
(Article)-[:DERIVED_FROM]->(Article)
```

## 3. Temporal Event Graph

```cypher
(Event)-[:HAPPENED_BEFORE]->(Event)
(Event)-[:HAPPENED_AFTER]->(Event)
(Event)-[:FOLLOW_UP_TO]->(Event)
(Event)-[:CONTINUES]->(Event)
(Event)-[:TRIGGERED]->(Event)
(Event)-[:ESCALATED_INTO]->(Event)
(Event)-[:DE_ESCALATED_INTO]->(Event)

(Event)-[:OCCURRED_DURING]->(TimeBucket)
(Event)-[:PART_OF_TIMELINE]->(Timeline)
(Event)-[:DEVELOPMENT_OF]->(Incident)

(Incident)-[:STARTED_AT]->(Event)
(Incident)-[:ENDED_AT]->(Event)
(Incident)-[:PRECEDES]->(Incident)
```

## 4. Geospatial Event Graph

```cypher
(Event)-[:OCCURRED_AT]->(Location)

(Location)-[:LOCATED_IN]->(Location)
(Location)-[:PART_OF]->(Location)
(Location)-[:NEAR]->(Location)
(Location)-[:ADJACENT_TO]->(Location)

(Event)-[:WITHIN_RADIUS]->(GeographicArea)
(GeographicArea)-[:BORDERS]->(GeographicArea)

(Event)-[:CROSSES]->(Border)
(Event)-[:AFFECTS_AREA]->(GeographicArea)

(Organization)-[:OPERATES_IN]->(Location)
(Person)-[:ACTIVE_IN]->(Location)

(Location)-[:HAS_COORDINATES]->(GeoPoint)
```

## 5. Entity Co-occurrence & Network Graph

```cypher
(Person)-[:CO_OCCURS_WITH]->(Person)
(Person)-[:CO_OCCURS_WITH]->(Organization)
(Organization)-[:CO_OCCURS_WITH]->(Organization)
(Organization)-[:CO_OCCURS_WITH]->(Location)

(Person)-[:ASSOCIATED_WITH]->(Person)
(Person)-[:ASSOCIATED_WITH]->(Organization)
(Organization)-[:ASSOCIATED_WITH]->(Organization)

(Entity)-[:CONNECTED_THROUGH]->(Event)
(Entity)-[:SHARES_EVENTS_WITH]->(Entity)
(Entity)-[:SHARES_LOCATION_WITH]->(Entity)

(Person)-[:MEMBER_OF]->(Group)
(Organization)-[:AFFILIATED_WITH]->(Group)
(Organization)-[:OPERATES_IN]->(Location)
(Event)-[:INVOLVES]->(Entity)
```

## 6. Topic & Semantic Graph

```cypher
(Event)-[:ABOUT]->(Topic)
(Event)-[:HAS_TOPIC]->(Topic)

(Topic)-[:HAS_SUBTOPIC]->(Subtopic)
(Subtopic)-[:SUBTOPIC_OF]->(Topic)

(Topic)-[:RELATED_TO]->(Topic)
(Topic)-[:ASSOCIATED_CONCEPT]->(Concept)

(Event)-[:HAS_KEYWORD]->(Keyword)
(Event)-[:HAS_KEYPHRASE]->(Keyphrase)
(Event)-[:CONTAINS_CONCEPT]->(Concept)

(Event)-[:SEMANTICALLY_SIMILAR_TO]->(Event)
(Concept)-[:SIMILAR_TO]->(Concept)

(Event)-[:BELONGS_TO]->(SemanticCluster)
(SemanticCluster)-[:REPRESENTS]->(Concept)

(Event)-[:MENTIONS]->(Entity)
(Concept)-[:EXPRESSED_BY]->(Keyphrase)
```

## 7. News Source & Provenance Graph

```cypher
(Source)-[:PUBLISHED]->(Article)
(Article)-[:REPORTS]->(Event)
(Event)-[:REPORTED_BY]->(Source)

(Article)-[:SYNDICATED_FROM]->(Article)
(Article)-[:DERIVED_FROM]->(Article)
(Article)-[:CITES]->(Article)

(Source)-[:COVERS]->(Topic)
(Source)-[:OPERATES_IN]->(Country)
(Source)-[:OWNED_BY]->(Publisher)

(Article)-[:WRITTEN_BY]->(Journalist)
(Source)-[:BELONGS_TO_DOMAIN]->(SourceDomain)

(Source)-[:FIRST_REPORTED]->(Event)

(Article)-[:CORROBORATES]->(Article)
(Article)-[:CONTRADICTS]->(Article)
```

## 8. Risk, Impact & Priority Graph

```cypher
(Event)-[:HAS_RISK_LEVEL]->(RiskLevel)
(Event)-[:HAS_IMPACT_LEVEL]->(ImpactLevel)
(Event)-[:HAS_URGENCY_LEVEL]->(UrgencyLevel)

(Event)-[:POSES_THREAT_TO]->(Target)
(ThreatActor)-[:THREATENS]->(Target)

(Event)-[:ASSOCIATED_WITH_THREAT]->(Threat)
(Event)-[:ESCALATES_RISK_OF]->(Event)

(Event)-[:INCREASES_THREAT_TO]->(Location)
(Event)-[:AFFECTS]->(Organization)

(Event)-[:HAS_RISK_CATEGORY]->(RiskCategory)
(Threat)-[:OCCURS_IN]->(Region)

(Event)-[:ASSESSED_BY]->(RiskLevel)
```

## 9. Claims & Evidence Graph

```cypher
(Event)-[:HAS_CLAIM]->(Claim)
(Article)-[:ASSERTS]->(Claim)

(Claim)-[:ABOUT]->(Entity)
(Claim)-[:SUPPORTED_BY]->(Evidence)
(Claim)-[:CONTRADICTED_BY]->(Evidence)

(Event)-[:EVIDENCED_BY]->(Evidence)
(Claim)-[:REPORTED_BY]->(Source)

(Evidence)-[:DERIVED_FROM]->(Article)

(Claim)-[:CORROBORATES]->(Claim)
(Claim)-[:CONTRADICTS]->(Claim)

(Evidence)-[:REFUTES]->(Claim)
(Claim)-[:VERIFIED_BY]->(Evidence)

(Claim)-[:SUPERSEDES]->(Claim)
(Claim)-[:RELATED_TO]->(Claim)
```

## 10. Incident Evolution Graph

```cypher
(Incident)-[:CONTAINS_EVENT]->(Event)
(Event)-[:DEVELOPMENT_OF]->(Incident)

(Event)-[:FOLLOW_UP_TO]->(Event)
(Incident)-[:RELATED_INCIDENT]->(Incident)

(Incident)-[:ESCALATION_OF]->(Incident)
(Incident)-[:DE_ESCALATION_OF]->(Incident)
(Incident)-[:CONTINUATION_OF]->(Incident)

(Incident)-[:TRIGGERED_BY]->(Event)
(Incident)-[:INVOLVES]->(Entity)
(Incident)-[:OCCURS_IN]->(Location)
(Incident)-[:ABOUT]->(Topic)

(Event)-[:PART_OF_OPERATION]->(Operation)
(Event)-[:CONTRIBUTES_TO]->(Incident)

(Incident)-[:PRECEDES]->(Incident)
```

## 11. Community & Network Analytics Graph

```cypher
(Entity)-[:BELONGS_TO_COMMUNITY]->(Community)
(Event)-[:BELONGS_TO_COMMUNITY]->(Community)

(Entity)-[:MEMBER_OF_CLUSTER]->(EntityCluster)
(Event)-[:MEMBER_OF_CLUSTER]->(EventCluster)

(Entity)-[:CONNECTED_TO]->(Entity)
(Entity)-[:BRIDGES_COMMUNITIES]->(Community)

(Entity)-[:LINKS_EVENTS]->(Event)
(Event)-[:SHARES_COMMUNITY_WITH]->(Event)

(Community)-[:RELATED_COMMUNITY]->(Community)

(Entity)-[:INFLUENCES]->(Entity)
(Entity)-[:CENTRAL_TO]->(Community)
```

## 12. Forecast & Emerging Trend Graph

```cypher
(Event)-[:CONTRIBUTES_TO]->(Trend)
(Trend)-[:ABOUT]->(Topic)

(Trend)-[:OCCURS_IN]->(Location)
(Trend)-[:OBSERVED_DURING]->(TimeBucket)

(Trend)-[:HAS_FORECAST]->(Forecast)
(Trend)-[:GENERATES_SIGNAL]->(Signal)

(Trend)-[:RELATED_TO]->(Trend)
(Trend)-[:PRECEDES]->(Trend)

(Trend)-[:INCREASES_IN]->(Location)
(Trend)-[:ASSOCIATED_WITH]->(Keyword)

(Forecast)-[:SUPPORTED_BY]->(Event)
(Signal)-[:MEASURED_IN]->(TimeBucket)

(Event)-[:BELONGS_TO]->(Trend)
```

---

## Recommended Initial Implementation Priority

For ARGUS, start with these graph layers:

1. Event–Entity Knowledge Graph
2. Event Similarity & Deduplication Graph
3. Temporal Event Graph
4. Geospatial Event Graph
5. News Source & Provenance Graph
6. Incident Evolution Graph
7. Claims & Evidence Graph

Add the remaining layers incrementally as analytics and retrieval requirements mature.

## Design Notes

- All 12 layers can be implemented in one Neo4j database.
- Reuse shared nodes instead of creating duplicates for each graph layer.
- Keep numerical scores (similarity, risk, confidence, centrality) as properties when possible.
- Avoid materializing every possible proximity, similarity, or temporal edge; calculate some dynamically or through indexed retrieval.
- Preserve relationship provenance, confidence, source, extraction method, and timestamps where applicable.
- Treat co-occurrence as evidence of association, not proof of affiliation.
- Distinguish:
  - **Article:** a specific published item.
  - **Event:** a real-world occurrence.
  - **Incident:** a larger ongoing situation containing multiple events.
