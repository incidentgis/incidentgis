---
title: "Sizing COG Overviews for Field Display Scales"
description: "Overview depth is chosen from the scales the field application renders, not from a default. Why trimming levels to save write time costs the cheapest and most-used view, and why categorical rasters must not average."
slug: sizing-cog-overviews-for-field-display-scales
type: article
breadcrumb: "Sizing COG Overviews"
datePublished: "2026-08-09"
dateModified: "2026-08-09"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Sizing COG Overviews for Field Display Scales",
      "description": "Overview depth is chosen from the scales the field application renders, not from a default. Why trimming levels to save write time costs the cheapest and most-used view, and why categorical rasters must not average.",
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
          "name": "Sizing COG Overviews for Field Display Scales",
          "item": "https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/raster-hazard-layers-and-cloud-optimized-geotiff/sizing-cog-overviews-for-field-display-scales/"
        }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Choose and build the right overview pyramid for a hazard raster",
      "description": "Derive the overview factor set from the display scales the field application renders, build every level without trimming for write time, choose resampling from the quantity's meaning, keep the pyramid internal, and assert the built set afterwards.",
      "step": [
        {
          "@type": "HowToStep",
          "name": "Enumerate the rendered scales",
          "text": "Read the ground resolutions the field client actually displays out of its own configuration, since levels finer than the finest rendered scale and coarser than the coarsest are never requested."
        },
        {
          "@type": "HowToStep",
          "name": "Build every level in the set",
          "text": "Generate all required factors rather than trimming for write time, because each overview is a quarter the area of the one below and the last levels add only a few per cent to the build."
        },
        {
          "@type": "HowToStep",
          "name": "Choose resampling by meaning",
          "text": "Use average for continuous quantities such as depth or wind speed and nearest for categorical codes such as behaviour class, since averaging class codes produces values that are not classes."
        },
        {
          "@type": "HowToStep",
          "name": "Keep the pyramid internal",
          "text": "Write overviews inside the file rather than to a sidecar, because a range-reading client never requests a sidecar and silently falls back to full-resolution reads."
        },
        {
          "@type": "HowToStep",
          "name": "Assert the built level set",
          "text": "Reopen the file and compare the overview list against the configured factors, so a build that silently produced fewer levels fails immediately instead of being discovered by a saturated uplink."
        }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "How deep should a Cloud-Optimized GeoTIFF's overview pyramid go?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "As deep as the coarsest scale the field application renders, and no deeper. Enumerate the ground resolutions the client displays and include every power-of-two factor that reaches them: levels finer than the finest rendered scale are never requested, and levels beyond the coarsest are pure write cost and file size. Deriving the set from the client's configuration makes this a measurement rather than a guess, and it removes the temptation to trim levels for build time."
          }
        },
        {
          "@type": "Question",
          "name": "Is it worth trimming overview levels to speed up the build?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Almost never. Measured on a four-gigabyte depth grid, going from three levels to five costs about 23 seconds and 100 megabytes, and going from five to seven costs a further 7 seconds and 10 megabytes — because each overview is a quarter the area of the one below it, so the tail of the pyramid is nearly free. The saving is a few per cent of build time, and the cost is that the county-wide situational view, the one an operations chief refreshes most often, becomes the most expensive read in the system."
          }
        },
        {
          "@type": "Question",
          "name": "Why must categorical hazard rasters use nearest resampling?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Because averaging class codes produces numbers that are not classes. A window containing behaviour class 1 and class 4 averages to 2.5, which renders as a moderate class over ground that is a mixture of the lowest and the highest. The error exists only in the overviews, so it is invisible at full resolution and appears exactly in the zoomed-out view people read most. Continuous quantities such as depth or wind speed should average, since the mean of two depths is a depth; the choice follows from what the raster means."
          }
        }
      ]
    }
  ]
}
</script>

# Sizing COG Overviews for Field Display Scales

An analyst rebuilds the flood-depth COG at 04:10 with the overview depth trimmed "because the write was taking too long", and the county-wide situational view that the operations section refreshes every few minutes goes from a 90-kilobyte read to a 12-megabyte one. Nobody changes a setting again for six hours, and the uplink at two forward posts is saturated for the rest of the operational period.

## Root Cause and Operational Impact

Overview generation is the one part of COG production whose cost lands on the producer and whose benefit lands on the consumer, which makes it the part that gets trimmed under time pressure. It is also the part with the least visible consequence locally: a COG with no overviews opens instantly on the machine that wrote it, renders identically, and behaves correctly in every test that does not go over a network.

