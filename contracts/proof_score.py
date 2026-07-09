# v0.1.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json

# ProofScore v8 - evidence-backed tier validation.
# Stronger than v7:
# - stores compact evidence for each dimension alongside score fields
# - applies deterministic caps for sparse or unavailable evidence
# - asks validators to check JSON shape, allowed tiers, non-empty reasoning,
#   and whether the cited evidence supports the selected tier under the rubric
# Still not proved:
# - wallet ownership of off-chain profiles
# - objective truth of external pages
# - complete identity verification
#
# Redeploy required: this file changes contract runtime behavior and storage
# payload contents while preserving public method names and frontend score keys.

VALID_TIERS = [0, 40, 80, 120, 160, 200]


def _tier(n: int) -> int:
    n = max(0, min(200, int(n)))
    if n < 20:
        return 0
    if n < 60:
        return 40
    if n < 100:
        return 80
    if n < 140:
        return 120
    if n < 180:
        return 160
    return 200


def _cap_tier(n: int, cap: int) -> int:
    return min(_tier(n), _tier(cap))


def _safe_json(text: str) -> dict:
    try:
        s = text.strip()
        if s.startswith("```"):
            s = s.split("```")[1]
            if s.startswith("json"):
                s = s[4:]
        return json.loads(s.strip())
    except:
        return {}


def _safe_int(value, default: int = 0) -> int:
    try:
        return int(value)
    except:
        return default


def _clean(text: str, limit: int = 420) -> str:
    try:
        s = str(text).replace("\n", " ").replace("\r", " ").replace('"', "'")
        while "  " in s:
            s = s.replace("  ", " ")
        return s[:limit]
    except:
        return ""


def _url_handle(url: str) -> str:
    try:
        u = url.rstrip("/")
        return u.split("/")[-1].lstrip("@").split("?")[0]
    except:
        return ""


def _github_handle(url: str) -> str:
    try:
        part = url.rstrip("/").split("github.com/")[-1]
        return part.split("/")[0].split("?")[0]
    except:
        return _url_handle(url)


def _json_score(raw: str, fallback_score: int, fallback_reason: str) -> dict:
    d = _safe_json(raw)
    score = _tier(_safe_int(d.get("score", fallback_score), fallback_score))
    reasoning = _clean(d.get("reasoning", fallback_reason), 360)
    evidence = _clean(d.get("evidence", ""), 360)
    if not reasoning:
        reasoning = fallback_reason
    return {"score": score, "reasoning": reasoning, "evidence": evidence}


def _semantic_criteria(allowed: str, extra: str) -> str:
    return (
        "Accept only if the answer is a valid JSON object with fields: "
        "score, reasoning, evidence. score must be exactly one of: " + allowed + ". "
        "reasoning and evidence must be non-empty strings. The evidence must be derived "
        "from the supplied input, not invented. The reasoning must explain why the chosen "
        "tier follows the rubric and must not materially exceed what the supplied evidence "
        "supports. " + extra
    )


