---
title: "Deduplicating CAP Updates Across Alerting Authorities"
description: "Every relay renumbers a CAP alert, so an update supersedes one copy and leaves the others standing. Group messages into decisions, layer four matching keys, and apply supersession across the whole set."
slug: deduplicating-cap-updates-across-alerting-authorities
type: article
breadcrumb: "Deduplicating CAP Updates"
datePublished: "2026-08-09"
dateModified: "2026-08-09"
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Deduplicating CAP Updates Across Alerting Authorities",
      "description": "Every relay renumbers a CAP alert, so an update supersedes one copy and leaves the others standing. Group messages into decisions, layer four matching keys, and apply supersession across the whole set.",
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
          "name": "Incident Mapping & Multi-Agency Sync Workflows",
          "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/"
        },
        {
          "@type": "ListItem",
          "position": 3,
          "name": "Public Alerting & CAP Message Pipelines",
          "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/public-alerting-and-cap-message-pipelines/"
        },
        {
          "@type": "ListItem",
          "position": 4,
          "name": "Deduplicating CAP Updates Across Alerting Authorities",
          "item": "https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/public-alerting-and-cap-message-pipelines/deduplicating-cap-updates-across-alerting-authorities/"
        }
      ]
    },
    {
      "@type": "HowTo",
      "name": "Recognise relayed CAP messages as one decision and supersede them together",
      "description": "Store messages under sender and identifier, group them into decisions using the references chain, a content hash and a flagged spatio-temporal fallback, and apply every supersession to the whole decision rather than to a single message.",
      "step": [
        {
          "@type": "HowToStep",
          "name": "Key messages on sender plus identifier",
          "text": "Store every message under both fields, because the identifier alone is reassigned at each relay and is not a unique key even for one message."
        },
        {
          "@type": "HowToStep",
          "name": "Match on the references chain first",
          "text": "Use references where a relay populated it, since it is authoritative and cheap, while expecting it to be absent far more often than the specification implies."
        },
        {
          "@type": "HowToStep",
          "name": "Fall back to a content hash",
          "text": "Hash the event, area, effective window and instruction so byte-equivalent relays collapse regardless of sender, and exclude presentation fields such as the headline."
        },
        {
          "@type": "HowToStep",
          "name": "Fall back again to a spatio-temporal key, and flag it",
          "text": "Match on overlapping area, matching event type and effective times within a tolerance to catch reworded relays, and flag every merge it makes because it can join two genuinely distinct nearby incidents."
        },
        {
          "@type": "HowToStep",
          "name": "Supersede the decision, not the message",
          "text": "Apply a cancel or update to every member of the decision so relayed copies are withdrawn too, which is only possible if the copies were retained rather than discarded."
        }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Why does deduplicating CAP alerts by identifier not work?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Because every relay is entitled to assign its own identifier and sender. A county issues an alert, a state operations centre republishes it under a new identifier, and a federal aggregator republishes that under another, so one decision arrives three times with nothing in common between the identifiers. Sender plus identifier is the correct unique key for a message, but it says nothing about whether two messages describe the same decision — which is the question a consumer aggregating several feeds actually needs answered."
          }
        },
        {
          "@type": "Question",
          "name": "What actually goes wrong when relayed copies are not linked?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "The update. When the county extends an evacuation boundary and issues an update, its references field names only its own original identifier, which the relayed copies were never issued under. Those copies are therefore not superseded, and a consumer holding one continues presenting the old boundary as current alongside the new one. The visible failure is two active evacuation orders for the same neighbourhood with different instructions, one of which was withdrawn twenty minutes earlier."
          }
        },
        {
          "@type": "Question",
          "name": "Why keep the duplicate copies instead of discarding them?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Because supersession has to be applied to them later. A consumer that dedupes by keeping the newest message and discarding the rest has nothing to withdraw when a cancel or update arrives — the copies that most need withdrawing are precisely the ones it threw away. Collapsing into a decision record that lists every member, names the authoritative copy by sender precedence, and records which key merged each one keeps the supersession applicable and makes any merge made by the fuzzy fallback reviewable."
          }
        }
      ]
    }
  ]
}
</script>

