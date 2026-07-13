---
title: "Resolving Shapefile Encoding Conflicts from Legacy CAD Exports"
description: "Detect and repair mojibake in legacy CAD-exported shapefiles: recover the true character encoding of DBF attribute fields, write a correct .cpg sidecar, and emit an audit trail for every re-decoded street name and agency code."
slug: resolving-shapefile-encoding-conflicts-from-legacy-cad-exports
type: article
breadcrumb: "Shapefile Encoding Conflicts"
datePublished: "2026-07-13"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Resolving Shapefile Encoding Conflicts from Legacy CAD Exports",
      "description": "Detect and repair mojibake in legacy CAD-exported shapefiles: recover the true character encoding of DBF attribute fields, write a correct .cpg sidecar, and emit an audit trail for every re-decoded street name and agency code.",
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
        { "@type": "ListItem", "position": 3, "name": "Geospatial Data Ingestion Pipelines", "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/" },
        { "@type": "ListItem", "position": 4, "name": "Resolving Shapefile Encoding Conflicts from Legacy CAD Exports", "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/resolving-shapefile-encoding-conflicts-from-legacy-cad-exports/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Repair mojibake in legacy CAD-exported shapefiles",
      "description": "Recover the true text encoding of a shapefile's DBF attribute fields when the .cpg sidecar is missing or wrong, re-decode the affected fields, write a correct .cpg, and record every change in an audit trail.",
      "step": [
        { "@type": "HowToStep", "name": "Read the declared encoding", "text": "Check for a .cpg sidecar and the DBF language driver byte, treating both as claims to verify rather than facts to trust." },
        { "@type": "HowToStep", "name": "Score candidate encodings", "text": "Decode a sample of the raw attribute bytes under each candidate encoding and score the results against a mojibake heuristic to find the encoding that yields clean text." },
        { "@type": "HowToStep", "name": "Re-decode and normalize", "text": "Decode every string field under the winning encoding, normalize to Unicode NFC, and hold the corrected records in memory before writing." },
        { "@type": "HowToStep", "name": "Write a correct sidecar", "text": "Persist the repaired attributes as UTF-8 and write a matching .cpg file so every downstream reader interprets the bytes identically." },
        { "@type": "HowToStep", "name": "Emit an audit record", "text": "Log the detected encoding, its confidence, and every field whose text changed so the repair is reproducible and defensible." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why do legacy CAD shapefiles show garbled street names?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "A shapefile stores its attributes in a DBF table whose text encoding is declared by an optional .cpg sidecar and a single language-driver byte in the DBF header. Legacy Computer-Aided Dispatch exports frequently omit the .cpg or stamp the wrong code page, so a reader decodes Windows-1252 or UTF-8 bytes as Latin-1 and vice versa. The mismatch turns accented street names and agency codes into mojibake such as PeÃ±a for Peña, and the geometry stays intact while the text becomes unreliable."
          }
        },
        {
          "@type": "Question",
          "name": "How can I detect the correct encoding automatically?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Treat the declared .cpg and language-driver byte as unverified claims, then decode a sample of the raw attribute bytes under each candidate encoding and score the output with a mojibake heuristic: reject any candidate that raises a decode error, and penalize telltale sequences and replacement characters. The candidate that decodes without error and scores cleanest is the recovered encoding. Record the confidence so a low-scoring result can be routed to human review instead of trusted blindly."
          }
        },
        {
          "@type": "Question",
          "name": "Should I overwrite the original shapefile in place?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "No. Write the repaired data to a new output with a fresh UTF-8 .cpg and preserve the original bytes untouched, because the original is the primary evidence in any after-action review. Emit an audit record listing the detected encoding, its confidence, and every field whose text changed, so the correction is reproducible and the provenance of the repaired archive stays intact."
          }
        }
      ]
    }
  ]
}
</script>

# Resolving Shapefile Encoding Conflicts from Legacy CAD Exports

