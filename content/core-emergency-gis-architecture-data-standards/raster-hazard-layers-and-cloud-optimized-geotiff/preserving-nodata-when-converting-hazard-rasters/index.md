---
title: "Preserving Nodata When Converting Hazard Rasters"
description: "A dropped nodata mask turns unmodelled flood cells into zero depth, so the map asserts dry ground exactly where the model failed to converge. Mask-preserving conversion, resampling and audit in Python."
slug: preserving-nodata-when-converting-hazard-rasters
type: article
breadcrumb: "Preserving Nodata in Conversions"
datePublished: "2026-08-09"
dateModified: "2026-08-09"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Preserving Nodata When Converting Hazard Rasters",
      "description": "A dropped nodata mask turns unmodelled flood cells into zero depth, so the map asserts dry ground exactly where the model failed to converge. Mask-preserving conversion, resampling and audit in Python.",
      "datePublished": "2026-08-09",
      "dateModified": "2026-08-09",
      "author": {
        "@type": "Organization",
        "name": "Incident GIS"
      },
      "publisher": {
        "@type": "Organization",
        "name": "Incident GIS"
      }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {
          "@type": "ListItem",
          "position": 1,
          "name": "Home",
          "item": "https://www.incidentgis.com/"
        },
        {
          "@type": "ListItem",
          "position": 2,
          "name": "Core Emergency GIS Architecture & Data Standards",
          "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/"
        },
        {
          "@type": "ListItem",
          "position": 3,
          "name": "Raster Hazard Layers & Cloud-Optimized GeoTIFF",
          "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/raster-hazard-layers-and-cloud-optimized-geotiff/"
        },
        {
          "@type": "ListItem",
          "position": 4,
          "name": "Preserving Nodata When Converting Hazard Rasters",
          "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/raster-hazard-layers-and-cloud-optimized-geotiff/preserving-nodata-when-converting-hazard-rasters/"
        }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Convert a hazard raster without losing its nodata mask",
      "description": "Keep the mask attached to the values through every conversion step, state the nodata value explicitly on every write, resample the mask separately, refuse targets that cannot carry it, and audit masked-cell counts before and after.",
      "step": [
        {
          "@type": "HowToStep",
          "name": "Read with the mask attached",
          "text": "Read bands with masked=True, or copy the source profile wholesale, so the array and its validity mask never travel separately — a bare array read is the single most common way the mask is lost."
        },
        {
          "@type": "HowToStep",
          "name": "State nodata on every write",
          "text": "Set the nodata value explicitly in each write profile rather than relying on inheritance, so the declaration is auditable in the code instead of implied by the input."
        },
        {
          "@type": "HowToStep",
          "name": "Resample the mask separately",
          "text": "Resample values with average and the mask with nearest, then reapply the mask, so no output cell is an average of real depths and the sentinel."
        },
        {
          "@type": "HowToStep",
          "name": "Refuse targets that cannot carry nodata",
          "text": "Treat PNG, JPEG and eight-bit renders as display artefacts, mark them as such, and prevent them from feeding routing or damage-assessment steps."
        },
        {
          "@type": "HowToStep",
          "name": "Audit masked-cell counts",
          "text": "Count masked cells before and after every step and assert equality for non-resampling conversions, turning a silent corruption into a failed job."
        }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why is losing the nodata mask more dangerous than losing other metadata?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Because it changes an assertion rather than a description. A raster that loses its units is confusing and recoverable; a raster that loses its nodata mask converts every unmodelled cell into an ordinary value, and for a depth grid that value is usually zero, which means dry. The map then states that ground is passable in exactly the places where the model declined to produce a result — typically where the mesh failed to converge, which is often the hydraulically complex ground that most needed modelling. Nothing in the rendered output distinguishes it, because zero and dry share a colour."
          }
        },
        {
          "@type": "Question",
          "name": "What is the most common way the mask gets dropped in Python?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Reading a band into a plain array with src.read(1) and writing a new file from it. The mask is a property of the dataset, not of the array, so the sentinel value arrives in the array as an ordinary number and is written back as one. The fix is src.read(1, masked=True), which returns a masked array carrying its own fill value, or copying the source profile wholesale and setting nodata explicitly on the write. Any function whose signature takes and returns a bare ndarray is a place where the mask cannot survive."
          }
        },
        {
          "@type": "Question",
          "name": "Can average resampling corrupt a hazard raster even when nodata is preserved?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Yes, and this is the subtler failure. An average kernel over a window that straddles the mask boundary blends real depths with the sentinel, producing an output cell that is neither nodata nor a genuine value — a plausible number with no provenance that will pass any range check applied to it. Resample the values and the mask separately, using nearest for the mask, then reapply it. The same problem affects overview pyramids built without mask awareness, which contaminates the zoomed-out view most people actually look at."
          }
        }
      ]
    }
  ]
}
</script>

