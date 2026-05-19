import logging
from datetime import datetime, timezone

import requests

from config import Config

logger = logging.getLogger(__name__)

HUBSPOT_BASE = "https://api.hubapi.com"


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
        Returns a list of dicts: {email, hubspot_contact_id, hubspot_deal_id}.
        Missing contacts get None for IDs — they are still included so the
        email is stored in meeting_contacts.
        """
        if not self._enabled or not emails:
            return [{"email": e, "hubspot_contact_id": None, "hubspot_deal_id": None} for e in emails]

        results = []
        for email in emails:
            contact_id = self._find_contact(email)
            deal_id = self._find_deal_for_contact(contact_id) if contact_id else None
            results.append({
                "email": email,
                "hubspot_contact_id": contact_id,
                "hubspot_deal_id": deal_id,
            })
            logger.info(f"HubSpot: {email} → contact={contact_id} deal={deal_id}")

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

    def _find_deal_for_contact(self, contact_id: str) -> str | None:
        """Return the most recently modified open deal associated with this contact."""
        resp = requests.get(
            f"{HUBSPOT_BASE}/crm/v4/objects/contacts/{contact_id}/associations/deals",
            headers=self._headers(),
            timeout=10,
        )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        results = resp.json().get("results", [])
        if not results:
            return None
        # Return the first associated deal ID (HubSpot returns them in recency order)
        return str(results[0]["toObjectId"])

    def post_meeting_activity(
        self,
        row: dict,
        synthesis: dict,
        contacts: list[dict],
        meeting_datetime: str | None,
    ) -> str | None:
        """
        Create a meeting engagement in HubSpot and associate it with resolved contacts.
        Returns the HubSpot engagement ID, or None on failure.
        Fire-and-forget — caller should wrap in try/except.
        """
        if not self._enabled:
            return None

        contact_ids = [c["hubspot_contact_id"] for c in contacts if c["hubspot_contact_id"]]
        if not contact_ids:
            logger.info("No resolved HubSpot contacts — skipping activity post")
            return None

        timestamp = None
        if meeting_datetime:
            try:
                dt = datetime.fromisoformat(meeting_datetime.replace("Z", "+00:00"))
                timestamp = int(dt.timestamp() * 1000)
            except ValueError:
                timestamp = int(datetime.now(timezone.utc).timestamp() * 1000)
        else:
            timestamp = int(datetime.now(timezone.utc).timestamp() * 1000)

        summary = synthesis.get("summary", "")
        next_steps = synthesis.get("next_steps", "")

        body = {
            "properties": {
                "hs_meeting_title": row.get("meeting_name", "TrovaTrip Meeting"),
                "hs_meeting_body": f"SUMMARY\n{summary}\n\nNEXT STEPS\n{next_steps}",
                "hs_timestamp": timestamp,
                "hs_meeting_outcome": "COMPLETED",
            },
        }

        resp = requests.post(
            f"{HUBSPOT_BASE}/crm/v3/objects/meetings",
            headers=self._headers(),
            json=body,
            timeout=10,
        )
        resp.raise_for_status()
        engagement_id = resp.json()["id"]
        logger.info(f"Created HubSpot meeting engagement {engagement_id}")

        # Associate with each resolved contact
        for contact_id in contact_ids:
            self._associate(engagement_id, contact_id)

        return engagement_id

    def _associate(self, engagement_id: str, contact_id: str) -> None:
        resp = requests.put(
            f"{HUBSPOT_BASE}/crm/v4/objects/meetings/{engagement_id}/associations/contacts/{contact_id}",
            headers=self._headers(),
            json=[{"associationCategory": "HUBSPOT_DEFINED", "associationTypeId": 200}],
            timeout=10,
        )
        if not resp.ok:
            logger.warning(f"Failed to associate engagement {engagement_id} with contact {contact_id}: {resp.text}")
