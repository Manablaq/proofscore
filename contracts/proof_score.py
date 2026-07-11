# v0.1.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from datetime import datetime
import json


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass

    class Write:
        pass


DECISIONS = ["QUALIFIED", "NOT_QUALIFIED", "INVALID"]
CONFIDENCES = ["HIGH", "MEDIUM", "LOW"]
VERDICTS = ["UPHOLD", "REDUCE_SCORE", "INCREASE_SCORE", "INVALIDATE", "NEEDS_MORE_EVIDENCE"]


def _now() -> int:
    """Return deterministic transaction time from GenLayer message metadata."""
    try:
        raw = gl.message_raw["datetime"]
        if isinstance(raw, (int, float)):
            timestamp = int(raw)
        else:
            value = str(raw).strip()
            if value.replace(".", "", 1).isdigit():
                timestamp = int(float(value))
            else:
                normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
                parsed = datetime.fromisoformat(normalized)
                assert parsed.tzinfo is not None, "transaction datetime must include a timezone"
                timestamp = int(parsed.timestamp())
        # Numeric providers may expose milliseconds rather than seconds.
        if timestamp >= 1000000000000:
            timestamp = timestamp // 1000
        assert timestamp > 0, "transaction datetime must be positive"
        return timestamp
    except AssertionError:
        raise
    except:
        assert False, "unusable GenLayer transaction datetime"
        return 0


def _clean(value, limit: int = 1200) -> str:
    try:
        text = str(value).replace("\r", " ").replace("\x00", " ").strip()
        return text[:limit]
    except:
        return ""


def _safe_json(raw: str) -> dict:
    try:
        text = raw.strip()
        if text.startswith("```"):
            text = text.split("```", 2)[1]
            if text.lstrip().startswith("json"):
                text = text.lstrip()[4:]
        parsed = json.loads(text.strip())
        return parsed if isinstance(parsed, dict) else {}
    except:
        return {}


def _integer(value, default: int = 0) -> int:
    try:
        return int(value)
    except:
        return default


def _strings(value, limit: int = 12) -> list:
    if not isinstance(value, list):
        return []
    return [_clean(item, 360) for item in value[:limit] if _clean(item, 360)]


def _score_result(raw: str) -> dict:
    data = _safe_json(raw)
    dimensions_raw = data.get("dimensions", {})
    if not isinstance(dimensions_raw, dict):
        dimensions_raw = {}
    dimensions = {}
    for key in ["build", "voice", "craft", "network", "consistency"]:
        dimensions[key] = max(0, min(20, _integer(dimensions_raw.get(key, 0))))
    score = max(0, min(100, _integer(data.get("score", sum(dimensions.values())))))
    decision = _clean(data.get("decision", "INVALID"), 24).upper()
    confidence = _clean(data.get("confidence", "LOW"), 12).upper()
    if decision not in DECISIONS:
        decision = "INVALID"
    if confidence not in CONFIDENCES:
        confidence = "LOW"
    if not _clean(data.get("reasoning", ""), 2000):
        decision = "INVALID"
        confidence = "LOW"
    if not _strings(data.get("accepted_sources", [])):
        decision = "INVALID"
        score = min(score, 39)
    return {
        "score": score,
        "decision": decision,
        "confidence": confidence,
        "dimensions": dimensions,
        "evidence_summary": _clean(data.get("evidence_summary", "No verifiable evidence summary returned."), 1600),
        "accepted_sources": _strings(data.get("accepted_sources", [])),
        "rejected_sources": _strings(data.get("rejected_sources", [])),
        "risk_flags": _strings(data.get("risk_flags", [])),
        "reasoning": _clean(data.get("reasoning", "Validator output was incomplete."), 2000),
    }