# Preserving Nodata When Converting Hazard Rasters

A hydraulic modeller hands over a depth grid at 02:00 and a GIS analyst converts it for the field cache with a one-line `rasterio` script. The conversion succeeds, the raster opens, the colours look right, and a block where the mesh failed to converge now reads as zero metres of water. At 06:20 a strike team is routed down that block because the depth grid says it is dry.

## Root Cause and Operational Impact

A hazard raster carries three distinct cell states — a modelled value, a modelled zero, and no result — and most raster tooling understands two. The nodata mask is what encodes the third, and it is stored as a property of the dataset rather than of the array, so any operation that moves the array without the dataset loses it.

That loss is silent by construction. The sentinel value is an ordinary number in an ordinary floating-point band; once the mask no longer marks it, nothing distinguishes it from data. If the sentinel was `-9999` the result is at least conspicuous, but the common defensive move of writing zeros into unmodelled cells "so the raster renders cleanly" produces exactly the failure above: an assertion of dry ground precisely where the model declined to say.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="nd1-t nd1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="nd1-t">One transect across a flood-depth grid, before and after nodata is lost</title>
  <desc id="nd1-d">A cross-section through a flood-depth raster along one street. In the source grid the solver produced depths of 0.4, 1.1 and 1.6 metres over the inundated stretch, zero over ground it solved as dry, and nodata over a block where the mesh failed to converge. After a conversion that dropped the nodata mask, the unconverged block reads as 0.0 metres. The rendered map is identical in both cases over the dry ground and identical in colour over the failed block, because zero and dry share a colour. The result is a map that asserts a block is passable in exactly the place where the model could not say.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">one transect along a street, through the depth grid</text>
  <text x="8" y="84" font-size="10.5" font-weight="700" fill="currentColor">source grid</text>
  <g stroke="var(--crimson-deep)" stroke-width="1.2">
    <rect x="200" y="96" width="90" height="44" fill="var(--petal-soft)"/>
    <rect x="290" y="96" width="90" height="44" fill="var(--petal)"/>
    <rect x="380" y="96" width="90" height="44" fill="var(--crimson)"/>
    <rect x="470" y="96" width="90" height="44" fill="var(--crimson)"/>
    <rect x="560" y="96" width="90" height="44" fill="var(--cream)" stroke-dasharray="5 3"/>
    <rect x="650" y="96" width="90" height="44" fill="var(--petal-soft)"/>
  </g>
  <g font-size="10.5" text-anchor="middle" fill="currentColor">
    <text x="245" y="124">0.0</text><text x="335" y="124">0.4</text>
    <text x="425" y="124" fill="var(--cream)">1.1</text><text x="515" y="124" fill="var(--cream)">1.6</text>
    <text x="605" y="124" fill="var(--ember-text)" font-weight="700">nodata</text><text x="695" y="124">0.0</text>
  </g>
  <text x="560" y="164" font-size="10" font-weight="700" fill="var(--ember-text)">the mesh did not converge here</text>
  <text x="8" y="228" font-size="10.5" font-weight="700" fill="currentColor">after a lossy conversion</text>
  <g stroke="var(--crimson-deep)" stroke-width="1.2">
    <rect x="200" y="240" width="90" height="44" fill="var(--petal-soft)"/>
    <rect x="290" y="240" width="90" height="44" fill="var(--petal)"/>
    <rect x="380" y="240" width="90" height="44" fill="var(--crimson)"/>
    <rect x="470" y="240" width="90" height="44" fill="var(--crimson)"/>
    <rect x="560" y="240" width="90" height="44" fill="var(--petal-soft)"/>
    <rect x="650" y="240" width="90" height="44" fill="var(--petal-soft)"/>
  </g>
  <g font-size="10.5" text-anchor="middle" fill="currentColor">
    <text x="245" y="268">0.0</text><text x="335" y="268">0.4</text>
    <text x="425" y="268" fill="var(--cream)">1.1</text><text x="515" y="268" fill="var(--cream)">1.6</text>
    <text x="605" y="268" font-weight="700">0.0</text><text x="695" y="268">0.0</text>
  </g>
  <text x="520" y="308" font-size="10.5" font-weight="700" fill="var(--ember-text)">now indistinguishable from ground the model solved as dry</text>
  <text x="8" y="352" font-size="10.5" fill="currentColor">Zero and dry share a colour, so the rendered map is identical — the assertion changed and nothing shows it.</text>