An overnight batch pulls a decade of hydrant, hazard, and pre-plan layers out of a county's aging Computer-Aided Dispatch (CAD) system and stages them for the incident ingestion job. The geometry loads cleanly, but the operations chief scanning the pre-plan layer sees `CaÃ±on Rd`, `Peï¿½a Blvd`, and an agency field reading `BOMBEROS Ã‰LITE`. The street the strike team was routed down does not match any name the map service will geocode, and a mutual-aid agency code no longer joins to the resource roster. Nothing is wrong with the coordinates — the failure is entirely in the attribute text, because the shapefile's DBF table was written in one character encoding and is being read in another. This page solves that single narrow failure: recovering the true encoding of legacy CAD-exported shapefile attributes, repairing the mojibake, writing a correct code-page sidecar, and leaving an audit trail behind every character it changes.

## Root Cause and Operational Impact

A shapefile is not one file but a small family, and its attribute text lives in the DBF component — a dBASE table with no self-describing encoding header of the modern kind. The character encoding is declared two weak ways: an optional `.cpg` sidecar holding a code-page name, and a single language-driver identifier (LDID) byte at offset 29 of the DBF header. Neither is reliable from a legacy exporter. Older CAD platforms wrote the DBF in the operator workstation's Windows code page — almost always Windows-1252 for North American installs — and either omitted the `.cpg` entirely or stamped a value that never matched the bytes. When a modern reader such as GDAL, `pyshp`, or `geopandas` finds no `.cpg`, it falls back to a guess (often ISO-8859-1 Latin-1 or the host locale), and any byte above 0x7F is decoded under the wrong table.

The visible symptom is mojibake. UTF-8 bytes read as Windows-1252 turn `Peña` into `PeÃ±a`; Windows-1252 bytes read as UTF-8 raise decode errors or produce the U+FFFD replacement character `ï¿½`. The geometry is untouched, which is exactly what makes this dangerous rather than merely ugly — the layer looks healthy on the map while its text silently fails every operation that depends on it. Garbled street names break geocoding and map-matched routing. A corrupted agency code breaks the join to the resource roster, so a mutual-aid unit drops off the accountability board. Corrupted attributes also fail the schema and value checks that [automated attribute validation rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/) apply downstream, and they poison the provenance the archive is supposed to carry under the [emergency metadata standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/). Because the Federal Emergency Management Agency (FEMA) and the National Incident Management System (NIMS) both expect incident data to be reconstructable for after-action review, a repair that quietly rewrites text without recording what it changed is itself a defect. The fix has to be both correct and auditable.

