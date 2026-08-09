---
title: "Emergency Metadata Standards"
description: "Production Python workflows for emergency GIS metadata: ISO 19115 and CAP schema enforcement, datum-aware lineage, cryptographic integrity, and pre-ingestion validation gates."
slug: emergency-metadata-standards
type: guide
breadcrumb: "Emergency Metadata Standards"
datePublished: "2025-02-20"
dateModified: "2026-06-25"
---

# Emergency Metadata Standards: Python Validation Workflows for Incident GIS

## Problem Framing

At hour 18 of a multi-county flood response, a state GIS analyst pulls a damage-assessment layer that three jurisdictions have all touched. It has no publication date, no contact authority, and no statement of how its geometry was derived. Nobody in the Emergency Operations Center (EOC) can answer the only question that matters before it feeds resource allocation: is this current, and who is accountable for it? The layer is silently a day stale, and engines are dispatched against parcels that were already cleared. Missing or untrusted metadata is not a documentation hygiene problem in emergency GIS — it is an operational failure vector that lets unattributed, undated, and unverifiable spatial data reach the Common Operating Picture (COP). This page specifies the deterministic metadata validation workflow that prevents that: a strict pre-ingestion gate that rejects any dataset lacking mandatory temporal, lineage, and contact fields, normalizes its declared coordinate reference, and emits an immutable, hash-anchored audit record. It implements the broader [Core Emergency GIS Architecture & Data Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/) contract for metadata governance under National Incident Management System (NIMS), Federal Emergency Management Agency (FEMA), and ISO 22320 (the international standard for emergency management) reporting requirements.

The four fields the gate insists on are not an arbitrary subset of ISO 19115-1 — they are the four that map one-to-one onto the questions an operations chief asks before trusting a layer. Everything else in the standard is useful for a catalogue; these four are what make the layer usable in a decision.

<svg viewBox="0 0 880 420" role="img" aria-labelledby="anat-title anat-desc" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="anat-title">The four mandatory metadata blocks and the operational question each one answers</title>
  <desc id="anat-desc">An ISO 19115-1 MD_Metadata record is drawn as a document containing four required blocks, each paired with the question it lets an operations chief answer. The dateStamp and CI_Date block, carrying publication and revision times in ISO 8601 UTC, answers whether the layer is current and by how long it is stale. The contact block, a CI_ResponsibleParty with authority, role and address, answers who is accountable for it. The lineage block, LI_Lineage with process steps and source datasets, answers how the geometry was derived. The referenceSystemInfo block, an RS_Identifier resolving to an EPSG code, answers whether the declared coordinate reference matches the data itself. A record missing any one of the four cannot answer its question, which is why the gate rejects rather than warns.</desc>
  <rect x="0" y="0" width="880" height="420" fill="var(--blush)"/>
  <text x="40" y="36" font-size="11" font-weight="700" fill="var(--crimson-deep)">Mandatory block</text>
  <text x="520" y="36" font-size="11" font-weight="700" fill="var(--crimson-deep)">The question it answers</text>
  <!-- document frame -->
  <rect x="40" y="50" width="380" height="310" rx="10" fill="var(--cream)" stroke="var(--crimson)" stroke-width="2"/>
  <text x="64" y="78" font-size="11.5" font-weight="700" fill="var(--crimson-deep)">gmd:MD_Metadata</text>
  <!-- blocks -->
  <g>
    <rect x="64" y="96" width="332" height="54" rx="7" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.3"/>
    <rect x="64" y="162" width="332" height="54" rx="7" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.3"/>
    <rect x="64" y="228" width="332" height="54" rx="7" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.3"/>
    <rect x="64" y="294" width="332" height="54" rx="7" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.3"/>
  </g>
  <g font-size="11" font-weight="700" fill="currentColor">
    <text x="78" y="119">gmd:dateStamp / CI_Date</text>
    <text x="78" y="185">gmd:contact</text>
    <text x="78" y="251">gmd:lineage / LI_Lineage</text>
    <text x="78" y="317">gmd:referenceSystemInfo</text>
  </g>
  <g font-size="10" fill="var(--muted)">
    <text x="78" y="137">publication + revision, ISO 8601 UTC</text>
    <text x="78" y="203">CI_ResponsibleParty · authority, role</text>
    <text x="78" y="269">process steps + source datasets</text>
    <text x="78" y="335">RS_Identifier → EPSG code</text>
  </g>
  <!-- leaders -->
  <g stroke="var(--crimson)" stroke-width="1.5" fill="none">
    <path d="M420 123 H516"/><path d="M420 189 H516"/><path d="M420 255 H516"/><path d="M420 321 H516"/>
  </g>
  <!-- questions -->
  <g>
    <rect x="520" y="96" width="330" height="54" rx="7" fill="var(--cream)" stroke="var(--crimson)" stroke-width="1.6"/>
    <rect x="520" y="162" width="330" height="54" rx="7" fill="var(--cream)" stroke="var(--crimson)" stroke-width="1.6"/>
    <rect x="520" y="228" width="330" height="54" rx="7" fill="var(--cream)" stroke="var(--crimson)" stroke-width="1.6"/>
    <rect x="520" y="294" width="330" height="54" rx="7" fill="var(--cream)" stroke="var(--crimson)" stroke-width="1.6"/>
  </g>
  <g font-size="11.5" font-weight="700" fill="var(--crimson-deep)">
    <text x="536" y="119">Is this current?</text>
    <text x="536" y="185">Who is accountable for it?</text>
    <text x="536" y="251">How was the geometry derived?</text>
    <text x="536" y="317">Does the CRS match the data?</text>
  </g>
  <g font-size="10" fill="var(--muted)">
    <text x="536" y="137">…and stale by exactly how long?</text>
    <text x="536" y="203">…and reachable during this operational period?</text>
    <text x="536" y="269">…surveyed, digitised, or inferred?</text>
    <text x="536" y="335">…or was the header copied from a template?</text>
  </g>
  <text x="440" y="396" font-size="11" text-anchor="middle" fill="var(--muted)">A record missing any one block cannot answer its question — which is why the gate rejects rather than warns.</text>
