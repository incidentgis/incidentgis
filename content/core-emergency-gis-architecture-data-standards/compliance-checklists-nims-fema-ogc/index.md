---
title: "Compliance Checklists: NIMS ICS-209, FEMA BPAS & OGC API Features"
description: "Turn NIMS ICS-209, FEMA BPAS, and OGC API - Features requirements into runnable Python conformance checklists that validate incident datasets and emit an auditable pass/fail record."
slug: compliance-checklists-nims-fema-ogc
type: guide
breadcrumb: "Compliance Checklists"
datePublished: "2026-07-13"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Compliance Checklists: NIMS ICS-209, FEMA BPAS & OGC API Features",
      "description": "Turn NIMS ICS-209, FEMA BPAS, and OGC API - Features requirements into runnable Python conformance checklists that validate incident datasets and emit an auditable pass/fail record.",
      "datePublished": "2026-07-13",
      "dateModified": "2026-07-13",
      "author": { "@type": "Organization", "name": "Incident GIS" },
      "publisher": { "@type": "Organization", "name": "Incident GIS" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.incidentgis.com/" },
        { "@type": "ListItem", "position": 2, "name": "Core Emergency GIS Architecture & Data Standards", "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/" },
        { "@type": "ListItem", "position": 3, "name": "Compliance Checklists: NIMS ICS-209, FEMA BPAS & OGC API Features", "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/compliance-checklists-nims-fema-ogc/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Validate an incident dataset against NIMS ICS-209, FEMA BPAS, and OGC API - Features",
      "description": "Encode each standard as a declarative checklist, validate the situation report and dataset against required fields and conformance classes, then emit a single machine-readable pass/fail conformance record with a full audit trail.",
      "step": [
        { "@type": "HowToStep", "name": "Encode each standard as a declarative checklist", "text": "Represent NIMS ICS-209 fields, FEMA BPAS data elements, and OGC API - Features conformance classes as versioned checklist specifications so every check is data, not hand-written branching." },
        { "@type": "HowToStep", "name": "Validate the situation report against NIMS ICS-209", "text": "Assert that every mandatory ICS-209 field is present, typed, and within domain, and record each missing or malformed field as a discrete finding rather than failing on the first error." },
        { "@type": "HowToStep", "name": "Validate the dataset against FEMA BPAS and OGC conformance", "text": "Check the submission schema and required data elements for the FEMA business process, then confirm the service advertises the required OGC API - Features conformance class URIs." },
        { "@type": "HowToStep", "name": "Emit an auditable conformance record", "text": "Aggregate all findings into a single pass/fail conformance record carrying the checklist version, evaluated timestamp, and per-requirement result so the decision is reproducible." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Should a conformance check stop at the first failed requirement?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "No. Fail-fast validation forces operators through repeated submit-fix-resubmit cycles under time pressure. Evaluate every requirement, collect each violation as a discrete finding, and emit one conformance record that lists all failures at once so a data steward can remediate the whole payload in a single pass."
          }
        },
        {
          "@type": "Question",
          "name": "How do I confirm a service actually conforms to OGC API - Features?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Request the service's /conformance endpoint and compare the advertised conformance class URIs against the set your workflow requires, at minimum Core and GeoJSON. Advertising a class is a claim, so a hardened checklist also fetches one collection and validates that the returned representation matches the advertised media type before recording a pass."
          }
        },
        {
          "@type": "Question",
          "name": "Why version the checklists instead of hard-coding the rules?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Standards revise: ICS-209 fields change between form editions and OGC adds conformance classes. If the rules are versioned data, every conformance record can name the exact checklist edition it was judged against, so an after-action audit can reproduce the decision instead of guessing which rules were active when the record was written."
          }
        }
      ]
    }
  ]
}
</script>

# Compliance Checklists: NIMS ICS-209, FEMA BPAS & OGC API Features

## Problem Framing

