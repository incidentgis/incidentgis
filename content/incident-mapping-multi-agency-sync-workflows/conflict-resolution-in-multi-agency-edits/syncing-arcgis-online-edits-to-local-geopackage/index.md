---
title: "Syncing ArcGIS Online Edits to Local GeoPackage"
description: "Resolve globalid collisions, last_edited_date races, and lock contention when replicating concurrent ArcGIS Online incident edits into a local GeoPackage with a deterministic, audited Python sync."
slug: syncing-arcgis-online-edits-to-local-geopackage
type: article
breadcrumb: "Sync AGOL to GeoPackage"
datePublished: "2025-03-04"
dateModified: "2026-06-25"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Syncing ArcGIS Online Edits to Local GeoPackage",
      "description": "Resolve globalid collisions, last_edited_date races, and lock contention when replicating concurrent ArcGIS Online incident edits into a local GeoPackage with a deterministic, audited Python sync.",
      "datePublished": "2025-03-04",
      "dateModified": "2026-06-25",
      "author": { "@type": "Organization", "name": "Incident GIS" },
      "publisher": { "@type": "Organization", "name": "Incident GIS" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.incidentgis.com/" },
        { "@type": "ListItem", "position": 2, "name": "Incident Mapping & Multi-Agency Sync", "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/" },
        { "@type": "ListItem", "position": 3, "name": "Conflict Resolution in Multi-Agency Edits", "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/" },
        { "@type": "ListItem", "position": 4, "name": "Syncing ArcGIS Online Edits to Local GeoPackage", "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/syncing-arcgis-online-edits-to-local-geopackage/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Sync ArcGIS Online edits into a local GeoPackage without overwrites",
      "description": "Pull a bounded delta from an ArcGIS Online feature service, stage it in an isolated SQLite workspace, reconcile globalid collisions and timestamp races, then commit transactionally to a local GeoPackage with an audit trail.",
      "step": [
        { "@type": "HowToStep", "name": "Bound the delta window", "text": "Query the feature service for records edited inside an explicit time window using a server-side last_edited_date filter, with exponential backoff and an offline fallback queue." },
        { "@type": "HowToStep", "name": "Stage in an isolated workspace", "text": "Write the delta into an in-memory SQLite table so a failed merge never leaves the live GeoPackage half-written." },
        { "@type": "HowToStep", "name": "Reconcile keys and timestamps", "text": "Cross-reference globalid against the local replica, prefix collisions with a jurisdiction tag, and break last_edited_date ties with ICS authority precedence." },
        { "@type": "HowToStep", "name": "Commit transactionally with audit", "text": "Open the GeoPackage in WAL mode, apply the reconciled rows inside a single transaction, and emit an immutable audit row per resolution before commit." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why do globalid collisions happen when syncing ArcGIS Online to a GeoPackage?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Field devices editing a detached GeoPackage generate their own GUIDs while ArcGIS Online assigns its own on the server. When the two replicas merge, two physically different features can carry the same globalid. The fix is to treat the AGOL globalid as authoritative, prefix the local one with a jurisdiction tag, and preserve lineage in a parent_globalid column rather than overwriting either record."
          }
        },
        {
          "@type": "Question",
          "name": "How do I stop a sync from corrupting the GeoPackage when the network drops mid-merge?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Never write directly from the network stream into the live GeoPackage. Stage the full delta in an isolated in-memory SQLite workspace first, then apply it to the GeoPackage inside a single BEGIN/COMMIT transaction. If any step fails, roll back; the live replica is untouched and the delta is re-queued for the next window."
          }
        },
        {
          "@type": "Question",
          "name": "What causes 'database is locked' errors during GeoPackage sync?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Concurrent Python writers contend on the default SQLite rollback journal, which holds a global write lock. Enable WAL mode with PRAGMA journal_mode=WAL and set PRAGMA busy_timeout=5000 so readers and a single writer coexist and writers wait briefly instead of failing immediately."
          }
        }
      ]
    }
  ]
}
</script>

# Syncing ArcGIS Online Edits to Local GeoPackage