</svg>

The distinction between rejecting and warning is the whole design. A warning is a message addressed to someone who is not in the room: the analyst who published the layer three hours ago in a different jurisdiction. During an incident, nobody triages warnings, so a gate that only warns is a gate that admits everything while producing a log that will read, at the after-action review, as though the system knew. Rejecting costs an agency a resubmission and costs the response nothing, because the alternative to a rejected layer is not a good layer — it is the previous good layer, which at least carries a known age.

Note also what the fourth block guards against, since it is the least obvious. `referenceSystemInfo` is not asking the data what projection it is in; the data already knows. It is asking the *authoring agency* to declare what it believes, so the two claims can be compared. A record where the declared EPSG and the container's actual SRID disagree is not a data problem to be repaired silently — it is evidence that the metadata was templated rather than generated, which puts every other field in the record under suspicion.

## Prerequisites

This workflow assumes a senior engineer's fluency with the Python geospatial stack and the following preconditions before any record is validated:

- **Python packages:** `pydantic>=2.0` for strict schema modeling, `lxml` for ISO 19115-1 / ISO 19139 XML parsing, `geopandas` and `pyproj` for the spatial-reference checks, and the standard-library `hashlib` and `json` modules for integrity and serialization.
- **Schema contracts:** Inbound metadata arrives as ISO 19115-1 (Geographic information — Metadata) XML or as Common Alerting Protocol (CAP) v1.2 alert blocks. Field submissions may be partial; the gate must distinguish *incomplete* from *malformed*.
- **CRS assumptions:** Every dataset declares an explicit EPSG code. The datum-aware reprojection rules — NAD27, NAD83(2011), ITRF2014 handling — are owned by the [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) workflow; this stage validates and records the declared CRS rather than transforming it.
- **Upstream position:** This gate runs *before* a dataset is admitted to the operational datastore. Anything it rejects is routed to quarantine, never to the COP.

## Validation Gate Architecture

The validation gate treats every metadata payload as untrusted until it has cleared four sequential checks — parse, schema, spatial-reference, and integrity — each of which can route the dataset to a quarantine table with an explicit rejection reason instead of admitting partial data.

