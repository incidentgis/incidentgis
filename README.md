<p align="center">
  <a href="https://www.incidentgis.com/">
    <img src="https://www.incidentgis.com/assets/icons/og-default.png" alt="Incident GIS — Python patterns for emergency response and incident GIS workflows" width="100%" />
  </a>
</p>

<h1 align="center">Incident GIS</h1>

<p align="center">
  <strong>Python for Emergency Response &amp; Incident GIS Workflows</strong><br />
  Production-focused, field-tested patterns for building reliable, compliant, and scalable
  geospatial systems for emergency management.
</p>

<p align="center">
  <a href="https://www.incidentgis.com/">🌐 www.incidentgis.com</a>
</p>

---

## What this is

[**Incident GIS**](https://www.incidentgis.com/) is an open technical reference for the engineers
who build the mapping and data systems behind emergency response. Every article is written for
practitioners shipping mission-critical software — GIS analysts, public-safety developers,
emergency-management technology teams, and government platform engineers — and every pattern is
designed to hold up in the field, under intermittent connectivity, strict compliance mandates, and
high-stakes decision timelines, not just in a lab.

The content is grounded in real standards and failure modes: the National Incident Management
System (NIMS), the Federal Emergency Management Agency (FEMA), the Open Geospatial Consortium (OGC),
and ISO 22320. Code samples are runnable Python with full type hints, explicit error handling, and
structured logging — the way this software is actually written in production.

## What's inside

The library is organized into three areas, each a set of deeply cross-linked technical guides:

### 🧭 [Core Emergency GIS Architecture &amp; Data Standards](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/)
Resilient geospatial foundations — deterministic coordinate handling, ingestion validation,
metadata governance, offline-first caching, shelter-capacity schemas, and consolidated
NIMS / FEMA / OGC compliance checklists.

### 📡 [Incident Mapping &amp; Multi-Agency Sync Workflows](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/)
Production patterns for spatial normalization, real-time telemetry ingestion, conflict-aware
multi-agency synchronization, live incident feeds, and evacuation routing on a road network.

### 🐍 [Python Toolchains for Public Safety GIS](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/)
Reproducible Python toolchains — containerized GDAL/PROJ environments, sensor ETL, library
trade-offs, spatial testing and CI, and throughput benchmarks under simulated surge load.

## Highlights

- **Head-to-head technology comparisons** — [FlatGeobuf vs GeoPackage](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/flatgeobuf-vs-geopackage-for-offline-caching/) for offline caching and [Kafka vs RabbitMQ](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/kafka-vs-rabbitmq-for-live-incident-feeds/) for live incident feeds.
- **Performance benchmarks** with real throughput numbers under surge load.
- **Compliance-first** — [NIMS ICS-209, FEMA BPAS, and OGC API – Features conformance checklists](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/compliance-checklists-nims-fema-ogc/) you can run against a dataset.
- **Failure-mode aware** — edge-case guides for the things that actually break in the field: MQTT reconnect storms, GPS drift in urban canyons, null-island coordinates, axis-order inversion, and broker-failover replays.
- **Accessible, offline-friendly site** — hand-authored diagrams, WCAG 2 AA compliant, fast on mobile, and installable as a progressive web app.

## The site

The site is a static build — fast, dependency-light, and easy to host:

- **[Eleventy (11ty)](https://www.11ty.dev/)** static site generator
- **Nunjucks** templates + **Markdown** content
- Hand-authored, theme-aware inline **SVG** diagrams (no image bloat, no external requests)
- Structured data (JSON-LD: Article, BreadcrumbList, HowTo, FAQPage) on every page
- Deployed on **Cloudflare Pages**

### Local development

```bash
npm install
npm run serve     # local dev server with live reload
npm run build     # production build into ./_site
```

## Contributing &amp; commit policy

> **Note on authorship:** all commits to this repository are made under the single
> project account (`incidentgis`). Commits do not use co-author trailers or any other
> contributor attribution — the project account is the sole author of record on every commit.

## License

© Incident GIS. All rights reserved unless otherwise noted.

<p align="center">
  <a href="https://www.incidentgis.com/">www.incidentgis.com</a> ·
  <a href="https://github.com/incidentgis">github.com/incidentgis</a>
</p>