def _challenge_result(raw: str, previous_score: int, previous_decision: str) -> dict:
    data = _safe_json(raw)
    verdict = _clean(data.get("verdict", "NEEDS_MORE_EVIDENCE"), 32).upper()
    decision = _clean(data.get("revised_decision", previous_decision), 24).upper()
    confidence = _clean(data.get("confidence", "LOW"), 12).upper()
    score = max(0, min(100, _integer(data.get("revised_score", previous_score), previous_score)))
    if verdict not in VERDICTS:
        verdict = "NEEDS_MORE_EVIDENCE"
    if decision not in DECISIONS:
        decision = previous_decision if previous_decision in DECISIONS else "INVALID"
    if confidence not in CONFIDENCES:
        confidence = "LOW"
    if verdict in ["UPHOLD", "NEEDS_MORE_EVIDENCE"]:
        score = previous_score
        decision = previous_decision
    elif verdict == "REDUCE_SCORE":
        score = min(score, previous_score)
    elif verdict == "INCREASE_SCORE":
        score = max(score, previous_score)
    if verdict == "INVALIDATE":
        decision = "INVALID"
        score = min(score, 39)
    if not _clean(data.get("reasoning", ""), 2000):
        verdict = "NEEDS_MORE_EVIDENCE"
        score = previous_score
        decision = previous_decision
        confidence = "LOW"
    return {
        "verdict": verdict,
        "revised_score": score,
        "revised_decision": decision,
        "confidence": confidence,
        "reasoning": _clean(data.get("reasoning", "Challenge output was incomplete; prior result retained."), 2000),
        "accepted_challenge_sources": _strings(data.get("accepted_challenge_sources", [])),
        "rejected_challenge_sources": _strings(data.get("rejected_challenge_sources", [])),
        "risk_flags": _strings(data.get("risk_flags", [])),
    }