<svg viewBox="0 0 880 470" role="img" aria-labelledby="gate-title gate-desc" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="gate-title">Emergency metadata validation gate data flow</title>
  <desc id="gate-desc">An inbound metadata payload — ISO 19115-1 XML or CAP v1.2 — enters four sequential checks. Gate 1 confirms the XML is well-formed; Gate 2 confirms the mandatory title, date, lineage, and contact fields are present; Gate 3 confirms the declared EPSG code is resolvable and matches the data; Gate 4 computes a SHA-256 integrity hash and proves the record serializes. A payload that clears all four is published to the operational catalog. Any gate that fails branches the dataset down to a single quarantine table carrying a machine-readable rejection_reason.</desc>
  <defs>
    <marker id="gate-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0L10 5L0 10z" fill="var(--crimson)"/>
    </marker>
    <marker id="gate-arrow-warn" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0L10 5L0 10z" fill="var(--ember)"/>
    </marker>
  </defs>
  <!-- Inbound payload -->
  <rect x="14" y="166" width="150" height="78" rx="10" fill="var(--blush)" stroke="var(--line-strong)" stroke-width="1.5"/>
  <text x="89" y="192" text-anchor="middle" font-size="13" font-weight="700" fill="currentColor">Inbound payload</text>
  <text x="89" y="212" text-anchor="middle" font-size="11.5" fill="var(--muted)">ISO 19115-1 XML</text>
  <text x="89" y="228" text-anchor="middle" font-size="11.5" fill="var(--muted)">CAP v1.2 alert</text>
  <path d="M164 205 H196" fill="none" stroke="var(--crimson)" stroke-width="2" marker-end="url(#gate-arrow)"/>
  <!-- Four sequential gates -->
  <g>
    <!-- Gate 1 -->
    <rect x="196" y="166" width="150" height="78" rx="10" fill="var(--cream)" stroke="var(--crimson)" stroke-width="2"/>
    <circle cx="214" cy="184" r="12" fill="var(--crimson)"/>
    <text x="214" y="188" text-anchor="middle" font-size="12" font-weight="700" fill="var(--cream)">1</text>
    <text x="271" y="190" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--crimson-deep)">Parse</text>
    <text x="271" y="210" text-anchor="middle" font-size="10.5" fill="var(--muted)">well-formed XML?</text>
    <text x="271" y="227" text-anchor="middle" font-size="10.5" fill="var(--muted)">lxml.etree</text>
    <!-- Gate 2 -->
    <rect x="364" y="166" width="150" height="78" rx="10" fill="var(--cream)" stroke="var(--crimson)" stroke-width="2"/>
    <circle cx="382" cy="184" r="12" fill="var(--crimson)"/>
    <text x="382" y="188" text-anchor="middle" font-size="12" font-weight="700" fill="var(--cream)">2</text>
    <text x="439" y="190" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--crimson-deep)">Schema</text>
    <text x="439" y="210" text-anchor="middle" font-size="10.5" fill="var(--muted)">title / date / lineage</text>
    <text x="439" y="227" text-anchor="middle" font-size="10.5" fill="var(--muted)">/ contact present?</text>
    <!-- Gate 3 -->
    <rect x="532" y="166" width="150" height="78" rx="10" fill="var(--cream)" stroke="var(--crimson)" stroke-width="2"/>
    <circle cx="550" cy="184" r="12" fill="var(--crimson)"/>
    <text x="550" y="188" text-anchor="middle" font-size="12" font-weight="700" fill="var(--cream)">3</text>
    <text x="607" y="190" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--crimson-deep)">Spatial ref</text>
    <text x="607" y="210" text-anchor="middle" font-size="10.5" fill="var(--muted)">EPSG resolvable</text>
    <text x="607" y="227" text-anchor="middle" font-size="10.5" fill="var(--muted)">&amp; matches data?</text>
    <!-- Gate 4 -->
    <rect x="700" y="166" width="150" height="78" rx="10" fill="var(--cream)" stroke="var(--crimson)" stroke-width="2"/>
    <circle cx="718" cy="184" r="12" fill="var(--crimson)"/>
    <text x="718" y="188" text-anchor="middle" font-size="12" font-weight="700" fill="var(--cream)">4</text>
    <text x="775" y="190" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--crimson-deep)">Integrity</text>
    <text x="775" y="210" text-anchor="middle" font-size="10.5" fill="var(--muted)">SHA-256 hash</text>
    <text x="775" y="227" text-anchor="middle" font-size="10.5" fill="var(--muted)">&amp; serializable?</text>
  </g>
  <!-- gate-to-gate pass flow -->
  <g fill="none" stroke="var(--crimson)" stroke-width="2" marker-end="url(#gate-arrow)">
    <path d="M346 205 H362"/>
    <path d="M514 205 H530"/>
    <path d="M682 205 H698"/>
  </g>
  <!-- The gate-to-gate gaps are 18u wide, too narrow to letter without the
       glyphs crossing a card edge. The solid arrow already means "passed",
       and the legend at the foot says so — so the gap stays unlettered. -->
  <!-- Publish to operational catalog -->
  <path d="M775 166 V88 H532" fill="none" stroke="var(--crimson)" stroke-width="2" marker-end="url(#gate-arrow)"/>
  <text x="775" y="135" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">all gates pass</text>
  <rect x="362" y="56" width="170" height="64" rx="10" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="2"/>
  <text x="447" y="84" text-anchor="middle" font-size="13" font-weight="700" fill="var(--cream)">Publish</text>
  <text x="447" y="103" text-anchor="middle" font-size="11.5" fill="var(--cream)">operational catalog (COP)</text>
  <!-- fail branches to quarantine -->
  <g fill="none" stroke="var(--ember)" stroke-width="1.8" stroke-dasharray="6 4" marker-end="url(#gate-arrow-warn)">
    <path d="M271 244 V300 H300"/>
    <path d="M439 244 V300 H300"/>
    <path d="M607 244 V300 H472"/>
    <path d="M775 244 V300 H472"/>
  </g>
  <g font-size="10.5" font-weight="700" fill="var(--crimson-deep)">
    <text x="285" y="262" text-anchor="middle">fail</text>
    <text x="453" y="262" text-anchor="middle">fail</text>
    <text x="593" y="262" text-anchor="middle">fail</text>
    <text x="761" y="262" text-anchor="middle">fail</text>
  </g>
  <!-- Quarantine table -->
  <rect x="300" y="300" width="172" height="64" rx="10" fill="var(--petal-soft)" stroke="var(--ember)" stroke-width="2"/>
  <text x="386" y="326" text-anchor="middle" font-size="13" font-weight="700" fill="var(--crimson-deep)">Quarantine table</text>
  <text x="386" y="346" text-anchor="middle" font-size="11.5" fill="var(--muted)">carries rejection_reason</text>
  <text x="432" y="400" text-anchor="middle" font-size="11" fill="var(--muted)">Solid = admit path · dashed = reject path; nothing partial reaches the catalog.</text>
