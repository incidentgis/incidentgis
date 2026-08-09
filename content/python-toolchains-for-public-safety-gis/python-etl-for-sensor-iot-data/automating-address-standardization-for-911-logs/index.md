---
title: "Automating Address Standardization for 911 Logs"
description: "Deterministic Python ETL that normalises malformed CAD address strings into NG911-routable records: usaddress parsing with regex fallback, MSAG reconciliation, audit-flagging, and a validation checklist for PSAP deployment."
slug: automating-address-standardization-for-911-logs
type: article
breadcrumb: "Address Standardization for 911 Logs"
datePublished: "2025-03-04"
dateModified: "2026-06-25"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Automating Address Standardization for 911 Logs",
      "description": "Deterministic Python ETL that normalises malformed CAD address strings into NG911-routable records: usaddress parsing with regex fallback, MSAG reconciliation, audit-flagging, and a validation checklist for PSAP deployment.",
      "datePublished": "2025-03-04",
      "dateModified": "2026-06-25",
      "author": { "@type": "Organization", "name": "Incident GIS" },
      "publisher": { "@type": "Organization", "name": "Incident GIS" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.incidentgis.com/" },
        { "@type": "ListItem", "position": 2, "name": "Python Toolchains for Public Safety GIS", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/" },
        { "@type": "ListItem", "position": 3, "name": "Python ETL for Sensor & IoT Data", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/python-etl-for-sensor-iot-data/" },
        { "@type": "ListItem", "position": 4, "name": "Address Standardization for 911 Logs", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/python-etl-for-sensor-iot-data/automating-address-standardization-for-911-logs/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Standardize malformed 911 CAD address strings for NG911 routing",
      "description": "Parse raw Computer-Aided Dispatch address text with a deterministic fallback chain, reconcile it against the Master Street Address Guide, and emit an audit trail for every correction.",
      "step": [
        { "@type": "HowToStep", "name": "Parse with a primary library", "text": "Run usaddress over the raw string to extract number, predirectional, street name, and post-type." },
        { "@type": "HowToStep", "name": "Fall back deterministically", "text": "On a parser exception, extract the house number and street name with a compiled regex so the batch never halts." },
        { "@type": "HowToStep", "name": "Normalise against lookup tables", "text": "Expand directional and suffix abbreviations from pre-compiled jurisdictional maps." },
        { "@type": "HowToStep", "name": "Reconcile against the MSAG", "text": "Match the standardized address to authoritative road centerlines within a strict proximity threshold and reject cross-jurisdiction failures." },
        { "@type": "HowToStep", "name": "Emit an audit record", "text": "Log every correction, fallback, and quarantine decision with structured logging for post-incident review." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why not rely on usaddress or libpostal alone for 911 logs?",
          "acceptedText": "Single-library parsing handles roughly 90% of standard municipal formats but raises exceptions on the legacy, truncated, and free-text strings common in Computer-Aided Dispatch exports. A 911 pipeline cannot halt a batch on one bad record, so a deterministic regex fallback that always returns a structured result is mandatory.",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Single-library parsing handles roughly 90% of standard municipal formats but raises exceptions on the legacy, truncated, and free-text strings common in Computer-Aided Dispatch exports. A 911 pipeline cannot halt a batch on one bad record, so a deterministic regex fallback that always returns a structured result is mandatory."
          }
        },
        {
          "@type": "Question",
          "name": "What proximity threshold should MSAG reconciliation enforce?",
          "acceptedText": "Production deployments typically reject any match beyond 15 metres from the authoritative road centerline or parcel centroid and additionally reject records that cross a jurisdictional boundary, routing both to a manual QA queue rather than guessing.",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Production deployments typically reject any match beyond 15 metres from the authoritative road centerline or parcel centroid and additionally reject records that cross a jurisdictional boundary, routing both to a manual QA queue rather than guessing."
          }
        }
      ]
    }
  ]
}
</script>

# Automating Address Standardization for 911 Logs