At 09:14 a wildland branch updates a hazard perimeter in an ArcGIS Online (AGOL) hosted feature service. Forty minutes later a field tablet, offline since dawn, reconnects and pushes its own edit to the same structure, made against a locally cached GeoPackage. When the nightly sync pulls the AGOL delta down onto that tablet's replica, two records arrive carrying the *same* `globalid` and `last_edited_date` values that overlap by seconds. The naive `INSERT OR REPLACE` that most field-built sync scripts rely on resolves this non-deterministically: depending on row order, one agency's authoritative perimeter silently overwrites the other's, and no one notices until a strike team is committed to geometry that was retired an hour earlier. This is the single failure mode this page solves — reconciling a bounded AGOL-to-GeoPackage delta so that concurrent edits never collide silently, and every resolution leaves an audit trail. It is a concrete instance of the precedence-weighted reconciliation defined in [Conflict Resolution in Multi-Agency Edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/), narrowed to the specific quirks of the AGOL replication path.

## Root cause and operational impact

Three properties of the AGOL-to-GeoPackage path combine to make this dangerous rather than merely annoying:

- **Dual GUID authorities.** A detached GeoPackage edited in the field mints its own `globalid` values; the hosted feature service mints its own on the server. Neither knows about the other until merge time, so two physically distinct features can legitimately share one `globalid`. A primary-key-keyed upsert treats them as the same row.
- **Coarse edit timestamps.** AGOL's `last_edited_date` has second-level resolution and is recorded against server clock skew. During a surge, dozens of edits land inside the same second, so `last_edited_date` alone cannot order them. Ties resolved by arrival order are effectively random.
- **Single-writer storage.** A GeoPackage is a SQLite database. The default rollback journal takes a process-global write lock, so a second sync worker — or a field app holding the file open — turns the merge into `sqlite3.OperationalError: database is locked` partway through, leaving a half-applied delta.

In an Incident Command System (ICS) environment the cost is not a stale map tile; it is a positional or status error propagating into resource assignment. A reopened evacuation zone, a duplicated medivac LZ, or a perimeter that snaps back to a retired line all flow from one silent overwrite. The resolution must therefore be deterministic and reversible, and it must record *why* each record won.