</svg>

## Step-by-Step Implementation

### Step 1 — Model the mandatory schema and parse ISO 19115 metadata

The first gate rejects anything missing a temporal, lineage, or contact field. A `pydantic` model declares the contract; `lxml` extracts the ISO 19115-1 fields, and a `safe_extract` helper turns an absent mandatory element into a typed, logged rejection rather than a silent empty string.

```python
import logging
from lxml import etree
from pydantic import BaseModel, ValidationError, field_validator

# Structured JSON logging so the incident tracking dashboard can index every event
logging.basicConfig(
    level=logging.INFO,
    format='{"timestamp":"%(asctime)s","level":"%(levelname)s","module":"%(module)s","message":"%(message)s"}',
)
logger = logging.getLogger(__name__)

ISO_NS: dict[str, str] = {
    "gmd": "http://www.isotc211.org/2005/gmd",
    "gco": "http://www.isotc211.org/2005/gco",
}


class EmergencyMetadata(BaseModel):
    title: str
    abstract: str
    publication_date: str
    crs_epsg: int
    lineage: str
    contact_email: str

    @field_validator("contact_email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        if "@" not in value or "." not in value.split("@")[-1]:
            raise ValueError("Invalid contact email format")
        return value.lower()


def parse_iso19115_metadata(xml_path: str) -> EmergencyMetadata:
    """Gate 1+2: parse ISO 19115-1 XML and enforce the mandatory-field contract."""
    try:
        root = etree.parse(xml_path).getroot()
    except etree.XMLSyntaxError as exc:
        logger.error('{"event":"parse_failure","path":"%s","error":"%s"}', xml_path, exc)
        raise RuntimeError("Metadata rejected: malformed XML") from exc

    def safe_extract(xpath: str) -> str:
        value = root.findtext(xpath, namespaces=ISO_NS)
        if not value or not value.strip():
            raise ValueError(f"Missing mandatory field: {xpath}")
        return value.strip()

    try:
        return EmergencyMetadata(
            title=safe_extract(
                ".//gmd:identificationInfo/gmd:MD_DataIdentification/gmd:citation"
                "/gmd:CI_Citation/gmd:title/gco:CharacterString"
            ),
            abstract=safe_extract(
                ".//gmd:identificationInfo/gmd:MD_DataIdentification"
                "/gmd:abstract/gco:CharacterString"
            ),
            publication_date=safe_extract(".//gmd:dateStamp/gco:Date"),
            crs_epsg=int(
                safe_extract(
                    ".//gmd:referenceSystemInfo/gmd:MD_ReferenceSystem"
                    "/gmd:referenceSystemIdentifier/gmd:RS_Identifier"
                    "/gmd:code/gco:CharacterString"
                )
            ),
            lineage=safe_extract(
                ".//gmd:dataQualityInfo/gmd:DQ_DataQuality/gmd:lineage"
                "/gmd:LI_Lineage/gmd:statement/gco:CharacterString"
            ),
            contact_email=safe_extract(
                ".//gmd:contact/gmd:CI_ResponsibleParty/gmd:contactInfo"
                "/gmd:CI_Contact/gmd:address/gmd:CI_Address"
                "/gmd:electronicMailAddress/gco:CharacterString"
            ),
        )
    except (ValueError, ValidationError) as exc:
        logger.warning('{"event":"schema_rejection","path":"%s","error":"%s"}', xml_path, exc)
        raise
```