</svg>

The two transects render identically. Zero and dry share a colour on every depth ramp anyone uses, so no visual review catches it, and the difference only becomes visible when a unit reaches the block. Under [NIMS and FEMA](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/compliance-checklists-nims-fema-ogc/) traceability expectations, a product that quietly converts "unknown" into "safe" is also unreconstructable after the fact — the audit trail shows a successful conversion.

## Tiered Resolution Strategy

Work down these tiers. The first three keep the mask intact; the last two contain the damage when something upstream has already destroyed it.

1. **Never separate the array from its dataset (definitive).** Read with `masked=True` so the mask travels with the values, or copy the source profile wholesale and write through it. Every conversion step must be expressible as "dataset in, dataset out"; a step whose signature takes and returns a bare `ndarray` is a step where the mask cannot survive.
2. **State the nodata value explicitly at every write.** Do not rely on it being inherited. An explicit `nodata=` on the write profile costs one line and makes the intent auditable in the code rather than implied by the input.
3. **Respect the mask in every resampling operation.** Averaging a real depth with a sentinel produces a plausible number derived partly from a cell that had no value. Use mask-aware resampling, or resample the mask separately and reapply it.
4. **Refuse the conversion when the mask cannot be represented (safe default).** Some targets — PNG, JPEG, an eight-bit render — have no way to carry nodata. Those are display artefacts, not data products, and the pipeline should mark them as such and refuse to let them feed a routing or assessment step.
5. **Emit an audit record comparing masked-cell counts.** Count nodata cells before and after every step and log both. A step that changes the count has either repaired or destroyed something, and either way somebody should know which.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="nd2-t nd2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="nd2-t">Five conversion paths and whether each preserves the nodata mask</title>
  <desc id="nd2-d">Five ways a hazard raster commonly moves between tools, and whether nodata survives. A gdal_translate call with an explicit destination nodata preserves it. A rasterio read-modify-write preserves it only if the profile is copied and the nodata key set explicitly, which is easy to omit. Reading into a plain NumPy array and writing a fresh file loses it, because the array carries no mask. Exporting to PNG or JPEG for a web viewer loses it, since neither format has a nodata concept. Resampling with average over a window containing nodata contaminates real values unless the mask is respected, producing plausible depths derived partly from cells that had none. Only the first path is safe by default; the rest are safe only if someone remembered.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">where the mask actually gets lost</text>
  <rect x="40" y="72" width="800" height="52" rx="8" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="94" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="currentColor">gdal_translate -a_nodata -9999</text>
  <text x="60" y="112" font-size="10" fill="currentColor">preserved — the value is stated on the command line</text>
  <text x="700" y="104" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">safe</text>
  <rect x="40" y="132" width="800" height="52" rx="8" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="154" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="currentColor">rasterio read → modify → write(**profile)</text>
  <text x="60" y="172" font-size="10" fill="currentColor">preserved only if the profile is copied and nodata is set — trivially omitted in a refactor</text>
  <text x="700" y="164" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">conditional</text>
  <rect x="40" y="192" width="800" height="52" rx="8" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="214" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="var(--ember-text)">src.read(1) → np.ndarray → new file</text>
  <text x="60" y="232" font-size="10" fill="currentColor">lost — a bare array carries no mask, so the sentinel becomes an ordinary value</text>
  <text x="700" y="224" font-size="10.5" font-weight="700" fill="var(--ember-text)">lost</text>
  <rect x="40" y="252" width="800" height="52" rx="8" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="274" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="var(--ember-text)">export to PNG / JPEG for a viewer</text>
  <text x="60" y="292" font-size="10" fill="currentColor">lost — neither format has a nodata concept, and JPEG also changes the values it keeps</text>
  <text x="700" y="284" font-size="10.5" font-weight="700" fill="var(--ember-text)">lost</text>
  <rect x="40" y="312" width="800" height="52" rx="8" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="334" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="var(--ember-text)">average resampling across the mask</text>
  <text x="60" y="352" font-size="10" fill="currentColor">contaminated — a real depth averaged with a sentinel is a plausible number derived from nothing</text>
  <text x="700" y="344" font-size="10.5" font-weight="700" fill="var(--ember-text)">worse</text>