class ProofScore(gl.Contract):
    scores: TreeMap[str, str]
    usernames: TreeMap[str, str]
    leaderboard: DynArray[str]
    total_profiles: str

    def __init__(self):
        self.total_profiles = "0"

    @gl.public.write
    def generate_score(
        self,
        username: str,
        github_url: str,
        twitter_url: str,
        portfolio_url: str,
    ) -> None:
        address = str(gl.message.sender_address)
        now_str = gl.message_raw["datetime"]

        existing_raw = self.scores.get(address, None)
        if existing_raw is not None:
            try:
                ex = json.loads(existing_raw)
                last_str = ex.get("last_updated", "")
                if last_str and len(last_str) >= 10 and len(now_str) >= 10:
                    if now_str[:10] <= last_str[:10]:
                        assert False, "Already scored today. Wait 7 days to refresh."
            except AssertionError:
                raise
            except:
                pass

        assert len(username) >= 2 and len(username) <= 30, "Username must be 2-30 chars."
        has_gh = bool(github_url and github_url != "none")
        has_tw = bool(twitter_url and twitter_url != "none")
        has_po = bool(portfolio_url and portfolio_url != "none")
        assert has_gh or has_tw or has_po, "Provide at least one URL."

        # BUILD: GitHub metrics are parsed deterministically where possible,
        # then validator-reviewed for tier support from compact evidence.
        b, b_r, b_e = 0, "No GitHub provided.", "No GitHub URL submitted."
        gh_handle = ""
        if has_gh:
            gh_handle = _github_handle(github_url)

            def _get_github_input() -> str:
                user_data = ""
                repos_data = ""
                try:
                    r = gl.nondet.web.get("https://api.github.com/users/" + gh_handle)
                    user_data = r.body.decode("utf-8")[:1400]
                except:
                    pass
                try:
                    r2 = gl.nondet.web.get("https://api.github.com/users/" + gh_handle + "/repos?sort=updated&per_page=8")
                    repos_data = r2.body.decode("utf-8")[:2200]
                except:
                    pass
                return (
                    "GitHub URL: " + github_url + "\n"
                    "Handle: " + gh_handle + "\n"
                    "User JSON: " + (user_data if user_data else "UNAVAILABLE") + "\n"
                    "Recent repos JSON: " + (repos_data if repos_data else "UNAVAILABLE")
                )

            gh_raw = gl.eq_principle.prompt_non_comparative(
                _get_github_input,
                task=(
                    "Return JSON only: {\"score\": tier, \"reasoning\": string, \"evidence\": string}. "
                    "Score BUILD from GitHub evidence. Tiers: 0 no accessible or meaningful evidence; "
                    "40 accessible but sparse/tutorial/fork-heavy; 80 several real repos or activity; "
                    "120 clear builder with consistent recent repos; 160 strong depth, many repos, stars, "
                    "or notable projects; 200 exceptional public impact. Evidence must cite compact facts "
                    "such as public_repos, followers, repo names, stars, forks, account age, or access limits."
                ),
                criteria=_semantic_criteria(
                    "0, 40, 80, 120, 160, 200",
                    "If GitHub API data is unavailable, score must be 0 or 40. Scores 160 or 200 require strong cited evidence.",
                ),
            )
            gh = _json_score(gh_raw, 40, "GitHub scored conservatively.")
            b = gh["score"]
            b_r = gh["reasoning"]
            b_e = gh["evidence"] if gh["evidence"] else "GitHub handle " + gh_handle

        # VOICE: X/Twitter often blocks scraping; inaccessible pages are capped.
        v, v_r, v_e = 0, "No Twitter/X provided.", "No Twitter/X URL submitted."
        tw_handle = ""
        if has_tw:
            tw_handle = _url_handle(twitter_url)

            def _get_twitter_input() -> str:
                content = ""
                try:
                    r = gl.nondet.web.get(twitter_url)
                    content = r.body.decode("utf-8")[:1800]
                except:
                    pass
                if len(content) > 180:
                    return "Twitter/X URL: " + twitter_url + "\nHandle: @" + tw_handle + "\nContent: " + content
                return "Twitter/X URL: " + twitter_url + "\nHandle: @" + tw_handle + "\nContent: UNAVAILABLE_OR_BLOCKED"

            tw_raw = gl.eq_principle.prompt_non_comparative(
                _get_twitter_input,
                task=(
                    "Return JSON only: {\"score\": tier, \"reasoning\": string, \"evidence\": string}. "
                    "Score VOICE from visible professional content. Tiers: 0 spam-like, empty, or unrelated; "
                    "40 handle only, blocked, sparse, or uncertain; 80 some professional relevance; "
                    "120 consistent domain expertise; 160 strong public professional presence; "
                    "200 major public influence. Do not claim account ownership."
                ),
                criteria=_semantic_criteria(
                    "0, 40, 80, 120, 160, 200",
                    "If content is unavailable or blocked, score must be 0 or 40. Do not accept identity ownership claims.",
                ),
            )
            tw = _json_score(tw_raw, 40, "Twitter/X scored conservatively due to limited access.")
            v = tw["score"]
            v_r = tw["reasoning"]
            v_e = tw["evidence"] if tw["evidence"] else "Twitter/X handle @" + tw_handle

        # CRAFT: portfolio fetch is compact and capped if unavailable.
        c, c_r, c_e = 0, "No portfolio provided.", "No portfolio URL submitted."
        if has_po:
            def _get_portfolio_input() -> str:
                content = ""
                try:
                    r = gl.nondet.web.get(portfolio_url)
                    content = r.body.decode("utf-8")[:2400]
                except:
                    pass
                if len(content) > 100:
                    return "Portfolio URL: " + portfolio_url + "\nContent: " + content
                return "Portfolio URL: " + portfolio_url + "\nContent: UNAVAILABLE_OR_TOO_SMALL"

            po_raw = gl.eq_principle.prompt_non_comparative(
                _get_portfolio_input,
                task=(
                    "Return JSON only: {\"score\": tier, \"reasoning\": string, \"evidence\": string}. "
                    "Score CRAFT from portfolio/work evidence. Tiers: 0 broken/empty/no work evidence; "
                    "40 minimal or inaccessible; 80 real work with basic quality; 120 good portfolio with "
                    "clear skills and examples; 160 professional-grade presentation and impact; "
                    "200 exceptional or widely recognized work. Evidence must cite visible signals."
                ),
                criteria=_semantic_criteria(
                    "0, 40, 80, 120, 160, 200",
                    "If content is unavailable or too small, score must be 0 or 40. High tiers require concrete visible work evidence.",
                ),
            )
            po = _json_score(po_raw, 40, "Portfolio scored conservatively.")
            c = po["score"]
            c_r = po["reasoning"]
            c_e = po["evidence"] if po["evidence"] else "Portfolio URL submitted."

        # NETWORK: valid wallet gets a conservative base; high tiers require page evidence.
        def _get_network_input() -> str:
            bradbury_content = ""
            eth_content = ""
            try:
                r = gl.nondet.web.get("https://explorer-bradbury.genlayer.com/address/" + address)
                bradbury_content = r.body.decode("utf-8")[:800]
            except:
                pass
            try:
                r = gl.nondet.web.get("https://etherscan.io/address/" + address)
                eth_content = r.body.decode("utf-8")[:800]
            except:
                pass
            return (
                "Wallet address: " + address + "\n"
                "Bradbury explorer content: " + (bradbury_content if bradbury_content else "UNAVAILABLE") + "\n"
                "Ethereum address page content: " + (eth_content if eth_content else "UNAVAILABLE")
            )

        net_raw = gl.eq_principle.prompt_non_comparative(
            _get_network_input,
            task=(
                "Return JSON only: {\"score\": tier, \"reasoning\": string, \"evidence\": string}. "
                "Score NETWORK. Tiers: 40 valid wallet with unavailable/no visible history; "
                "80 some visible activity; 120 moderate visible activity or multiple interactions; "
                "160 active history across protocols or many transactions; 200 extensive power-user history. "
                "Evidence must cite visible page signals or access limits."
            ),
            criteria=_semantic_criteria(
                "40, 80, 120, 160, 200",
                "If both address pages are unavailable or show no clear activity, score must be 40.",
            ),
        )
        net = _json_score(net_raw, 40, "Network scored conservatively.")
        n = max(40, net["score"])
        n_r = net["reasoning"]
        n_e = net["evidence"] if net["evidence"] else "Wallet address " + address

        # CONSISTENCY: based on submitted handles/evidence, with deterministic caps.
        platform_count = sum([has_gh, has_tw, has_po])

        def _get_consistency_input() -> str:
            parts = ["Display name: " + username, "Wallet address: " + address]
            if has_gh:
                parts.append("GitHub: " + github_url + " handle=" + gh_handle + " score=" + str(b) + " evidence=" + b_e)
            if has_tw:
                parts.append("Twitter/X: " + twitter_url + " handle=" + tw_handle + " score=" + str(v) + " evidence=" + v_e)
            if has_po:
                parts.append("Portfolio: " + portfolio_url + " score=" + str(c) + " evidence=" + c_e)
            return "\n".join(parts)

        con_raw = gl.eq_principle.prompt_non_comparative(
            _get_consistency_input,
            task=(
                "Return JSON only: {\"score\": tier, \"reasoning\": string, \"evidence\": string}. "
                "Score CONSISTENCY from visible overlap across submitted URLs, handles, display name, "
                "and evidence summaries. Tiers: 0 clear contradiction/unrelated; 40 weak or sparse alignment; "
                "80 plausible alignment; 120 good alignment across two or more sources; 160 strong reinforcing "
                "professional identity; 200 exceptional coherence across all sources. Do not claim ownership proof."
            ),
            criteria=_semantic_criteria(
                "0, 40, 80, 120, 160, 200",
                "With one submitted platform, score must be at most 80. With two submitted platforms, score must be at most 120. Do not accept ownership-proof claims.",
            ),
        )
        con = _json_score(con_raw, 80, "Consistency scored from submitted evidence.")
        x = con["score"]
        if platform_count <= 1:
            x = min(x, 80)
        elif platform_count == 2:
            x = min(x, 120)
        x_r = con["reasoning"]
        x_e = con["evidence"] if con["evidence"] else "Submitted platform count: " + str(platform_count)

        total = b + v + c + n + x
        evidence = {
            "build": b_e,
            "voice": v_e,
            "craft": c_e,
            "network": n_e,
            "consistency": x_e,
        }

        reasoning = (
            "BUILD(" + str(b) + "): " + b_r + " | " +
            "VOICE(" + str(v) + "): " + v_r + " | " +
            "CRAFT(" + str(c) + "): " + c_r + " | " +
            "NETWORK(" + str(n) + "): " + n_r + " | " +
            "CONSISTENCY(" + str(x) + "): " + x_r
        )

        uc = "1"
        if existing_raw is not None:
            try:
                ex = json.loads(existing_raw)
                uc = str(int(ex.get("update_count", "0")) + 1)
            except:
                uc = "2"

        data = {
            "version": "v8",
            "build_score": str(b),
            "consistency_score": str(x),
            "craft_score": str(c),
            "github_url": github_url if has_gh else "none",
            "last_updated": now_str,
            "network_score": str(n),
            "portfolio_url": portfolio_url if has_po else "none",
            "reasoning": _clean(reasoning, 1600),
            "evidence_summary": _clean(json.dumps(evidence), 1600),
            "evidence": evidence,
            "total_score": str(total),
            "twitter_url": twitter_url if has_tw else "none",
            "update_count": uc,
            "voice_score": str(v),
        }

        self.scores[address] = json.dumps(data)
        self.usernames[address] = username

        if uc == "1":
            try:
                self.total_profiles = str(int(self.total_profiles) + 1)
            except:
                self.total_profiles = "1"

        entry = {
            "address": address,
            "build_score": str(b),
            "consistency_score": str(x),
            "craft_score": str(c),
            "network_score": str(n),
            "total_score": str(total),
            "username": username.replace('"', "'"),
            "voice_score": str(v),
        }

        idx = -1
        for i in range(len(self.leaderboard)):
            try:
                e = json.loads(self.leaderboard[i])
                if e.get("address") == address:
                    idx = i
                    break
            except:
                pass
        if idx >= 0:
            self.leaderboard.pop(idx)

        inserted = False
        entry_raw = json.dumps(entry)
        for i in range(len(self.leaderboard)):
            try:
                e = json.loads(self.leaderboard[i])
                if int(e.get("total_score", "0")) < total:
                    self.leaderboard.insert(i, entry_raw)
                    inserted = True
                    break
            except:
                pass
        if not inserted:
            self.leaderboard.append(entry_raw)
        while len(self.leaderboard) > 50:
            self.leaderboard.pop(len(self.leaderboard) - 1)

    @gl.public.view
    def get_score(self, address: str) -> str:
        raw = self.scores.get(address, None)
        if raw is None:
            return json.dumps({
                "exists": "false", "address": address,
                "version": "v8",
                "total_score": "0", "build_score": "0", "voice_score": "0",
                "craft_score": "0", "network_score": "0", "consistency_score": "0",
                "reasoning": "", "evidence_summary": "", "evidence": {},
                "github_url": "none", "twitter_url": "none",
                "portfolio_url": "none", "username": "Unknown",
                "last_updated": "0", "update_count": "0",
            })
        d = json.loads(raw)
        d["exists"] = "true"
        d["address"] = address
        d["username"] = self.usernames.get(address, "Unknown")
        return json.dumps(d)

    @gl.public.view
    def get_leaderboard(self) -> str:
        result = []
        for raw in self.leaderboard:
            try:
                result.append(json.loads(raw))
            except:
                pass
        return json.dumps(result)

    @gl.public.view
    def get_stats(self) -> str:
        return json.dumps({
            "total_profiles": self.total_profiles or "0",
            "leaderboard_size": str(len(self.leaderboard)),
            "contract_version": "v8",
        })

    @gl.public.view
    def has_score(self, address: str) -> str:
        return "true" if self.scores.get(address, None) is not None else "false"
