# Validating FEMA Shapefile Schemas Automatically

A county GIS analyst pulls a fresh `damage_assessment.shp` from a Federal Emergency Management Agency (FEMA) mutual-aid drop two hours into a flood activation, runs it straight into the operational geodatabase, and the dispatch map silently loses every structure with a damage code longer than ten characters. The shapefile loaded without error — the failure mode this page solves is narrower and nastier than a crashed import: a FEMA shapefile whose attribute schema *almost* matches the contract you expect, drifting just enough that joins, severity filters, and resource-allocation queries return wrong answers without raising an exception. This page covers detecting and repairing that schema drift at the ingestion boundary, before a single feature reaches a situation map.

## Root Cause and Operational Impact

The shapefile format predates modern emergency data standards, and its dBASE (`.dbf`) attribute table imposes a hard ten-character limit on field names. When FEMA, a state emergency management agency, and a contractor each export the same logical layer, `INCIDENT_IDENTIFIER` becomes `INCIDENT_I`, `INCIDEN_01`, or a truncated collision — and `geopandas.read_file()` accepts all three without complaint. Add to that the `.prj` sidecar, which is advisory rather than authoritative: a layer labelled EPSG:4326 may actually carry State Plane easting/northing values, and the reader will trust the label.

In a non-emergency setting this is a data-cleaning chore. During an active incident it is dangerous. A truncated `SEVERITY_LEVEL` field breaks the severity filter that triages structures for inspection, so the most damaged buildings drop off the work queue. A mislabelled CRS shifts a hazard perimeter by hundreds of metres, sending crews to the wrong block. And because the import *succeeded*, no operator knows to look. Schema drift therefore has to be caught structurally — by comparing the incoming field set, types, and projection against an explicit contract — rather than by visual inspection under load. This is the federal-format edge of the broader [automated attribute validation rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/) every multi-agency pipeline depends on.