# Deduplicating CAP Updates Across Alerting Authorities

A public-facing alert map shows two active evacuation orders for the same neighbourhood with different boundaries. Both are real CAP messages, both are current, and one of them was superseded twenty minutes ago — by an update that referenced the county's original identifier, which the relayed copy never carried.

## Root Cause and Operational Impact

CAP is designed to be relayed. A county issues an alert, a state emergency operations centre republishes it, a federal aggregator republishes that, and each hop is entitled to assign its own `identifier` and `sender`. That is correct behaviour and it means a consumer aggregating several feeds routinely receives one decision several times, under identifiers that have nothing in common.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="dp1-t dp1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="dp1-t">One evacuation order arriving four times from three authorities</title>
  <desc id="dp1-d">A single evacuation decision reaches an aggregator four times. The county emergency manager issues the original CAP alert. The state emergency operations centre relays it under its own sender identifier with a new message identifier. A federal aggregator republishes the state copy, again renumbering. The county then issues a genuine update extending the boundary, referencing only its own original. To a naive consumer these are four unrelated alerts covering overlapping areas, and the genuine update references an identifier two of the copies never carried. The problem is not duplication for its own sake — it is that the update supersedes one copy and leaves the other two standing, so a handset can end up showing a superseded boundary as current.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">one decision, four messages, three sender identifiers</text>
  <rect x="40" y="76" width="330" height="58" rx="8" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.6"/>
  <text x="58" y="98" font-size="10.5" font-weight="700" fill="var(--cream)">county · id A · Alert</text>
  <text x="58" y="118" font-size="10" fill="var(--cream)">the original decision, 14:02</text>
  <path d="M370 105 H430" fill="none" stroke="var(--crimson)" stroke-width="2"/>
  <path d="M430 105 l-9 -5 M430 105 l-9 5" fill="none" stroke="var(--crimson)" stroke-width="2"/>
  <rect x="440" y="76" width="400" height="58" rx="8" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="458" y="98" font-size="10.5" font-weight="700" fill="currentColor">state relay · id B · Alert · references none</text>
  <text x="458" y="118" font-size="10" fill="currentColor">same decision, new sender, new identifier, 14:04</text>
  <rect x="440" y="148" width="400" height="58" rx="8" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="458" y="170" font-size="10.5" font-weight="700" fill="currentColor">federal aggregator · id C · Alert</text>
  <text x="458" y="190" font-size="10" fill="currentColor">republished from B, renumbered again, 14:07</text>
  <rect x="40" y="228" width="330" height="58" rx="8" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="58" y="250" font-size="10.5" font-weight="700" fill="var(--ember-text)">county · id D · Update</text>
  <text x="58" y="270" font-size="10" fill="currentColor">references A only · boundary extended, 14:26</text>
  <path d="M370 257 H430" fill="none" stroke="var(--ember)" stroke-width="2" stroke-dasharray="5 3"/>
  <rect x="440" y="228" width="400" height="58" rx="8" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="458" y="250" font-size="10.5" font-weight="700" fill="var(--ember-text)">B and C are not superseded</text>
  <text x="458" y="270" font-size="10" fill="currentColor">a handset holding either still shows the old boundary as current</text>
  <text x="8" y="330" font-size="10.5" fill="currentColor">The duplication itself is harmless. The update that supersedes one copy and leaves two standing is not.</text>
  <text x="8" y="352" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">Which is why deduplication has to key on the decision, not on the message.</text>
</svg>

Duplication on its own is a display nuisance. The real failure is what happens at the *update*. When the county extends the boundary and issues an update, its `references` names only its own original identifier — the one the state and federal copies were never issued under. Those copies are not superseded, so a consumer holding them continues to present the old boundary as current, alongside the new one.