The cost shows up only at the far end of a thin link, and it shows up worst on the cheapest view. A structure-level window is a small area either way; a county-wide situational view is the whole raster, and without an overview to read, the client must fetch full-resolution pixels for all of it and throw away 99 per cent of what it downloaded. The view an operations chief refreshes most often becomes the single most expensive read in the system.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="ov1-t ov1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="ov1-t">Overview levels against the display scales a field application actually renders</title>
  <desc id="ov1-d">A two-metre flood-depth grid with overview factors of 2, 4, 8, 16 and 32, giving effective resolutions of 4, 8, 16, 32 and 64 metres. Against these are the four scales the field application renders: 1 to 6,000 needs roughly 2-metre pixels, 1 to 24,000 needs 8 metres, 1 to 50,000 needs 16 metres and 1 to 250,000 needs 64 metres. Every rendered scale has an overview level at or just finer than it needs, and no level is left unused. A pyramid built to a generic depth of eight levels would add 128-metre and 256-metre overviews that no display scale ever requests, costing write time and file size for nothing.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">overview levels, matched to the scales the field app actually renders</text>
  <text x="60" y="76" font-size="10" fill="var(--muted)">overview factor</text>
  <text x="300" y="76" font-size="10" fill="var(--muted)">effective resolution</text>
  <text x="520" y="76" font-size="10" fill="var(--muted)">display scale that uses it</text>
  <rect x="40" y="88" width="800" height="44" rx="7" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.4"/>
  <text x="60" y="116" font-size="10.5" font-weight="700" fill="var(--cream)">base</text>
  <text x="300" y="116" font-size="10.5" fill="var(--cream)">2 m</text>
  <text x="520" y="116" font-size="10.5" fill="var(--cream)">1:6 000 · structure assessment</text>
  <rect x="40" y="140" width="800" height="44" rx="7" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.4"/>
  <text x="60" y="168" font-size="10.5" font-weight="700" fill="currentColor">×2 / ×4</text>
  <text x="300" y="168" font-size="10.5" fill="currentColor">4 m / 8 m</text>
  <text x="520" y="168" font-size="10.5" fill="currentColor">1:24 000 · tactical</text>
  <rect x="40" y="192" width="800" height="44" rx="7" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.4"/>
  <text x="60" y="220" font-size="10.5" font-weight="700" fill="currentColor">×8</text>
  <text x="300" y="220" font-size="10.5" fill="currentColor">16 m</text>
  <text x="520" y="220" font-size="10.5" fill="currentColor">1:50 000 · division</text>
  <rect x="40" y="244" width="800" height="44" rx="7" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.4"/>
  <text x="60" y="272" font-size="10.5" font-weight="700" fill="currentColor">×16 / ×32</text>
  <text x="300" y="272" font-size="10.5" fill="currentColor">32 m / 64 m</text>
  <text x="520" y="272" font-size="10.5" fill="currentColor">1:250 000 · county situational</text>
  <rect x="40" y="296" width="800" height="44" rx="7" fill="var(--cream)" stroke="var(--ember)" stroke-width="2" stroke-dasharray="6 4"/>
  <text x="60" y="324" font-size="10.5" font-weight="700" fill="var(--ember-text)">×64 / ×128</text>
  <text x="300" y="324" font-size="10.5" fill="currentColor">128 m / 256 m</text>
  <text x="520" y="324" font-size="10.5" font-weight="700" fill="var(--ember-text)">nothing renders at this scale</text>
</svg>

Choosing the depth is therefore a question about the *client*, not about the raster: which scales does the field application actually render? Levels below the finest rendered scale are never requested, and levels above the coarsest are pure cost. Matching the pyramid to the application's scale set is what makes the decision principled rather than a guess between "some" and "lots".

## Tiered Resolution Strategy

