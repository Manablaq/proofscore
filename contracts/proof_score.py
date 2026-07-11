# v0.1.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from datetime import datetime
import json


MAX_CAMPAIGNS = 25
MAX_SUBMISSIONS_PER_CAMPAIGN = 25
MAX_LEADERBOARD_ENTRIES = 25


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass

    class Write:
        pass


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
        text = str(value).replace("\r", " ").replace("\n", " ").replace("\x00", " ").strip()
        return text[:limit]
    except:
        return ""


def _integer(value, default: int = 0) -> int:
    try:
        return int(value)
    except:
        return default


def _canonical_json(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _optional_source(value: str) -> str:
    value = _clean(value, 500)
    if not value or value.lower() == "none":
        return ""
    return value


def _web_source(value: str) -> str:
    value = _optional_source(value)
    if not value:
        return ""
    lowered = value.lower()
    valid_scheme = lowered.startswith("https://") or lowered.startswith("http://")
    separator = lowered.find("://")
    host_and_path = value[separator + 3:]
    assert valid_scheme and separator >= 0 and host_and_path and host_and_path[0] not in "/?#" and " " not in value, "Evidence must be a valid HTTP(S) URL."
    return value


def _github_source(value: str) -> str:
    value = _optional_source(value)
    if not value:
        return ""
    prefix = "https://github.com/"
    path = value[len(prefix):].split("?", 1)[0].split("#", 1)[0].strip("/")
    assert value.lower().startswith(prefix) and path, "GitHub evidence must use https://github.com/..."
    assert " " not in value, "GitHub evidence must not contain spaces."
    return value


def _x_source(value: str) -> str:
    value = _optional_source(value)
    if not value:
        return ""
    lowered = value.lower()
    prefix = "https://x.com/" if lowered.startswith("https://x.com/") else "https://twitter.com/"
    valid = lowered.startswith("https://x.com/") or lowered.startswith("https://twitter.com/")
    path = value[len(prefix):].split("?", 1)[0].split("#", 1)[0].strip("/")
    assert valid and path, "X evidence must use https://x.com/... or https://twitter.com/..."
    assert " " not in value, "X evidence must not contain spaces."
    return value


def _deterministic_score(campaign: dict, evidence: dict, invalidated: list = []) -> dict:
    source_fields = ["github_url", "x_url", "portfolio_url", "additional_evidence_url"]
    source_labels = ["github", "x", "portfolio", "additional"]
    accepted = [evidence[source_fields[i]] for i in range(len(source_fields)) if evidence[source_fields[i]] and source_labels[i] not in invalidated]
    rejected = [evidence[source_fields[i]] for i in range(len(source_fields)) if evidence[source_fields[i]] and source_labels[i] in invalidated]
    notes_length = len(evidence["notes"])
    notes_score = 20 if notes_length >= 40 else (10 if notes_length >= 10 else 0)
    dimensions = {
        "github": 25 if evidence["github_url"] and "github" not in invalidated else 0,
        "x": 15 if evidence["x_url"] and "x" not in invalidated else 0,
        "portfolio": 20 if evidence["portfolio_url"] and "portfolio" not in invalidated else 0,
        "additional": 20 if evidence["additional_evidence_url"] and "additional" not in invalidated else 0,
        "notes": notes_score,
    }
    score = sum(dimensions.values())
    requirements = _clean(campaign["evidence_requirements"], 1600)
    required = [label for label in source_labels if "[requires:" + label + "]" in requirements]
    present = {source_labels[i]: bool(evidence[source_fields[i]]) and source_labels[i] not in invalidated for i in range(len(source_fields))}
    missing = [label for label in required if not present[label]]
    has_strong_source = present["github"] or present["portfolio"]
    threshold = _integer(campaign["threshold_score"])
    forced_invalid = "duplicate" in invalidated or "irrelevant" in invalidated
    decision = "INVALID" if forced_invalid else ("QUALIFIED" if score >= threshold and not missing and has_strong_source else "NOT_QUALIFIED")
    risks = ["INVALIDATED_" + label.upper() for label in invalidated]
    risks += ["MISSING_REQUIRED_" + label.upper() for label in missing]
    if not has_strong_source:
        risks.append("MISSING_STRONG_SOURCE")
    return {
        "score": score,
        "decision": decision,
        "confidence": "DETERMINISTIC",
        "dimensions": dimensions,
        "evidence_summary": "Canonical source-identifier rubric; URLs are identifiers, not ownership proof.",
        "accepted_sources": accepted,
        "rejected_sources": rejected,
        "risk_flags": risks,
        "reasoning": "Score uses validated category weights and bounded notes. Qualification requires GitHub or portfolio, the campaign threshold, and every exact [requires:category] token.",
        "scoring_method": "CANONICAL_SOURCE_RUBRIC_V1",
    }


class ProofScore(gl.Contract):
    campaigns: TreeMap[str, str]
    campaign_ids: DynArray[str]
    submissions: TreeMap[str, str]
    submission_ids: TreeMap[str, str]
    challenges: TreeMap[str, str]
    challenge_ids: TreeMap[str, str]
    builder_submissions: TreeMap[str, str]
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
        assert _integer(self.campaign_count) < MAX_CAMPAIGNS, "Campaign limit reached."
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
        self.campaigns[campaign_id] = _canonical_json(campaign)
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
        assert _integer(campaign["submissions_count"]) < MAX_SUBMISSIONS_PER_CAMPAIGN, "Campaign submission limit reached."
        assert 2 <= len(handle) <= 80, "Handle must be 2-80 characters."
        submitter = str(gl.message.sender_address)
        builder_key = campaign_id + ":" + submitter
        assert self.builder_submissions.get(builder_key, None) is None, "Builder already submitted to this campaign."

        # Canonical metadata only. No claim is made that a URL proves ownership.
        evidence_record = {
            "handle": _clean(handle, 80),
            "github_url": _github_source(github_url),
            "x_url": _x_source(x_url),
            "portfolio_url": _web_source(portfolio_url),
            "additional_evidence_url": _web_source(additional_evidence_url),
            "notes": _clean(notes, 1800),
        }
        assert any([evidence_record["github_url"], evidence_record["x_url"], evidence_record["portfolio_url"], evidence_record["additional_evidence_url"]]), "Provide at least one valid HTTP(S) evidence URL."
        result = _deterministic_score(campaign, evidence_record)
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
            "invalidated_categories": [],
        }
        key = campaign_id + ":" + submission_id
        self.submissions[key] = _canonical_json(submission)
        ids = json.loads(self.submission_ids.get(campaign_id, "[]"))
        ids.append(submission_id)
        self.submission_ids[campaign_id] = _canonical_json(ids)
        self.challenge_ids[key] = "[]"
        self.builder_submissions[builder_key] = submission_id
        campaign["submissions_count"] += 1
        if eligible:
            campaign["qualified_count"] += 1
        self.campaigns[campaign_id] = _canonical_json(campaign)
        self.submission_count = str(_integer(self.submission_count) + 1)
        self._rank(submission)

    def _rank(self, submission: dict) -> None:
        entry = {
            "campaign_id": submission["campaign_id"],
            "submission_id": submission["submission_id"],
            "builder": submission["builder"],
            "handle": submission["handle"],
            "score": submission["score"],
            "decision": submission["decision"],
        }
        key = submission["campaign_id"] + ":" + submission["submission_id"]
        entries = []
        seen_keys = []
        for campaign_id in self.campaign_ids:
            try:
                submission_ids = json.loads(self.submission_ids.get(campaign_id, "[]"))
            except:
                submission_ids = []
            for submission_id in submission_ids:
                try:
                    persisted_key = campaign_id + ":" + submission_id
                    if persisted_key in seen_keys:
                        continue
                    if persisted_key == key:
                        candidate = submission
                    else:
                        raw = self.submissions.get(persisted_key, None)
                        if raw is None:
                            continue
                        candidate = json.loads(raw)
                    entries.append({
                        "campaign_id": candidate["campaign_id"],
                        "submission_id": candidate["submission_id"],
                        "builder": candidate["builder"],
                        "handle": candidate["handle"],
                        "score": candidate["score"],
                        "decision": candidate["decision"],
                    })
                    seen_keys.append(persisted_key)
                except:
                    pass
        if key not in seen_keys:
            entries.append(entry)
        entries.sort(key=lambda item: (
            -_integer(item.get("score", 0)),
            _integer(item.get("campaign_id", 0)),
            _integer(item.get("submission_id", 0)),
            str(item.get("builder", "")),
            str(item.get("handle", "")),
        ))
        while len(self.leaderboard) > 0:
            self.leaderboard.pop()
        for item in entries[:MAX_LEADERBOARD_ENTRIES]:
            self.leaderboard.append(_canonical_json(item))

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
        self.submissions[campaign_id + ":" + submission_id] = _canonical_json(submission)
        self.campaigns[campaign_id] = _canonical_json(campaign)
        self.claimed_count = str(_integer(self.claimed_count) + 1)
        self.total_claimed_wei = str(_integer(self.total_claimed_wei) + reward)
        self.total_locked_wei = str(max(0, _integer(self.total_locked_wei) - reward))
        _Recipient(Address(submission["builder"])).emit_transfer(value=u256(reward))

    @gl.public.write
    def challenge_score(self, campaign_id: str, submission_id: str, challenge_url: str, reason: str) -> None:
        campaign = self._campaign(campaign_id)
        submission = self._submission(campaign_id, submission_id)
        canonical_challenge_url = _web_source(challenge_url)
        assert canonical_challenge_url, "Challenge evidence must be a valid HTTP(S) URL."
        canonical_reason = _clean(reason, 1600)
        assert len(canonical_reason) >= 10, "Challenge reason must be at least 10 characters."
        challenger = str(gl.message.sender_address)
        previous_score = _integer(submission["score"])
        previous_decision = submission["decision"]

        was_qualified = submission["eligible_to_claim"]
        tags = [label for label in ["github", "x", "portfolio", "additional", "duplicate", "irrelevant"] if "[invalid:" + label + "]" in canonical_reason]
        creator_can_affect = challenger == campaign["creator"] and not submission["claimed"] and len(tags) > 0
        invalidated = submission.get("invalidated_categories", [])
        if not isinstance(invalidated, list):
            invalidated = []
        if creator_can_affect:
            for label in tags:
                if label not in invalidated:
                    invalidated.append(label)
            evidence = {
                "github_url": submission["github_url"],
                "x_url": submission["x_url"],
                "portfolio_url": submission["portfolio_url"],
                "additional_evidence_url": submission["additional_evidence_url"],
                "notes": submission["notes"],
            }
            result = _deterministic_score(campaign, evidence, invalidated)
            submission.update(result)
            submission["invalidated_categories"] = invalidated
            submission["eligible_to_claim"] = result["decision"] == "QUALIFIED" and result["score"] >= _integer(campaign["threshold_score"])

        revised_score = _integer(submission["score"])
        revised_decision = submission["decision"]
        if submission["claimed"]:
            verdict = "NEEDS_MORE_EVIDENCE"
            settlement_effect = "RECORDED_NO_CLAWBACK"
            deterministic_reasoning = "Post-claim challenge recorded without changing settled payout state."
        elif creator_can_affect:
            verdict = "INVALIDATE" if revised_decision == "INVALID" else ("REDUCE_SCORE" if revised_score < previous_score else "UPHOLD")
            settlement_effect = "ELIGIBILITY_RECOMPUTED"
            deterministic_reasoning = "Campaign creator challenge applied exact invalidation tags and recomputed canonical score eligibility."
        else:
            verdict = "NEEDS_MORE_EVIDENCE"
            settlement_effect = "RECORDED_NO_SCORE_CHANGE"
            deterministic_reasoning = "Challenge recorded without score change; only a pre-claim campaign creator challenge with exact tags can affect eligibility."

        outcome = {
            "verdict": verdict,
            "revised_score": revised_score,
            "revised_decision": revised_decision,
            "confidence": "DETERMINISTIC",
            "reasoning": deterministic_reasoning,
            "accepted_challenge_sources": [canonical_challenge_url],
            "rejected_challenge_sources": [],
            "risk_flags": ["APPLIED_" + label.upper() for label in tags] if creator_can_affect else ["MANUAL_REVIEW_RECOMMENDED"],
        }
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
            "challenge_url": canonical_challenge_url,
            "reason": canonical_reason,
            "prior_score": previous_score,
            "prior_decision": previous_decision,
            "previous_score": previous_score,
            "previous_decision": previous_decision,
            **outcome,
            "claimed_before_challenge": submission["claimed"],
            "settlement_effect": settlement_effect,
            "created_at": _now(),
        }
        key = campaign_id + ":" + submission_id
        self.challenges[key + ":" + challenge_id] = _canonical_json(challenge)
        ids = json.loads(self.challenge_ids.get(key, "[]"))
        ids.append(challenge_id)
        self.challenge_ids[key] = _canonical_json(ids)
        self.submissions[key] = _canonical_json(submission)
        self.campaigns[campaign_id] = _canonical_json(campaign)
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
        self.campaigns[campaign_id] = _canonical_json(campaign)
        if refund > 0:
            self.total_locked_wei = str(max(0, _integer(self.total_locked_wei) - refund))
            self.total_refunded_wei = str(_integer(self.total_refunded_wei) + refund)
            _Recipient(Address(campaign["creator"])).emit_transfer(value=u256(refund))

    @gl.public.view
    def get_campaign(self, campaign_id: str) -> str:
        raw = self.campaigns.get(campaign_id, None)
        return raw if raw is not None else _canonical_json({"exists": False, "campaign_id": campaign_id})

    @gl.public.view
    def list_campaigns(self) -> str:
        result = []
        for campaign_id in self.campaign_ids:
            raw = self.campaigns.get(campaign_id, None)
            if raw is not None:
                result.append(json.loads(raw))
        return _canonical_json(result)

    @gl.public.view
    def get_submission(self, campaign_id: str, submission_id: str) -> str:
        raw = self.submissions.get(campaign_id + ":" + submission_id, None)
        return raw if raw is not None else _canonical_json({"exists": False, "campaign_id": campaign_id, "submission_id": submission_id})

    @gl.public.view
    def list_submissions(self, campaign_id: str) -> str:
        result = []
        for submission_id in json.loads(self.submission_ids.get(campaign_id, "[]")):
            raw = self.submissions.get(campaign_id + ":" + submission_id, None)
            if raw is not None:
                result.append(json.loads(raw))
        return _canonical_json(result)

    @gl.public.view
    def get_challenge(self, campaign_id: str, submission_id: str, challenge_id: str) -> str:
        raw = self.challenges.get(campaign_id + ":" + submission_id + ":" + challenge_id, None)
        return raw if raw is not None else _canonical_json({"exists": False, "challenge_id": challenge_id})

    @gl.public.view
    def list_challenges(self, campaign_id: str, submission_id: str) -> str:
        key = campaign_id + ":" + submission_id
        result = []
        for challenge_id in json.loads(self.challenge_ids.get(key, "[]")):
            raw = self.challenges.get(key + ":" + challenge_id, None)
            if raw is not None:
                result.append(json.loads(raw))
        return _canonical_json(result)

    @gl.public.view
    def get_stats(self) -> str:
        return _canonical_json({
            "contract_version": "v9",
            "max_campaigns": MAX_CAMPAIGNS,
            "max_submissions_per_campaign": MAX_SUBMISSIONS_PER_CAMPAIGN,
            "max_leaderboard_entries": MAX_LEADERBOARD_ENTRIES,
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
        return _canonical_json([json.loads(item) for item in self.leaderboard])

    @gl.public.view
    def list_top_scores(self) -> str:
        return _canonical_json([json.loads(item) for item in self.leaderboard])
