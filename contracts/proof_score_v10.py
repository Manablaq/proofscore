# v0.2.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""ProofScore v10: wallet-bound public-proof verification and evidence adjudication.

This is intentionally a new contract.  It never upgrades or mutates the v9
deployment, whose settlement history remains independently auditable.
"""
from genlayer import *
from datetime import datetime
import json

MAX_CAMPAIGNS = 25
MAX_SUBMISSIONS_PER_CAMPAIGN = 25
MAX_EVIDENCE_URLS = 3
MAX_URL_LENGTH = 500
VERIFICATION_WINDOW_SECONDS = 7 * 24 * 60 * 60


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass
    class Write:
        pass


def _fail(message: str) -> None:
    # Bradbury exposes application errors through gl.vm, not gl directly.
    # Using gl.UserError turns an ordinary failed requirement into a VM crash.
    raise gl.vm.UserError(message)


def _require(condition: bool, message: str) -> None:
    if not condition:
        _fail(message)


def _now() -> int:
    raw = gl.message_raw["datetime"]
    try:
        if isinstance(raw, (int, float)):
            value = int(raw)
        else:
            text = str(raw).strip()
            if text.replace(".", "", 1).isdigit():
                value = int(float(text))
            else:
                value = int(datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith("Z") else text).timestamp())
        if value >= 1000000000000:
            value //= 1000
        _require(value > 0, "Transaction timestamp is invalid.")
        return value
    except gl.UserError:
        raise
    except Exception:
        _fail("Transaction timestamp is unavailable.")
    return 0


def _clean(value, limit: int) -> str:
    return str(value).replace("\r", " ").replace("\n", " ").replace("\x00", " ").strip()[:limit]


def _url(value: str, label: str) -> str:
    result = _clean(value, MAX_URL_LENGTH)
    _require(result.startswith("https://"), label + " must use HTTPS.")
    _require(" " not in result and len(result) > len("https://"), label + " is not a valid URL.")
    return result


def _integer(value, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _json(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _proof_token(campaign_id: str, submission_id: str, wallet: str, expiry: int) -> str:
    # Replay-safe because the token is bound to a unique on-chain submission and
    # expires. The wallet transaction is the cryptographic proof of wallet control.
    return "PROOFSCORE-V10|" + campaign_id + "|" + submission_id + "|" + wallet.lower() + "|" + str(expiry)


def _fetch_contains(url: str, token: str) -> bool:
    """Validators independently fetch only a boolean; no fetched prose reaches storage."""
    def fetch_token():
        # Fetch the response body directly. Rendered page wrapper representations
        # are not a stable source of the original public text (notably on GitHub).
        response = gl.nondet.web.get(url)
        return token in response.body.decode("utf-8")
    return gl.eq_principle.strict_eq(fetch_token)


def _adjudicate_evidence(dossier_url: str, repository_url: str, product_url: str) -> dict:
    """Settle a transparent, reproducible public-evidence completeness score.

    An LLM cannot provide a stable objective quality fact for payout settlement:
    the traced Bradbury rounds produced both 87/ACCEPTED and
    0/INSUFFICIENT_EVIDENCE for the same dossier.  Instead, each validator
    independently fetches the same dossier and derives a small set of explicit
    Boolean signals.  `strict_eq` reaches consensus on the canonical JSON of
    those signals, never on subjective prose or model-generated scores.
    """
    def inspect_dossier() -> str:
        response = gl.nondet.web.get(dossier_url)
        content = response.body.decode("utf-8").lower()
        signals = {
            "repository_linked": repository_url.lower() in content,
            "product_linked": product_url.lower() in content,
            "mentions_genlayer": "genlayer" in content,
            "describes_wallet_control": "wallet-bound" in content and "control" in content,
            "includes_deployment": "deployment transaction" in content or "contract:" in content,
        }
        return _json(signals)

    signals = json.loads(gl.eq_principle.strict_eq(inspect_dossier))
    weights = {
        "repository_linked": 25,
        "product_linked": 25,
        "mentions_genlayer": 20,
        "describes_wallet_control": 15,
        "includes_deployment": 15,
    }
    scores = {key: (weights[key] if signals.get(key) else 0) for key in weights}
    total = sum(scores.values())
    verdict = "ACCEPTED" if total >= 70 else "INSUFFICIENT_EVIDENCE"
    found = [key.replace("_", " ") for key in weights if signals.get(key)]
    missing = [key.replace("_", " ") for key in weights if not signals.get(key)]
    rationale = "Verified dossier signals: " + (", ".join(found) if found else "none") + "."
    if missing:
        rationale += " Missing: " + ", ".join(missing) + "."
    return {"verdict": verdict, "score": total, "scores": scores, "rationale": rationale}


class ProofScoreV10(gl.Contract):
    campaigns: TreeMap[str, str]
    campaign_ids: DynArray[str]
    submissions: TreeMap[str, str]
    submission_ids: TreeMap[str, str]
    builder_submissions: TreeMap[str, str]
    campaign_count: str
    submission_count: str
    total_locked_wei: str

    def __init__(self):
        self.campaign_count = "0"
        self.submission_count = "0"
        self.total_locked_wei = "0"

    def _campaign(self, campaign_id: str) -> dict:
        raw = self.campaigns.get(campaign_id, None)
        _require(raw is not None, "Campaign not found.")
        return json.loads(raw)

    def _submission(self, campaign_id: str, submission_id: str) -> dict:
        raw = self.submissions.get(campaign_id + ":" + submission_id, None)
        _require(raw is not None, "Submission not found.")
        return json.loads(raw)

    @gl.public.write.payable
    def create_campaign(self, title: str, description: str, reward_per_builder: str, deadline: int) -> None:
        _require(_integer(self.campaign_count) < MAX_CAMPAIGNS, "Campaign limit reached.")
        _require(3 <= len(title) <= 100, "Title must be 3-100 characters.")
        _require(20 <= len(description) <= 1200, "Description must be 20-1200 characters.")
        reward = _integer(reward_per_builder)
        deposit = int(gl.message.value)
        _require(reward > 0 and deposit >= reward, "Deposit must fund at least one positive reward.")
        _require(deadline > _now(), "Deadline must be in the future.")
        campaign_id = str(_integer(self.campaign_count) + 1)
        self.campaigns[campaign_id] = _json({"version": "v10", "campaign_id": campaign_id, "creator": str(gl.message.sender_address), "title": _clean(title, 100), "description": _clean(description, 1200), "reward_per_builder": str(reward), "total_pool": str(deposit), "remaining_pool": str(deposit), "deadline": deadline, "status": "OPEN", "submissions_count": 0})
        self.campaign_ids.append(campaign_id)
        self.submission_ids[campaign_id] = "[]"
        self.campaign_count = campaign_id
        self.total_locked_wei = str(_integer(self.total_locked_wei) + deposit)

    @gl.public.write
    def submit_evidence(self, campaign_id: str, handle: str, proof_url: str, repository_url: str, product_url: str, documentation_url: str, notes: str) -> None:
        campaign = self._campaign(campaign_id)
        _require(campaign["status"] == "OPEN" and _now() <= _integer(campaign["deadline"]), "Campaign is not accepting submissions.")
        _require(_integer(campaign["submissions_count"]) < MAX_SUBMISSIONS_PER_CAMPAIGN, "Campaign submission limit reached.")
        _require(2 <= len(handle) <= 80, "Handle must be 2-80 characters.")
        wallet = str(gl.message.sender_address)
        key = campaign_id + ":" + wallet
        _require(self.builder_submissions.get(key, None) is None, "This wallet already submitted to this campaign.")
        campaign["submissions_count"] += 1
        submission_id = str(campaign["submissions_count"])
        expiry = min(_integer(campaign["deadline"]), _now() + VERIFICATION_WINDOW_SECONDS)
        token = _proof_token(campaign_id, submission_id, wallet, expiry)
        record = {"version": "v10", "campaign_id": campaign_id, "submission_id": submission_id, "builder": wallet, "handle": _clean(handle, 80), "proof_url": _url(proof_url, "Ownership-proof URL"), "repository_url": _url(repository_url, "Repository URL"), "product_url": _url(product_url, "Product URL"), "documentation_url": _url(documentation_url, "Documentation URL"), "notes": _clean(notes, 1600), "verification_token": token, "verification_expires_at": expiry, "account_control": "PENDING", "quality_status": "NOT_REQUESTED", "verdict": "PENDING", "score": 0, "scores": {}, "rationale": "", "claimed": False, "payout_status": "UNCLAIMED", "submitted_at": _now()}
        self.submissions[campaign_id + ":" + submission_id] = _json(record)
        ids = json.loads(self.submission_ids.get(campaign_id, "[]")); ids.append(submission_id); self.submission_ids[campaign_id] = _json(ids)
        self.builder_submissions[key] = submission_id
        self.submission_count = str(_integer(self.submission_count) + 1)
        self.campaigns[campaign_id] = _json(campaign)

    @gl.public.write
    def verify_account_control(self, campaign_id: str, submission_id: str) -> None:
        submission = self._submission(campaign_id, submission_id)
        _require(str(gl.message.sender_address) == submission["builder"], "Only the submitting wallet can verify account control.")
        _require(submission["account_control"] == "PENDING", "Account control was already resolved.")
        _require(_now() <= _integer(submission["verification_expires_at"]), "Verification challenge expired; submit a new evidence record.")
        _require(_fetch_contains(submission["proof_url"], submission["verification_token"]), "The public proof URL did not contain the exact active challenge.")
        submission["account_control"] = "CONTROL_VERIFIED"
        submission["verified_at"] = _now()
        self.submissions[campaign_id + ":" + submission_id] = _json(submission)

    @gl.public.write
    def adjudicate_quality(self, campaign_id: str, submission_id: str) -> None:
        submission = self._submission(campaign_id, submission_id)
        _require(submission["account_control"] == "CONTROL_VERIFIED", "Verify public account control before quality adjudication.")
        _require(submission["quality_status"] == "NOT_REQUESTED", "Quality adjudication was already requested.")
        result = _adjudicate_evidence(submission["documentation_url"], submission["repository_url"], submission["product_url"])
        submission.update(result)
        submission["quality_status"] = "ADJUDICATED"
        submission["eligible_to_claim"] = result["verdict"] == "ACCEPTED"
        self.submissions[campaign_id + ":" + submission_id] = _json(submission)

    @gl.public.write
    def claim_reward(self, campaign_id: str, submission_id: str) -> None:
        campaign = self._campaign(campaign_id); submission = self._submission(campaign_id, submission_id)
        _require(str(gl.message.sender_address) == submission["builder"], "Only the submitting wallet can claim.")
        _require(submission.get("eligible_to_claim", False) and not submission["claimed"], "A verified accepted verdict is required to claim.")
        reward = _integer(campaign["reward_per_builder"]); remaining = _integer(campaign["remaining_pool"])
        _require(remaining >= reward, "Campaign pool cannot cover this reward.")
        submission["claimed"] = True; submission["eligible_to_claim"] = False; submission["payout_status"] = "SCHEDULED_FOR_FINALIZATION"; submission["claimed_at"] = _now()
        campaign["remaining_pool"] = str(remaining - reward)
        if remaining - reward < reward: campaign["status"] = "EXHAUSTED"
        self.submissions[campaign_id + ":" + submission_id] = _json(submission); self.campaigns[campaign_id] = _json(campaign)
        self.total_locked_wei = str(_integer(self.total_locked_wei) - reward)
        _Recipient(Address(submission["builder"])).emit_transfer(value=u256(reward))

    @gl.public.write
    def close_campaign(self, campaign_id: str) -> None:
        campaign = self._campaign(campaign_id)
        _require(str(gl.message.sender_address) == campaign["creator"], "Only the campaign creator can close.")
        _require(_now() > _integer(campaign["deadline"]), "Campaign deadline has not passed.")
        refund = _integer(campaign["remaining_pool"]); campaign["remaining_pool"] = "0"; campaign["status"] = "CLOSED"; campaign["refund_status"] = "NONE" if refund == 0 else "SCHEDULED_FOR_FINALIZATION"
        self.campaigns[campaign_id] = _json(campaign); self.total_locked_wei = str(_integer(self.total_locked_wei) - refund)
        if refund > 0: _Recipient(Address(campaign["creator"])).emit_transfer(value=u256(refund))

    @gl.public.view
    def get_campaign(self, campaign_id: str) -> str:
        return self.campaigns.get(campaign_id, _json({"exists": False, "campaign_id": campaign_id}))

    @gl.public.view
    def list_campaigns(self) -> str:
        return _json([json.loads(self.campaigns[campaign_id]) for campaign_id in self.campaign_ids])

    @gl.public.view
    def get_submission(self, campaign_id: str, submission_id: str) -> str:
        return self.submissions.get(campaign_id + ":" + submission_id, _json({"exists": False}))

    @gl.public.view
    def list_submissions(self, campaign_id: str) -> str:
        return _json([json.loads(self.submissions[campaign_id + ":" + item]) for item in json.loads(self.submission_ids.get(campaign_id, "[]"))])

    @gl.public.view
    def get_stats(self) -> str:
        return _json({"contract_version": "v10", "campaigns": self.campaign_count, "submissions": self.submission_count, "total_locked_wei": self.total_locked_wei})