class ProofScore(gl.Contract):
    campaigns: TreeMap[str, str]
    campaign_ids: DynArray[str]
    submissions: TreeMap[str, str]
    submission_ids: TreeMap[str, str]
    challenges: TreeMap[str, str]
    challenge_ids: TreeMap[str, str]
    leaderboard: DynArray[str]
    # Bradbury storage does not support an unsized Python `int`. String counters
    # match the proven storage pattern used by the v8 and marketplace contracts.
    campaign_count: str
    submission_count: str
    challenge_count: str
    claimed_count: str
    total_locked_wei: str
    total_funded_wei: str
    total_claimed_wei: str
    total_refunded_wei: str

    def __init__(self):
        self.campaign_count = "0"
        self.submission_count = "0"
        self.challenge_count = "0"
        self.claimed_count = "0"
        self.total_locked_wei = "0"
        self.total_funded_wei = "0"
        self.total_claimed_wei = "0"
        self.total_refunded_wei = "0"

    def _campaign(self, campaign_id: str) -> dict:
        raw = self.campaigns.get(campaign_id, None)
        assert raw is not None, "Campaign not found."
        return json.loads(raw)

    def _submission(self, campaign_id: str, submission_id: str) -> dict:
        raw = self.submissions.get(campaign_id + ":" + submission_id, None)
        assert raw is not None, "Submission not found."
        return json.loads(raw)

    @gl.public.write.payable
    def create_campaign(
        self,
        title: str,
        description: str,
        threshold_score: int,
        reward_per_qualified_builder: str,
        deadline: int,
        evidence_requirements: str,
    ) -> None:
        assert 3 <= len(title) <= 100, "Title must be 3-100 characters."
        assert 1 <= len(description) <= 1200, "Description is required."
        assert 1 <= threshold_score <= 100, "Threshold must be 1-100."
        reward = _integer(reward_per_qualified_builder)
        deposit = int(gl.message.value)
        assert reward > 0, "Reward must be positive wei."
        assert deposit >= reward, "Deposit must fund at least one reward."
        assert deadline > _now(), "Deadline must be in the future."
        assert len(evidence_requirements) > 0, "Evidence requirements are required."

        campaign_id = str(_integer(self.campaign_count) + 1)
        campaign = {
            "version": "v9",
            "campaign_id": campaign_id,
            "creator": str(gl.message.sender_address),
            "title": _clean(title, 100),
            "description": _clean(description, 1200),
            "threshold_score": threshold_score,
            "reward_per_qualified_builder": str(reward),
            "total_pool": str(deposit),
            "remaining_pool": str(deposit),
            "deadline": deadline,
            "evidence_requirements": _clean(evidence_requirements, 1600),
            "status": "OPEN",
            "created_at": _now(),
            "closed_at": 0,
            "submissions_count": 0,
            "qualified_count": 0,
        }
        self.campaigns[campaign_id] = json.dumps(campaign)
        self.campaign_ids.append(campaign_id)
        self.submission_ids[campaign_id] = "[]"
        self.campaign_count = campaign_id
        self.total_locked_wei = str(_integer(self.total_locked_wei) + deposit)
        self.total_funded_wei = str(_integer(self.total_funded_wei) + deposit)

    @gl.public.write
    def submit_builder_profile(
        self,
        campaign_id: str,
        handle: str,
        github_url: str,
        x_url: str,
        portfolio_url: str,
        additional_evidence_url: str,
        notes: str,
    ) -> None:
        campaign = self._campaign(campaign_id)
        assert campaign["status"] == "OPEN", "Campaign is not open."
        assert _now() <= _integer(campaign["deadline"]), "Campaign deadline has passed."
        assert 2 <= len(handle) <= 80, "Handle must be 2-80 characters."
        sources = [url for url in [github_url, x_url, portfolio_url, additional_evidence_url] if url and url != "none"]
        assert len(sources) > 0, "Provide at least one evidence URL."
        submitter = str(gl.message.sender_address)

        # Metadata-only resolver: validators judge the submitted source identifiers,
        # notes, and requirements. No claim is made that a URL proves ownership.
        evidence_record = {
            "handle": _clean(handle, 80),
            "github_url": _clean(github_url, 500),
            "x_url": _clean(x_url, 500),
            "portfolio_url": _clean(portfolio_url, 500),
            "additional_evidence_url": _clean(additional_evidence_url, 500),
            "notes": _clean(notes, 1800),
            "source_identifiers": sources,
        }

        def get_input() -> str:
            return json.dumps({
                "campaign_title": campaign["title"],
                "campaign_description": campaign["description"],
                "threshold_score": campaign["threshold_score"],
                "evidence_requirements": campaign["evidence_requirements"],
                "submitted_evidence": evidence_record,
            })

        raw = gl.eq_principle.prompt_non_comparative(
            get_input,
            task=(
                "Assess builder evidence for a bounty. Treat URLs as source identifiers and notes as claims, not identity proof. "
                "Return strict JSON only with score (0-100), decision (QUALIFIED, NOT_QUALIFIED, or INVALID), "
                "confidence (HIGH, MEDIUM, or LOW), dimensions with build/voice/craft/network/consistency each 0-20, "
                "evidence_summary, accepted_sources array, rejected_sources array, risk_flags array, and reasoning. "
                "The five dimensions should sum to score. QUALIFIED requires credible source-backed evidence matching the campaign. "
                "Use INVALID for malformed, irrelevant, or unverifiable identifiers; use NOT_QUALIFIED for valid but weak evidence."
            ),
            criteria=(
                "Accept only one valid JSON object with every requested field and allowed enum. Scores must be integers in range, "
                "dimension totals must materially agree with score, reasoning must connect accepted source identifiers to the campaign "
                "requirements, and uncertainty or inaccessible content must lower confidence and score. Never accept claims of wallet/profile ownership proof."
            ),
        )
        result = _score_result(raw)
        eligible = result["decision"] == "QUALIFIED" and result["score"] >= _integer(campaign["threshold_score"])
        submission_id = str(campaign["submissions_count"] + 1)
        submission = {
            "version": "v9",
            "campaign_id": campaign_id,
            "submission_id": submission_id,
            "builder": submitter,
            "handle": evidence_record["handle"],
            "github_url": evidence_record["github_url"],
            "x_url": evidence_record["x_url"],
            "portfolio_url": evidence_record["portfolio_url"],
            "additional_evidence_url": evidence_record["additional_evidence_url"],
            "notes": evidence_record["notes"],
            **result,
            "original_score": result["score"],
            "original_decision": result["decision"],
            "eligible_to_claim": eligible,
            "claimed": False,
            "payout_status": "UNCLAIMED",
            "submitted_at": _now(),
            "claimed_at": 0,
            "challenge_count": 0,
            "last_challenged_at": 0,
            "revision_count": 0,
        }
        key = campaign_id + ":" + submission_id
        self.submissions[key] = json.dumps(submission)
        ids = json.loads(self.submission_ids.get(campaign_id, "[]"))
        ids.append(submission_id)
        self.submission_ids[campaign_id] = json.dumps(ids)
        self.challenge_ids[key] = "[]"
        campaign["submissions_count"] += 1
        if eligible:
            campaign["qualified_count"] += 1
        self.campaigns[campaign_id] = json.dumps(campaign)
        self.submission_count = str(_integer(self.submission_count) + 1)
        self._rank(submission)

    def _rank(self, submission: dict) -> None:
        entry = json.dumps({
            "campaign_id": submission["campaign_id"],
            "submission_id": submission["submission_id"],
            "builder": submission["builder"],
            "handle": submission["handle"],
            "score": submission["score"],
            "decision": submission["decision"],
        })
        key = submission["campaign_id"] + ":" + submission["submission_id"]
        found = -1
        for i in range(len(self.leaderboard)):
            try:
                old = json.loads(self.leaderboard[i])
                if old["campaign_id"] + ":" + old["submission_id"] == key:
                    found = i
                    break
            except:
                pass
        if found >= 0:
            self.leaderboard.pop(found)
        inserted = False
        for i in range(len(self.leaderboard)):
            try:
                if _integer(json.loads(self.leaderboard[i]).get("score", 0)) < _integer(submission["score"]):
                    self.leaderboard.insert(i, entry)
                    inserted = True
                    break
            except:
                pass
        if not inserted:
            self.leaderboard.append(entry)
        while len(self.leaderboard) > 50:
            self.leaderboard.pop(len(self.leaderboard) - 1)

    @gl.public.write
    def claim_reward(self, campaign_id: str, submission_id: str) -> None:
        campaign = self._campaign(campaign_id)
        submission = self._submission(campaign_id, submission_id)
        assert str(gl.message.sender_address) == submission["builder"], "Only the submitting builder can claim."
        assert submission["eligible_to_claim"], "Accepted score does not qualify for settlement."
        assert not submission["claimed"], "Reward already claimed."
        reward = _integer(campaign["reward_per_qualified_builder"])
        remaining = _integer(campaign["remaining_pool"])
        assert remaining >= reward, "Campaign pool cannot cover this reward."

        # EOA transfers execute on finalization. Accepted state records that the
        # payout is scheduled; the UI must not describe it as paid/finalized yet.
        submission["claimed"] = True
        submission["eligible_to_claim"] = False
        submission["payout_status"] = "SCHEDULED_FOR_FINALIZATION"
        submission["claimed_at"] = _now()
        campaign["remaining_pool"] = str(remaining - reward)
        if remaining - reward < reward:
            campaign["status"] = "EXHAUSTED"
        self.submissions[campaign_id + ":" + submission_id] = json.dumps(submission)
        self.campaigns[campaign_id] = json.dumps(campaign)
        self.claimed_count = str(_integer(self.claimed_count) + 1)
        self.total_claimed_wei = str(_integer(self.total_claimed_wei) + reward)
        self.total_locked_wei = str(max(0, _integer(self.total_locked_wei) - reward))
        _Recipient(Address(submission["builder"])).emit_transfer(value=u256(reward))

    @gl.public.write
    def challenge_score(self, campaign_id: str, submission_id: str, challenge_url: str, reason: str) -> None:
        campaign = self._campaign(campaign_id)
        submission = self._submission(campaign_id, submission_id)
        assert len(challenge_url) > 5, "Challenge evidence URL is required."
        assert len(reason) >= 10, "Challenge reason must be at least 10 characters."
        challenger = str(gl.message.sender_address)
        previous_score = _integer(submission["score"])
        previous_decision = submission["decision"]

        original = {
            "handle": submission["handle"],
            "github_url": submission["github_url"],
            "x_url": submission["x_url"],
            "portfolio_url": submission["portfolio_url"],
            "additional_evidence_url": submission["additional_evidence_url"],
            "notes": submission["notes"],
            "accepted_sources": submission["accepted_sources"],
            "rejected_sources": submission["rejected_sources"],
            "score": previous_score,
            "decision": previous_decision,
            "reasoning": submission["reasoning"],
        }

        def get_input() -> str:
            return json.dumps({
                "campaign_requirements": campaign["evidence_requirements"],
                "threshold_score": campaign["threshold_score"],
                "original_evidence_and_accepted_assessment": original,
                "challenge_evidence": {"challenge_url": challenge_url, "reason": reason},
                "already_claimed": submission["claimed"],
            })

        raw = gl.eq_principle.prompt_non_comparative(
            get_input,
            task=(
                "Compare the complete original evidence record and its accepted assessment against the challenge source identifier and reason. "
                "Return strict JSON only with verdict (UPHOLD, REDUCE_SCORE, INCREASE_SCORE, INVALIDATE, or NEEDS_MORE_EVIDENCE), "
                "revised_score 0-100, revised_decision (QUALIFIED, NOT_QUALIFIED, or INVALID), confidence, reasoning, "
                "accepted_challenge_sources array, rejected_challenge_sources array, and risk_flags array. "
                "Do not assume URL ownership or invent page contents. A challenge may revise eligibility but cannot claw back an already scheduled payout."
            ),
            criteria=(
                "Accept only valid JSON with allowed enums and bounded score. Reasoning must explicitly compare original evidence with counter-evidence, "
                "explain source acceptance/rejection, preserve the prior result when counter-evidence is insufficient, and avoid identity-proof claims."
            ),
        )
        outcome = _challenge_result(raw, previous_score, previous_decision)
        was_qualified = submission["eligible_to_claim"]
        submission["score"] = outcome["revised_score"]
        submission["decision"] = outcome["revised_decision"]
        if not submission["claimed"]:
            submission["eligible_to_claim"] = (
                outcome["revised_decision"] == "QUALIFIED"
                and outcome["revised_score"] >= _integer(campaign["threshold_score"])
            )
        submission["challenge_count"] += 1
        submission["last_challenged_at"] = _now()
        if outcome["revised_score"] != previous_score or outcome["revised_decision"] != previous_decision:
            submission["revision_count"] += 1
        if was_qualified != submission["eligible_to_claim"]:
            if submission["eligible_to_claim"]:
                campaign["qualified_count"] += 1
            else:
                campaign["qualified_count"] = max(0, _integer(campaign["qualified_count"]) - 1)

        challenge_id = str(submission["challenge_count"])
        challenge = {
            "version": "v9",
            "campaign_id": campaign_id,
            "submission_id": submission_id,
            "challenge_id": challenge_id,
            "challenger": challenger,
            "challenge_url": _clean(challenge_url, 500),
            "reason": _clean(reason, 1600),
            "previous_score": previous_score,
            "previous_decision": previous_decision,
            **outcome,
            "claimed_before_challenge": submission["claimed"],
            "settlement_effect": "RECORDED_NO_CLAWBACK" if submission["claimed"] else "ELIGIBILITY_RECOMPUTED",
            "created_at": _now(),
        }
        key = campaign_id + ":" + submission_id
        self.challenges[key + ":" + challenge_id] = json.dumps(challenge)
        ids = json.loads(self.challenge_ids.get(key, "[]"))
        ids.append(challenge_id)
        self.challenge_ids[key] = json.dumps(ids)
        self.submissions[key] = json.dumps(submission)
        self.campaigns[campaign_id] = json.dumps(campaign)
        self.challenge_count = str(_integer(self.challenge_count) + 1)
        self._rank(submission)

    @gl.public.write
    def close_campaign(self, campaign_id: str) -> None:
        campaign = self._campaign(campaign_id)
        assert str(gl.message.sender_address) == campaign["creator"], "Only the creator can close."
        assert campaign["status"] in ["OPEN", "EXHAUSTED"], "Campaign already closed."
        assert _now() > _integer(campaign["deadline"]), "Campaign deadline has not passed."
        refund = _integer(campaign["remaining_pool"])
        campaign["remaining_pool"] = "0"
        campaign["status"] = "CLOSED"
        campaign["closed_at"] = _now()
        campaign["refund_status"] = "NONE" if refund == 0 else "SCHEDULED_FOR_FINALIZATION"
        self.campaigns[campaign_id] = json.dumps(campaign)
        if refund > 0:
            self.total_locked_wei = str(max(0, _integer(self.total_locked_wei) - refund))
            self.total_refunded_wei = str(_integer(self.total_refunded_wei) + refund)
            _Recipient(Address(campaign["creator"])).emit_transfer(value=u256(refund))

    @gl.public.view
    def get_campaign(self, campaign_id: str) -> str:
        raw = self.campaigns.get(campaign_id, None)
        return raw if raw is not None else json.dumps({"exists": False, "campaign_id": campaign_id})

    @gl.public.view
    def list_campaigns(self) -> str:
        result = []
        for campaign_id in self.campaign_ids:
            raw = self.campaigns.get(campaign_id, None)
            if raw is not None:
                result.append(json.loads(raw))
        return json.dumps(result)

    @gl.public.view
    def get_submission(self, campaign_id: str, submission_id: str) -> str:
        raw = self.submissions.get(campaign_id + ":" + submission_id, None)
        return raw if raw is not None else json.dumps({"exists": False, "campaign_id": campaign_id, "submission_id": submission_id})

    @gl.public.view
    def list_submissions(self, campaign_id: str) -> str:
        result = []
        for submission_id in json.loads(self.submission_ids.get(campaign_id, "[]")):
            raw = self.submissions.get(campaign_id + ":" + submission_id, None)
            if raw is not None:
                result.append(json.loads(raw))
        return json.dumps(result)

    @gl.public.view
    def get_challenge(self, campaign_id: str, submission_id: str, challenge_id: str) -> str:
        raw = self.challenges.get(campaign_id + ":" + submission_id + ":" + challenge_id, None)
        return raw if raw is not None else json.dumps({"exists": False, "challenge_id": challenge_id})

    @gl.public.view
    def list_challenges(self, campaign_id: str, submission_id: str) -> str:
        key = campaign_id + ":" + submission_id
        result = []
        for challenge_id in json.loads(self.challenge_ids.get(key, "[]")):
            raw = self.challenges.get(key + ":" + challenge_id, None)
            if raw is not None:
                result.append(json.loads(raw))
        return json.dumps(result)

    @gl.public.view
    def get_stats(self) -> str:
        return json.dumps({
            "contract_version": "v9",
            "campaigns": self.campaign_count,
            "submissions": self.submission_count,
            "challenges": self.challenge_count,
            "claims_scheduled": self.claimed_count,
            "total_locked_wei": self.total_locked_wei,
            "total_funded_wei": self.total_funded_wei,
            "total_claimed_wei": self.total_claimed_wei,
            "total_refunded_wei": self.total_refunded_wei,
        })

    @gl.public.view
    def get_leaderboard(self) -> str:
        return json.dumps([json.loads(item) for item in self.leaderboard])

    @gl.public.view
    def list_top_scores(self) -> str:
        return json.dumps([json.loads(item) for item in self.leaderboard])