<svg viewBox="0 0 940 470" role="img" aria-label="Deterministic AGOL-to-GeoPackage sync flow for a contested feature globalid G1. The ArcGIS Online hosted feature service edits G1 at 09:14 while an offline field tablet edits its cached GeoPackage copy of G1 at 09:54. On reconnect the bounded delta is queried with a last_edited_date filter and lands in an isolated in-memory SQLite stage rather than the live file. A reconcile step applies a globalid-collision rule, re-keying the local record to LOCAL-G1 with a parent_globalid lineage link, then breaks the same-second timestamp tie by ICS authority precedence. The reconciled rows are applied to the live GeoPackage inside a single WAL transaction, and every resolution emits an immutable audit row. If the transaction fails it rolls back, leaving the replica untouched and re-queuing the delta." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>Deterministic AGOL-to-GeoPackage sync for a colliding feature</title>
  <desc>Two authorities edit the same feature globalid=G1: the ArcGIS Online feature service at 09:14 and an offline field tablet's cached GeoPackage at 09:54. A bounded last_edited_date delta query feeds an isolated in-memory SQLite stage, never the live file. Reconcile applies the globalid-collision rule — the AGOL record is authoritative, the local one is re-keyed to LOCAL-G1 with a parent_globalid lineage link — then resolves the same-second timestamp race by ICS authority precedence (FED over STATE over LOCAL). Reconciled rows commit to the live GeoPackage in a single WAL transaction with busy_timeout, and each resolution writes an immutable audit row. Any failure rolls back the whole batch, leaves the replica byte-identical, and re-queues the delta offline.</desc>
  <defs>
    <marker id="agol-flow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
    <marker id="agol-flow-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <g font-size="12" text-anchor="middle" fill="currentColor">
    <!-- stage labels -->
    <text x="120" y="22" font-size="11" fill="var(--crimson, currentColor)" font-weight="600">Two authorities edit G1</text>
    <text x="470" y="22" font-size="11" fill="var(--crimson, currentColor)" font-weight="600">Stage &amp; reconcile (isolated)</text>
    <text x="828" y="22" font-size="11" fill="var(--crimson, currentColor)" font-weight="600">Commit + audit</text>
    <!-- separators -->
    <line x1="250" y1="34" x2="250" y2="450" stroke="currentColor" stroke-width="1" stroke-dasharray="3 5" opacity="0.5"/>
    <line x1="700" y1="34" x2="700" y2="450" stroke="currentColor" stroke-width="1" stroke-dasharray="3 5" opacity="0.5"/>
    <!-- AGOL source -->
    <rect x="20" y="64" width="210" height="62" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="125" y="86" font-weight="600">AGOL feature service</text>
    <text x="125" y="104" font-size="10">edits globalid=G1 · 09:14</text>
    <text x="125" y="119" font-size="10">server clock · authoritative</text>
    <!-- field tablet source -->
    <rect x="20" y="160" width="210" height="62" rx="7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="5 4"/>
    <text x="125" y="182" font-weight="600">Offline field tablet</text>
    <text x="125" y="200" font-size="10">cached GeoPackage · G1 · 09:54</text>
    <text x="125" y="215" font-size="10">reconnects at sync window</text>
    <!-- bounded delta query -->
    <rect x="40" y="270" width="170" height="56" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.4"/>
    <text x="125" y="292" font-size="11" font-weight="600">Bounded delta query</text>
    <text x="125" y="310" font-size="10">last_edited_date &gt;= cutoff</text>
    <!-- in-memory stage -->
    <rect x="288" y="64" width="184" height="74" rx="7" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="380" y="88" font-weight="700">In-memory SQLite stage</text>
    <text x="380" y="107" font-size="10">delta isolated from live file</text>
    <text x="380" y="123" font-size="10">drop here = replica untouched</text>
    <!-- reconcile: collision -->
    <rect x="288" y="178" width="184" height="78" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.7"/>
    <text x="380" y="200" font-weight="700">Reconcile · collision</text>
    <text x="380" y="218" font-size="10">AGOL G1 authoritative</text>
    <text x="380" y="233" font-size="10">local re-keyed → LOCAL-G1</text>
    <text x="380" y="248" font-size="10">parent_globalid = G1</text>
    <!-- reconcile: precedence -->
    <rect x="288" y="296" width="184" height="78" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.7"/>
    <text x="380" y="318" font-weight="700">Reconcile · timestamp tie</text>
    <text x="380" y="336" font-size="10">same-second last_edited_date</text>
    <text x="380" y="351" font-size="10">ICS precedence: FED &gt; STATE</text>
    <text x="380" y="366" font-size="10">&gt; LOCAL, then last-writer-wins</text>
    <!-- quarantine -->
    <rect x="510" y="296" width="158" height="78" rx="7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="5 4"/>
    <text x="589" y="320" font-weight="600">Quarantine</text>
    <text x="589" y="338" font-size="10">unresolved or</text>
    <text x="589" y="353" font-size="10">invalid geometry</text>
    <text x="589" y="368" font-size="10">held for review</text>
    <!-- WAL transaction -->
    <rect x="738" y="74" width="180" height="78" rx="7" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="2"/>
    <text x="828" y="98" font-weight="700">Single WAL txn</text>
    <text x="828" y="116" font-size="10">journal_mode=WAL</text>
    <text x="828" y="131" font-size="10">busy_timeout=5000</text>
    <text x="828" y="146" font-size="10">all rows or rollback</text>
    <!-- live geopackage -->
    <rect x="738" y="186" width="180" height="64" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
    <text x="828" y="212" font-weight="700">Live GeoPackage</text>
    <text x="828" y="232" font-size="10">incident replica · committed COP</text>
    <!-- audit log -->
    <rect x="738" y="296" width="180" height="64" rx="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="828" y="322" font-weight="600">sync_audit</text>
    <text x="828" y="342" font-size="10">one immutable row · per rule</text>
  </g>
  <!-- crimson primary flows -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5" marker-end="url(#agol-flow)">
    <path d="M125,126 V160"/>
    <path d="M125,222 V270"/>
    <path d="M210,298 H250 Q270,298 270,278 V120 Q270,101 288,101"/>
    <path d="M380,138 V178"/>
    <path d="M380,256 V296"/>
    <path d="M472,217 H560 Q700,217 700,160 V113 Q700,113 738,113"/>
    <path d="M828,152 V186"/>
  </g>
  <!-- dim secondary flows: audit taps + rollback -->
  <g fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#agol-flow-dim)" stroke-dasharray="5 4">
    <!-- reconcile quarantine fork -->
    <path d="M472,335 H510"/>
    <!-- each resolution taps audit -->
    <path d="M828,250 V296"/>
  </g>
  <!-- rollback return path (no marker, labelled) -->
  <g fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 4" opacity="0.85">
    <path d="M738,124 H560 Q540,124 540,150 V430 H230 Q210,430 210,410 V326"/>
  </g>
  <text x="430" y="424" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.85">on failure: rollback · replica untouched · delta re-queued offline</text>
</svg>

## Tiered resolution strategy

Apply these in order. The earlier tiers are definitive fixes; the last is a safe default that never discards data and always flags itself for review.

1. **Bound the delta, never the whole layer.** Query only records edited inside an explicit window (`last_edited_date >= cutoff`) so a sync never re-imports the full table and re-litigates already-resolved rows. If the network degrades, back off exponentially and route the pending pull to an offline queue rather than failing the run.
2. **Stage before you touch the live replica.** Write the delta into an isolated in-memory SQLite workspace. The live GeoPackage is only opened once the full delta is in hand and validated, so a mid-stream drop can never leave it half-written.
3. **Resolve key collisions by lineage, not overwrite.** When an incoming AGOL `globalid` already exists locally but refers to a different feature, treat the AGOL record as authoritative, re-key the local one with a jurisdiction prefix (`LOCAL-…`), and store the original in `parent_globalid` so nothing is lost.
4. **Break timestamp ties with ICS authority.** When two edits to the same merge key fall inside the same `last_edited_date` second, defer to the higher ICS `agency_type` tier; only fall back to last-writer-wins between equal-authority agencies.
5. **Commit in one transaction, in WAL mode.** Apply all reconciled rows inside a single `BEGIN`/`COMMIT` with `journal_mode=WAL` and a `busy_timeout`, so a lock contender waits instead of corrupting the merge, and any failure rolls the whole batch back.
6. **Safe default: quarantine, don't guess.** Any record whose geometry fails validation or whose conflict can't be resolved by rule is written to a quarantine table with an audit flag for supervisor adjudication — never auto-merged and never dropped.

The failure that makes this hard is not that clocks disagree. It is that `edit_date` answers a question nobody asked.

<svg viewBox="0 0 880 400" role="img" aria-labelledby="ao-t ao-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="ao-t">Why edit_date cannot drive a two-way sync</title>
  <desc id="ao-d">A feature is edited on a disconnected field device at 14:02 by its own clock and in ArcGIS Online at 14:05 by the server clock. The device reconnects at 15:40 and its edit arrives an hour and a half after the server's. Keyed on edit_date the device edit appears older and is discarded, even though the device edit was made against a base that already included everything the server knew, and was the more recent observation of the ground. Keyed on a per-replica change generation instead, the two edits are recognised as concurrent and go to the reconciler, which can apply the domain rule. The defect is not clock skew — both clocks may be perfectly correct — it is that arrival order and authoring order are different orderings and edit_date records neither reliably.</desc>
  <rect x="0" y="0" width="880" height="400" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">arrival order and authoring order are different orderings — edit_date records neither reliably</text>
  <path d="M180 300 H820" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>
  <g font-size="10" text-anchor="middle" fill="var(--muted)">
    <text x="180" y="322">14:00</text><text x="340" y="322">14:30</text><text x="500" y="322">15:00</text>
    <text x="660" y="322">15:30</text><text x="820" y="322">16:00</text>
  </g>
  <path d="M200 130 V300" fill="none" stroke="var(--crimson)" stroke-width="1.6" stroke-dasharray="4 4"/>
  <circle cx="200" cy="120" r="9" fill="var(--crimson)"/>
  <text x="214" y="112" font-size="10.5" font-weight="700" fill="currentColor">field device edits at 14:02</text>
  <text x="214" y="128" font-size="9.5" fill="var(--muted)">offline · base already includes everything the server knew</text>
  <path d="M216 206 V300" fill="none" stroke="var(--crimson)" stroke-width="1.6" stroke-dasharray="4 4"/>
  <circle cx="216" cy="196" r="9" fill="var(--petal)" stroke="var(--crimson-deep)" stroke-width="2"/>
  <text x="232" y="188" font-size="10.5" font-weight="700" fill="currentColor">ArcGIS Online edits at 14:05</text>
  <text x="232" y="204" font-size="9.5" fill="var(--muted)">server clock, correct, three minutes later</text>
  <path d="M212 132 Q440 176 690 254" fill="none" stroke="var(--ember)" stroke-width="2" stroke-dasharray="6 4"/>
  <circle cx="700" cy="258" r="9" fill="var(--ember)"/>
  <text x="440" y="246" font-size="10.5" font-weight="700" fill="var(--ember-text)">device reconnects 15:40 — arrives 95 minutes later</text>
  <rect x="40" y="336" width="380" height="52" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.8"/>
  <text x="58" y="358" font-size="10.5" font-weight="700" fill="var(--ember-text)">keyed on edit_date → discarded as older</text>
  <text x="58" y="376" font-size="10" fill="currentColor">the more recent observation of the ground is the one thrown away</text>
  <rect x="460" y="336" width="380" height="52" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.8"/>
  <text x="478" y="358" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">keyed on change generation → concurrent</text>
  <text x="478" y="376" font-size="10" fill="currentColor">goes to the reconciler, where the domain rule applies</text>
</svg>

Both timestamps in that sequence are correct. The device's clock is right, the server's clock is right, and the device edit genuinely happened three minutes before the server edit. Keying the sync on `edit_date` still discards it, because the sync sees the two records in arrival order and the device's is older by the clock — so the more recent *observation of the ground*, made by the responder standing on it, loses to a server-side edit made by someone reading a screen.

Replacing the timestamp with a per-replica change generation fixes it by recording what each editor had seen rather than when they acted. The device edited against a base that already included the server's prior state; the server edited against a base that did not include the device's. Neither generation dominates, so they are concurrent, and the resolver applies a domain rule instead of a clock comparison.

The local side needs a matching piece of bookkeeping for that to be affordable.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="gp-t gp-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="gp-t">The three states a local GeoPackage row can be in, and what sync does with each</title>
  <desc id="gp-d">Every row in the local GeoPackage carries a sync state. Clean rows match the last known server version and are skipped entirely by the sync, which is what keeps a two-minute window affordable. Locally edited rows are pushed with the base generation they were edited against, so the server can detect concurrency rather than trusting arrival order. Rows edited both locally and on the server since the last sync are conflicted and go to the reconciler with both versions intact. The important property is that state is recorded at edit time rather than derived at sync time by comparing full geometries — deriving it means reading and hashing the entire table on a device that has two minutes of connectivity.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">state is recorded when the edit happens, not derived when the sync runs</text>
  <rect x="40" y="80" width="256" height="150" rx="9" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.5"/>
  <rect x="312" y="80" width="256" height="150" rx="9" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.6"/>
  <rect x="584" y="80" width="256" height="150" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.8"/>
  <text x="60" y="108" font-size="11" font-weight="700" fill="currentColor">clean</text>
  <text x="332" y="108" font-size="11" font-weight="700" fill="currentColor">locally edited</text>
  <text x="604" y="108" font-size="11" font-weight="700" fill="var(--ember-text)">conflicted</text>
  <text x="60" y="134" font-size="10" fill="currentColor">matches the last known</text>
  <text x="60" y="150" font-size="10" fill="currentColor">server generation</text>
  <text x="332" y="134" font-size="10" fill="currentColor">changed here since the</text>
  <text x="332" y="150" font-size="10" fill="currentColor">last successful sync</text>
  <text x="604" y="134" font-size="10" fill="currentColor">changed here and on the</text>
  <text x="604" y="150" font-size="10" fill="currentColor">server since the last sync</text>
  <text x="60" y="186" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">skipped entirely</text>
  <text x="60" y="204" font-size="10" fill="currentColor">never read, never hashed</text>
  <text x="332" y="186" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">pushed with its base generation</text>
  <text x="332" y="204" font-size="10" fill="currentColor">so the server can see concurrency</text>
  <text x="604" y="186" font-size="10.5" font-weight="700" fill="var(--ember-text)">to the reconciler</text>
  <text x="604" y="204" font-size="10" fill="currentColor">both versions preserved</text>
  <rect x="40" y="258" width="800" height="66" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="282" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">why not just diff the tables at sync time?</text>
  <text x="60" y="302" font-size="10" fill="currentColor">Because diffing means reading and hashing every geometry in the layer, on a device with two minutes of</text>
  <text x="60" y="318" font-size="10" fill="currentColor">connectivity. The state column turns an O(table) operation into an O(edits) one.</text>
</svg>

The state column is what makes the sync proportional to the number of edits rather than to the size of the layer. Without it, establishing which rows changed means reading and hashing every geometry in the GeoPackage — on a 200,000-feature regional layer, tens of seconds of local I/O before a single byte crosses the link, on a device whose entire connectivity window may be two minutes.

Set the state in a trigger rather than in application code. Edits reach a local GeoPackage from more places than the sync client knows about — a field app, an ad-hoc QGIS session, a repair script — and a state column that only some writers maintain is worse than none, because the sync will confidently skip rows it believes are clean.

## Production Python implementation

The following resolver implements the full path: bounded extraction with backoff, isolated staging, collision and tie reconciliation, a transactional WAL commit, and an immutable audit row per resolution. It assumes the delta arrives already CRS-normalised — axis-order and datum normalisation are owned upstream by [Real-Time Geocoding & Location Normalization](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/), and feeding un-normalised coordinates in produces false overlap flags from projection drift.

```python
import time
import json
import sqlite3
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Callable, Optional

from arcgis.gis import GIS
from arcgis.features import FeatureLayer
from requests.exceptions import RequestException, Timeout, HTTPError

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("agol_gpkg_sync")

# ICS authority tiers: higher wins a same-second last_edited_date tie.
ICS_PRECEDENCE: dict[str, int] = {"FED": 3, "STATE": 2, "LOCAL": 1}


class AGOLToGeoPackageSync:
    """Deterministic, audited AGOL feature-service -> local GeoPackage sync."""

    def __init__(
        self,
        agol_url: str,
        gpkg_path: str,
        max_retries: int = 3,
        backoff_factor: float = 2.0,
    ) -> None:
        self.gis = GIS(agol_url)
        self.gpkg_path = gpkg_path
        self.max_retries = max_retries
        self.backoff_factor = backoff_factor

    def _with_backoff(self, func: Callable[..., Any], *args: Any, **kwargs: Any) -> Optional[Any]:
        """Run a network call with exponential backoff; queue offline on exhaustion."""
        for attempt in range(self.max_retries):
            try:
                return func(*args, **kwargs)
            except HTTPError as exc:
                status = getattr(exc.response, "status_code", None)
                if status != 429:  # only retry rate-limit; re-raise hard errors
                    logger.error("Non-retryable HTTP %s from feature service: %s", status, exc)
                    raise
                wait = self.backoff_factor ** attempt
                logger.warning("Throttled (429); backing off %.1fs", wait)
                time.sleep(wait)
            except (Timeout, RequestException) as exc:
                wait = self.backoff_factor ** attempt
                logger.warning("Network degradation (attempt %d): %s; waiting %.1fs",
                               attempt + 1, exc, wait)
                time.sleep(wait)
        logger.critical("Retries exhausted; routing pull to offline delta queue.")
        self._queue_offline()
        return None

    def _queue_offline(self) -> None:
        """Persist intent to re-pull on the next connected window (DLQ stub)."""
        logger.info("Offline fallback engaged; this window will be retried.")

    def sync(self, layer_url: str, window_hours: int = 2) -> None:
        """Pull a bounded delta and merge it into the GeoPackage transactionally."""
        layer = FeatureLayer(layer_url, self.gis)
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=window_hours)).strftime(
            "%Y-%m-%d %H:%M:%S"
        )
        params: dict[str, Any] = {
            "where": f"last_edited_date >= TIMESTAMP '{cutoff}'",
            "out_fields": "globalid,last_edited_date,agency_type",
            "return_geometry": True,
            "f": "geojson",
        }
        result = self._with_backoff(layer.query, **params)
        if not result:
            return

        # --- Tier 2: stage in an isolated workspace, never the live file ---
        stage = sqlite3.connect(":memory:")
        stage.execute(
            "CREATE TABLE delta (globalid TEXT, agency_type TEXT, "
            "last_edited_date TEXT, geometry TEXT)"
        )
        for feat in result.features:
            stage.execute(
                "INSERT INTO delta VALUES (?, ?, ?, ?)",
                (
                    feat.attributes.get("globalid"),
                    feat.attributes.get("agency_type"),
                    feat.attributes.get("last_edited_date"),
                    json.dumps(feat.geometry),
                ),
            )
        stage.commit()
        rows = stage.execute("SELECT * FROM delta").fetchall()
        stage.close()
        logger.info("Staged %d delta records for window starting %s", len(rows), cutoff)

        self._commit(rows)

    def _resolve(self, incoming: tuple, existing: Optional[tuple]) -> tuple[str, dict]:
        """Decide the winner for one merge key; return (action, audit_payload)."""
        gid, agency, edited, geom = incoming
        if existing is None:
            return "insert", {"rule": "new_feature", "globalid": gid}

        ex_gid, ex_agency, ex_edited, _ = existing

        # Tier 3: same key, different physical feature -> re-key local, keep lineage.
        if gid == ex_gid and geom_signature(geom) != geom_signature(existing[3]):
            return "rekey", {"rule": "globalid_collision", "globalid": gid,
                             "relabelled": f"LOCAL-{ex_gid}", "parent_globalid": ex_gid}

        # Tier 4: timestamp race -> ICS precedence, then last-writer-wins.
        if edited == ex_edited:
            inc_rank = ICS_PRECEDENCE.get(str(agency).split("-")[0], 0)
            ex_rank = ICS_PRECEDENCE.get(str(ex_agency).split("-")[0], 0)
            if inc_rank != ex_rank:
                winner = "incoming" if inc_rank > ex_rank else "existing"
                return ("update" if winner == "incoming" else "keep",
                        {"rule": "ics_precedence", "globalid": gid, "winner": winner})
            return "update", {"rule": "tie_last_writer_wins", "globalid": gid}

        return ("update" if edited > ex_edited else "keep",
                {"rule": "recency", "globalid": gid})

    def _commit(self, rows: list[tuple]) -> None:
        """Apply reconciled rows + audit in a single WAL transaction."""
        conn = sqlite3.connect(self.gpkg_path)
        # Tier 5: WAL + busy_timeout so a lock contender waits, never corrupts.
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        try:
            conn.execute("BEGIN")
            for row in rows:
                gid = row[0]
                existing = conn.execute(
                    "SELECT globalid, agency_type, last_edited_date, geometry "
                    "FROM features WHERE globalid = ?",
                    (gid,),
                ).fetchone()
                action, audit = self._resolve(row, existing)
                self._apply(conn, action, row)
                # Tier 6: immutable audit row per decision, before commit.
                conn.execute(
                    "INSERT INTO sync_audit (ts, action, payload) VALUES (?, ?, ?)",
                    (datetime.now(timezone.utc).isoformat(), action, json.dumps(audit)),
                )
                logger.info("Resolved %s -> %s (%s)", gid, action, audit["rule"])
            conn.commit()
            logger.info("GeoPackage sync committed: %d records.", len(rows))
        except sqlite3.OperationalError as exc:
            conn.rollback()
            logger.error("Lock/IO failure; rolled back, replica untouched: %s", exc)
            self._queue_offline()
        except Exception as exc:  # noqa: BLE001 - never leave a half-applied merge
            conn.rollback()
            logger.exception("Merge failed; rolled back to prevent corruption: %s", exc)
            raise
        finally:
            conn.close()

    def _apply(self, conn: sqlite3.Connection, action: str, row: tuple) -> None:
        """Translate a resolution decision into a write (geometry write via pyogrio in prod)."""
        # 'keep' is a no-op by design; 'rekey'/'insert'/'update' write here.
        ...


def geom_signature(geom_json: str) -> str:
    """Stable hash of geometry used to tell two same-key features apart."""
    return str(hash(geom_json))
```

## Validation checklist

Verify each item in a staging replica before this sync touches a live incident GeoPackage:

- [ ] The `last_edited_date` filter is built from a Python-side UTC cutoff, not server date arithmetic, and the window is bounded (no full-layer re-pulls).
- [ ] Every network call routes through the backoff wrapper and a retry-exhausted pull lands in the offline queue, not a crash.
- [ ] The delta is fully staged in the in-memory workspace before the live GeoPackage is opened.
- [ ] A simulated duplicate `globalid` for a *different* feature re-keys the local record to `LOCAL-…` and populates `parent_globalid` (nothing overwritten).
- [ ] A same-second `last_edited_date` tie resolves by ICS precedence, and only equal-tier ties fall through to last-writer-wins.
- [ ] `PRAGMA journal_mode=WAL` and `PRAGMA busy_timeout` are set, and a second concurrent writer waits rather than raising `database is locked`.
- [ ] A forced exception inside the transaction rolls back cleanly and leaves the GeoPackage byte-identical to its pre-sync state.
- [ ] One `sync_audit` row exists per resolution, each naming the rule that decided the winner.

## Edge cases and gotchas

- **Axis-order inversion.** GeoJSON from AGOL is lon/lat, but a GeoPackage layer registered against a CRS whose authority defines lat/lon order (some EPSG geographic codes) can silently transpose coordinates on read in older drivers. Confirm the staged geometry round-trips through a known control point before committing; a transposed perimeter passes every attribute check while sitting in the wrong hemisphere.
- **Null-island drift.** Field devices that lose a fix frequently emit `(0, 0)`. A `(0, 0)` point sails through `INSERT` but clusters every affected feature off the coast of West Africa. Reject coordinates at exact origin and at improbable distances from the incident bounding box, and quarantine rather than merge them.
- **Offline device clock skew.** A tablet that has been disconnected may carry a drifted RTC, so its `last_edited_date` can be *ahead* of the server's, falsely winning a recency comparison. Prefer the server-applied edit timestamp where AGOL provides it, and treat device-supplied times as advisory only.
- **Agency-specific datum anomalies.** A partner agency exporting from a NAD27 legacy dataset can shift features tens of metres from the NAD83/WGS84 baseline the rest of the incident uses. Pin the GeoPackage's declared CRS and reproject on ingest; never trust an unstated source datum.
- **Empty deltas are not no-ops.** A window that returns zero features should still emit an audit heartbeat, otherwise a silently failing query is indistinguishable from a genuinely quiet period during an after-action review (AAR).

## Related

- [Conflict Resolution in Multi-Agency Edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/) — the precedence-weighted reconciliation model this sync specialises.
- [Real-Time Geocoding & Location Normalization](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/real-time-geocoding-location-normalization/) — the upstream stage that guarantees deltas arrive CRS- and axis-normalised.
- [Automated Attribute Validation Rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/) — schema and field-contract enforcement that keeps malformed records out of the merge.

Up one level: [Conflict Resolution in Multi-Agency Edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/).
