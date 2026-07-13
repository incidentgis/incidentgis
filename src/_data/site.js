module.exports = {
  name: "Incident GIS",
  title: "Python for Emergency Response & Incident GIS Workflows",
  url: "https://www.incidentgis.com",
  description:
    "A production-focused, field-tested technical resource for building reliable, compliant, and scalable Python GIS workflows tailored to emergency management.",
  author: "Incident GIS",
  locale: "en_US",
  language: "en",
  themeColor: "#b3122e",
  backgroundColor: "#fff5f5",
  // Default Open Graph image (1200x630). Generated from the logo at build prep time.
  ogImage: "/assets/icons/og-default.png",
  ogImageAlt:
    "Incident GIS — Python patterns for emergency response and incident GIS workflows.",
  // Used for the publication-date floor on JSON-LD Article schema.
  founded: "2026-01-01",
  sections: [
    {
      slug: "core-emergency-gis-architecture-data-standards",
      title: "Core Emergency GIS Architecture & Data Standards",
      short: "Architecture & Standards",
      summary:
        "Resilient geospatial foundations: deterministic coordinate handling, ingestion validation, metadata governance, and offline-first architecture.",
      icon: "compass",
      accent: "crimson",
    },
    {
      slug: "incident-mapping-multi-agency-sync-workflows",
      title: "Incident Mapping & Multi-Agency Sync Workflows",
      short: "Incident Mapping & Sync",
      summary:
        "Production patterns for spatial normalization, async telemetry ingestion, schema enforcement, and conflict-aware multi-agency synchronization.",
      icon: "pulse",
      accent: "ember",
    },
    {
      slug: "python-toolchains-for-public-safety-gis",
      title: "Python Toolchains for Public Safety GIS",
      short: "Python Toolchains",
      summary:
        "Reproducible Python toolchains: containerized environments, ETL pipelines, library trade-offs, and CI-validated spatial workflows.",
      icon: "python",
      accent: "rose",
    },
  ],
};