1. **Enumerate the display scales the application renders (definitive).** Read them out of the client's configuration rather than assuming powers of two. Every scale the application can display needs an overview at or slightly finer than its ground resolution; anything else is unused.
2. **Build every level in that set, without trimming for write time.** The cost of depth falls off geometrically, so the last levels are nearly free — trimming them saves seconds and costs the cheapest and most-used view.
3. **Choose the resampling by what the raster means.** Continuous quantities average; categorical codes must use nearest. This is a correctness decision, not a quality one.
4. **Keep the overviews inside the file (safe default).** A `.ovr` sidecar works locally and is invisible to a range-reading client, which will silently fall back to full-resolution reads. Internal is the only arrangement that survives publication.
5. **Assert the level set after every build.** Reopen the file, read `src.overviews(1)`, and compare against the configured set. A build that silently produced fewer levels is a build that will be discovered by a saturated uplink.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="ov2-t ov2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="ov2-t">Write time and file size as overview depth increases</title>
  <desc id="ov2-d">Building a Cloud-Optimized GeoTIFF from a 4-gigabyte flood-depth grid, measured at increasing overview depth. With no overviews the write takes about 96 seconds and produces a 3.9-gigabyte file. Three levels take about 148 seconds and 4.2 gigabytes. Five levels, the recommended depth, take about 171 seconds and 4.3 gigabytes. Seven levels take about 178 seconds and 4.31 gigabytes. The cost of each additional level falls off sharply because each overview is a quarter the size of the one below it, so the fifth through seventh levels together add under 4 per cent to both figures. The practical consequence is that there is no meaningful saving in stopping early, and the pipeline should build to the deepest scale the application renders rather than trimming for write time.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">building a COG from a 4 GB grid — the cost of depth falls off fast</text>
  <text x="8" y="76" font-size="10" fill="var(--muted)">write time</text>
  <rect x="220" y="88" width="270" height="30" rx="5" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.2"/>
  <rect x="220" y="126" width="416" height="30" rx="5" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.2"/>
  <rect x="220" y="164" width="481" height="30" rx="5" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <rect x="220" y="202" width="501" height="30" rx="5" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.2"/>
  <g font-size="10.5" fill="currentColor">
    <text x="8" y="108">no overviews</text>
    <text x="8" y="146">3 levels</text>
    <text x="8" y="184">5 levels · recommended</text>
    <text x="8" y="222">7 levels</text>
  </g>
  <g font-size="10.5" font-weight="700" fill="var(--crimson-deep)">
    <text x="500" y="108">96 s</text><text x="646" y="146">148 s</text><text x="711" y="184">171 s</text><text x="731" y="222">178 s</text>
  </g>
  <text x="8" y="272" font-size="10" fill="var(--muted)">resulting file size</text>
  <g font-size="10.5" fill="currentColor">
    <text x="8" y="300">3.90 GB</text><text x="180" y="300">4.20 GB</text><text x="360" y="300">4.30 GB</text><text x="540" y="300">4.31 GB</text>
  </g>
  <rect x="40" y="318" width="800" height="46" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="346" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">levels 5 to 7 add under 4% to both — so trimming overview depth to save write time saves almost nothing</text>
</svg>

Tier two is the one this guide exists to settle. Measured on a 4-gigabyte grid, going from three levels to five costs 23 seconds and 100 megabytes; going from five to seven costs a further 7 seconds and 10 megabytes. Each overview is a quarter the area of the one below, so the tail of the pyramid is almost free, and there is no defensible saving in stopping early. The write time that felt worth trimming is dominated by the base image, which you were writing anyway.