A single mis-standardized address string is enough to misroute an emergency. When a county PSAP exports a batch of Computer-Aided Dispatch (CAD) call logs at 02:00 during a regional storm surge, the raw text routinely arrives as `123 N MAIN ST APT 4`, `123 North Main Street #4`, and `123 N. MAIN` for the *same* location — plus PO Box artifacts, truncated suffixes, and rural-route placeholders that have no point geometry at all. The narrow failure this page solves is the one where a non-deterministic parser raises an exception on one ugly record and aborts the whole batch, so a dispatcher's spatial join silently returns the wrong response polygon. The fix is a deterministic normalization stage that always returns a structured result and flags — never drops — anything it cannot resolve.

## Root Cause and Operational Impact

The danger is not the messy text itself; it is that the messiness is *non-uniform and exception-raising*. Libraries such as `usaddress` and `libpostal` are probabilistic parsers tuned for well-formed mailing addresses. Fed a legacy CAD string with repeated labels (two `StreetName` tokens, an embedded apartment, a milepost), `usaddress` throws `RepeatedLabelError`. If that exception propagates, every subsequent record in the batch is lost, and the loss is silent: the dispatch console simply shows fewer incidents than were called in.

In Next Generation 911 (NG911) routing this is a life-safety defect, not a data-quality inconvenience. An address that fails to standardize fails to match the Master Street Address Guide (MSAG), so it cannot resolve to an Emergency Service Number, and the call routes to a default or neighbouring PSAP. The same upstream-contract assumptions that govern any [Python ETL for Sensor & IoT Data](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/python-etl-for-sensor-iot-data/) apply here: the stage downstream of you assumes you hand it ordered, structured, in-bounds records, and it has no way to know that 4% of a surge batch quietly vanished into an unhandled exception.

## Tiered Resolution Strategy

Resolve each raw string through an ordered fallback chain, descending from the definitive structured parse to a safe default that is never silently trusted:

1. **Definitive fix — primary structured parse.** Run `usaddress` (or `libpostal`) and accept its components when it returns cleanly. This covers the bulk of standard municipal formats with full confidence.
2. **Deterministic regex extraction.** On any parser exception, fall back to a compiled regex that pulls the house number and remaining street name. The result is partial but guaranteed, so the batch continues.
3. **Lookup normalization.** Expand directional prefixes (`N` → `NORTH`) and street suffixes (`ST` → `STREET`) from pre-compiled, jurisdiction-specific maps so MSAG matching is comparing like with like.
4. **Non-routable detection.** Flag PO Box, rural-route, and general-delivery artifacts that have no point geometry; these can never satisfy a spatial join and must be diverted, not coerced.
5. **Safe default with audit flag.** Anything that survives to here is emitted with a low confidence score and an explicit audit flag, routed to a manual QA queue. The record is preserved and traceable — never dropped, never silently "fixed".

The reason standardisation earns its place ahead of geocoding is arithmetic: it collapses the number of distinct strings the geocoder ever sees.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="as-t as-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="as-t">Seven ways one address arrives, and what each normalisation step removes</title>
  <desc id="as-d">One physical address arrives from dispatch in seven textual variants differing in case, abbreviation, punctuation, directional placement and unit designator. Case folding and whitespace collapse merges two of them. Expanding standard abbreviations for street types and directionals merges three more. Normalising the unit designator merges the last. The seven distinct strings become one, which means the geocoder is called once instead of seven times, the response cache hits on every subsequent occurrence, and — most importantly — the seven records now share a key that lets duplicate-incident detection see them as the same place.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">one physical address, seven strings from dispatch</text>
  <g font-size="10.5" font-family="var(--font-mono)" fill="currentColor">
    <text x="40" y="82">1420 N Main St Apt 3</text>
    <text x="40" y="104">1420 north main street apt 3</text>
    <text x="40" y="126">1420 N. MAIN ST., APT 3</text>
    <text x="40" y="148">1420 N Main Street #3</text>
    <text x="40" y="170">1420 Main St N Apt 3</text>
    <text x="40" y="192">1420  N Main St  Apt3</text>
    <text x="40" y="214">1420 N Main St Unit 3</text>
  </g>
  <path d="M340 140 H420" fill="none" stroke="var(--crimson)" stroke-width="2"/>
  <path d="M420 140 l-9 -5 M420 140 l-9 5" fill="none" stroke="var(--crimson)" stroke-width="2"/>
  <rect x="430" y="96" width="410" height="88" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.8"/>
  <text x="450" y="122" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">case fold · collapse whitespace</text>
  <text x="450" y="142" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">expand ST, N, APT · normalise unit designator</text>
  <text x="450" y="166" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="currentColor">1420 NORTH MAIN STREET UNIT 3</text>
  <rect x="40" y="246" width="250" height="88" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.8"/>
  <text x="58" y="270" font-size="10.5" font-weight="700" fill="var(--ember-text)">without standardisation</text>
  <text x="58" y="292" font-size="10" fill="currentColor">7 geocoder calls, 0 cache hits</text>
  <text x="58" y="310" font-size="10" fill="currentColor">7 records that never match</text>
  <text x="58" y="326" font-size="10" fill="currentColor">each other</text>
  <rect x="330" y="246" width="250" height="88" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.8"/>
  <text x="348" y="270" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">with standardisation</text>
  <text x="348" y="292" font-size="10" fill="currentColor">1 geocoder call, 6 cache hits</text>
  <text x="348" y="310" font-size="10" fill="currentColor">7 records sharing one key</text>
  <rect x="620" y="246" width="220" height="88" rx="9" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="638" y="270" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">the real payoff</text>
  <text x="638" y="292" font-size="10" fill="currentColor">duplicate detection can</text>
  <text x="638" y="310" font-size="10" fill="currentColor">now see these as one place</text>