That is the operational cost: not two copies of one message, but one message that has been withdrawn and one that has not, describing the same neighbourhood with different instructions.

## Tiered Resolution Strategy

1. **Key on the decision, not the message (definitive).** Store messages under `sender` plus `identifier`, which is their true unique key, but group them under a decision identifier the consumer assigns.
2. **Use the references chain when it is present.** It is authoritative and cheap. It is also absent far more often than the specification implies, so it cannot be the only mechanism.
3. **Fall back to a content hash over the fields that carry meaning.** Event, area, effective window and instruction. Two byte-equivalent relays hash identically regardless of who sent them.
4. **Fall back again to a spatio-temporal key, and flag whatever it merges (safe default).** Overlapping area, same event type, effective windows within a tolerance. This catches relays that reworded the headline, and it can occasionally merge two genuinely distinct nearby incidents — so anything it merges is flagged rather than merged silently.
5. **Apply supersession across the whole decision, never to a single message.** This is the step that fixes the failure above, and it is only possible because the copies were kept rather than discarded.

<svg viewBox="0 0 880 380" role="img" aria-labelledby="dp2-t dp2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="dp2-t">Candidate keys for recognising two messages as one decision</title>
  <desc id="dp2-d">Five ways to decide that two CAP messages describe the same decision. The message identifier alone fails immediately, because every relay assigns a new one. Sender plus identifier is the correct uniqueness key for a message but says nothing about equivalence across senders. The references chain works when relays populate it and fails silently when they do not, which is common. A content hash over the event, area, effective time and instruction recognises byte-equivalent relays and misses ones that reworded the headline. A spatio-temporal key — overlapping area, same event type, effective windows within a tolerance — recognises relays that reworded, at the cost of occasionally merging two genuinely distinct nearby incidents. The practical answer is the content hash first, falling back to the spatio-temporal key, with anything merged by the fallback flagged for review.</desc>
  <rect x="0" y="0" width="880" height="380" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">five candidate keys, and where each one breaks</text>
  <rect x="40" y="72" width="800" height="52" rx="8" fill="var(--cream)" stroke="var(--ember)" stroke-width="2"/>
  <text x="60" y="94" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="var(--ember-text)">identifier</text>
  <text x="230" y="94" font-size="10" fill="currentColor">every relay assigns a new one — fails immediately</text>
  <text x="700" y="94" font-size="10.5" font-weight="700" fill="var(--ember-text)">useless</text>
  <text x="230" y="112" font-size="9.5" fill="var(--muted)">not even a message key on its own</text>
  <rect x="40" y="134" width="800" height="52" rx="8" fill="var(--petal-soft)" stroke="var(--line-strong)" stroke-width="1.4"/>
  <text x="60" y="156" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="currentColor">sender + identifier</text>
  <text x="230" y="156" font-size="10" fill="currentColor">correct message key · says nothing about equivalence across senders</text>
  <text x="700" y="156" font-size="10.5" font-weight="700" fill="currentColor">necessary</text>
  <text x="230" y="174" font-size="9.5" fill="var(--muted)">use it for storage, not for dedup</text>
  <rect x="40" y="196" width="800" height="52" rx="8" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="218" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="currentColor">references chain</text>
  <text x="230" y="218" font-size="10" fill="currentColor">works when relays populate it · silently absent more often than not</text>
  <text x="700" y="218" font-size="10.5" font-weight="700" fill="currentColor">when present</text>
  <rect x="40" y="258" width="800" height="52" rx="8" fill="var(--crimson)" stroke="var(--crimson-deep)" stroke-width="1.6"/>
  <text x="60" y="280" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="var(--cream)">content hash</text>
  <text x="230" y="280" font-size="10" fill="var(--cream)">event + area + effective + instruction · catches byte-equivalent relays</text>
  <text x="700" y="280" font-size="10.5" font-weight="700" fill="var(--cream)">primary</text>
  <rect x="40" y="320" width="800" height="52" rx="8" fill="var(--petal)" stroke="var(--crimson)" stroke-width="1.5"/>
  <text x="60" y="342" font-size="10.5" font-weight="700" font-family="var(--font-mono)" fill="currentColor">spatio-temporal</text>
  <text x="230" y="342" font-size="10" fill="currentColor">overlapping area, same event, effective within tolerance — catches rewording</text>
  <text x="700" y="342" font-size="10.5" font-weight="700" fill="currentColor">fallback</text>
  <text x="230" y="360" font-size="9.5" fill="var(--muted)">can merge two genuinely distinct nearby incidents — flag whatever it merges</text>