Three days into a multi-county wildfire, an auditor asks a simple question the incident data team cannot answer: was the 06:00 situation report that triggered the mutual-aid request actually complete and valid when it was filed? The report was assembled by hand from the operational geodatabase, emailed as a spreadsheet, and re-keyed into a partner state's system. Nobody recorded which fields were present, whether the acreage and containment percentages were in range, or whether the feature service the partner pulled from met the interoperability profile their tooling assumed. When the standards these artifacts must satisfy — the National Incident Management System (NIMS) ICS-209 situation report, the Federal Emergency Management Agency (FEMA) Business Process Analysis and System (BPAS) submission requirements, and the Open Geospatial Consortium (OGC) API - Features conformance classes — live only in PDFs and tribal knowledge, compliance becomes a post-hoc opinion instead of a testable property. This page turns those three standards into runnable Python conformance checklists that validate a dataset or report programmatically and emit a machine-readable pass/fail record, implementing the [Core Emergency GIS Architecture & Data Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/) contract for auditable, reproducible conformance.

## Prerequisites

This workflow assumes a senior engineer's fluency with the Python geospatial and validation stack, and the following preconditions before the first conformance evaluation runs:

- **Packages:** `pydantic >= 2.0` for typed field contracts, `httpx >= 0.24` for querying a live OGC API - Features endpoint, and `geopandas >= 0.12` / `shapely >= 2.0` where a check must inspect geometry. No component of the checklist reaches outside the standard library plus these.
- **A canonical field vocabulary:** the operational datastore must expose incident attributes under stable, documented names. The mapping from your internal schema to ICS-209 field names is the responsibility of the [Emergency Metadata Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/) layer; this page assumes those names resolve before a report is assembled.
- **A validated ingestion boundary:** conformance checking is a downstream gate, not a substitute for input validation. Payloads should already have passed the schema, idempotency, and coordinate-reference-system contract enforced by the [Geospatial Data Ingestion Pipelines](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/) workflow, so a conformance failure signals a reporting gap rather than a corrupt geometry.
- **Reachable conformance metadata:** for the OGC checks, the target feature service must expose a `/conformance` endpoint and at least one collection. Air-gapped field nodes cache the last-fetched conformance declaration so the check degrades to a warning rather than an error offline.

## Conformance Architecture

Compliance under ISO 22320 (the international standard for emergency management and incident coordination) and its United States implementation through NIMS is not a single yes/no gate — it is three independent standards, each with its own required data elements, evaluated against the same artifact. A situation report can satisfy every ICS-209 field yet be published through a feature service that fails OGC API - Features conformance, or ride on a conformant service while omitting a mandatory FEMA BPAS data element. The checklist architecture therefore treats each standard as a separate gate over a shared payload, evaluates all requirements within a gate (never failing fast), and merges the per-gate results into one conformance record. Each gate fails closed: an unmet requirement routes a discrete finding into the audit trail rather than silently downgrading the record to a pass. The diagram below maps the three standards onto the concrete data requirements each imposes and shows the fail-closed path to the nonconformance findings log.