<svg viewBox="0 0 900 470" role="img" aria-label="Encoding-recovery decision flow for a legacy CAD-exported shapefile. The DBF attribute component enters detection. Weak declared hints — an optional .cpg sidecar and the DBF language-driver byte — are read as unverified claims. A sample of raw attribute bytes is decoded under three candidate encodings, UTF-8, Windows-1252, and Latin-1, and each result is scored by a mojibake heuristic. The winning encoding drives a re-decode and Unicode normalization step, which writes a corrected UTF-8 output with a matching .cpg sidecar and appends an audit record. A low confidence score branches to human review instead." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit;color:var(--ink)">
  <title>Recovering the true encoding of a legacy shapefile's attribute table</title>
  <desc>The DBF attribute component of a shapefile enters an encoding-detection stage. The declared .cpg sidecar and the DBF language-driver byte are treated as unverified claims. A sample of raw attribute bytes is decoded under three candidate encodings — UTF-8, Windows-1252, and Latin-1 — and each result is scored with a mojibake heuristic that rejects decode errors and penalizes replacement characters and telltale byte sequences. The highest-scoring candidate is chosen; a confident result drives a full re-decode, Unicode NFC normalization, a corrected UTF-8 output with a matching .cpg sidecar, and an audit record, while a low-confidence result is routed to human review.</desc>
  <defs>
    <marker id="cpg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
    <marker id="cpg-plain" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- source shapefile -->
  <rect x="24" y="180" width="150" height="110" rx="8" fill="var(--blush, none)" stroke="currentColor" stroke-width="1.5"/>
  <text x="99" y="205" font-size="12" text-anchor="middle" font-weight="700" fill="currentColor">Legacy CAD export</text>
  <text x="99" y="228" font-size="10.5" text-anchor="middle" fill="currentColor">.shp geometry OK</text>
  <text x="99" y="248" font-size="10.5" text-anchor="middle" font-weight="600" fill="var(--crimson, currentColor)">.dbf text = mojibake</text>
  <text x="99" y="268" font-size="10.5" text-anchor="middle" fill="currentColor">.cpg missing / wrong</text>
  <path d="M174,235 H214" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#cpg-plain)"/>
  <!-- declared hints -->
  <rect x="216" y="60" width="196" height="66" rx="8" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1.4"/>
  <text x="314" y="82" font-size="11" text-anchor="middle" font-weight="600" fill="currentColor">Declared hints (unverified)</text>
  <text x="314" y="101" font-size="10" text-anchor="middle" fill="currentColor">.cpg name · LDID byte @29</text>
  <text x="314" y="117" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.8">treat as a claim, not truth</text>
  <path d="M314,126 V150" fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#cpg-plain)"/>
  <!-- candidate scoring box -->
  <rect x="216" y="152" width="248" height="166" rx="8" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
  <text x="340" y="174" font-size="12" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">Score candidate encodings</text>
  <g font-size="10.5" fill="currentColor">
    <rect x="232" y="188" width="216" height="30" rx="6" fill="var(--cream, none)" stroke="currentColor" stroke-width="1.1"/>
    <text x="242" y="207" font-weight="600">UTF-8</text>
    <text x="438" y="207" text-anchor="end">strict decode</text>
    <rect x="232" y="224" width="216" height="30" rx="6" fill="var(--cream, none)" stroke="currentColor" stroke-width="1.1"/>
    <text x="242" y="243" font-weight="600">Windows-1252</text>
    <text x="438" y="243" text-anchor="end">score mojibake</text>
    <rect x="232" y="260" width="216" height="30" rx="6" fill="var(--cream, none)" stroke="currentColor" stroke-width="1.1"/>
    <text x="242" y="279" font-weight="600">Latin-1 (ISO-8859-1)</text>
    <text x="438" y="279" text-anchor="end">score mojibake</text>
  </g>
  <text x="340" y="308" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.85">reject decode errors · penalize U+FFFD</text>
  <path d="M464,235 H512" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6" marker-end="url(#cpg-arrow)"/>
  <text x="488" y="226" font-size="9.5" text-anchor="middle" fill="var(--crimson, currentColor)">best</text>
  <!-- decision diamond: confidence -->
  <path d="M574,190 L636,235 L574,280 L512,235 Z" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
  <text x="574" y="231" font-size="10.5" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">confident?</text>
  <text x="574" y="247" font-size="9.5" text-anchor="middle" fill="currentColor">score ≥ floor</text>
  <!-- yes branch -->
  <path d="M636,235 H688" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#cpg-plain)"/>
  <text x="662" y="226" font-size="9.5" text-anchor="middle" fill="currentColor" font-weight="600">yes</text>
  <rect x="690" y="150" width="186" height="86" rx="8" fill="var(--blush, none)" stroke="currentColor" stroke-width="1.5"/>
  <text x="783" y="172" font-size="11" text-anchor="middle" font-weight="700" fill="currentColor">Re-decode + normalize</text>
  <text x="783" y="191" font-size="10" text-anchor="middle" fill="currentColor">winning encoding → NFC</text>
  <text x="783" y="208" font-size="10" text-anchor="middle" fill="currentColor">write UTF-8 output</text>
  <text x="783" y="225" font-size="10" text-anchor="middle" font-weight="600" fill="var(--crimson, currentColor)">write matching .cpg</text>
  <path d="M783,236 V262" fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#cpg-plain)"/>
  <rect x="690" y="264" width="186" height="52" rx="8" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
  <text x="783" y="286" font-size="11" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">Audit record</text>
  <text x="783" y="304" font-size="9.5" text-anchor="middle" fill="currentColor">encoding · confidence · changed fields</text>
  <!-- no branch -->
  <path d="M574,280 V330 H690" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#cpg-plain)"/>
  <text x="600" y="322" font-size="9.5" text-anchor="middle" fill="currentColor" font-weight="600">no</text>
  <rect x="692" y="332" width="184" height="44" rx="8" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1.4"/>
  <text x="784" y="352" font-size="10.5" text-anchor="middle" font-weight="700" fill="currentColor">Quarantine</text>
  <text x="784" y="368" font-size="9.5" text-anchor="middle" fill="currentColor">route to human review + flag</text>
  <!-- footer note -->
  <text x="450" y="430" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.8">Original bytes are never overwritten — the repaired copy is a new artifact with its own provenance.</text>
</svg>

## Tiered Resolution Strategy

Work the problem in ordered tiers, from the definitive recovery down to a safe default that is always flagged. The guiding rule: never overwrite the source in place and never rewrite text silently — the original DBF is the primary evidence, and an unrecorded correction is indistinguishable from data tampering.

1. **Trust a verified sidecar (definitive).** If a `.cpg` exists and a sample of the attribute bytes decodes under it without error and scores clean, honour it. The declared encoding is only accepted after it survives the same scoring every candidate faces.
2. **Recover by scoring candidates.** When the `.cpg` is absent, wrong, or fails scoring, decode a byte sample under an ordered candidate set — UTF-8 strict first, then Windows-1252, then Latin-1 — and pick the one that decodes without error and scores best on a mojibake heuristic. UTF-8 goes first because it is the only self-validating member of the set: byte sequences that are not valid UTF-8 fail loudly.
3. **Re-decode, normalize, and re-emit (the fix).** Decode every string field under the winning encoding, normalize to Unicode NFC so composed and decomposed accents compare equal, write the corrected table as UTF-8, and write a `.cpg` that says `UTF-8` so every downstream reader agrees.
4. **Quarantine on low confidence (safe default).** If no candidate clears the confidence floor, do not guess into the operational store. Keep the original, stamp the record with a needs-review flag, and route it to a human — a plausible-but-wrong repair on a street name is worse than an obvious failure.
5. **Emit an audit record for every repair.** Source path, detected encoding, confidence, and the before/after of every field whose text changed, so the corrected archive is reproducible against the exact detector that produced it.

## Production Python Implementation

The routine below carries the full resolution path: reading raw DBF field bytes through `pyshp`, scoring candidate encodings with a mojibake heuristic, re-decoding and normalizing, writing a corrected UTF-8 shapefile with a matching `.cpg`, structured logging, explicit exception handling, and an immutable audit entry per repaired file. Senior-engineer assumptions apply — `pyshp` (imported as `shapefile`) is available and geometry integrity is out of scope here; this is a text-layer repair that leaves the `.shp` and `.shx` untouched. Thresholds are parameters, not literals, so the confidence floor and candidate order can be committed alongside the ingestion configuration.

```python
from __future__ import annotations

import logging
import unicodedata
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import shapefile  # pyshp

logger = logging.getLogger("incidentgis.encoding")

# Ordered candidates: UTF-8 first because it is the only self-validating member.
DEFAULT_CANDIDATES: tuple[str, ...] = ("utf-8", "cp1252", "latin-1")

# Byte sequences that signal a UTF-8 string was mis-decoded as a single-byte
# code page (e.g. "Ã±", "Â ", "ï¿½"). Their presence penalizes a candidate.
_MOJIBAKE_MARKERS: tuple[str, ...] = ("Ã", "Â", "�", "�", "ï¿½")


@dataclass
class EncodingVerdict:
    encoding: str
    confidence: float          # 0.0 - 1.0, share of sampled values scoring clean
    from_declared: bool        # True if a .cpg / LDID claim was confirmed


@dataclass
class FieldChange:
    record_index: int
    field_name: str
    before: str
    after: str


@dataclass
class AuditEntry:
    """Immutable record of one file's encoding repair."""
    source: str
    output: str
    detected_encoding: str
    confidence: float
    from_declared: bool
    changed_fields: int
    samples: list[FieldChange]
    recorded_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class ShapefileEncodingRepair:
    """Recover the true DBF encoding of a legacy shapefile and re-emit it as UTF-8.

    The original is never modified; a repaired copy is written to ``out_path``
    with a UTF-8 .cpg, and every override is appended to ``audit_log`` so the
    correction is reproducible against the detector that produced it.
    """

    def __init__(
        self,
        candidates: tuple[str, ...] = DEFAULT_CANDIDATES,
        confidence_floor: float = 0.85,
        sample_size: int = 200,
        max_audit_samples: int = 25,
    ) -> None:
        self.candidates = candidates
        self.confidence_floor = confidence_floor
        self.sample_size = sample_size
        self.max_audit_samples = max_audit_samples
        self.audit_log: list[AuditEntry] = []

    def _score(self, raw_values: list[bytes], encoding: str) -> float:
        """Fraction of sampled byte-strings that decode cleanly under ``encoding``.

        A single decode error collapses the score to 0.0 (the encoding is wrong
        for at least one value); otherwise each mojibake marker docks the score.
        """
        if not raw_values:
            return 0.0
        clean = 0
        for raw in raw_values:
            try:
                text = raw.decode(encoding)
            except (UnicodeDecodeError, LookupError):
                return 0.0  # strict rejection: this encoding cannot be correct
            if not any(marker in text for marker in _MOJIBAKE_MARKERS):
                clean += 1
        return clean / len(raw_values)

    def _sample_raw_values(self, dbf_path: Path) -> list[bytes]:
        """Read raw bytes of character fields without imposing an encoding."""
        # Reading with latin-1 is lossless (every byte maps to a code point),
        # so we can round-trip back to the original bytes for scoring.
        reader = shapefile.Reader(str(dbf_path.with_suffix("")), encoding="latin-1")
        char_cols = [
            i for i, fld in enumerate(reader.fields[1:])  # skip DeletionFlag
            if fld[1] == "C"
        ]
        raw: list[bytes] = []
        for rec in reader.iterRecords():
            for col in char_cols:
                value = rec[col]
                if isinstance(value, str) and value.strip():
                    raw.append(value.encode("latin-1"))
                    if len(raw) >= self.sample_size:
                        return raw
        return raw

    def detect(self, source: Path) -> EncodingVerdict:
        """Choose the encoding that decodes the attribute sample most cleanly."""
        declared = self._read_declared(source)
        raw = self._sample_raw_values(source)

        ordered = list(self.candidates)
        if declared and declared not in ordered:
            ordered.insert(0, declared)  # verify the claim, do not assume it

        best_enc, best_score = "latin-1", 0.0
        for enc in ordered:
            score = self._score(raw, enc)
            logger.debug("encoding_candidate", extra={"encoding": enc, "score": score})
            if score > best_score:
                best_enc, best_score = enc, score

        return EncodingVerdict(
            encoding=best_enc,
            confidence=best_score,
            from_declared=bool(declared) and best_enc == declared,
        )

    def _read_declared(self, source: Path) -> Optional[str]:
        """Return the .cpg-declared encoding if present and parseable."""
        cpg = source.with_suffix(".cpg")
        try:
            if cpg.exists():
                token = cpg.read_text(encoding="ascii").strip().lower()
                # Normalize a few common CAD-exporter spellings.
                aliases = {"utf8": "utf-8", "1252": "cp1252",
                           "windows-1252": "cp1252", "iso-8859-1": "latin-1"}
                return aliases.get(token, token)
        except (OSError, UnicodeDecodeError) as exc:
            logger.warning("cpg_unreadable", extra={"path": str(cpg)}, exc_info=exc)
        return None

    def repair(self, source: Path, out_path: Path) -> Optional[EncodingVerdict]:
        """Detect, re-decode, and re-emit ``source`` as UTF-8 with a matching .cpg.

        Returns the verdict on success, or ``None`` if the file is quarantined
        because no candidate cleared the confidence floor.
        """
        try:
            verdict = self.detect(source)
        except (shapefile.ShapefileException, OSError, ValueError) as exc:
            logger.error("detect_failed", extra={"source": str(source)}, exc_info=exc)
            raise

        if verdict.confidence < self.confidence_floor:
            logger.warning(
                "encoding_quarantined",
                extra={"source": str(source),
                       "best_encoding": verdict.encoding,
                       "confidence": round(verdict.confidence, 3)},
            )
            return None  # safe default: do not guess into the operational store

        changes: list[FieldChange] = []
        try:
            # latin-1 read is lossless; re-encode to bytes, decode as the true
            # encoding, then normalize so accents compare equal downstream.
            reader = shapefile.Reader(str(source.with_suffix("")), encoding="latin-1")
            writer = shapefile.Writer(str(out_path.with_suffix("")), encoding="utf-8")
            writer.fields = reader.fields[1:]  # drop the DeletionFlag pseudo-field
            char_names = [f[0] for f in reader.fields[1:] if f[1] == "C"]

            for idx, sr in enumerate(reader.iterShapeRecords()):
                record = dict(sr.record.as_dict())
                for name in char_names:
                    original = record.get(name)
                    if isinstance(original, str) and original.strip():
                        repaired = unicodedata.normalize(
                            "NFC",
                            original.encode("latin-1").decode(verdict.encoding),
                        )
                        if repaired != original and len(changes) < self.max_audit_samples:
                            changes.append(FieldChange(idx, name, original, repaired))
                        record[name] = repaired
                writer.shape(sr.shape)
                writer.record(**record)
            writer.close()

            out_path.with_suffix(".cpg").write_text("UTF-8", encoding="ascii")
        except (shapefile.ShapefileException, OSError,
                UnicodeError, KeyError) as exc:
            logger.error("repair_failed", extra={"source": str(source)}, exc_info=exc)
            raise

        entry = AuditEntry(
            source=str(source),
            output=str(out_path),
            detected_encoding=verdict.encoding,
            confidence=round(verdict.confidence, 3),
            from_declared=verdict.from_declared,
            changed_fields=len(changes),
            samples=changes,
        )
        self.audit_log.append(entry)
        logger.info("encoding_repaired", extra={"audit": asdict(entry)})
        return verdict
```

The `audit_log` is the load-bearing output. Persisting it as a content-hashed artifact next to the repaired archive lets a reviewer confirm which encoding was inferred, how confident the detector was, and exactly which street names and agency codes were rewritten — the provenance guarantee the [emergency metadata standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/) require of any transformed dataset.

## Validation Checklist

Verify every item before running the repair against a production archive.

- [ ] Candidate order, confidence floor, and sample size are passed as parameters and committed under version control — no encodings hard-coded in the batch script.
- [ ] The original shapefile family (`.shp`, `.shx`, `.dbf`, `.prj`, and any existing `.cpg`) is preserved untouched; the repair writes to a new output path.
- [ ] A declared `.cpg` is re-scored, not trusted — a wrong sidecar cannot force a wrong decode.
- [ ] UTF-8 is scored first and strictly, so genuinely UTF-8 files are never re-decoded as Windows-1252.
- [ ] Repaired text is normalized to Unicode NFC so `é` composed and `é` decomposed do not split a later join.
- [ ] Files below the confidence floor are quarantined with a needs-review flag rather than written into the operational store.
- [ ] Every repaired file yields an `AuditEntry` with detected encoding, confidence, and a bounded sample of before/after field changes.
- [ ] A round-trip test asserts that a known-good UTF-8 fixture is detected as UTF-8 with confidence 1.0 and produces zero field changes.
- [ ] The output `.cpg` reads `UTF-8` and a re-open under UTF-8 reproduces the repaired strings byte-for-byte.

## Edge Cases and Gotchas

- **The lossless-latin-1 trick can hide a real bug.** Reading with Latin-1 is lossless because every one of the 256 byte values maps to a code point, which is what lets the scorer round-trip back to the original bytes. But it also means a Latin-1 read never raises — so you must score candidates rather than rely on a decode exception alone, or a mis-encoded file will sail through looking valid.
- **Double-encoded mojibake.** Some CAD exporters have already been "fixed" once, producing text that was UTF-8, mis-decoded as Windows-1252, then re-encoded as UTF-8. The bytes are now legal UTF-8 that still reads as `PeÃ±a`. Strict UTF-8 decoding will accept it, so the mojibake-marker penalty in the scorer is what catches it — keep the marker set current for the exporters you actually see.
- **The DBF language-driver byte lies as often as the sidecar.** Offset 29 (LDID) is a single byte that many exporters leave at 0x00 or set to a code page the workstation was never using. Treat it exactly like the `.cpg`: a hint to verify by scoring, never a fact to honour blind.
- **Field width is bytes, not characters.** DBF character fields are fixed-width in bytes. A multibyte UTF-8 name can be truncated mid-character by an exporter that sized the column for single-byte text, leaving an un-decodable trailing byte. Trim trailing partial bytes before scoring so one truncated value does not zero out an otherwise-correct candidate.
- **Agency-specific code pages beyond the Western set.** Jurisdictions with non-Latin scripts may have exported under a code page outside UTF-8, Windows-1252, and Latin-1 entirely. Make the candidate tuple configurable per source agency, and let the confidence floor quarantine anything the configured set cannot explain rather than forcing a Western decode onto Cyrillic or CJK text. The same records should still pass the schema gate in [automated attribute validation rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/) once repaired.

## Frequently Asked Questions

**Why do legacy CAD shapefiles show garbled street names?** A shapefile stores its attributes in a DBF table whose text encoding is declared by an optional `.cpg` sidecar and a single language-driver byte in the DBF header. Legacy Computer-Aided Dispatch (CAD) exports frequently omit the `.cpg` or stamp the wrong code page, so a reader decodes Windows-1252 or UTF-8 bytes as Latin-1 and vice versa. The mismatch turns accented street names and agency codes into mojibake such as `PeÃ±a` for `Peña`, and the geometry stays intact while the text becomes unreliable.

**How can I detect the correct encoding automatically?** Treat the declared `.cpg` and language-driver byte as unverified claims, then decode a sample of the raw attribute bytes under each candidate encoding and score the output with a mojibake heuristic: reject any candidate that raises a decode error, and penalize telltale sequences and replacement characters. The candidate that decodes without error and scores cleanest is the recovered encoding. Record the confidence so a low-scoring result can be routed to human review instead of trusted blindly.

**Should I overwrite the original shapefile in place?** No. Write the repaired data to a new output with a fresh UTF-8 `.cpg` and preserve the original bytes untouched, because the original is the primary evidence in any after-action review. Emit an audit record listing the detected encoding, its confidence, and every field whose text changed, so the correction is reproducible and the provenance of the repaired archive stays intact.

## Related

- [Geospatial Data Ingestion Pipelines](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/) — the ingestion stage where encoding repair belongs before attributes are trusted.
- [Emergency Metadata Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/) — record the detected encoding and repair provenance as lineage on the archive.
- [Automated Attribute Validation Rules](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/automated-attribute-validation-rules/) — the value and schema checks that repaired text must still pass downstream.
- [Handling Missing CRS in Field-Collected GPS Logs](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/handling-missing-crs-in-field-collected-gps-logs/) — the sibling metadata-recovery pattern for missing coordinate reference systems.

Up: [Geospatial Data Ingestion Pipelines](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/)