</svg>

The layering matters because each key is wrong on its own. The references chain is exact and frequently missing. A content hash is exact and defeated by a relay that changed one word of the headline. The spatio-temporal key catches those and is the only one that can produce a false merge, which is why it is last and why its merges are reviewable.

<svg viewBox="0 0 880 340" role="img" aria-labelledby="dp3-t dp3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:inherit;color:var(--ink)">
  <title id="dp3-t">What a decision record holds once copies are collapsed</title>
  <desc id="dp3-d">Rather than picking one message and discarding the rest, the consumer keeps a decision record. It carries a decision identifier of its own, the set of message identifiers and senders that have been recognised as that decision, the currently authoritative version chosen by the highest-precedence sender, and the supersession state. When the county issues an update referencing only its own original, the decision record applies the supersession to every member of the set, so the state and federal copies are marked superseded too. Discarding duplicates instead would leave nothing to apply the supersession to, which is exactly how a superseded boundary keeps showing as current.</desc>
  <rect x="0" y="0" width="880" height="340" fill="var(--blush)"/>
  <text x="8" y="44" font-size="11" font-weight="700" fill="var(--crimson-deep)">collapse into a decision record — never discard the copies</text>
  <rect x="40" y="76" width="800" height="180" rx="10" fill="var(--petal-soft)" stroke="var(--crimson)" stroke-width="1.8"/>
  <text x="62" y="104" font-size="11" font-weight="700" fill="var(--crimson-deep)">decision d-7f3a</text>
  <text x="62" y="132" font-size="10.5" fill="currentColor">members · county/A · state/B · federal/C · county/D</text>
  <text x="62" y="156" font-size="10.5" fill="currentColor">authoritative · county/D — highest-precedence sender, latest sent</text>
  <text x="62" y="180" font-size="10.5" fill="currentColor">supersedes · A, and by membership B and C as well</text>
  <text x="62" y="204" font-size="10.5" fill="currentColor">merged by · references chain for A→D, content hash for B, spatio-temporal for C</text>
  <text x="62" y="230" font-size="10.5" font-weight="700" fill="var(--crimson-deep)">review flag · set, because C was merged by the fallback key</text>
  <rect x="40" y="276" width="800" height="52" rx="9" fill="var(--cream)" stroke="var(--ember)" stroke-width="1.8"/>
  <text x="60" y="298" font-size="10.5" font-weight="700" fill="var(--ember-text)">why not just keep the newest and drop the rest?</text>
  <text x="60" y="318" font-size="10" fill="currentColor">because a later supersession has to be applied to every copy, and a discarded copy is one nothing can be applied to</text>
</svg>

Keeping the copies is the part that looks wasteful and is load-bearing. A consumer that dedupes by discarding has nothing to apply a later supersession to — the very copies that need withdrawing are the ones it threw away.

## Production Python Implementation