### Step 2 — Validate the declared spatial reference

A metadata record can name an EPSG code that `pyproj` cannot resolve, or one that disagrees with the geometry it describes. The third gate confirms the declared CRS is real and matches the dataset's own CRS before the record is trusted — it does not reproject, leaving that to the dedicated transformation stage.

```python
import geopandas as gpd
from pyproj import CRS
from pyproj.exceptions import CRSError


def validate_declared_crs(metadata: EmergencyMetadata, gdf: gpd.GeoDataFrame) -> None:
    """Gate 3: confirm the metadata's EPSG is resolvable and matches the data."""
    try:
        declared = CRS.from_epsg(metadata.crs_epsg)
    except CRSError as exc:
        logger.error('{"event":"crs_unresolvable","epsg":%s}', metadata.crs_epsg)
        raise ValueError(f"Metadata declares unresolvable EPSG:{metadata.crs_epsg}") from exc

    if gdf.crs is None:
        logger.error('{"event":"crs_missing_on_data","title":"%s"}', metadata.title)
        raise ValueError("Dataset carries no CRS to verify against metadata")

    if not CRS(gdf.crs).equals(declared):
        logger.error(
            '{"event":"crs_mismatch","declared":%s,"actual":"%s"}',
            metadata.crs_epsg,
            gdf.crs.to_string(),
        )
        raise ValueError("Declared CRS does not match dataset CRS")

    logger.info('{"event":"crs_verified","epsg":%s}', metadata.crs_epsg)
```

### Step 3 — Emit a hash-anchored compliance record

The final gate binds the validated metadata to the bytes it describes. A SHA-256 hash makes the record tamper-evident, the timestamp is UTC and ISO 8601, and serialization is proven before export so a non-serializable field surfaces here rather than at the catalog write.

```python
import hashlib
import json
from datetime import datetime, timezone
from typing import Any


def generate_compliance_record(metadata: EmergencyMetadata, source_path: str) -> dict[str, Any]:
    """Gate 4: build a tamper-evident, audit-ready lineage record."""
    try:
        with open(source_path, "rb") as handle:
            file_hash = hashlib.sha256(handle.read()).hexdigest()
    except OSError as exc:
        logger.error('{"event":"hash_read_failure","path":"%s"}', source_path)
        raise RuntimeError("Cannot hash source for integrity record") from exc

    record: dict[str, Any] = {
        "metadata_schema": "ISO 19115-1 / CAP v1.2",
        "dataset_title": metadata.title,
        "ingestion_timestamp": datetime.now(timezone.utc).isoformat(),
        "source_crs": f"EPSG:{metadata.crs_epsg}",
        "contact_authority": metadata.contact_email,
        "lineage_statement": metadata.lineage,
        "integrity_hash": f"sha256:{file_hash}",
        "compliance_status": "VALIDATED",
    }

    try:
        json.dumps(record)
    except TypeError as exc:
        logger.critical('{"event":"record_not_serializable","error":"%s"}', exc)
        raise

    logger.info('{"event":"record_emitted","title":"%s","hash":"%s"}', metadata.title, file_hash[:12])
    return record
```