</svg>

The third row is the one to search the codebase for. `src.read(1)` returning a plain array is the most natural thing to write in `rasterio`, appears in every tutorial, and is where the mask is dropped. Its fix is `src.read(1, masked=True)`, which returns a masked array whose fill value can be written back out intact.

The fifth row is subtler and worse. Resampling is not usually thought of as a lossy step for the mask, but an `average` kernel over a window straddling the mask boundary blends real values with the sentinel, and the output is neither nodata nor a real depth — it is a number with no provenance that will pass every range check you apply to it.

## Production Python Implementation

The routine below performs a mask-preserving conversion with an explicit before-and-after audit, and refuses outright when asked to write to a target that cannot carry nodata.

```python
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.errors import RasterioIOError

logger = logging.getLogger("incidentgis.nodata")

# Formats that cannot represent nodata. Writing a hazard product to one of
# these is a rendering step, never a data step.
DISPLAY_ONLY_DRIVERS = frozenset({"PNG", "JPEG", "GIF", "BMP"})


class NodataContractError(RuntimeError):
    """Raised when a conversion would lose or corrupt the nodata mask."""


def convert_preserving_nodata(
    source: Path,
    destination: Path,
    *,
    driver: str = "GTiff",
    scale_factor: float | None = None,
) -> dict[str, int]:
    """Convert a hazard raster, keeping the nodata mask intact and audited.

    Returns the before/after masked-cell counts so the caller can assert on
    them. Raises NodataContractError rather than producing a product whose
    unmodelled cells have become ordinary values.
    """
    if driver.upper() in DISPLAY_ONLY_DRIVERS:
        raise NodataContractError(
            f"{driver} cannot carry nodata; produce it as a render, "
            "not as an input to routing or assessment"
        )

    try:
        with rasterio.open(source) as src:
            if src.nodata is None:
                raise NodataContractError(
                    f"{source} declares no nodata value — refusing to guess one"
                )

            # masked=True keeps the mask attached to the values. A bare
            # src.read(1) here is the single most common way the mask is lost.
            data = src.read(1, masked=True)
            before = int(np.ma.count_masked(data))

            profile = src.profile.copy()
            profile.update(driver=driver, tiled=True,
                           blockxsize=512, blockysize=512)

            if scale_factor is not None:
                # Resample the mask separately and reapply it, so no output
                # cell is an average of real values and the sentinel.
                out_shape = (
                    int(src.height * scale_factor),
                    int(src.width * scale_factor),
                )
                values = src.read(
                    1, out_shape=out_shape, resampling=Resampling.average,
                )
                mask = src.read_masks(1, out_shape=out_shape,
                                      resampling=Resampling.nearest)
                data = np.ma.masked_where(mask == 0, values)
                profile.update(
                    height=out_shape[0], width=out_shape[1],
                    transform=src.transform * src.transform.scale(
                        src.width / out_shape[1], src.height / out_shape[0]
                    ),
                )

            with rasterio.open(destination, "w", **profile) as dst:
                # Writing the filled array plus an explicit nodata keeps the
                # sentinel and the declaration in agreement.
                dst.write(data.filled(src.nodata).astype(profile["dtype"]), 1)
                dst.update_tags(**src.tags())

        with rasterio.open(destination) as check:
            if check.nodata != rasterio.open(source).nodata:
                raise NodataContractError("nodata value changed during conversion")
            after = int(np.ma.count_masked(check.read(1, masked=True)))

    except RasterioIOError as exc:
        logger.error("nodata_conversion_io_failed", exc_info=exc)
        raise

    if scale_factor is None and after != before:
        raise NodataContractError(
            f"masked-cell count changed without resampling: {before} → {after}"
        )

    logger.info("nodata_conversion_ok", extra={
        "source": str(source), "destination": str(destination),
        "masked_before": before, "masked_after": after,
    })
    return {"masked_before": before, "masked_after": after}
```