```python
from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from shapely.geometry.base import BaseGeometry

logger = logging.getLogger("incidentgis.cap_dedup")

EFFECTIVE_TOLERANCE = timedelta(minutes=10)
AREA_OVERLAP_MIN = 0.80
# Higher wins when choosing which copy is authoritative for a decision.
SENDER_PRECEDENCE = {"county": 3, "state": 2, "federal": 1}


@dataclass(frozen=True)
class CapMessage:
    sender: str
    identifier: str
    msg_type: str                   # Alert | Update | Cancel | Error
    references: tuple[str, ...]
    event: str
    area: BaseGeometry
    effective: datetime
    instruction: str
    sent: datetime

    @property
    def key(self) -> tuple[str, str]:
        """The message's true unique key — never the identifier alone."""
        return (self.sender, self.identifier)

    @property
    def content_hash(self) -> str:
        """Hash the fields that carry the decision, not the presentation."""
        payload = "|".join([
            self.event,
            self.area.wkt,
            self.effective.isoformat(),
            self.instruction.strip().lower(),
        ])
        return hashlib.sha256(payload.encode()).hexdigest()


@dataclass
class Decision:
    decision_id: str
    members: set[tuple[str, str]] = field(default_factory=set)
    authoritative: CapMessage | None = None
    superseded: bool = False
    needs_review: bool = False
    merged_by: dict[str, str] = field(default_factory=dict)


class DecisionIndex:
    """Group relayed CAP messages into the decisions they describe."""

    def __init__(self) -> None:
        self._by_key: dict[tuple[str, str], str] = {}
        self._by_hash: dict[str, str] = {}
        self._decisions: dict[str, Decision] = {}
        self._counter = 0

    def _new_decision(self) -> Decision:
        self._counter += 1
        d = Decision(decision_id=f"d-{self._counter:06d}")
        self._decisions[d.decision_id] = d
        return d

    def _match(self, msg: CapMessage) -> tuple[Decision | None, str]:
        # Tier 2: the references chain, when the relay bothered to populate it.
        for ref in msg.references:
            for (sender, ident), did in self._by_key.items():
                if ident == ref:
                    return self._decisions[did], "references"
        # Tier 3: byte-equivalent relays.
        did = self._by_hash.get(msg.content_hash)
        if did:
            return self._decisions[did], "content_hash"
        # Tier 4: reworded relays — may over-merge, so it is flagged.
        for d in self._decisions.values():
            other = d.authoritative
            if other is None or other.event != msg.event:
                continue
            if abs(other.effective - msg.effective) > EFFECTIVE_TOLERANCE:
                continue
            inter = other.area.intersection(msg.area).area
            union = other.area.union(msg.area).area
            if union and inter / union >= AREA_OVERLAP_MIN:
                return d, "spatio_temporal"
        return None, "new"

    def ingest(self, msg: CapMessage) -> Decision:
        decision, how = self._match(msg)
        if decision is None:
            decision = self._new_decision()

        decision.members.add(msg.key)
        decision.merged_by[f"{msg.sender}/{msg.identifier}"] = how
        if how == "spatio_temporal":
            # A merge the fallback made is a merge a human should confirm.
            decision.needs_review = True

        self._by_key[msg.key] = decision.decision_id
        self._by_hash.setdefault(msg.content_hash, decision.decision_id)

        if msg.msg_type == "Cancel":
            # Supersession applies to the decision, so every relayed copy is
            # withdrawn — including ones whose identifier was never referenced.
            decision.superseded = True
        elif decision.authoritative is None or _outranks(msg, decision.authoritative):
            decision.authoritative = msg

        logger.info("cap_message_ingested", extra={
            "decision": decision.decision_id, "matched_by": how,
            "members": len(decision.members), "review": decision.needs_review,
        })
        return decision


def _outranks(a: CapMessage, b: CapMessage) -> bool:
    """Higher-precedence sender wins; ties break on the later sent time."""
    pa = SENDER_PRECEDENCE.get(a.sender, 0)
    pb = SENDER_PRECEDENCE.get(b.sender, 0)
    return (pa, a.sent) > (pb, b.sent)
```

## Validation Checklist

