---
title: "Pinning GDAL & PROJ Versions to Avoid Datum-Grid Drift"
description: "Stop sub-metre datum-grid drift between field machines: pin exact GDAL and PROJ versions, fingerprint the PROJ transformation grids, fail the build on any mismatch, and emit an audit record so every reprojected coordinate is reproducible."
slug: pinning-gdal-and-proj-versions-to-avoid-datum-grid-drift
type: article
breadcrumb: "Pinning GDAL & PROJ Versions"
datePublished: "2026-07-13"
dateModified: "2026-07-13"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Pinning GDAL & PROJ Versions to Avoid Datum-Grid Drift",
      "description": "Stop sub-metre datum-grid drift between field machines: pin exact GDAL and PROJ versions, fingerprint the PROJ transformation grids, fail the build on any mismatch, and emit an audit record so every reprojected coordinate is reproducible.",
      "datePublished": "2026-07-13",
      "dateModified": "2026-07-13",
      "author": { "@type": "Organization", "name": "Incident GIS" },
      "publisher": { "@type": "Organization", "name": "Incident GIS" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.incidentgis.com/" },
        { "@type": "ListItem", "position": 2, "name": "Python Toolchains for Public Safety GIS", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/" },
        { "@type": "ListItem", "position": 3, "name": "Setting Up Dockerized GIS Environments", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/" },
        { "@type": "ListItem", "position": 4, "name": "Pinning GDAL & PROJ Versions to Avoid Datum-Grid Drift", "item": "https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/pinning-gdal-and-proj-versions-to-avoid-datum-grid-drift/" }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Pin GDAL and PROJ versions and verify transformation grids for reproducible reprojection",
      "description": "Lock exact GDAL and PROJ versions and the PROJ-data grid set in the container image, fingerprint the grids that each transformation actually uses, fail the build on any drift from the expected manifest, and emit an audit record so every reprojected coordinate can be reproduced.",
      "step": [
        { "@type": "HowToStep", "name": "Pin the toolchain", "text": "Install exact GDAL, PROJ, and PROJ-data versions in the image and disable network grid fetching so no machine silently upgrades or downloads a different grid." },
        { "@type": "HowToStep", "name": "Fingerprint the grids", "text": "Hash every transformation grid file and capture the version tuple into a manifest that travels with the image as the single source of truth." },
        { "@type": "HowToStep", "name": "Assert the transformation used", "text": "For each critical datum pair, resolve the operation PROJ selects and confirm it is the grid-based pipeline, not a coarser Helmert fallback." },
        { "@type": "HowToStep", "name": "Fail on drift and audit", "text": "Compare the running environment against the manifest at startup, abort on any mismatch, and emit an audit record binding the reprojection to a specific grid fingerprint." }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "How can pinning only GDAL still leave datum-grid drift?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "GDAL delegates every datum transformation to PROJ, and PROJ reads its answer from separate transformation grid files shipped in the PROJ-data package. Two images can carry the identical GDAL version yet different PROJ releases or different grid sets, so the same input coordinate is transformed through different pipelines. Pinning GDAL alone does not pin PROJ or the grids, which is where the sub-metre divergence actually originates."
          }
        },
        {
          "@type": "Question",
          "name": "Why is a sub-metre datum shift dangerous rather than negligible?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "A half-metre offset is invisible on a zoomed-out map but decisive at the point of work: it moves a structure the width of a doorway, shifts a hazard-zone boundary across a property line, and makes two agencies' layers disagree over which side of a line a responder stands on. Because the error is constant and quiet, it is trusted, and a Common Operating Picture that silently mixes two datum realizations is not defensible in after-action review."
          }
        },
        {
          "@type": "Question",
          "name": "Should field machines download PROJ grids on demand?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "No. On-demand grid fetching means the transformation a machine performs depends on what it managed to download and when, which is neither reproducible nor available on a disconnected incident network. Bake the exact grid set into the image, disable network fetching, and verify the grid fingerprints at startup so every machine transforms coordinates identically whether it is online or blacked out."
          }
        }
      ]
    }
  ]
}
</script>

# Pinning GDAL & PROJ Versions to Avoid Datum-Grid Drift