The equality assertion on masked-cell counts is what turns a silent class of bug into a loud one. For a straight conversion the count must be identical; if it is not, something read or wrote the sentinel as a value.

<svg viewBox="0 0 880 340" role="img" aria-labelledby="nd3-t nd3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="nd3-t">What a downstream consumer should do with each of the three cell states</title>
  <desc id="nd3-d">A depth raster carries three distinct cell states and each demands different downstream behaviour. A positive depth is a modelled hazard and drives routing closure and evacuation decisions directly. An explicit zero is modelled dry ground and is safe to route across, because the solver considered it and found no water. Nodata is the absence of a result and must propagate as unknown: a route crossing it is not closed and not open, and the correct handling is to flag the segment for reconnaissance rather than to treat it as either. Collapsing nodata into zero destroys the third state, and with it the only signal that would have sent someone to look.</desc>
  <rect x="0" y="0" width="880" height="340" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">three states, three behaviours — the third is the one that gets collapsed</text>
  <rect x="40" y="76" width="256" height="184" rx="9" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.8"/>
  <rect x="312" y="76" width="256" height="184" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <rect x="584" y="76" width="256" height="184" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="106" font-size="11.5" font-weight="700" fill="var(--cream)">depth &gt; 0</text>
  <text x="332" y="106" font-size="11.5" font-weight="700" fill="var(--crimson-deep)">depth = 0</text>
  <text x="604" y="106" font-size="11.5" font-weight="700" fill="var(--ember-text)">nodata</text>
  <text x="60" y="132" font-size="10" fill="var(--cream)">modelled hazard</text>
  <text x="332" y="132" font-size="10" fill="currentColor">modelled dry ground</text>
  <text x="604" y="132" font-size="10" fill="currentColor">no result at all</text>
  <text x="60" y="168" font-size="10" fill="var(--cream)">close the segment</text>
  <text x="60" y="186" font-size="10" fill="var(--cream)">drive the evacuation line</text>
  <text x="60" y="204" font-size="10" fill="var(--cream)">quote the value on the radio</text>
  <text x="332" y="168" font-size="10" fill="currentColor">route across it</text>
  <text x="332" y="186" font-size="10" fill="currentColor">the solver considered it</text>
  <text x="332" y="204" font-size="10" fill="currentColor">and found no water</text>
  <text x="604" y="168" font-size="10" fill="currentColor">neither closed nor open</text>
  <text x="604" y="186" font-size="10" fill="currentColor">flag for reconnaissance</text>
  <text x="604" y="204" font-size="10" fill="currentColor">propagate as unknown</text>
  <text x="60" y="236" font-size="10" font-weight="700" fill="var(--cream)">act on it</text>
  <text x="332" y="236" font-size="10" font-weight="700" fill="var(--crimson-deep)">act on it</text>
  <text x="604" y="236" font-size="10" font-weight="700" fill="var(--ember-text)">go and look</text>
  <text x="8" y="300" font-size="10.5" fill="currentColor">Collapsing nodata into zero deletes the third column — and with it the only signal that would have sent someone.</text>
  <text x="8" y="322" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">Which is why the mask is not metadata. It is one third of the data.</text>
</svg>

## Validation Checklist