### Step 4 — Compose the gates behind a single quarantine boundary

The orchestrator runs the gates in order and is the only place a dataset is admitted or quarantined. Every rejection carries a machine-readable `rejection_reason` so data stewards can triage without re-running the pipeline.

```python
def admit_or_quarantine(xml_path: str, data_path: str, gdf: gpd.GeoDataFrame) -> dict[str, Any]:
    """Single entry point: validated record on success, raises on rejection."""
    try:
        metadata = parse_iso19115_metadata(xml_path)        # Gates 1 + 2
        validate_declared_crs(metadata, gdf)                # Gate 3
        return generate_compliance_record(metadata, data_path)  # Gate 4
    except (RuntimeError, ValueError) as exc:
        logger.warning('{"event":"quarantined","path":"%s","rejection_reason":"%s"}', xml_path, exc)
        raise
```

## Configuration Reference

| Parameter / variable | Purpose | Recommended value |
|----------------------|---------|-------------------|
| `METADATA_SCHEMA` | Declared standard recorded in lineage | `ISO 19115-1 / CAP v1.2` |
| `QUARANTINE_TABLE` | Destination for rejected datasets | dedicated table/bucket with `rejection_reason` |
| `HASH_ALGORITHM` | Integrity digest | `sha256` (never MD5 for chain-of-custody) |
| `MAX_FAILURE_RATE` | Alert threshold over a 15-min window | `0.05` (page on >5% rejections) |
| `STALENESS_HOURS` | Flag records older than N hours at fusion | `6` (tactical) / `24` (planning) |
| `STRICT_CONTACT` | Require resolvable contact authority | `True` for all operational layers |
| `LOG_FORMAT` | Emit structured JSON for SIEM ingestion | JSON, never plain text |

## Verification & Smoke Test

Before this gate is trusted in a staging environment, confirm it rejects each failure class and admits a clean record. The assertions below run against fixtures and exercise the parse, schema, and integrity paths.

```python
import pytest


def test_rejects_missing_contact(incomplete_xml: str) -> None:
    with pytest.raises(ValueError, match="Missing mandatory field"):
        parse_iso19115_metadata(incomplete_xml)


def test_rejects_malformed_xml(broken_xml: str) -> None:
    with pytest.raises(RuntimeError, match="malformed XML"):
        parse_iso19115_metadata(broken_xml)


def test_emits_hash_anchored_record(valid_xml: str, valid_data: str) -> None:
    metadata = parse_iso19115_metadata(valid_xml)
    record = generate_compliance_record(metadata, valid_data)
    assert record["integrity_hash"].startswith("sha256:")
    assert record["compliance_status"] == "VALIDATED"
    assert json.dumps(record)  # serializable end-to-end
```

A one-line CLI smoke test confirms the same record is produced deterministically on re-run, proving the gate is idempotent:

```bash
python -c "from gate import admit_or_quarantine; import geopandas as gpd; \
print(admit_or_quarantine('meta.xml','data.gpkg', gpd.read_file('data.gpkg'))['integrity_hash'])"
```

## Integration with Adjacent Workflows

This metadata gate is the governance layer that the rest of the parent architecture leans on. It runs as the compliance check inside the [Geospatial Data Ingestion Pipelines](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/) stage — a dataset that fails here never reaches transformation or publication. The CRS it validates is the same one the [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) workflow later reprojects, so a mismatch caught here prevents silent positional drift downstream. And because field devices may validate metadata while disconnected, the schema definitions and EPSG lookup tables this gate depends on must be staged by the [Offline GIS Data Caching Strategies](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/) workflow so validation is deterministic with the network down.

## Troubleshooting

**Symptom: every field-collected dataset is quarantined for a missing lineage statement.** Field collection apps often omit `gmd:LI_Lineage` entirely. Confirm with `root.findtext(...lineage...)` returning `None`; remediate by injecting a default lineage at the collection layer — a tagged "field collection, app vX" statement — rather than relaxing the gate.

**Symptom: `crs_mismatch` fires on data that looks correct.** The metadata declares EPSG:4326 but the GeoPackage was written in a UTM zone, or vice versa. Inspect `gdf.crs.to_epsg()` against `metadata.crs_epsg`; the metadata, not the data, is usually wrong because it was copied from a template. Reject and return to the authoring agency.