</svg>

The geocoder-call saving is the obvious benefit and the smaller one. The saving that matters operationally is on the right: seven callers reporting the same structure fire produce seven records that, unstandardised, share no key at all. Duplicate detection working on address strings sees seven distinct addresses; working on geocoded coordinates it sees seven points scattered by whatever variance the geocoder introduced across seven slightly different inputs. Standardising first gives the deduplicator something exact to match on before it has to fall back to spatial proximity.

Two rules keep the normaliser from causing harm. Never discard the original string — store it alongside the standardised form, because a normaliser that mangles an unusual address needs to be diagnosable, and because the verbatim text is what a dispatcher will read back over the radio. And keep the abbreviation table jurisdiction-specific rather than national: a directional convention or a street-type abbreviation that is unambiguous in one county collides with a real street name in another, and the failure is a silently rewritten address rather than an error.

## Production Python Implementation

The routine below implements the full resolution path: chained parse, deterministic fallback, lookup normalization, non-routable flagging, structured logging, and an audit record emitted for every correction. It never raises out of the per-record path, so a single malformed string cannot halt the batch.

```python
import logging
import re
from dataclasses import asdict, dataclass
from typing import Optional

import usaddress

logger = logging.getLogger("ng911.address_standardizer")

# Pre-compiled jurisdictional lookup tables. Tune SUFFIX/DIRECTIONAL maps per county.
DIRECTIONAL_MAP: dict[str, str] = {
    "N": "NORTH", "S": "SOUTH", "E": "EAST", "W": "WEST",
    "NE": "NORTHEAST", "NW": "NORTHWEST", "SE": "SOUTHEAST", "SW": "SOUTHWEST",
}
SUFFIX_MAP: dict[str, str] = {
    "ST": "STREET", "AVE": "AVENUE", "BLVD": "BOULEVARD",
    "RD": "ROAD", "DR": "DRIVE", "LN": "LANE", "CT": "COURT", "HWY": "HIGHWAY",
}
NON_ROUTABLE = re.compile(r"PO\s*BOX|RURAL\s*ROUTE|\bRR\b|GENERAL\s*DELIVERY", re.IGNORECASE)
HOUSE_NUMBER = re.compile(r"^(\d+[\w-]*)")


@dataclass
class StandardizedAddress:
    number: Optional[str]
    prefix: Optional[str]
    name: Optional[str]
    suffix: Optional[str]
    confidence: float          # 1.0 = clean parse, 0.4 = regex fallback, 0.1 = unresolved
    flagged: bool              # True => route to manual QA queue, do not auto-trust
    raw: str                   # original string, retained for audit replay


def standardize(raw: str, record_id: str) -> StandardizedAddress:
    """Resolve one CAD address string. Never raises; always returns a record."""
    prefix: Optional[str] = None
    suffix: Optional[str] = None
    confidence = 1.0
    flagged = False

    try:
        # Tier 1: definitive structured parse.
        parsed = usaddress.parse(raw)
        components = {tag: val for val, tag in parsed}
        number = components.get("AddressNumber")
        name = components.get("StreetName")
        prefix = (components.get("StreetNamePreDirectional") or "").upper() or None
        suffix = (components.get("StreetNamePostType") or "").upper() or None
    except (usaddress.RepeatedLabelError, ValueError) as exc:
        # Tier 2: deterministic regex fallback — partial but guaranteed.
        logger.warning("usaddress fallback id=%s reason=%s", record_id, exc.__class__.__name__)
        m = HOUSE_NUMBER.search(raw)
        number = m.group(1) if m else None
        name = re.sub(r"^\d+[\w-]*\s*", "", raw).strip() if number else raw.strip()
        confidence = 0.4

    # Tier 3: lookup normalization so MSAG compares like with like.
    if prefix:
        prefix = DIRECTIONAL_MAP.get(prefix, prefix)
    if suffix:
        suffix = SUFFIX_MAP.get(suffix, suffix)

    # Tier 4: non-routable detection (no point geometry can satisfy a spatial join).
    if NON_ROUTABLE.search(raw):
        flagged = True
        confidence = min(confidence, 0.1)
        logger.info("non-routable artifact id=%s raw=%r -> manual QA", record_id, raw)

    # Tier 5: anything we could not resolve is flagged, never silently trusted.
    if number is None or name is None:
        flagged = True
        confidence = min(confidence, 0.1)

    result = StandardizedAddress(
        number=number, prefix=prefix, name=name, suffix=suffix,
        confidence=confidence, flagged=flagged, raw=raw,
    )

    # Audit trail: one structured row per record for post-incident review.
    logger.info("standardized id=%s confidence=%.1f flagged=%s out=%s",
                record_id, confidence, flagged, asdict(result))
    return result
```