- [ ] Messages are stored under `sender` plus `identifier`, never under the identifier alone.
- [ ] The references chain is used first and its absence is expected rather than treated as an error.
- [ ] The content hash covers event, area, effective window and instruction — and not the headline.
- [ ] Spatio-temporal merges set a review flag and are visible in the operator interface.
- [ ] Supersession is applied to every member of a decision, not to the referenced message alone.
- [ ] Copies are retained after merging, so a later supersession has something to apply to.
- [ ] Sender precedence is configuration, agreed with the participating authorities in advance.
- [ ] A fixture reproduces the county-state-federal relay chain and asserts one decision with four members.

## Edge Cases and Gotchas

- **A relay that alters the polygon slightly.** Reprojection round trips can move vertices by centimetres, which changes the WKT and defeats the content hash. Normalise coordinate precision before hashing, exactly as the [deterministic artifact rule](https://www.incidentgis.com/core-emergency-gis-architecture-data-standards/offline-gis-data-caching-strategies/) requires elsewhere.
- **Two real incidents in the same block within ten minutes.** The spatio-temporal fallback will merge them. That is the cost of catching reworded relays, and the review flag is what makes it recoverable — do not tighten the tolerance until it stops catching relays.
- **A cancel that arrives before the alert it cancels.** Feeds reorder. Create the decision on the cancel and mark it superseded, so the alert is born withdrawn rather than resurrecting the order.
- **Sender precedence disagreements.** If two authorities each believe they outrank the other, the authoritative copy flips as messages arrive. Agree precedence in advance and treat an unknown sender as lowest rather than defaulting it into the middle.
- **An update that changes the event type.** A wildfire evacuation updated to a flood evacuation is arguably a new decision. Treat an event-type change as a new decision and reference the old one, rather than mutating a decision's meaning in place.

## Frequently Asked Questions

**Why does deduplicating CAP alerts by identifier not work?** Because every relay is entitled to assign its own identifier and sender. A county issues an alert, a state operations centre republishes it under a new identifier, and a federal aggregator republishes that under another, so one decision arrives three times with nothing in common between the identifiers. Sender plus identifier is the correct unique key for a message, but it says nothing about whether two messages describe the same decision — which is the question a consumer aggregating several feeds actually needs answered.

**What actually goes wrong when relayed copies are not linked?** The update. When the county extends an evacuation boundary and issues an update, its references field names only its own original identifier, which the relayed copies were never issued under. Those copies are therefore not superseded, and a consumer holding one continues presenting the old boundary as current alongside the new one. The visible failure is two active evacuation orders for the same neighbourhood with different instructions, one of which was withdrawn twenty minutes earlier.

**Why keep the duplicate copies instead of discarding them?** Because supersession has to be applied to them later. A consumer that dedupes by keeping the newest message and discarding the rest has nothing to withdraw when a cancel or update arrives — the copies that most need withdrawing are precisely the ones it threw away. Collapsing into a decision record that lists every member, names the authoritative copy by sender precedence, and records which key merged each one keeps the supersession applicable and makes any merge made by the fuzzy fallback reviewable.

## Related

- [Public Alerting & CAP Message Pipelines](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/public-alerting-and-cap-message-pipelines/) — why references and expires carry the risk in the message this consumer receives.
- [Deduplicating Replayed Incident Messages After Broker Failover](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/websocket-mqtt-for-live-incident-feeds/deduplicating-replayed-incident-messages-after-broker-failover/) — the same problem where the producer controls the key, which is why that one is easier.
- [Resolving Duplicate Incident Reports Across Jurisdictions](https://www.incidentgis.com/python-toolchains-for-public-safety-gis/geopandas-vs-pyshp-for-field-operations/resolving-duplicate-incident-reports-across-jurisdictions/) — the spatio-temporal scoring this fallback key is a narrow case of.
- [Conflict Resolution in Multi-Agency Edits](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/conflict-resolution-in-multi-agency-edits/) — sender precedence as a policy artefact agreed before an incident rather than during one.

Up: [Public Alerting & CAP Message Pipelines](https://www.incidentgis.com/incident-mapping-multi-agency-sync-workflows/public-alerting-and-cap-message-pipelines/)