**Symptom: identical datasets produce different integrity hashes on re-ingestion.** The source file is being rewritten (e.g. a GeoPackage with a changing `last_change` pragma) before hashing. Hash the canonicalized geometry payload rather than the raw container, or freeze the file before the gate reads it.

**Symptom: validation passes but the catalog write fails with a serialization error.** A `datetime` or `Decimal` slipped into the record after the `json.dumps` guard. Ensure every field is set before the serialization check, and keep the check as the last statement before `return`.

**Symptom: rejection rate spikes above 5% during a surge.** A new agency joined the response with a non-conforming export profile. The SIEM alert should fire on `MAX_FAILURE_RATE`; triage the `rejection_reason` distribution to find the single dominant cause before treating it as a systemic gate failure.

That last symptom deserves a picture, because the instinct it triggers is usually the wrong one. A rejection rate that quadruples looks like the gate has become too strict, and the pressure during a surge is to relax it. Comparing the *composition* of the rejections rather than their rate shows why that instinct misreads the data.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="rej-title rej-desc" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="rej-title">Composition of metadata rejections in steady state compared with hour six of a surge</title>
  <desc id="rej-desc">Two full-width stacked bars showing what fraction of rejections each cause accounts for. In steady state, when 1.8 per cent of ingests are rejected, the causes are spread out: missing lineage 41 per cent, CRS mismatch 24 per cent, missing contact 19 per cent, stale date stamp 11 per cent and other causes 5 per cent. At hour six of a surge, when 7.4 per cent of ingests are rejected, a single new agency's non-conforming export profile accounts for 68 per cent of all rejections, while every other cause shrinks in share. The rate roughly quadrupled but the gate did not become stricter; one new participant arrived with one fixable export defect, which is a conversation with that agency rather than a reason to relax the contract.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="200" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">share of all rejections, by cause</text>
  <!-- steady state -->
  <g font-size="11" fill="currentColor">
    <text x="8" y="110" font-weight="700">steady state</text>
    <text x="8" y="126" font-size="10" fill="var(--muted)">1.8% of ingests</text>
  </g>
  <g stroke="var(--blush)" stroke-width="1.5">
    <rect x="200" y="86" width="254.2" height="52" fill="var(--crimson)"/>
    <rect x="454.2" y="86" width="148.8" height="52" fill="var(--crimson-deep)"/>
    <rect x="603" y="86" width="117.8" height="52" fill="var(--rose)"/>
    <rect x="720.8" y="86" width="68.2" height="52" fill="var(--petal)"/>
    <rect x="789" y="86" width="31" height="52" fill="var(--line-strong)"/>
  </g>
  <text x="216" y="117" font-size="10.5" font-weight="700" fill="var(--cream)">missing lineage · 41%</text>
  <!-- surge -->
  <g font-size="11" fill="currentColor">
    <text x="8" y="220" font-weight="700">surge, hour 6</text>
    <text x="8" y="236" font-size="10" fill="var(--muted)">7.4% of ingests</text>
  </g>
  <g stroke="var(--blush)" stroke-width="1.5">
    <rect x="200" y="196" width="421.6" height="52" fill="var(--ember)"/>
    <rect x="621.6" y="196" width="86.8" height="52" fill="var(--crimson)"/>
    <rect x="708.4" y="196" width="55.8" height="52" fill="var(--crimson-deep)"/>
    <rect x="764.2" y="196" width="37.2" height="52" fill="var(--rose)"/>
    <rect x="801.4" y="196" width="18.6" height="52" fill="var(--line-strong)"/>
  </g>
  <text x="216" y="227" font-size="10.5" font-weight="700" fill="var(--on-fire)">one new agency's export profile · 68%</text>
  <!-- legend -->
  <g font-size="10.5" fill="currentColor">
    <circle cx="206" cy="278" r="6" fill="var(--ember)"/><text x="220" y="282">non-conforming export profile</text>
    <circle cx="436" cy="278" r="6" fill="var(--crimson)"/><text x="450" y="282">missing lineage</text>
    <circle cx="606" cy="278" r="6" fill="var(--crimson-deep)"/><text x="620" y="282">CRS mismatch</text>
    <circle cx="206" cy="304" r="6" fill="var(--rose)"/><text x="220" y="308">missing contact</text>
    <circle cx="436" cy="304" r="6" fill="var(--petal)"/><text x="450" y="308">stale date stamp</text>
    <circle cx="606" cy="304" r="6" fill="var(--line-strong)"/><text x="620" y="308">other</text>
  </g>
  <text x="440" y="340" font-size="11" text-anchor="middle" fill="var(--muted)">The rate quadrupled; the gate did not change. One participant arrived with one fixable defect.</text>