Records with `flagged=False` and full confidence flow straight into MSAG reconciliation; everything else lands in the manual QA queue with its original string intact for replay. Because reconciliation is a spatial-join problem, drive it through the same metric-CRS and library-selection discipline established in [Geopandas vs PyShp for Field Operations](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/) — match standardized addresses to road centerlines within a 15-metre threshold and reject any candidate that crosses a jurisdictional boundary.

The one rule that keeps a standardiser safe is that it must never be the only copy of the address, and the reason is that its failures are asymmetric.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="ab-t ab-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="ab-t">Two ways a standardiser gets an address wrong, and what each costs</title>
  <desc id="ab-d">A standardiser can fail in two directions. Under-normalising leaves two forms of one address distinct, so the geocoder is called twice and duplicate detection misses a pair — a visible cost, discovered when a second unit is dispatched, and self-correcting once someone extends the abbreviation table. Over-normalising rewrites a genuinely distinct address into a different one: an aggressive directional rule turns North Bend Road into N Bend Road and then matches it against Bend Road North, so two real addresses collapse into one and an incident is placed on the wrong street. That failure is invisible, because the resulting address is well-formed and geocodes successfully. Keeping the verbatim string alongside the standardised form is what makes the second kind recoverable at all.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">the two failure directions are not equally expensive</text>
  <rect x="40" y="76" width="390" height="196" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <rect x="460" y="76" width="380" height="196" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="104" font-size="11.5" font-weight="700" fill="var(--crimson-deep)">under-normalised</text>
  <text x="480" y="104" font-size="11.5" font-weight="700" fill="var(--ember-text)">over-normalised</text>
  <text x="60" y="132" font-size="10.5" font-family="var(--font-mono)" fill="currentColor">1420 N Main St</text>
  <text x="60" y="150" font-size="10.5" font-family="var(--font-mono)" fill="currentColor">1420 North Main Street</text>
  <text x="480" y="132" font-size="10.5" font-family="var(--font-mono)" fill="currentColor">North Bend Road</text>
  <text x="480" y="150" font-size="10.5" font-family="var(--font-mono)" fill="currentColor">Bend Road North</text>
  <text x="60" y="180" font-size="10" fill="currentColor">stay distinct · two geocoder calls</text>
  <text x="60" y="198" font-size="10" fill="currentColor">duplicate detection misses the pair</text>
  <text x="480" y="180" font-size="10" fill="currentColor">both become N BEND ROAD</text>
  <text x="480" y="198" font-size="10" fill="currentColor">two real streets collapse into one</text>
  <text x="60" y="230" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">visible: a second unit arrives</text>
  <text x="60" y="250" font-size="10" fill="currentColor">self-correcting once the table is extended</text>
  <text x="480" y="230" font-size="10.5" font-weight="700" fill="var(--ember-text)">invisible: the result is well-formed</text>
  <text x="480" y="250" font-size="10" fill="currentColor">it geocodes successfully, to the wrong street</text>
  <rect x="40" y="292" width="800" height="46" rx="9" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="320" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">so: prefer under-normalising, and always keep the verbatim string — it is the only way back from the right-hand column</text>