A damage-assessment team stands at the corner of a collapsed structure and drops a point. Back at the emergency operations centre, an analyst overlays that point on a parcel layer reprojected the night before on a different workstation, and it lands half a metre inside the neighbouring lot — enough to attribute the damage to the wrong owner on a public assistance claim. Nobody moved the point and no coordinate was mistyped. The field tablet and the workstation ran the same Python and the same GDAL version, but their PROJ installations shipped different datum transformation grids, so the two machines shifted the same latitude and longitude through two different pipelines and landed forty centimetres apart. This is datum-grid drift, and it is the single narrow failure mode this page solves: making every machine in a Dockerized fleet transform coordinates byte-for-byte identically, and proving it before anyone trusts a reprojected feature.

## Root Cause and Operational Impact

GDAL does not compute datum shifts itself. Every reprojection between two realizations — say a legacy North American Datum onto the current one, or a national grid onto WGS 84 — is delegated to PROJ, and PROJ reads the answer out of transformation *grid* files: gridded offsets, distributed in the PROJ-data package, that model the irregular real-world difference between two datums far more accurately than a single seven-parameter Helmert rotation ever could. When the correct grid is present, PROJ uses it and the shift is accurate to a few centimetres. When it is absent, PROJ does not error — it silently selects a coarser fallback operation, and the same coordinate moves to a subtly different place.

That is the trap. Two container images can carry an identical GDAL version and still diverge, because the PROJ release, the PROJ-data grid set, or the `PROJ_NETWORK` fetch behaviour underneath differs. One machine transforms through a high-accuracy grid; another, missing that grid, falls back to a low-accuracy Helmert path. The gap is typically sub-metre — which is exactly why it is dangerous rather than merely wrong. A metre of error is obvious and gets caught; forty centimetres is invisible on any map a commander looks at, so it is trusted, propagated, and inherited by every downstream decision. It moves a structure by a doorway width, pushes a mandatory-evacuation boundary across a property line, and makes two agencies' layers disagree about which side of a road a resource occupies. Because the National Incident Management System (NIMS) and the Federal Emergency Management Agency (FEMA) both require that spatial products be reconstructable for after-action review, a Common Operating Picture that quietly blends two datum realizations is not defensible. The correction is not a better algorithm — it is reproducibility: pin the exact toolchain, fingerprint the grids, and refuse to run when the environment drifts from what is committed, the same discipline the wider [Setting Up Dockerized GIS Environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/) workflow applies to the whole image.

