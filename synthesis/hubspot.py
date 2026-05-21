import logging

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