</svg>

Under-normalising is a cost you can see and pay down. Two variants of one address survive as two records, a second unit gets dispatched, somebody notices, and the abbreviation table grows by one entry. Nothing is lost that cannot be recovered, and the system gets better each time it happens.

Over-normalising produces a well-formed address that is not the one dispatch received. It geocodes cleanly, lands on a real street, and appears on the map next to every correctly-handled incident. There is no downstream check that can catch it, because every property a valid address has, this one has.

That asymmetry is the whole argument for a conservative abbreviation table and for jurisdiction-scoped rules. A directional-normalisation rule that is safe in a county with no street named "North" is unsafe in one that has three, and the failure is not a rejected record but a silently relocated incident. When in doubt, leave the string alone and let the duplicate detector do more work — its errors are visible and this one is not.

## Validation Checklist

Verify each item against a staging copy of a real surge batch before deploying the standardizer to a live PSAP:

- [ ] A batch containing a `RepeatedLabelError`-triggering string completes without aborting — no records are lost.
- [ ] Every record that hits the regex fallback is emitted with `confidence == 0.4` and a `warning` log line.
- [ ] PO Box, rural-route, and general-delivery strings are flagged and routed to the manual QA queue, not coerced to geometry.
- [ ] Directional and suffix expansion is exercised against the *target county's* legacy naming, not just the default map.
- [ ] MSAG reconciliation rejects matches beyond 15 metres and any cross-jurisdiction match.
- [ ] One audit row exists per input record; the original `raw` string is replayable from the log.
- [ ] Standardized output components are uppercased and trimmed so MSAG joins are case- and whitespace-stable.

## Edge Cases and Gotchas

- **Axis-order / null-island drift downstream.** Standardization produces text, but the geocoded result enters a spatial pipeline. A lat/lon swap there sends matches to `(0, 0)`; keep `pyproj` transforms on `always_xy=True` and bounds-check before the join, exactly as the parent [Python ETL for Sensor & IoT Data](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/python-etl-for-sensor-iot-data/) pattern does.
- **Agency-specific suffix collisions.** `ST` means `STREET` in most counties but `SAINT` in place names like `ST JOHNS AVE`. Order your lookup so a leading `ST` token followed by a name is not expanded to `STREET` — false expansion silently breaks the MSAG match.
- **Unit/apartment leakage into the street name.** `usaddress` usually isolates `OccupancyIdentifier`, but the regex fallback does not. Strip trailing `APT`, `#`, `UNIT`, and `STE` fragments before MSAG matching or the join rate collapses.
- **Encoding artifacts from legacy CAD exports.** Mainframe exports often carry non-UTF-8 bytes (smart quotes, `0xA0` non-breaking spaces) that defeat both the parser and the regex. Normalise encoding on ingest and stage the raw bytes through [Offline GIS Data Caching Strategies](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/) so a failed batch can be replayed rather than re-pulled.
- **Confidence inflation on partial parses.** A regex fallback that finds a number and a plausible name still has no validated suffix. Never let lookup normalization raise its confidence back to 1.0 — the audit flag must survive to the QA queue.