<svg viewBox="0 0 880 360" role="img" aria-labelledby="ov3-t ov3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="ov3-t">Average and nearest resampling on a categorical hazard raster</title>
  <desc id="ov3-d">A four-class fire-behaviour raster with classes coded 1 through 4 is downsampled two ways. Nearest resampling picks one of the input classes, so every output cell is a class that exists. Average resampling over a window containing classes 1 and 4 produces 2.5, which is not a class at all: it renders as class 2 or 3 depending on how the ramp rounds, so the overview shows moderate behaviour over ground that is a mixture of the lowest and highest. On a continuous depth raster averaging is correct and nearest is needlessly noisy. The resampling choice is therefore a property of what the raster means, not a quality setting.</desc>
  <rect x="0" y="0" width="880" height="360" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">resampling is a property of what the raster means, not a quality setting</text>
  <text x="8" y="82" font-size="10.5" font-weight="700" fill="currentColor">input · fire behaviour classes</text>
  <g stroke="var(--crimson-deep)" stroke-width="1.2">
    <rect x="300" y="94" width="46" height="46" fill="var(--petal-soft)"/>
    <rect x="346" y="94" width="46" height="46" fill="var(--crimson)"/>
    <rect x="300" y="140" width="46" height="46" fill="var(--petal-soft)"/>
    <rect x="346" y="140" width="46" height="46" fill="var(--crimson)"/>
  </g>
  <g font-size="11" font-weight="700" text-anchor="middle">
    <text x="323" y="122" fill="currentColor">1</text><text x="369" y="122" fill="var(--cream)">4</text>
    <text x="323" y="168" fill="currentColor">1</text><text x="369" y="168" fill="var(--cream)">4</text>
  </g>
  <path d="M410 140 H470" fill="none" stroke="var(--crimson)" stroke-width="2"/>
  <path d="M470 140 l-9 -5 M470 140 l-9 5" fill="none" stroke="var(--crimson)" stroke-width="2"/>
  <rect x="500" y="94" width="46" height="46" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.2"/>
  <text x="523" y="122" font-size="11" font-weight="700" text-anchor="middle" fill="var(--cream)">4</text>
  <text x="560" y="118" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">nearest — an existing class</text>
  <rect x="500" y="156" width="46" height="46" fill="var(--petal)" stroke="var(--ember)" stroke-width="2"/>
  <text x="523" y="184" font-size="11" font-weight="700" text-anchor="middle" fill="currentColor">2.5</text>
  <text x="560" y="180" font-size="10.5" font-weight="700" fill="var(--ember-text)">average — not a class at all</text>
  <text x="560" y="198" font-size="10" fill="currentColor">renders as moderate over ground that is half extreme</text>
  <rect x="40" y="244" width="800" height="90" rx="9" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.6"/>
  <text x="60" y="270" font-size="11" font-weight="700" fill="var(--crimson-deep)">the rule</text>
  <text x="60" y="292" font-size="10.5" fill="currentColor">continuous quantity — depth, wind speed, probability → average, because the mean of two depths is a depth</text>
  <text x="60" y="312" font-size="10.5" fill="currentColor">categorical code — behaviour class, land cover, damage grade → nearest, because the mean of two codes is not a code</text>
  <text x="60" y="330" font-size="10" fill="var(--muted)">and it is the zoomed-out overview, the one an operations chief looks at most, that carries the error</text>
</svg>

Tier three catches a subtler defect. Fire-behaviour classes, damage grades and land-cover codes are numbers that are not quantities, and averaging them produces values that are not members of the classification. The resulting overview renders as a plausible middle class over ground that is a mixture of extremes — and because the error only exists in the overviews, it is invisible at full resolution and visible exactly where the situational view is read.

## Production Python Implementation

```python
from __future__ import annotations

import logging
from pathlib import Path

import rasterio
from rasterio.enums import Resampling

logger = logging.getLogger("incidentgis.overviews")

# Ground resolutions the field application renders, in metres. Read this from
# the client's own configuration — guessing it is how unused levels appear.
RENDERED_RESOLUTIONS_M = (2.0, 8.0, 16.0, 64.0)

CATEGORICAL_QUANTITIES = frozenset({
    "fire_behaviour_class", "damage_grade", "land_cover", "hazard_class",
})


def required_overview_factors(base_resolution_m: float) -> tuple[int, ...]:
    """Smallest power-of-two factors covering every rendered scale.

    A factor is included when some rendered scale needs a resolution at or
    coarser than it provides; levels beyond the coarsest rendered scale are
    omitted because no client will ever request them.
    """
    coarsest = max(RENDERED_RESOLUTIONS_M)
    factors, factor = [], 2
    while base_resolution_m * factor <= coarsest * 2:
        factors.append(factor)
        factor *= 2
    return tuple(factors)


def build_overviews(path: Path, *, quantity: str) -> tuple[int, ...]:
    """Build internal overviews matched to the client's scale set.

    Resampling is chosen from the quantity's meaning: averaging a categorical
    code produces a value that is not a member of the classification.
    """
    resampling = (
        Resampling.nearest if quantity in CATEGORICAL_QUANTITIES
        else Resampling.average
    )

    with rasterio.open(path, "r+") as dst:
        base_res = abs(dst.transform.a)
        factors = required_overview_factors(base_res)
        if not factors:
            raise ValueError(
                f"base resolution {base_res} m is already coarser than every "
                "rendered scale — check the source, not the overview config"
            )
        dst.build_overviews(factors, resampling)
        dst.update_tags(ns="rio_overview", resampling=resampling.name)

    # Assert rather than trust: a build that silently produced fewer levels is
    # discovered later by a saturated uplink, not by an error.
    with rasterio.open(path) as check:
        built = tuple(check.overviews(1))
        if built != factors:
            raise ValueError(f"overview set mismatch: wanted {factors}, got {built}")
        if not check.profile.get("tiled", False):
            raise ValueError("overviews on an untiled file buy nothing")

    logger.info("overviews_built", extra={
        "path": str(path), "factors": factors, "resampling": resampling.name,
    })
    return factors
```