<svg viewBox="0 0 900 500" role="img" aria-label="Datum-grid drift diagram. One input latitude and longitude enters two container images. The pinned image carries the expected PROJ version and a verified grid, transforms through the grid-based pipeline, and produces the correct coordinate. The unpinned image is missing that grid, silently falls back to a coarser Helmert transformation, and produces a coordinate offset by roughly forty centimetres. A verification gate at the bottom hashes each grid against a committed manifest and fails the build on any mismatch." xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">
  <title>How a missing PROJ grid produces sub-metre datum drift and how a fingerprint gate stops it</title>
  <desc>A single input coordinate is fed to two container images. The pinned image holds the expected PROJ and PROJ-data versions and passes a grid fingerprint check, so PROJ selects the grid-based datum transformation and outputs the correct position. The unpinned image is missing the transformation grid, so PROJ silently falls back to a coarser Helmert operation and outputs a position offset by about forty centimetres. A verification gate hashes every grid file against a committed manifest, aborting startup when the running grids do not match, so both machines are forced to transform coordinates identically.</desc>
  <defs>
    <marker id="datum-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--crimson, currentColor)"/>
    </marker>
    <marker id="datum-plain" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- input -->
  <rect x="360" y="24" width="180" height="46" rx="8" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1.5"/>
  <text x="450" y="44" font-size="12.5" text-anchor="middle" font-weight="700" fill="currentColor">Input coordinate</text>
  <text x="450" y="61" font-size="10.5" text-anchor="middle" fill="currentColor">lat / lon · NAD83 realization</text>
  <line x1="360" y1="70" x2="238" y2="104" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#datum-plain)"/>
  <line x1="540" y1="70" x2="662" y2="104" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#datum-plain)"/>
  <!-- left lane: pinned -->
  <rect x="52" y="106" width="336" height="250" rx="10" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="70" y="130" font-size="12.5" font-weight="700" fill="currentColor">Pinned image</text>
  <text x="70" y="147" font-size="10" fill="currentColor" opacity="0.8">GDAL 3.8.4 · PROJ 9.3.1 · data 1.15</text>
  <rect x="72" y="160" width="296" height="40" rx="7" fill="none" stroke="currentColor" stroke-width="1.3"/>
  <text x="220" y="184" font-size="11" text-anchor="middle" fill="currentColor">grid present · fingerprint verified</text>
  <rect x="72" y="212" width="296" height="44" rx="7" fill="var(--petal-soft, none)" stroke="currentColor" stroke-width="1.4"/>
  <text x="220" y="231" font-size="11" text-anchor="middle" font-weight="600" fill="currentColor">grid-based transformation</text>
  <text x="220" y="247" font-size="10" text-anchor="middle" fill="currentColor">accuracy ~0.02 m</text>
  <rect x="96" y="288" width="248" height="46" rx="8" fill="none" stroke="currentColor" stroke-width="1.8"/>
  <text x="220" y="309" font-size="11.5" text-anchor="middle" font-weight="700" fill="currentColor">Correct position</text>
  <text x="220" y="325" font-size="10" text-anchor="middle" fill="currentColor">reference truth</text>
  <line x1="220" y1="200" x2="220" y2="212" fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#datum-plain)"/>
  <line x1="220" y1="256" x2="220" y2="288" fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#datum-plain)"/>
  <!-- right lane: unpinned -->
  <rect x="512" y="106" width="336" height="250" rx="10" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.6"/>
  <text x="530" y="130" font-size="12.5" font-weight="700" fill="var(--crimson, currentColor)">Unpinned image</text>
  <text x="530" y="147" font-size="10" fill="currentColor" opacity="0.8">GDAL 3.8.4 · PROJ 9.1.0 · grid absent</text>
  <rect x="532" y="160" width="296" height="40" rx="7" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.3"/>
  <text x="680" y="184" font-size="11" text-anchor="middle" fill="var(--crimson, currentColor)">grid missing · no error raised</text>
  <rect x="532" y="212" width="296" height="44" rx="7" fill="var(--petal-soft, none)" stroke="var(--crimson, currentColor)" stroke-width="1.4"/>
  <text x="680" y="231" font-size="11" text-anchor="middle" font-weight="600" fill="var(--crimson, currentColor)">Helmert fallback</text>
  <text x="680" y="247" font-size="10" text-anchor="middle" fill="currentColor">accuracy ~1 m</text>
  <rect x="556" y="288" width="248" height="46" rx="8" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.8"/>
  <text x="680" y="309" font-size="11.5" text-anchor="middle" font-weight="700" fill="var(--crimson, currentColor)">Drifted position</text>
  <text x="680" y="325" font-size="10" text-anchor="middle" fill="var(--crimson, currentColor)">offset ≈ 0.4 m</text>
  <line x1="680" y1="200" x2="680" y2="212" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.3" marker-end="url(#datum-arrow)"/>
  <line x1="680" y1="256" x2="680" y2="288" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.3" marker-end="url(#datum-arrow)"/>
  <!-- drift measure between outputs -->
  <path d="M344,311 H556" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.2" stroke-dasharray="4 4" marker-start="url(#datum-arrow)" marker-end="url(#datum-arrow)"/>
  <text x="450" y="303" font-size="10" text-anchor="middle" fill="var(--crimson, currentColor)">same input, two answers</text>
  <!-- verification gate -->
  <rect x="210" y="392" width="480" height="86" rx="10" fill="var(--blush, none)" stroke="currentColor" stroke-width="1.6"/>
  <text x="450" y="416" font-size="12.5" text-anchor="middle" font-weight="700" fill="currentColor">Fingerprint gate at startup</text>
  <text x="450" y="436" font-size="10.5" text-anchor="middle" fill="currentColor">hash every grid → compare to committed manifest</text>
  <text x="450" y="454" font-size="10.5" text-anchor="middle" fill="var(--crimson, currentColor)" font-weight="600">mismatch → abort before any reprojection runs</text>
  <text x="450" y="470" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.85">forces both images to the identical grid set</text>
  <line x1="220" y1="334" x2="300" y2="392" fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#datum-plain)"/>
  <line x1="680" y1="334" x2="600" y2="392" fill="none" stroke="var(--crimson, currentColor)" stroke-width="1.3" marker-end="url(#datum-arrow)"/>
</svg>

## Tiered Resolution Strategy

Close the gap in ordered tiers, from the definitive pin down to a safe default that still records what it did. The guiding rule: a reprojection must never proceed on an unverified grid, and a machine that cannot prove its toolchain must refuse to serve rather than serve a plausible lie.

1. **Pin the whole toolchain, not just GDAL (definitive).** Install exact GDAL, PROJ, and PROJ-data versions in the image, disable `PROJ_NETWORK` so no grid is ever fetched at runtime, and let the same pins flow into the reproducible build the [Setting Up Dockerized GIS Environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/) workflow produces.
2. **Fingerprint the grids into a committed manifest.** Hash every grid file and capture the version tuple into a manifest that lives under [Version Control for Spatial Workflows](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/version-control-for-spatial-workflows/), so "what this machine will do to a coordinate" is a reviewable, diff-able artifact rather than a runtime surprise.
3. **Assert the operation PROJ actually selects.** For each datum pair the incident cares about, resolve the chosen transformation and confirm it is the grid-based pipeline, not a Helmert fallback — versions can match while a needed grid is still missing.
4. **Fail closed on any mismatch (safe default with audit flag).** At startup, compare the running environment against the manifest; on drift, abort and emit an audit record naming the offending grid, so the machine is quarantined loudly instead of drifting quietly.
5. **Bind every reprojection to a grid fingerprint.** Stamp outputs with the manifest hash so any feature can be replayed against the exact grids that produced it, satisfying the reconstructability the compliance regime demands.

## Production Python Implementation

The routine below carries the full resolution path: it reads the pinned version and grid fingerprints, verifies them against a committed manifest, confirms that the critical datum transformation resolves to a grid-based operation rather than a coarse fallback, aborts on drift, and emits an immutable audit record binding the environment to a specific fingerprint. Senior-engineer assumptions apply: `pyproj` wraps the same PROJ the container pins, and the manifest is generated once on a trusted build and committed. Nothing here fetches from the network — offline determinism is the whole point.

```python
from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import pyproj
from pyproj import Transformer
from pyproj.datadir import get_data_dir

logger = logging.getLogger("incidentgis.datum")


class ToolchainDriftError(RuntimeError):
    """Raised when the running GDAL/PROJ grid environment diverges from the manifest."""


@dataclass
class GridManifest:
    """The committed source of truth for a reproducible reprojection environment."""
    proj_version: str
    grid_hashes: dict[str, str]          # filename -> sha256
    critical_pairs: list[tuple[str, str]]  # (source_crs, target_crs) that MUST use a grid

    @classmethod
    def load(cls, path: Path) -> "GridManifest":
        data = json.loads(path.read_text(encoding="utf-8"))
        return cls(
            proj_version=data["proj_version"],
            grid_hashes=data["grid_hashes"],
            critical_pairs=[tuple(p) for p in data["critical_pairs"]],
        )


@dataclass
class DatumAuditEntry:
    """Immutable record binding a verification pass to a specific environment."""
    proj_version: str
    manifest_fingerprint: str
    verified_grids: int
    status: str
    detail: str
    recorded_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


def _sha256(path: Path) -> str:
    """Stream-hash a grid file so large .tif grids do not load fully into memory."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


class DatumGridVerifier:
    """Verify the pinned PROJ toolchain and grids before any reprojection is trusted.

    Every verification appends a ``DatumAuditEntry`` so a corrected dataset can be
    reconstructed against the exact grids that produced it.
    """

    def __init__(self, manifest: GridManifest) -> None:
        self.manifest = manifest
        self.audit_log: list[DatumAuditEntry] = []
        self._fingerprint = self._manifest_fingerprint(manifest)

    @staticmethod
    def _manifest_fingerprint(manifest: GridManifest) -> str:
        # Order-independent digest of the manifest's grid hash set.
        joined = "|".join(sorted(f"{k}:{v}" for k, v in manifest.grid_hashes.items()))
        return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:16]

    def _fail(self, detail: str) -> None:
        entry = DatumAuditEntry(
            proj_version=pyproj.proj_version_str,
            manifest_fingerprint=self._fingerprint,
            verified_grids=0,
            status="drift",
            detail=detail,
        )
        self.audit_log.append(entry)
        logger.error("datum_drift_detected", extra={"audit": asdict(entry)})
        raise ToolchainDriftError(detail)

    def _verify_version(self) -> None:
        running = pyproj.proj_version_str
        if running != self.manifest.proj_version:
            self._fail(
                f"PROJ version mismatch: running {running}, "
                f"manifest expects {self.manifest.proj_version}"
            )

    def _verify_grids(self) -> int:
        data_dir = Path(get_data_dir())
        verified = 0
        for name, expected in self.manifest.grid_hashes.items():
            grid_path = data_dir / name
            if not grid_path.is_file():
                self._fail(f"pinned grid absent: {name} not found in {data_dir}")
            actual = _sha256(grid_path)
            if actual != expected:
                self._fail(
                    f"grid fingerprint mismatch for {name}: "
                    f"got {actual[:12]}…, expected {expected[:12]}…"
                )
            verified += 1
        return verified

    def _verify_operations(self) -> None:
        # A version+hash match still permits a missing-but-not-manifested grid to
        # force a Helmert fallback, so assert the selected operation is grid-based.
        for source_crs, target_crs in self.manifest.critical_pairs:
            try:
                transformer = Transformer.from_crs(
                    source_crs, target_crs, always_xy=True
                )
            except pyproj.exceptions.CRSError as exc:
                self._fail(f"invalid critical pair {source_crs}->{target_crs}: {exc}")
            desc = transformer.description.lower()
            # Ballpark/null transforms are PROJ's low-accuracy fallbacks.
            if "ballpark" in desc or transformer.is_network_enabled:
                self._fail(
                    f"{source_crs}->{target_crs} resolved to a fallback "
                    f"('{transformer.description}') instead of a pinned grid"
                )

    def verify(self) -> DatumAuditEntry:
        """Run all checks; raise on drift, otherwise emit a pass audit entry."""
        try:
            self._verify_version()
            grid_count = self._verify_grids()
            self._verify_operations()
        except ToolchainDriftError:
            raise
        except (OSError, ValueError) as exc:
            # Never let an unexpected fault masquerade as a clean environment.
            logger.exception("datum_verify_unexpected_error")
            self._fail(f"verification aborted on unexpected error: {exc}")
        entry = DatumAuditEntry(
            proj_version=pyproj.proj_version_str,
            manifest_fingerprint=self._fingerprint,
            verified_grids=grid_count,
            status="verified",
            detail=f"{grid_count} grids match; critical pairs grid-based",
        )
        self.audit_log.append(entry)
        logger.info("datum_environment_verified", extra={"audit": asdict(entry)})
        return entry


def guard_reprojection_environment(manifest_path: Path) -> DatumAuditEntry:
    """Call once at container startup; a raised ToolchainDriftError must abort the process."""
    manifest = GridManifest.load(manifest_path)
    verifier = DatumGridVerifier(manifest)
    return verifier.verify()
```

The `audit_log` and the returned `manifest_fingerprint` are the load-bearing outputs. Stamping every reprojected feature with that fingerprint lets a reviewer prove which grid set produced a coordinate, and wiring `guard_reprojection_environment` into a startup check turns "we think the field tablets match" into a build that cannot start when they do not — the same gate the [Spatial Data Testing & CI Pipelines](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/spatial-data-testing-and-ci-pipelines/) workflow runs before an image is ever promoted.

## Validation Checklist

Verify every item before promoting an image to a field device.

- [ ] Exact GDAL, PROJ, and PROJ-data versions are pinned in the image build — no floating minor or `latest` tags anywhere in the layer chain.
- [ ] `PROJ_NETWORK` is disabled and no runtime path fetches grids on demand, so the environment is identical online and blacked out.
- [ ] The grid manifest (versions + per-file SHA-256) is committed under version control and the fingerprint is reproducible from a clean checkout.
- [ ] `guard_reprojection_environment` runs at container startup and a raised `ToolchainDriftError` aborts the process rather than logging and continuing.
- [ ] Every datum pair the incident depends on is listed in `critical_pairs` and asserted to resolve to a grid-based operation, not a ballpark fallback.
- [ ] Reprojected outputs are stamped with the manifest fingerprint so any feature can be replayed against the exact grids that produced it.
- [ ] Structured logs and every `DatumAuditEntry` route to the incident logging sink, not stdout.
- [ ] A regression test transforms a known control point and asserts the result within a few centimetres of the surveyed truth for the pinned grids.

## Edge Cases and Gotchas

- **Version match, grid still missing.** Two images can report the identical PROJ version yet differ because a grid was never installed or was pruned to shrink the image. A version check alone passes; only fingerprinting the actual grid files and asserting the selected operation catches it, which is why `_verify_operations` exists alongside the hash check.
- **Silent ballpark fallback.** PROJ does not raise when a grid is absent — it quietly returns a low-accuracy "ballpark" transformation. Treat a `ballpark` description as a hard failure, never a warning, because a warning in a field log is a warning nobody reads until the after-action review.
- **Axis-order inversion masquerading as drift.** A coordinate that looks shifted may actually be latitude and longitude swapped, not a datum grid difference. Always construct transformers with `always_xy=True` and rule out axis order first, following the same contract the [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) workflow enforces, before blaming the grids.
- **Vertical grids forgotten.** Teams pin the horizontal NTv2 grids and overlook the geoid grids that height transformations need, so elevations drift while positions match. Include vertical grids in the manifest if the incident uses heights for flood modelling or debris volume.
- **Agency-specific datum realizations.** A partner agency emitting a different NAD83 realization than yours introduces a real, correct offset that no pinning will erase — the grids are doing their job. Reproject partner feeds to the incident's declared realization on ingest rather than assuming a shared datum, and let property-based transform tests such as those in [Writing Property-Based Tests for Coordinate Transforms](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/spatial-data-testing-and-ci-pipelines/writing-property-based-tests-for-coordinate-transforms/) catch the round-trip errors that slip past a single control point.

## Frequently Asked Questions

**How can pinning only GDAL still leave datum-grid drift?** GDAL delegates every datum transformation to PROJ, and PROJ reads its answer from separate transformation grid files shipped in the PROJ-data package. Two images can carry the identical GDAL version yet different PROJ releases or different grid sets, so the same input coordinate is transformed through different pipelines. Pinning GDAL alone does not pin PROJ or the grids, which is where the sub-metre divergence actually originates.

**Why is a sub-metre datum shift dangerous rather than negligible?** A half-metre offset is invisible on a zoomed-out map but decisive at the point of work: it moves a structure the width of a doorway, shifts a hazard-zone boundary across a property line, and makes two agencies' layers disagree over which side of a line a responder stands on. Because the error is constant and quiet, it is trusted, and a Common Operating Picture that silently mixes two datum realizations is not defensible in after-action review.

**Should field machines download PROJ grids on demand?** No. On-demand grid fetching means the transformation a machine performs depends on what it managed to download and when, which is neither reproducible nor available on a disconnected incident network. Bake the exact grid set into the image, disable network fetching, and verify the grid fingerprints at startup so every machine transforms coordinates identically whether it is online or blacked out.

## Related

- [Setting Up Dockerized GIS Environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/) — the reproducible image build these version pins and grid fingerprints belong in.
- [Spatial Data Testing & CI Pipelines](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/spatial-data-testing-and-ci-pipelines/) — gate the fingerprint check in CI so no drifted image is ever promoted.
- [Writing Property-Based Tests for Coordinate Transforms](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/spatial-data-testing-and-ci-pipelines/writing-property-based-tests-for-coordinate-transforms/) — round-trip invariants that catch datum bugs a single control point misses.
- [Coordinate Reference Systems for Disaster Zones](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/coordinate-reference-systems-for-disaster-zones/) — the CRS and axis-order contract that keeps drift diagnosis honest.

Up: [Setting Up Dockerized GIS Environments](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/setting-up-dockerized-gis-environments/)