<svg viewBox="0 0 880 560" role="img" aria-labelledby="tier-title tier-desc" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="tier-title">Five-tier address-standardization fallback ladder for 911 CAD logs</title>
  <desc id="tier-desc">A raw Computer-Aided Dispatch address string enters a five-tier resolution ladder. Tier 1 runs the usaddress structured parser; a clean parse exits at full confidence 1.0. On a parser exception the record drops to Tier 2, a deterministic regex extraction that always returns a partial result at confidence 0.4. Tier 3 normalizes directional and suffix abbreviations against jurisdictional lookup tables. Tier 4 detects non-routable PO Box, rural-route, and general-delivery artifacts. Tier 5 emits a safe default at confidence 0.1 for anything still unresolved. Records that pass cleanly and are not flagged branch right into MSAG reconciliation with a fifteen-metre proximity threshold; every flagged record branches down into a manual QA queue that retains the original raw string for audit replay.</desc>
  <defs>
    <marker id="addr-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0L10 5L0 10z" fill="var(--crimson)"/>
    </marker>
    <marker id="addr-arrow-warn" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0L10 5L0 10z" fill="var(--ember)"/>
    </marker>
  </defs>
  <!-- Raw CAD input -->
  <rect x="262" y="14" width="356" height="52" rx="10" fill="var(--blush)" stroke="var(--line-strong)" stroke-width="1.5"/>
  <text x="440" y="36" text-anchor="middle" font-size="13" font-weight="700" fill="currentColor">Raw CAD address string</text>
  <text x="440" y="55" text-anchor="middle" font-size="11" fill="var(--muted)">123 N. MAIN ST APT 4  ·  legacy / truncated / free-text</text>
  <path d="M440 66 V84" fill="none" stroke="var(--crimson)" stroke-width="2" marker-end="url(#addr-arrow)"/>
  <!-- Tier ladder (left column) -->
  <g>
    <!-- Tier 1 -->
    <rect x="40" y="86" width="340" height="62" rx="10" fill="var(--cream)" stroke="var(--crimson)" stroke-width="2"/>
    <circle cx="64" cy="108" r="13" fill="var(--crimson)"/>
    <text x="64" y="113" text-anchor="middle" font-size="13" font-weight="700" fill="var(--cream)">1</text>
    <text x="88" y="111" font-size="12.5" font-weight="700" fill="var(--crimson-deep)">usaddress structured parse</text>
    <text x="88" y="130" font-size="10.5" fill="var(--muted)">number · predir · name · post-type</text>
    <!-- Tier 2 -->
    <rect x="40" y="170" width="340" height="62" rx="10" fill="var(--cream)" stroke="var(--crimson)" stroke-width="2"/>
    <circle cx="64" cy="192" r="13" fill="var(--crimson)"/>
    <text x="64" y="197" text-anchor="middle" font-size="13" font-weight="700" fill="var(--cream)">2</text>
    <text x="88" y="195" font-size="12.5" font-weight="700" fill="var(--crimson-deep)">Deterministic regex fallback</text>
    <text x="88" y="214" font-size="10.5" fill="var(--muted)">on parser exception · partial but guaranteed</text>
    <!-- Tier 3 -->
    <rect x="40" y="254" width="340" height="62" rx="10" fill="var(--cream)" stroke="var(--crimson)" stroke-width="2"/>
    <circle cx="64" cy="276" r="13" fill="var(--crimson)"/>
    <text x="64" y="281" text-anchor="middle" font-size="13" font-weight="700" fill="var(--cream)">3</text>
    <text x="88" y="279" font-size="12.5" font-weight="700" fill="var(--crimson-deep)">Lookup normalization</text>
    <text x="88" y="298" font-size="10.5" fill="var(--muted)">N&#8594;NORTH · ST&#8594;STREET (per county)</text>
    <!-- Tier 4 -->
    <rect x="40" y="338" width="340" height="62" rx="10" fill="var(--cream)" stroke="var(--crimson)" stroke-width="2"/>
    <circle cx="64" cy="360" r="13" fill="var(--crimson)"/>
    <text x="64" y="365" text-anchor="middle" font-size="13" font-weight="700" fill="var(--cream)">4</text>
    <text x="88" y="363" font-size="12.5" font-weight="700" fill="var(--crimson-deep)">Non-routable detection</text>
    <text x="88" y="382" font-size="10.5" fill="var(--muted)">PO Box · rural route · general delivery</text>
    <!-- Tier 5 -->
    <rect x="40" y="422" width="340" height="62" rx="10" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
    <circle cx="64" cy="444" r="13" fill="var(--crimson)"/>
    <text x="64" y="449" text-anchor="middle" font-size="13" font-weight="700" fill="var(--cream)">5</text>
    <text x="88" y="447" font-size="12.5" font-weight="700" fill="var(--crimson-deep)">Safe default + audit flag</text>
    <text x="88" y="466" font-size="10.5" fill="var(--muted)">unresolved · preserved · never trusted</text>
  </g>
  <!-- vertical fall-through between tiers (exception path) -->
  <g fill="none" stroke="var(--crimson)" stroke-width="2" marker-end="url(#addr-arrow)">
    <path d="M210 148 V168"/>
    <path d="M210 232 V252"/>
    <path d="M210 316 V336"/>
    <path d="M210 400 V420"/>
  </g>
  <g font-size="9.5" font-weight="700" fill="var(--crimson-deep)">
    <text x="218" y="162">on exception &#8594; 0.4</text>
    <text x="218" y="246">expand &amp; align</text>
    <text x="218" y="330">scan artifacts</text>
    <text x="218" y="414">still unresolved</text>
  </g>
  <!-- Confidence rail (right of tiers) -->
  <g font-size="10.5" font-weight="700">
    <text x="396" y="121" fill="var(--crimson-deep)">conf 1.0</text>
    <text x="396" y="205" fill="var(--crimson-deep)">conf 0.4</text>
    <text x="396" y="289" fill="var(--muted)">conf held</text>
    <text x="396" y="373" fill="var(--crimson)">conf 0.1</text>
    <text x="396" y="457" fill="var(--crimson)">conf 0.1</text>
  </g>
  <!-- Clean branch right -> MSAG -->
  <path d="M380 117 H636 V186" fill="none" stroke="var(--crimson)" stroke-width="2" marker-end="url(#addr-arrow)"/>
  <text x="512" y="110" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">flagged = False</text>
  <rect x="556" y="188" width="160" height="74" rx="10" fill="var(--blush)" stroke="var(--crimson)" stroke-width="2"/>
  <text x="636" y="213" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--crimson-deep)">MSAG reconciliation</text>
  <text x="636" y="232" text-anchor="middle" font-size="10.5" fill="var(--muted)">&#8804; 15 m to centerline</text>
  <text x="636" y="248" text-anchor="middle" font-size="10.5" fill="var(--muted)">reject cross-jurisdiction</text>
  <!-- Flagged branch down -> manual QA queue -->
  <path d="M380 453 H636 V474" fill="none" stroke="var(--ember)" stroke-width="2" marker-end="url(#addr-arrow-warn)"/>
  <text x="512" y="446" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--crimson)">flagged = True</text>
  <rect x="556" y="476" width="280" height="74" rx="10" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="696" y="501" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--crimson-deep)">Manual QA queue</text>
  <text x="696" y="520" text-anchor="middle" font-size="10.5" fill="var(--muted)">raw string retained for audit replay</text>
  <text x="696" y="536" text-anchor="middle" font-size="10.5" fill="var(--muted)">tiers 4 &amp; 5 route here · never dropped</text>
  <!-- Tier-4 non-routable also diverts to QA -->
  <path d="M380 369 H476 V476" fill="none" stroke="var(--ember)" stroke-width="1.6" stroke-dasharray="5 4" marker-end="url(#addr-arrow-warn)"/>
</svg>

## Related

- [Python ETL for Sensor & IoT Data](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/python-etl-for-sensor-iot-data/) — the ingestion, validation, and audit-trail pattern this standardizer plugs into
- [Geopandas vs PyShp for Field Operations](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/) — spatial-library selection for the MSAG reconciliation join
- [Offline GIS Data Caching Strategies](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/) — staging raw CAD batches for replay after an encoding or backhaul failure

Up: [Python ETL for Sensor & IoT Data](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/python-etl-for-sensor-iot-data/)