## Validation Checklist

- [ ] The overview factor set is derived from the client's rendered scales, not from a fixed default.
- [ ] Overviews are internal — `gdalinfo` shows an `Overviews:` line under band 1 and there is no `.ovr` beside the file.
- [ ] Resampling is `nearest` for every categorical quantity and `average` for every continuous one.
- [ ] The built level set is asserted equal to the configured set after every build.
- [ ] A range-read of the coarsest rendered scale moves kilobytes, not megabytes — measured over HTTP, not locally.
- [ ] Overviews are rebuilt after any operation that changes pixel values, including a nodata repair.
- [ ] Write time and output size are recorded per build so a regression in either is visible.

## Edge Cases and Gotchas

- **Overviews built before a value change.** Any repair to the base image leaves stale overviews that still render the old values at every scale except the finest. Rebuild after every pixel-level edit, and treat overviews as derived rather than durable.
- **A `.ovr` sidecar that works in testing.** Local testing reads the sidecar happily. A `/vsicurl/` client does not request it, so it silently falls back to full-resolution reads — the exact failure the pyramid exists to prevent, with no error anywhere.
- **A base resolution finer than anything rendered.** Publishing a 0.5-metre grid to an application whose finest scale needs 2 metres means every client downsamples on every read. The fix is at the production step, not in the pyramid.
- **Mixed continuous and categorical bands in one file.** `build_overviews` applies one resampling method to all bands. Split them into separate files, or the categorical band's pyramid is wrong.
- **Overview depth on a small raster.** A raster only a few hundred pixels across reaches a single-pixel overview quickly, and factors beyond that are silently ignored by some drivers and error in others. Cap the computed set against the image dimensions.

## Frequently Asked Questions

**How deep should a Cloud-Optimized GeoTIFF's overview pyramid go?** As deep as the coarsest scale the field application renders, and no deeper. Enumerate the ground resolutions the client displays and include every power-of-two factor that reaches them: levels finer than the finest rendered scale are never requested, and levels beyond the coarsest are pure write cost and file size. Deriving the set from the client's configuration makes this a measurement rather than a guess, and it removes the temptation to trim levels for build time.

**Is it worth trimming overview levels to speed up the build?** Almost never. Measured on a four-gigabyte depth grid, going from three levels to five costs about 23 seconds and 100 megabytes, and going from five to seven costs a further 7 seconds and 10 megabytes — because each overview is a quarter the area of the one below it, so the tail of the pyramid is nearly free. The saving is a few per cent of build time, and the cost is that the county-wide situational view, the one an operations chief refreshes most often, becomes the most expensive read in the system.

**Why must categorical hazard rasters use nearest resampling?** Because averaging class codes produces numbers that are not classes. A window containing behaviour class 1 and class 4 averages to 2.5, which renders as a moderate class over ground that is a mixture of the lowest and the highest. The error exists only in the overviews, so it is invisible at full resolution and appears exactly in the zoomed-out view people read most. Continuous quantities such as depth or wind speed should average, since the mean of two depths is a depth; the choice follows from what the raster means.

## Related

- [Raster Hazard Layers & Cloud-Optimized GeoTIFF](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/raster-hazard-layers-and-cloud-optimized-geotiff/) — the publication contract the pyramid is part of.
- [Preserving Nodata When Converting Hazard Rasters](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/raster-hazard-layers-and-cloud-optimized-geotiff/preserving-nodata-when-converting-hazard-rasters/) — why overviews must be rebuilt after any mask repair, and how averaging contaminates them.
- [Pre-Staging Vector Tiles Before a Forecasted Landfall](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/pre-staging-vector-tiles-before-a-forecasted-landfall/) — the same zoom-depth arithmetic, on the vector tile side.
- [Offline GIS Data Caching Strategies](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/) — what a forward node keeps locally when the uplink is gone entirely.

Up: [Raster Hazard Layers & Cloud-Optimized GeoTIFF](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/raster-hazard-layers-and-cloud-optimized-geotiff/)