<figure class="diagram">
<svg viewBox="0 0 900 380" role="img" aria-label="Gated conformance-checklist diagram: an incident dataset and situation report pass through three sequential gates, NIMS ICS-209 required fields, FEMA BPAS submission requirements, and OGC API - Features conformance classes, each fed by its concrete data requirements, then produce a single pass or fail conformance record, while any unmet requirement fails closed downward into a nonconformance findings and audit log." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>Three-gate conformance checklist for NIMS ICS-209, FEMA BPAS, and OGC API - Features</title>
  <desc>An incident dataset and situation report enter on the left and flow through three sequential gates. Gate one checks NIMS ICS-209 required fields: incident number and name, size and percent contained, and point of origin latitude and longitude. Gate two checks FEMA BPAS submission requirements: the submission schema, required data elements, and an authoritative source. Gate three checks OGC API - Features conformance classes: Core, GeoJSON, and OpenAPI 3.0. Passing all three produces a single conformance record marked pass or fail. Any unmet requirement in any gate fails closed downward into a shared nonconformance findings and audit log.</desc>
  <defs>
    <marker id="cnf-flow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
  </defs>
  <g font-size="12" text-anchor="middle" fill="currentColor">
    <!-- input -->
    <rect x="18" y="146" width="118" height="64" rx="7" fill="var(--blush, none)" stroke="currentColor" stroke-width="1.3"/>
    <text x="77" y="174" font-size="12">Dataset /</text>
    <text x="77" y="191" font-size="12">situation report</text>
    <!-- gate 1 -->
    <rect x="170" y="118" width="150" height="120" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="245" y="138" font-weight="700" font-size="12">1 · NIMS ICS-209</text>
    <text x="245" y="162" font-size="10.5">incident no / name</text>
    <text x="245" y="182" font-size="10.5">size · % contained</text>
    <text x="245" y="202" font-size="10.5">origin lat / long</text>
    <text x="245" y="222" font-size="10.5">reporting period UTC</text>
    <!-- gate 2 -->
    <rect x="360" y="118" width="150" height="120" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="435" y="138" font-weight="700" font-size="12">2 · FEMA BPAS</text>
    <text x="435" y="162" font-size="10.5">submission schema</text>
    <text x="435" y="182" font-size="10.5">required elements</text>
    <text x="435" y="202" font-size="10.5">authoritative source</text>
    <text x="435" y="222" font-size="10.5">effective date</text>
    <!-- gate 3 -->
    <rect x="550" y="118" width="150" height="120" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <text x="625" y="138" font-weight="700" font-size="12">3 · OGC Features</text>
    <text x="625" y="162" font-size="10.5">Core class</text>
    <text x="625" y="182" font-size="10.5">GeoJSON class</text>
    <text x="625" y="202" font-size="10.5">OpenAPI 3.0 class</text>
    <text x="625" y="222" font-size="10.5">CRS declared</text>
    <!-- record -->
    <rect x="738" y="140" width="146" height="76" rx="8" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="2"/>
    <text x="811" y="168" font-weight="700" font-size="12">Conformance</text>
    <text x="811" y="185" font-weight="700" font-size="12">record</text>
    <text x="811" y="203" font-size="10.5">pass / fail + audit</text>
    <!-- findings -->
    <rect x="196" y="300" width="450" height="58" rx="8" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
    <text x="421" y="324" font-weight="700" font-size="12">Nonconformance findings + audit log</text>
    <text x="421" y="342" font-size="10.5">missing field · out-of-domain value · absent conformance class</text>
  </g>
  <!-- forward flow -->
  <g fill="none" stroke="currentColor" stroke-width="1.6" marker-end="url(#cnf-flow)">
    <path d="M136,178 H168"/>
    <path d="M320,178 H358"/>
    <path d="M510,178 H548"/>
    <path d="M700,178 H736"/>
  </g>
  <!-- fail-closed branches -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.5" stroke-dasharray="5 4" marker-end="url(#cnf-flow)">
    <path d="M245,238 V298"/>
    <path d="M435,238 V298"/>
    <path d="M625,238 V270 H500 V298"/>
  </g>
  <g font-size="10" fill="var(--crimson, currentColor)" text-anchor="middle">
    <text x="259" y="270">fail</text>
    <text x="449" y="262">fail</text>
    <text x="639" y="262">fail</text>
  </g>
</svg>
<figcaption>The dataset and situation report pass three sequential gates — NIMS ICS-209 fields, FEMA BPAS elements, and OGC API - Features conformance classes — merging into one pass/fail record; any unmet requirement fails closed into the nonconformance findings log.</figcaption>
</figure>

## Step-by-Step Implementation

### Step 1 — Encode each standard as a declarative checklist

Hard-coded validation branches rot the moment a form edition changes. Represent every requirement as data — a checklist of named requirements, each with a severity and a predicate — so the rules are versioned artifacts an audit can cite. A single evaluation engine then runs any checklist against any payload and returns one finding per requirement.

```python
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Mapping

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger(__name__)


class Severity(str, Enum):
    REQUIRED = "required"   # absence is a hard fail
    ADVISORY = "advisory"   # absence degrades but does not fail the record


@dataclass(frozen=True)
class Requirement:
    """One checkable clause of a standard."""
    key: str                                   # stable id, e.g. "ics209.incident_number"
    label: str                                 # human description for the audit log
    severity: Severity
    predicate: Callable[[Mapping[str, Any]], bool]


@dataclass
class Finding:
    key: str
    label: str
    severity: Severity
    passed: bool
    detail: str = ""


@dataclass
class Checklist:
    standard: str                              # e.g. "NIMS ICS-209"
    version: str                               # e.g. "form-edition-2022.1"
    requirements: List[Requirement] = field(default_factory=list)

    def evaluate(self, payload: Mapping[str, Any]) -> List[Finding]:
        """Evaluate every requirement; never fail fast so operators see all gaps at once."""
        findings: List[Finding] = []
        for req in self.requirements:
            try:
                passed = bool(req.predicate(payload))
                detail = "" if passed else "predicate returned False"
            except Exception as exc:
                # A predicate that raises is treated as a failed check, not a crash,
                # so one malformed field cannot abort the whole conformance run.
                logger.warning("Requirement %s raised during evaluation: %s", req.key, exc)
                passed, detail = False, f"predicate error: {exc}"
            findings.append(
                Finding(req.key, req.label, req.severity, passed, detail)
            )
        return findings
```

### Step 2 — Build and run the NIMS ICS-209 checklist

The NIMS ICS-209 Incident Status Summary carries the fields dispatch and mutual-aid coordination depend on: incident number and name, incident kind, the reporting period, current size and percent contained, and the point of origin as latitude and longitude. Encode the mandatory subset with domain guards — containment is a percentage, latitude and longitude are bounded — and evaluate the whole report so a steward sees every gap in one pass.

```python
import logging
from datetime import datetime, timezone
from typing import Any, List, Mapping

logger = logging.getLogger(__name__)


def _present(field_name: str) -> "Callable[[Mapping[str, Any]], bool]":
    return lambda p: p.get(field_name) not in (None, "")


def _pct_in_range(field_name: str) -> "Callable[[Mapping[str, Any]], bool]":
    def check(p: Mapping[str, Any]) -> bool:
        value = p.get(field_name)
        return isinstance(value, (int, float)) and 0 <= value <= 100
    return check


def _utc_timestamp(field_name: str) -> "Callable[[Mapping[str, Any]], bool]":
    def check(p: Mapping[str, Any]) -> bool:
        raw = p.get(field_name)
        if not isinstance(raw, str):
            return False
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return False
        return dt.tzinfo is not None and dt.utcoffset() == timezone.utc.utcoffset(None)
    return check


def _lat_lon_valid(p: Mapping[str, Any]) -> bool:
    lat, lon = p.get("origin_latitude"), p.get("origin_longitude")
    return (
        isinstance(lat, (int, float)) and -90 <= lat <= 90
        and isinstance(lon, (int, float)) and -180 <= lon <= 180
    )


def build_ics209_checklist() -> "Checklist":
    reqs = [
        Requirement("ics209.incident_number", "Incident number present",
                    Severity.REQUIRED, _present("incident_number")),
        Requirement("ics209.incident_name", "Incident name present",
                    Severity.REQUIRED, _present("incident_name")),
        Requirement("ics209.incident_kind", "Incident kind present",
                    Severity.REQUIRED, _present("incident_kind")),
        Requirement("ics209.report_period_utc", "Reporting period end is UTC ISO 8601",
                    Severity.REQUIRED, _utc_timestamp("report_period_end")),
        Requirement("ics209.incident_size", "Incident size (acres) is a positive number",
                    Severity.REQUIRED, lambda p: isinstance(p.get("size_acres"), (int, float)) and p["size_acres"] >= 0),
        Requirement("ics209.percent_contained", "Percent contained within 0-100",
                    Severity.REQUIRED, _pct_in_range("percent_contained")),
        Requirement("ics209.point_of_origin", "Point of origin latitude/longitude valid",
                    Severity.REQUIRED, _lat_lon_valid),
        Requirement("ics209.incident_commander", "Incident commander named",
                    Severity.ADVISORY, _present("incident_commander")),
    ]
    return Checklist(standard="NIMS ICS-209", version="form-edition-2022.1", requirements=reqs)


def run_ics209(report: Mapping[str, Any]) -> List["Finding"]:
    findings = build_ics209_checklist().evaluate(report)
    failed = [f.key for f in findings if not f.passed and f.severity is Severity.REQUIRED]
    if failed:
        logger.error("ICS-209 report failed %d required field(s): %s", len(failed), failed)
    return findings
```

### Step 3 — Assert FEMA BPAS data elements and OGC API - Features conformance

The FEMA BPAS gate checks the submission itself: that the payload matches the agreed submission schema for the business process, carries every required data element, names an authoritative source, and stamps an effective date. The OGC gate is different in kind — it interrogates a live service. OGC API - Features advertises what it supports at a `/conformance` endpoint as a list of conformance class URIs; the checklist confirms the classes your consumers require are present. Because advertising a class is only a claim, the check optionally fetches one collection and confirms the returned media type matches.

```python
import logging
from typing import Any, List, Mapping, Sequence

import httpx

logger = logging.getLogger(__name__)

# Canonical OGC API - Features conformance class URIs.
OGC_CORE = "http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core"
OGC_GEOJSON = "http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/geojson"
OGC_OPENAPI = "http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/oas30"

REQUIRED_BPAS_ELEMENTS: Sequence[str] = (
    "submission_id", "business_process", "authoritative_source",
    "effective_date", "geometry", "record_status",
)


class ConformanceUnavailable(RuntimeError):
    """Raised when a live service cannot be interrogated for its conformance declaration."""


def build_bpas_checklist() -> "Checklist":
    reqs = [
        Requirement(f"bpas.element.{name}", f"Required BPAS element '{name}' present",
                    Severity.REQUIRED, _present(name))
        for name in REQUIRED_BPAS_ELEMENTS
    ]
    reqs.append(
        Requirement("bpas.effective_date_utc", "Effective date is UTC ISO 8601",
                    Severity.REQUIRED, _utc_timestamp("effective_date"))
    )
    return Checklist(standard="FEMA BPAS", version="bpas-2024.03", requirements=reqs)


def fetch_ogc_conformance(base_url: str, timeout_s: float = 10.0) -> List[str]:
    """Return the conformance class URIs a service advertises at /conformance."""
    url = base_url.rstrip("/") + "/conformance"
    try:
        resp = httpx.get(url, headers={"Accept": "application/json"}, timeout=timeout_s)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        logger.error("Could not reach OGC conformance endpoint %s: %s", url, exc)
        raise ConformanceUnavailable(f"conformance fetch failed for {base_url}") from exc
    classes = resp.json().get("conformsTo", [])
    logger.info("Service %s advertises %d conformance class(es)", base_url, len(classes))
    return list(classes)


def build_ogc_checklist(advertised: Sequence[str]) -> "Checklist":
    advertised_set = set(advertised)
    required = {
        "ogc.core": OGC_CORE,
        "ogc.geojson": OGC_GEOJSON,
    }
    advisory = {"ogc.openapi": OGC_OPENAPI}
    reqs: List[Requirement] = []
    for key, uri in required.items():
        reqs.append(Requirement(key, f"Conformance class advertised: {uri}",
                                Severity.REQUIRED, (lambda u: lambda _p: u in advertised_set)(uri)))
    for key, uri in advisory.items():
        reqs.append(Requirement(key, f"Conformance class advertised: {uri}",
                                Severity.ADVISORY, (lambda u: lambda _p: u in advertised_set)(uri)))
    return Checklist(standard="OGC API - Features", version="part1-1.0", requirements=reqs)
```

### Step 4 — Merge findings into an auditable conformance record

A conformance decision that leaves no trace is indistinguishable from an unchecked one. Aggregate the findings from all three gates into a single immutable record that names each checklist version, timestamps the evaluation in UTC, and lists every requirement result. Overall `conformant` is true only when no `REQUIRED` finding failed; advisory failures are surfaced but do not veto the record. Emit that record to the audit sink alongside the same lineage the [Emergency Metadata Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/) layer records for every published artifact.

```python
import json
import logging
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping, Tuple

logger = logging.getLogger(__name__)


def build_conformance_record(
    artifact_id: str,
    checklist_results: List[Tuple["Checklist", List["Finding"]]],
) -> Dict[str, Any]:
    """Aggregate multi-standard findings into one immutable, auditable record."""
    gates: List[Dict[str, Any]] = []
    overall_conformant = True

    for checklist, findings in checklist_results:
        required_failures = [
            f for f in findings if not f.passed and f.severity is Severity.REQUIRED
        ]
        gate_pass = not required_failures
        overall_conformant &= gate_pass
        gates.append({
            "standard": checklist.standard,
            "checklist_version": checklist.version,
            "conformant": gate_pass,
            "findings": [asdict(f) | {"severity": f.severity.value} for f in findings],
        })

    record = {
        "artifact_id": artifact_id,
        "evaluated_utc": datetime.now(timezone.utc).isoformat(),
        "conformant": overall_conformant,
        "gates": gates,
    }
    level = logging.INFO if overall_conformant else logging.ERROR
    logger.log(level, "Conformance for %s: %s", artifact_id,
               "PASS" if overall_conformant else "FAIL")
    return record


def emit_conformance_record(record: Mapping[str, Any], sink_path: str) -> None:
    """Append the record to a durable, append-only audit log (never overwrite)."""
    try:
        with open(sink_path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, sort_keys=True) + "\n")
    except OSError as exc:
        # Failing to persist an audit record must be loud: a silent audit gap is a
        # compliance failure in its own right.
        logger.critical("Failed to persist conformance record for %s: %s",
                        record.get("artifact_id"), exc)
        raise
```

## Configuration Reference

Tune these per deployment; a steady-state cloud validation service and an offline field node evaluating cached submissions will diverge.

| Parameter | Env var | Default | Notes |
|-----------|---------|---------|-------|
| ICS-209 checklist version | `CONF_ICS209_VERSION` | `form-edition-2022.1` | Pin to the form edition in force; bump when a new edition ships. |
| BPAS element set | `CONF_BPAS_VERSION` | `bpas-2024.03` | Names the required-element list; recorded in every gate result. |
| OGC base URL | `CONF_OGC_BASE_URL` | _unset_ | Feature-service root; the `/conformance` endpoint is derived from it. |
| OGC required classes | `CONF_OGC_REQUIRED` | `core,geojson` | Comma list; add `oas30` where consumers need the OpenAPI description. |
| Conformance HTTP timeout | `CONF_OGC_TIMEOUT_S` | `10` | Lower on flaky links so the check fails to a warning instead of hanging. |
| Advisory severity treatment | `CONF_FAIL_ON_ADVISORY` | `false` | When `true`, advisory failures also veto the record for strict programs. |
| Audit sink path | `CONF_AUDIT_SINK` | `/var/local/conformance_audit.jsonl` | Durable append-only storage, never tmpfs. |
| Offline conformance cache | `CONF_OGC_CACHE` | `/var/local/ogc_conformance.json` | Last-good declaration used when the service is unreachable. |

## Verification & Smoke Test

Run these assertions on a staging node before promoting a checklist change. They confirm that a complete report passes, that a missing required field fails the record without aborting evaluation, and that advisory failures do not veto conformance.

```python
import logging

logger = logging.getLogger(__name__)


def smoke_test() -> None:
    good_report = {
        "incident_number": "CA-ABC-012345",
        "incident_name": "Ridge Complex",
        "incident_kind": "Wildfire",
        "report_period_end": "2026-07-13T06:00:00Z",
        "size_acres": 14200,
        "percent_contained": 35,
        "origin_latitude": 39.51,
        "origin_longitude": -121.44,
        # incident_commander (advisory) intentionally omitted
    }

    # 1. A complete report passes ICS-209 with only an advisory gap.
    findings = run_ics209(good_report)
    required_failed = [f for f in findings if not f.passed and f.severity is Severity.REQUIRED]
    assert not required_failed, "complete report must satisfy every required field"

    # 2. Evaluation does not fail fast: all requirements are reported.
    assert len(findings) == len(build_ics209_checklist().requirements)

    # 3. A missing required field fails the record but not the run.
    bad = {k: v for k, v in good_report.items() if k != "percent_contained"}
    bad_findings = run_ics209(bad)
    assert any(f.key == "ics209.percent_contained" and not f.passed for f in bad_findings)

    # 4. Advisory-only failure still yields an overall conformant record.
    record = build_conformance_record("INC-smoke", [(build_ics209_checklist(), findings)])
    assert record["conformant"] is True, "advisory gap must not veto conformance"

    logger.info("conformance smoke test passed")


smoke_test()
```

A continuous-integration equivalent confirms the module imports and the HTTP dependency resolves before the checklist ships:

```bash
python -c "import httpx, pydantic; print('conformance stack ok')"
python -m emergency_conformance.smoke   # exits non-zero on any failed assertion
```

## Integration With Adjacent Workflows

The conformance checklist sits at the reporting boundary of the [Core Emergency GIS Architecture & Data Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/) contract, downstream of ingestion and upstream of external submission. It assumes geometry and coordinate references were already validated by the [Geospatial Data Ingestion Pipelines](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/) stage, so an ICS-209 field failure points to a reporting-completeness gap rather than corrupt spatial data. Each conformance record it emits is itself lineage, and must be filed under the [Emergency Metadata Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/) contract so post-incident audits can reconstruct exactly which checklist edition judged which artifact and when. When the goal is not a one-off check but a recurring, scheduled export of the situation report to a partner system, the batch-export procedure and its field mapping are covered in [Automating NIMS ICS-209 Situation Report Exports](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/compliance-checklists-nims-fema-ogc/automating-nims-ics-209-situation-report-exports/).

## Troubleshooting

**Symptom: a report that operators swear is complete still fails the ICS-209 gate.** A required field is present but out of domain — commonly `percent_contained` stored as the string `"35%"` rather than the number `35`, or a size in hectares where the checklist expects acres. The domain predicates in Step 2 fail closed on type, so inspect the offending `Finding.detail`; normalize units and coerce numerics at the metadata-mapping layer before the report reaches the gate.

**Symptom: the OGC gate fails even though the service clearly returns GeoJSON.** Returning GeoJSON is not the same as advertising the conformance class. The service may serve GeoJSON while its `/conformance` list omits the `geojson` class URI, or exposes it under a versioned path the checklist does not match. Fetch `/conformance` directly, compare the exact URIs against `OGC_GEOJSON`, and only then decide whether the service or the checklist constant needs updating.

**Symptom: conformance runs hang for tens of seconds during a network brownout.** The OGC check is blocking on an unreachable `/conformance` endpoint. Lower `CONF_OGC_TIMEOUT_S`, catch `ConformanceUnavailable`, and fall back to the cached declaration at `CONF_OGC_CACHE` so the gate records an advisory warning instead of stalling the whole conformance run during a surge.

**Symptom: an after-action review cannot reproduce a past pass/fail decision.** The conformance record did not capture the checklist version, or the audit sink was overwritten instead of appended. Confirm every gate result carries its `checklist_version`, that `emit_conformance_record` opens the sink in append mode, and that `CONF_AUDIT_SINK` points at durable storage rather than an ephemeral container layer.

**Symptom: a strict program wants advisory gaps to block, but they pass.** By default advisory findings are surfaced without vetoing the record. Set `CONF_FAIL_ON_ADVISORY` to `true` and have `build_conformance_record` fold advisory failures into the `overall_conformant` reduction so the stricter policy is explicit and, crucially, recorded in the audit trail.

## Frequently Asked Questions

**Should a conformance check stop at the first failed requirement?**
No. Fail-fast validation forces operators through repeated submit-fix-resubmit cycles under time pressure. Evaluate every requirement, collect each violation as a discrete finding, and emit one conformance record that lists all failures at once so a data steward can remediate the whole payload in a single pass.

**How do I confirm a service actually conforms to OGC API - Features?**
Request the service's `/conformance` endpoint and compare the advertised conformance class URIs against the set your workflow requires, at minimum Core and GeoJSON. Advertising a class is a claim, so a hardened checklist also fetches one collection and validates that the returned representation matches the advertised media type before recording a pass.

**Why version the checklists instead of hard-coding the rules?**
Standards revise: ICS-209 fields change between form editions and OGC adds conformance classes. If the rules are versioned data, every conformance record can name the exact checklist edition it was judged against, so an after-action audit can reproduce the decision instead of guessing which rules were active when the record was written.

## Related

- [Automating NIMS ICS-209 Situation Report Exports](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/compliance-checklists-nims-fema-ogc/automating-nims-ics-209-situation-report-exports/)
- [Emergency Metadata Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/)
- [Geospatial Data Ingestion Pipelines](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/)

Up: [Core Emergency GIS Architecture & Data Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/)