</svg>

Read as a rate, the surge looks like a gate that has started refusing work the response needs. Read as a composition, it is a single agency exporting a single malformed profile, and every other failure category has actually shrunk in absolute terms because the conforming agencies were unaffected. The remedy is a ten-minute conversation about an export template, not a policy change — and crucially, the policy change would have admitted that agency's undated, unattributed layers into the Common Operating Picture at exactly the hour when the most decisions per minute were being made against it.

This is why the alert should be wired to the distribution and not only to the rate. A threshold on `MAX_FAILURE_RATE` tells you that something changed; the `rejection_reason` histogram tells you whether the change is one participant, one agency's tooling upgrade, or a genuine broadening across unrelated sources. Only the third of those is evidence that the gate itself needs attention, and in practice it is the rarest. Keep the histogram in the same dashboard panel as the rate, because a number without its composition invites precisely the reflex the surge cannot afford.

## Frequently Asked Questions

**What is the minimum metadata an emergency dataset must carry to be admitted?**
A resolvable title, a publication or dateStamp timestamp, an explicit EPSG code, a lineage statement, and a valid contact authority. Anything missing one of these is incomplete and routed to quarantine, not the operational catalog — there is no partial-admit path.

**Why hash the source file when the metadata is already validated?**
Validation proves the metadata is well-formed; the SHA-256 hash proves the bytes have not changed since. Together they give chain-of-custody: a post-action audit can confirm the layer fed into the COP is byte-identical to what was validated, which a metadata check alone cannot establish.

**How does this gate stay deterministic on offline field devices?**
Bundle the `pydantic` schema, the EPSG lookup, and any schema registry snapshot into the device image so no gate depends on a network call. Validation then produces the same admit/quarantine decision and the same integrity hash whether the device is connected or dark.

## Related

- [Validating FEMA shapefile schemas automatically](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/validating-fema-shapefile-schemas-automatically/)
- [Geospatial Data Ingestion Pipelines](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/)
- [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/)
- [Offline GIS Data Caching Strategies](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/)

Up: [Core Emergency GIS Architecture & Data Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/)

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Emergency metadata validation gate for incident GIS",
  "description": "Model the mandatory ISO 19115 / CAP schema, parse and reject incomplete records, validate the declared spatial reference, and emit a hash-anchored compliance record behind a single quarantine boundary.",
  "step": [
    { "@type": "HowToStep", "name": "Model the mandatory schema and parse ISO 19115 metadata", "url": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/#step-1-model-the-mandatory-schema-and-parse-iso-19115-metadata" },
    { "@type": "HowToStep", "name": "Validate the declared spatial reference", "url": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/#step-2-validate-the-declared-spatial-reference" },
    { "@type": "HowToStep", "name": "Emit a hash-anchored compliance record", "url": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/#step-3-emit-a-hash-anchored-compliance-record" },
    { "@type": "HowToStep", "name": "Compose the gates behind a single quarantine boundary", "url": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/#step-4-compose-the-gates-behind-a-single-quarantine-boundary" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is the minimum metadata an emergency dataset must carry to be admitted?",
      "acceptedAnswer": { "@type": "Answer", "text": "A resolvable title, a publication or dateStamp timestamp, an explicit EPSG code, a lineage statement, and a valid contact authority. Anything missing one of these is incomplete and routed to quarantine, not the operational catalog; there is no partial-admit path." }
    },
    {
      "@type": "Question",
      "name": "Why hash the source file when the metadata is already validated?",
      "acceptedAnswer": { "@type": "Answer", "text": "Validation proves the metadata is well-formed; the SHA-256 hash proves the bytes have not changed since. Together they give chain-of-custody so a post-action audit can confirm the layer fed into the Common Operating Picture is byte-identical to what was validated." }
    },
    {
      "@type": "Question",
      "name": "How does this gate stay deterministic on offline field devices?",
      "acceptedAnswer": { "@type": "Answer", "text": "Bundle the pydantic schema, the EPSG lookup, and any schema registry snapshot into the device image so no gate depends on a network call. Validation then produces the same admit/quarantine decision and the same integrity hash whether the device is connected or dark." }
    }
  ]
}
</script>