- [ ] Every read that feeds a write uses `masked=True`, or copies the source profile wholesale.
- [ ] Every write states `nodata=` explicitly rather than inheriting it.
- [ ] The nodata sentinel is outside the physically valid range for the quantity and is not `NaN`.
- [ ] Resampling uses a mask-aware path, or resamples the mask with `nearest` and reapplies it.
- [ ] Masked-cell counts are logged before and after every step, and asserted equal for non-resampling steps.
- [ ] Any export to PNG, JPEG or an eight-bit render is tagged as display-only and cannot feed routing or assessment.
- [ ] A downstream consumer treats nodata as a third state, not as zero — the routing layer flags those segments for reconnaissance.
- [ ] The smoke test includes a fixture with a deliberate unconverged block, and asserts it is still nodata after the full pipeline.

## Edge Cases and Gotchas

- **`NaN` as the sentinel.** It cannot be compared with `==`, several readers round-trip it inconsistently, and integer bands cannot hold it at all. Use an explicit out-of-range sentinel and reject `NaN` at the writer.
- **A valid value that collides with the sentinel.** `-9999` is safe for depth and unsafe for elevation in a region below sea level. Choose the sentinel against the quantity's real range, not by convention.
- **Alpha bands standing in for a mask.** Some pipelines carry validity as a fourth band. That works within the pipeline and is invisible to any consumer expecting `nodata`, so convert it to a real nodata declaration at the publication boundary.
- **Nodata surviving the raster and dying in the vectorisation.** Polygonising a depth grid to produce flood extents will happily produce a polygon whose interior includes unconverged cells. Mask before polygonising, and carry the unconverged area as a separate "unassessed" polygon rather than folding it into either class.
- **Overviews built across the mask.** The same averaging problem, one level up: an overview pyramid built without mask awareness contaminates every zoomed-out view, which is the view most people look at. Rebuild overviews after any mask repair.

## Frequently Asked Questions

**Why is losing the nodata mask more dangerous than losing other metadata?** Because it changes an assertion rather than a description. A raster that loses its units is confusing and recoverable; a raster that loses its nodata mask converts every unmodelled cell into an ordinary value, and for a depth grid that value is usually zero, which means dry. The map then states that ground is passable in exactly the places where the model declined to produce a result — typically where the mesh failed to converge, which is often the hydraulically complex ground that most needed modelling. Nothing in the rendered output distinguishes it, because zero and dry share a colour.

**What is the most common way the mask gets dropped in Python?** Reading a band into a plain array with src.read(1) and writing a new file from it. The mask is a property of the dataset, not of the array, so the sentinel value arrives in the array as an ordinary number and is written back as one. The fix is src.read(1, masked=True), which returns a masked array carrying its own fill value, or copying the source profile wholesale and setting nodata explicitly on the write. Any function whose signature takes and returns a bare ndarray is a place where the mask cannot survive.

**Can average resampling corrupt a hazard raster even when nodata is preserved?** Yes, and this is the subtler failure. An average kernel over a window that straddles the mask boundary blends real depths with the sentinel, producing an output cell that is neither nodata nor a genuine value — a plausible number with no provenance that will pass any range check applied to it. Resample the values and the mask separately, using nearest for the mask, then reapply it. The same problem affects overview pyramids built without mask awareness, which contaminates the zoomed-out view most people actually look at.

## Related

- [Raster Hazard Layers & Cloud-Optimized GeoTIFF](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/raster-hazard-layers-and-cloud-optimized-geotiff/) — the publication contract this conversion has to satisfy.
- [Recovering from Corrupt Geometry in Streaming Sensor Ingest](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/geospatial-data-ingestion-pipelines/recovering-from-corrupt-geometry-in-streaming-sensor-ingest/) — the same distinction between a repairable defect and an absent value, on the vector side.
- [Emergency Metadata Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/emergency-metadata-standards/) — why a product that converts unknown into safe is also unreconstructable at review.
- [Rerouting Around Dynamically Closed Roads During Flooding](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/evacuation-routing-and-road-network-analysis/rerouting-around-dynamically-closed-roads-during-flooding/) — the routing layer that must treat nodata as a third state rather than as dry.

Up: [Raster Hazard Layers & Cloud-Optimized GeoTIFF](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/raster-hazard-layers-and-cloud-optimized-geotiff/)