<svg viewBox="0 0 900 470" role="img" aria-label="Data-flow diagram of FEMA shapefile schema validation. A shapefile and its .dbf and .prj sidecars enter a repair stage that remaps truncated field names and forces a known EPSG code, then reaches a schema-validation gate. Features that satisfy the canonical contract pass to the operational geodatabase. Features with a recoverable defect loop back through the repair stage. Features with an unrecoverable defect are quarantined to a local GeoPackage cache alongside a structured audit record." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>FEMA shapefile schema-validation data flow</title>
  <desc>An incoming FEMA shapefile, carrying its dBASE attribute table and projection sidecar, first enters a repair stage that renames aliased and truncated DBF columns to canonical names and forces an authoritative EPSG code when the .prj is missing or untrustworthy. The repaired layer then hits the schema-validation gate, which checks field presence, declared types, enum and range constraints, and geometry validity. Features that satisfy the contract pass to the operational geodatabase and the situation map. Features whose defect is recoverable — a coercible over-length string or an invalid polygon — loop back through the repair stage to be coerced in place. Features whose mandatory field cannot be recovered are routed to a quarantine GeoPackage on the local cache, each paired with a structured audit record naming the failed field and rule for a later reconciliation pass.</desc>
  <defs>
    <marker id="fema-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
    <marker id="fema-arrow-warn" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
  </defs>
  <!-- input: shapefile + sidecars -->
  <g font-size="12.5" text-anchor="middle" fill="currentColor">
    <rect x="24" y="186" width="180" height="74" rx="8" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <text x="114" y="210" font-weight="700">FEMA drop</text>
    <text x="114" y="229" font-family="monospace" font-size="11">.shp</text>
    <text x="114" y="246" font-family="monospace" font-size="11">.dbf · .prj sidecars</text>
  </g>
  <!-- repair stage -->
  <g font-size="12.5" text-anchor="middle" fill="currentColor">
    <rect x="272" y="180" width="190" height="86" rx="8" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <text x="367" y="204" font-weight="700">Repair stage</text>
    <text x="367" y="223" font-size="11">remap truncated fields</text>
    <text x="367" y="239" font-size="11">force region EPSG</text>
    <text x="367" y="255" font-size="11">coerce · make_valid()</text>
  </g>
  <!-- validation gate (diamond) -->
  <g font-size="12.5" text-anchor="middle" fill="currentColor">
    <path d="M620,223 L548,170 L620,117 L692,170 Z" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <text x="620" y="160" font-weight="700">Schema</text>
    <text x="620" y="178" font-weight="700">gate</text>
    <text x="620" y="196" font-size="10.5">contract check</text>
  </g>
  <!-- PASS target -->
  <g font-size="12.5" text-anchor="middle" fill="currentColor">
    <rect x="744" y="34" width="148" height="74" rx="8" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <text x="818" y="58" font-weight="700">PASS</text>
    <text x="818" y="77" font-size="11">operational</text>
    <text x="818" y="93" font-size="11">geodatabase · map</text>
  </g>
  <!-- QUARANTINE target -->
  <g font-size="12.5" text-anchor="middle">
    <rect x="744" y="346" width="148" height="92" rx="8" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.8"/>
    <text x="818" y="372" font-weight="700" fill="var(--crimson, currentColor)">QUARANTINE</text>
    <text x="818" y="392" font-size="11" fill="currentColor">GeoPackage · local cache</text>
    <text x="818" y="409" font-size="11" fill="currentColor">+ audit record</text>
    <text x="818" y="426" font-size="10.5" fill="currentColor">(field · rule)</text>
  </g>
  <!-- main left-to-right flow -->
  <g fill="none" stroke="currentColor" stroke-width="1.6" marker-end="url(#fema-arrow)">
    <path d="M204,223 H268"/>
    <path d="M462,206 C500,206 516,190 544,179"/>
  </g>
  <!-- PASS branch up -->
  <g fill="none" stroke="currentColor" stroke-width="1.6" marker-end="url(#fema-arrow)">
    <path d="M620,117 V71 H740"/>
  </g>
  <text x="636" y="100" font-size="10.5" fill="currentColor" text-anchor="start">contract met</text>
  <!-- REPAIR loop back -->
  <g fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 4" marker-end="url(#fema-arrow)">
    <path d="M608,224 C580,270 470,290 380,290 V270"/>
  </g>
  <text x="470" y="307" font-size="10.5" fill="currentColor" text-anchor="middle">recoverable · re-coerce</text>
  <!-- QUARANTINE branch down -->
  <g fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" stroke-dasharray="5 4" marker-end="url(#fema-arrow-warn)">
    <path d="M632,224 C660,300 700,360 740,386"/>
  </g>
  <text x="694" y="318" font-size="10.5" fill="var(--crimson, currentColor)" text-anchor="middle">unrecoverable</text>
</svg>

## Tiered Resolution Strategy

Validation cannot be all-or-nothing during a response; a hard reject on the only damage layer you have is itself an operational failure. Apply these tiers in order, escalating only when the cleaner option is impossible:

1. **Definitive fix — canonical field remap.** Match incoming `.dbf` field names against a maintained alias table (`INCIDENT_I` → `incident_id`) and rename to the canonical schema. This recovers truncation losses losslessly when the mapping is known.
2. **Reproject against a known region code.** If the `.prj` is missing or contradicts the geometry's coordinate extent, force the explicit EPSG code registered for that FEMA region rather than trusting the label, then reproject to the storage CRS. This depends on a sound [coordinate reference system standard for disaster zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) being defined upstream.
3. **Coerce and repair in place.** Truncate over-length strings to the contract limit, repair invalid polygon topology with `make_valid()`, and cast numeric fields to their declared types.
4. **Safe default with audit flag.** When a mandatory field genuinely cannot be recovered, do not drop the feature silently. Route it to a quarantine GeoPackage with a structured audit record naming the failed field and rule, so a reconciliation pass can resolve it once the surge eases.

The distinction that makes this worth automating is between a field being *present* and a field being *conformant*, which a manual review conflates almost every time.

<svg viewBox="0 0 880 400" role="img" aria-labelledby="fe-t fe-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="fe-t">A submission checked field by field against the required element set</title>
  <desc id="fe-d">Seven required elements checked against one agency submission. Four are present and correctly typed. SEVERITY is present but carries a value outside the permitted enumeration. ACRES is present but declared as an integer where a decimal with two places is required, so fractional acreage is silently truncated on load. SRC_AGENCY is absent entirely. Only the absent field would be caught by a check that asks whether the column exists; the other two failures are present-but-wrong, which is the category that reaches the reviewer looking complete. A conformance check therefore has to compare declared types and enumerations, not merely names.</desc>
  <rect x="0" y="0" width="880" height="400" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">present is not the same as conformant</text>
  <text x="8" y="76" font-size="10" fill="var(--muted)">required element</text>
  <text x="216" y="76" font-size="10" fill="var(--muted)">declared type</text>
  <text x="330" y="76" font-size="10" fill="var(--muted)">state in this submission</text>
  <rect x="200" y="92" width="500" height="30" rx="5" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.4"/>
  <text x="8" y="112" font-size="10.5" font-family="var(--font-mono)" fill="currentColor">INCIDENT_ID</text>
  <text x="216" y="112" font-size="10.5" font-family="var(--font-mono)" fill="var(--muted)">C(20)</text>
  <text x="330" y="112" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">present</text>
  <rect x="200" y="130" width="500" height="30" rx="5" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.4"/>
  <text x="8" y="150" font-size="10.5" font-family="var(--font-mono)" fill="currentColor">INCIDENT_NM</text>
  <text x="216" y="150" font-size="10.5" font-family="var(--font-mono)" fill="var(--muted)">C(60)</text>
  <text x="330" y="150" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">present</text>
  <rect x="200" y="168" width="500" height="30" rx="5" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.4"/>
  <text x="8" y="188" font-size="10.5" font-family="var(--font-mono)" fill="currentColor">DECLARED_DT</text>
  <text x="216" y="188" font-size="10.5" font-family="var(--font-mono)" fill="var(--muted)">D</text>
  <text x="330" y="188" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">present</text>
  <rect x="200" y="206" width="500" height="30" rx="5" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.4"/>
  <text x="8" y="226" font-size="10.5" font-family="var(--font-mono)" fill="currentColor">SEVERITY</text>
  <text x="216" y="226" font-size="10.5" font-family="var(--font-mono)" fill="var(--muted)">C(12)</text>
  <text x="330" y="226" font-size="10.5" font-weight="700" fill="var(--ember-text)">enum mismatch</text>
  <rect x="200" y="244" width="500" height="30" rx="5" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.4"/>
  <text x="8" y="264" font-size="10.5" font-family="var(--font-mono)" fill="currentColor">ACRES</text>
  <text x="216" y="264" font-size="10.5" font-family="var(--font-mono)" fill="var(--muted)">N(12,2)</text>
  <text x="330" y="264" font-size="10.5" font-weight="700" fill="var(--ember-text)">typed N(10,0)</text>
  <rect x="200" y="282" width="500" height="30" rx="5" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.4"/>
  <text x="8" y="302" font-size="10.5" font-family="var(--font-mono)" fill="currentColor">SRC_AGENCY</text>
  <text x="216" y="302" font-size="10.5" font-family="var(--font-mono)" fill="var(--muted)">C(40)</text>
  <text x="330" y="302" font-size="10.5" font-weight="700" fill="var(--ember-text)">absent</text>
  <rect x="200" y="320" width="500" height="30" rx="5" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.4"/>
  <text x="8" y="340" font-size="10.5" font-family="var(--font-mono)" fill="currentColor">GEOM_TYPE</text>
  <text x="216" y="340" font-size="10.5" font-family="var(--font-mono)" fill="var(--muted)">C(12)</text>
  <text x="330" y="340" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">present</text>
  <rect x="720" y="130" width="140" height="30" rx="5" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.4"/>
  <text x="736" y="150" font-size="9.5" font-weight="700" fill="var(--ember-text)">value outside enum</text>
  <rect x="720" y="168" width="140" height="30" rx="5" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.4"/>
  <text x="736" y="188" font-size="9.5" font-weight="700" fill="var(--ember-text)">decimals truncated</text>
  <rect x="720" y="206" width="140" height="30" rx="5" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.4"/>
  <text x="736" y="226" font-size="9.5" font-weight="700" fill="var(--ember-text)">the only obvious one</text>
  <text x="8" y="372" font-size="10.5" fill="currentColor">A name-only check passes six of seven and admits a submission with an invalid severity and truncated acreage.</text>
</svg>

A reviewer opening the attribute table sees seven columns with the right names and reasonable-looking values. The absent `SRC_AGENCY` is obvious and gets flagged. The other two failures are not visible at all: `SEVERITY` holds a string the agency uses internally that is not in the permitted enumeration, and `ACRES` is declared as an integer, so every fractional acreage in the submission was truncated at load time and the values on screen are the truncated ones. Nothing in the table announces either.

The acreage case is the one worth internalising, because the data loss happened before anybody looked. A DBF column declared `N(10,0)` cannot hold 4,182.65; the writer rounded it, and the original value exists only in the source system. Re-exporting with the correct type does not recover it — the submission has to be regenerated. That is a materially different remediation from "add the missing column", and knowing which one you are facing is the difference between a ten-minute fix and a resubmission.

So the check has to read the DBF field descriptors rather than the loaded DataFrame. By the time `geopandas` has a frame in memory, the declared width and decimal count are gone and an integer column is indistinguishable from a decimal column that happens to hold whole numbers. Read the descriptors, compare them to the required element set, and report type mismatches with the same severity as absences — because in this case the type mismatch is the more expensive one.

## Production Python Implementation

The handler below walks the full resolution path: read, remap fields against the alias table, validate the schema contract, repair geometry, normalise CRS, and emit a structured audit trail for every feature it cannot pass cleanly. It uses explicit type hints and structured logging, and never drops a feature without recording why.

```python
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import geopandas as gpd
from pyproj import CRS
from shapely.validation import make_valid

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("fema_schema_validator")

# Canonical contract: declared field -> rules. Aliases capture known DBF truncations.
FEMA_SCHEMA: dict[str, dict[str, Any]] = {
    "incident_id": {"dtype": str, "required": True, "max_len": 20,
                    "aliases": ("INCIDENT_I", "INCIDEN_01", "INC_ID")},
    "status": {"dtype": str, "required": True,
               "allowed": {"ACTIVE", "CONTAINED", "RESOLVED"},
               "aliases": ("STATUS", "STAT")},
    "severity": {"dtype": int, "required": True, "min_val": 1, "max_val": 5,
                 "aliases": ("SEVERITY_L", "SEV_LEVEL", "SEV")},
}

# FEMA region -> authoritative EPSG, used when the .prj is absent or untrustworthy.
REGION_EPSG: dict[str, int] = {"VI": 32161, "VI_GUAM": 32655}
STORAGE_EPSG = 4326


def _remap_fields(gdf: gpd.GeoDataFrame) -> tuple[gpd.GeoDataFrame, list[str]]:
    """Rename truncated/aliased DBF columns to canonical contract names."""
    notes: list[str] = []
    rename: dict[str, str] = {}
    for canonical, rules in FEMA_SCHEMA.items():
        if canonical in gdf.columns:
            continue
        for alias in rules.get("aliases", ()):  # first matching alias wins
            if alias in gdf.columns:
                rename[alias] = canonical
                notes.append(f"remapped {alias!r} -> {canonical!r}")
                break
    return gdf.rename(columns=rename), notes


def _normalise_crs(gdf: gpd.GeoDataFrame, region: str | None) -> gpd.GeoDataFrame:
    """Force a known EPSG when the .prj is missing, then reproject to storage CRS."""
    target = CRS.from_epsg(STORAGE_EPSG)
    if gdf.crs is None and region in REGION_EPSG:
        logger.warning("Missing .prj; forcing EPSG:%s for region %s",
                       REGION_EPSG[region], region)
        gdf = gdf.set_crs(epsg=REGION_EPSG[region], allow_override=True)
    if gdf.crs is None:
        raise ValueError("Unresolvable CRS: no .prj and no region override")
    return gdf if gdf.crs.equals(target) else gdf.to_crs(target)


def _validate_row(row: "gpd.GeoSeries", idx: int) -> list[dict[str, Any]]:
    """Return a list of audit records; empty list means the feature passed."""
    audit: list[dict[str, Any]] = []
    for col, rules in FEMA_SCHEMA.items():
        if col not in row.index:
            if rules.get("required"):
                audit.append({"feature": idx, "field": col, "rule": "required",
                              "detail": "field absent after remap"})
            continue
        val = row[col]
        if isinstance(val, str) and rules.get("max_len") and len(val) > rules["max_len"]:
            row[col] = val[: rules["max_len"]]  # coerce, not reject
        if rules.get("allowed") and val not in rules["allowed"]:
            audit.append({"feature": idx, "field": col, "rule": "enum",
                          "detail": f"{val!r} not in {sorted(rules['allowed'])}"})
        if rules.get("dtype") is int:
            try:
                ival = int(val)
            except (TypeError, ValueError):
                audit.append({"feature": idx, "field": col, "rule": "dtype",
                              "detail": f"{val!r} not coercible to int"})
                continue
            if not (rules["min_val"] <= ival <= rules["max_val"]):
                audit.append({"feature": idx, "field": col, "rule": "range",
                              "detail": f"{ival} outside [{rules['min_val']},{rules['max_val']}]"})
    return audit


def validate_fema_shapefile(
    input_path: str,
    region: str | None = None,
    quarantine_dir: str = "./quarantine",
) -> dict[str, Any]:
    """Validate a FEMA shapefile against the canonical schema and route results.

    Returns a dict with the validated GeoDataFrame (if any) and an audit trail.
    """
    try:
        gdf = gpd.read_file(input_path)
    except Exception as exc:  # driver, encoding, or missing-sidecar failures
        logger.error("Read failure for %s: %s", input_path, exc)
        return {"status": "READ_ERROR", "detail": str(exc)}

    gdf, remap_notes = _remap_fields(gdf)
    for note in remap_notes:
        logger.info("Schema: %s", note)

    # Repair topology before attribute checks so geometry never aborts the batch.
    invalid = ~gdf.geometry.is_valid
    if invalid.any():
        logger.warning("Repairing %d invalid geometries", int(invalid.sum()))
        gdf.loc[invalid, "geometry"] = gdf.loc[invalid, "geometry"].apply(make_valid)

    audit_trail: list[dict[str, Any]] = []
    keep_idx: list[int] = []
    for idx, row in gdf.iterrows():
        issues = _validate_row(row, idx)
        if issues:
            audit_trail.extend(issues)
        else:
            keep_idx.append(idx)

    try:
        region_used = region
        validated = _normalise_crs(gdf.loc[keep_idx].copy(), region_used) if keep_idx else None
    except ValueError as exc:
        logger.error("CRS normalisation failed: %s", exc)
        return {"status": "CRS_ERROR", "detail": str(exc), "audit": audit_trail}

    quarantined = gdf.index.difference(keep_idx)
    if len(quarantined):
        Path(quarantine_dir).mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        gdf.loc[quarantined].to_file(
            Path(quarantine_dir) / f"quarantine_{stamp}.gpkg", driver="GPKG")
        (Path(quarantine_dir) / f"audit_{stamp}.json").write_text(
            json.dumps(audit_trail, indent=2, default=str))
        logger.warning("Quarantined %d features; audit written", len(quarantined))

    logger.info("Validation complete: %d passed, %d quarantined",
                len(keep_idx), len(quarantined))
    return {
        "status": "SUCCESS" if keep_idx else "NO_VALID_FEATURES",
        "validated_gdf": validated,
        "passed": len(keep_idx),
        "quarantined": len(quarantined),
        "audit": audit_trail,
    }
```

The audit JSON is the load-bearing output here: it is what lets a post-surge reconciliation worker re-process quarantined features and what satisfies the chain-of-custody expectations that downstream [conflict resolution in multi-agency edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/) relies on when reconciling the same layer across agencies.

It is worth tracing exactly where the acreage went, because it determines what the remediation has to be.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="f2-t f2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="f2-t">Where the truncation happens, and why re-exporting does not recover it</title>
  <desc id="f2-d">A value of 4,182.65 acres travels from the source system through a DBF column declared as a ten-digit integer with no decimal places. The writer rounds it to 4,183 at the moment it is written, so the fractional part is gone before the file exists. Everything downstream — the loaded frame, the validation check, the reviewer's attribute table — sees 4,183 and has no way to know it was ever anything else. Correcting the column type and re-exporting from the already-written shapefile reproduces 4,183.00, not the original value; only regenerating from the source system recovers it. This is why a type mismatch is a resubmission rather than a repair.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">the loss happens at write time — everything after it is downstream of the evidence</text>
  <rect x="40" y="96" width="180" height="64" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="58" y="122" font-size="10.5" font-weight="700" fill="currentColor">source system</text>
  <text x="58" y="144" font-size="14" font-weight="700" fill="var(--crimson-deep)">4182.65</text>
  <path d="M220 128 H300" fill="none" stroke="var(--crimson)" stroke-width="2"/>
  <rect x="300" y="96" width="180" height="64" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="318" y="122" font-size="10.5" font-weight="700" fill="var(--ember-text)">DBF write · N(10,0)</text>
  <text x="318" y="144" font-size="14" font-weight="700" fill="var(--ember-text)">4183</text>
  <path d="M480 128 H560" fill="none" stroke="var(--crimson)" stroke-width="2"/>
  <rect x="560" y="96" width="280" height="64" rx="9" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.4"/>
  <text x="578" y="122" font-size="10.5" font-weight="700" fill="currentColor">frame · check · reviewer's table</text>
  <text x="578" y="144" font-size="14" font-weight="700" fill="currentColor">4183 — and no trace of 4182.65</text>
  <text x="318" y="182" font-size="10" font-weight="700" fill="var(--ember-text)">the fractional part ceases to exist here</text>
  <rect x="40" y="222" width="800" height="52" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.8"/>
  <text x="60" y="244" font-size="10.5" font-weight="700" fill="var(--ember-text)">re-exporting the shapefile with a corrected type yields 4183.00</text>
  <text x="60" y="264" font-size="10.5" fill="currentColor">only regeneration from the source recovers the value — which is why a type mismatch is a resubmission, not a repair</text>
  <text x="8" y="316" font-size="10.5" fill="currentColor">Read the DBF field descriptors, not the loaded frame: once it is a DataFrame, N(10,0) and N(12,2) look identical.</text>
</svg>

The practical rule that follows: report type mismatches as *blocking* and with a remediation of "regenerate from source", not "fix and re-export". Those read similarly in a ticket and mean entirely different things — one is a five-minute GDAL invocation against the file you already have, the other requires the authoring agency to run their export again. Getting the wording wrong sends a reviewer down a path that produces a conformant-looking file containing rounded values, which is the same defect with a passing check on top of it.

The same reasoning applies to string widths. A `C(20)` column receiving a 34-character incident name truncates it at write time, and the truncated name is what every downstream match will use. Because incident names are frequently the join key between an agency's records and the federal submission, a silently shortened name breaks correlation in a way that surfaces weeks later as "our numbers do not reconcile".

Check widths and decimal counts on every character and numeric field, not only on the ones that look important. The cost is a few lines against the field descriptors; the alternative is discovering the constraint by finding the data that violated it.

## Validation Checklist

Run through these before pointing the handler at a live FEMA drop in the field:

- [ ] The alias table covers every truncated field name seen in samples from each contributing agency, not just FEMA's own export.
- [ ] `REGION_EPSG` holds the authoritative code for the activation's region, and the `region` argument is passed explicitly.
- [ ] Geometry repair runs before attribute validation, so a bad polygon never aborts the batch.
- [ ] Over-length strings are coerced to the contract limit, while missing mandatory fields and enum violations are quarantined, not silently passed.
- [ ] Every quarantined feature produces a matching audit record naming the failed field and rule.
- [ ] Output reprojects to the storage CRS (`EPSG:4326` here) only after CRS normalisation has resolved a trustworthy source projection.
- [ ] The quarantine GeoPackage and audit JSON land on persistent storage that survives a device reboot or loss of connectivity.

## Edge Cases and Gotchas

**Axis-order inversion.** A `.prj` that names a CRS in lat/lon (Y, X) axis order while the geometry stores lon/lat will pass `set_crs` cleanly and then reproject to the wrong hemisphere. Cross-check the centroid against the activation's expected bounding box after `_normalise_crs`, not just the CRS object.

**Null-island drift.** Features that lost their geometry to a failed join often default to `(0, 0)` off the West African coast. They are valid polygons by topology but operationally meaningless; add a bounds guard so the centroid check quarantines anything at null island rather than mapping it onto the situation display.

**Encoding on legacy CAD exports.** Older `.dbf` files written by computer-aided dispatch systems frequently use CP1252 rather than UTF-8, so accented place names arrive mojibaked and break enum matching. Pass an explicit `encoding=` to `read_file` per agency, and treat an encoding mismatch as a remap problem, not a data-quality reject.

**Agency-specific datum anomalies.** Territories such as the U.S. Virgin Islands and Guam sit on local datums whose State Plane zones are easy to mislabel as CONUS codes. Keep the region override authoritative and never infer the datum from the field crew's device, which may itself carry [missing or wrong CRS in field-collected GPS logs](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/handling-missing-crs-in-field-collected-gps-logs/).

**Quarantine on offline devices.** When the validator runs on a ruggedised tablet, the quarantine GeoPackage is the only record of rejected features until sync. Treat it as a first-class artefact of your [offline GIS data caching strategy](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/) so the audit trail survives until connectivity returns.

## Related

- [Automated Attribute Validation Rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/) — the parent pattern this federal-format handler plugs into.
- [Conflict Resolution in Multi-Agency Edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/) — what consumes the audit trail when the same layer arrives from several agencies.
- [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) — the CRS contract the reprojection step enforces.

Up: [Automated Attribute Validation Rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/)
