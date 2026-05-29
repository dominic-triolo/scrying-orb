import logging
import re
from datetime import datetime, timezone

import requests

from config import Config

logger = logging.getLogger(__name__)

HUBSPOT_BASE = "https://api.hubapi.com"

PIPELINE_LABELS = {
    '3350665': 'Host Pipeline',
    '5932157': 'Trips Pipeline',
}

STAGE_LABELS = {
    '109478269': 'Call Scheduled',
    '143928967': 'Call Held',
    '11444385':  'Created',
    '11444387':  'Ready-To-Qualify',
    '11444389':  'Qualifying',
    '11444390':  'Qualified',
    '11444391':  'Planning',
    '11444483':  'Launched',
    '11444484':  'Confirmed',
    '11444485':  'Renewed',
    '115825557': 'Pending',
    '18279047':  'Created',
    '18279048':  'Partner-Approved',
    '18279049':  'Trova-Pricing-Approved',
    '18279050':  'Host-Approved',
    '18279051':  'Live',
    '18279052':  'Ready-To-Confirm',
    '115894141': 'Early-Confirmed',
    '18279053':  'Confirmed',
    '31398243':  'Closed',
}


class HubSpotClient:
    def __init__(self, config: Config):
        self._token = config.hubspot_token
        self._enabled = bool(self._token)
        if not self._enabled:
            logger.warning("HUBSPOT_TOKEN not set — HubSpot integration disabled")

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        }

    def resolve_contacts(self, emails: list[str]) -> list[dict]:
        """
        Look up each external participant email in HubSpot.
        Returns a list of dicts: {email, hubspot_contact_id, hubspot_deal_id, deals}.
        - deals: list of {id, name, stage, pipeline} for all associated deals
        - hubspot_deal_id: first deal's ID, kept for meetings.hubspot_deal_id (backward compat)
        """
        if not self._enabled or not emails:
            return [
                {"email": e, "hubspot_contact_id": None, "hubspot_deal_id": None, "deals": []}
                for e in emails
            ]

        results = []
        for email in emails:
            contact_id = self._find_contact(email)
            deals = self._find_deals_for_contact(contact_id) if contact_id else []
            deal_id = deals[0]["id"] if deals else None
            results.append({
                "email":              email,
                "hubspot_contact_id": contact_id,
                "hubspot_deal_id":    deal_id,
                "deals":              deals,
            })
            logger.info(
                f"HubSpot: {email} → contact={contact_id} "
                f"deals={[d['id'] for d in deals]}"
            )

        return results

    def _find_contact(self, email: str) -> str | None:
        resp = requests.post(
            f"{HUBSPOT_BASE}/crm/v3/objects/contacts/search",
            headers=self._headers(),
            json={
                "filterGroups": [{
                    "filters": [{
                        "propertyName": "email",
                        "operator": "EQ",
                        "value": email,
                    }]
                }],
                "properties": ["email"],
                "limit": 1,
            },
            timeout=10,
        )
        resp.raise_for_status()
        results = resp.json().get("results", [])
        return results[0]["id"] if results else None

    def _find_deals_for_contact(self, contact_id: str) -> list[dict]:
        """Return all deals associated with this contact, with name/stage/pipeline labels."""
        resp = requests.get(
            f"{HUBSPOT_BASE}/crm/v4/objects/contacts/{contact_id}/associations/deals",
            headers=self._headers(),
            timeout=10,
        )
        if resp.status_code == 404:
            return []
        resp.raise_for_status()

        results = resp.json().get("results", [])
        if not results:
            return []

        deal_ids = [str(r["toObjectId"]) for r in results]

        # Batch fetch deal properties
        batch_resp = requests.post(
            f"{HUBSPOT_BASE}/crm/v3/objects/deals/batch/read",
            headers=self._headers(),
            json={
                "properties": ["dealname", "dealstage", "pipeline"],
                "inputs": [{"id": did} for did in deal_ids],
            },
            timeout=10,
        )
        batch_resp.raise_for_status()

        deals = []
        for deal in batch_resp.json().get("results", []):
            props      = deal.get("properties", {})
            stage_id   = props.get("dealstage", "")
            pipeline_id = props.get("pipeline", "")
            deals.append({
                "id":       deal["id"],
                "name":     props.get("dealname") or "Unnamed Deal",
                "stage":    STAGE_LABELS.get(stage_id, stage_id),
                "pipeline": PIPELINE_LABELS.get(pipeline_id, pipeline_id),
            })

        logger.info(f"Found {len(deals)} deal(s) for contact {contact_id}")
        return deals

    def find_meeting_info(
        self,
        contact_id: str,
        meeting_name: str,
        meeting_date: datetime,
    ) -> dict:
        """
        Look up HubSpot meeting properties matching this contact, title, and date.

        Returns a dict:
            {
                "activity_type": str | None,  # hs_activity_type (e.g. "Intro Call")
                "outcome":       str | None,  # hs_meeting_outcome (e.g. "COMPLETED")
            }

        Both fields are None if no unambiguous match is found.
        Uses a single pair of API calls to retrieve both values simultaneously.
        """
        empty = {"activity_type": None, "outcome": None}

        if not self._enabled:
            return empty

        # 1. Get meeting IDs associated with this contact
        try:
            assoc_resp = requests.get(
                f"{HUBSPOT_BASE}/crm/v4/objects/contacts/{contact_id}/associations/meetings",
                headers=self._headers(),
                params={"limit": 100},
                timeout=10,
            )
        except requests.RequestException as exc:
            logger.warning(f"HubSpot association fetch failed for contact {contact_id}: {exc}")
            return empty

        if not assoc_resp.ok:
            logger.warning(f"HubSpot associations returned {assoc_resp.status_code} for contact {contact_id}")
            return empty

        meeting_ids = [str(r["toObjectId"]) for r in assoc_resp.json().get("results", [])]
        if not meeting_ids:
            return empty

        # 2. Batch fetch meeting properties (type + outcome in one call)
        try:
            batch_resp = requests.post(
                f"{HUBSPOT_BASE}/crm/v3/objects/meetings/batch/read",
                headers=self._headers(),
                json={
                    "inputs": [{"id": mid} for mid in meeting_ids[:100]],
                    "properties": [
                        "hs_meeting_title",
                        "hs_timestamp",
                        "hs_activity_type",
                        "hs_meeting_outcome",
                    ],
                },
                timeout=10,
            )
        except requests.RequestException as exc:
            logger.warning(f"HubSpot batch meeting fetch failed: {exc}")
            return empty

        if not batch_resp.ok:
            logger.warning(f"HubSpot batch read returned {batch_resp.status_code}")
            return empty

        meetings = batch_resp.json().get("results", [])
        target_title = _normalize_title(meeting_name)
        target_date = meeting_date.date() if hasattr(meeting_date, "date") else meeting_date

        matches = []
        for m in meetings:
            props = m.get("properties", {})
            activity_type = (props.get("hs_activity_type") or "").strip()
            if not activity_type:
                continue  # skip untyped meetings (duplicates / manually logged)

            hs_title = _normalize_title(props.get("hs_meeting_title") or "")
            if not hs_title:
                continue

            # Title match: either is a substring of the other
            if target_title not in hs_title and hs_title not in target_title:
                continue

            # Date match: truncate HubSpot timestamp (epoch ms string) to day
            hs_ts = props.get("hs_timestamp") or ""
            if hs_ts:
                try:
                    hs_date = datetime.fromtimestamp(int(hs_ts) / 1000, tz=timezone.utc).date()
                    if hs_date != target_date:
                        continue
                except (ValueError, TypeError):
                    pass  # if we can't parse the date, still consider it a title match

            outcome = (props.get("hs_meeting_outcome") or "").strip() or None
            matches.append({"activity_type": activity_type, "outcome": outcome})

        if len(matches) == 1:
            result = matches[0]
            logger.info(
                f"HubSpot meeting info for '{meeting_name}': "
                f"type={result['activity_type']} outcome={result['outcome']}"
            )
            return result
        if len(matches) > 1:
            logger.warning(
                f"Ambiguous HubSpot meeting matches for '{meeting_name}': "
                f"{matches} — falling back"
            )
            return empty

        return empty


    def update_deal_property(self, deal_id: str, property_name: str, value) -> bool:
        """
        Update a single property on a HubSpot deal via PATCH.
        Returns True on success, False on failure (caller should log and continue).
        """
        if not self._enabled:
            logger.warning("HubSpot disabled — skipping deal property update")
            return False
        try:
            resp = requests.patch(
                f"{HUBSPOT_BASE}/crm/v3/objects/deals/{deal_id}",
                headers=self._headers(),
                json={"properties": {property_name: value}},
                timeout=10,
            )
            resp.raise_for_status()
            logger.info(f"Updated deal {deal_id}: {property_name}={value}")
            return True
        except requests.RequestException as exc:
            logger.error(f"Failed to update deal {deal_id} property {property_name}: {exc}")
            return False


def _normalize_title(title: str) -> str:
    """Lowercase, collapse whitespace, strip punctuation for fuzzy title matching."""
    title = title.lower().strip()
    title = re.sub(r"[^\w\s]", "", title)   # strip punctuation
    title = re.sub(r"\s+", " ", title)       # collapse whitespace
    return title
