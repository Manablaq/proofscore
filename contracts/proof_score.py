# v0.1.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from dataclasses import dataclass
import json
import typing

# ProofScore v7 - uses official gl.eq_principle.prompt_non_comparative API
# Tiers: 0, 40, 80, 120, 160, 200 (only 6 values per dimension)
# prompt_non_comparative: validators verify leader's output quality, don't re-run


def _tier(n: int) -> int:
    """Snap score to nearest valid tier."""
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


def _safe_json(text: str) -> dict:
    """Parse JSON from LLM output, stripping markdown if present."""
    try:
        s = text.strip()
        if s.startswith("```"):
            s = s.split("```")[1]
            if s.startswith("json"):
                s = s[4:]
        return json.loads(s.strip())
    except:
        return {}


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

        # Rate limit: prevent same-day refresh
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

        # ── BUILD (GitHub) ────────────────────────────────────────────────────
        b, b_r = 0, "No GitHub provided."
        if has_gh:
            def _get_github_input() -> str:
                handle = github_url.rstrip("/").split("github.com/")[-1].split("/")[0]
                user_data = ""
                repos_data = ""
                try:
                    r = gl.nondet.web.get("https://api.github.com/users/" + handle)
                    user_data = r.body.decode("utf-8")[:1500]
                except:
                    pass
                try:
                    r2 = gl.nondet.web.get("https://api.github.com/users/" + handle + "/repos?sort=updated&per_page=10")
                    repos_data = r2.body.decode("utf-8")[:2000]
                except:
                    pass
                if user_data:
                    return "GitHub handle: " + handle + "\nUser profile (JSON):\n" + user_data + "\nRecent repos (JSON):\n" + repos_data
                else:
                    return "GitHub URL: " + github_url + "\nNote: Could not load via GitHub API."

            gh_raw = gl.eq_principle.prompt_non_comparative(
                _get_github_input,
                task=(
                    "Score this GitHub profile for ProofScore, an on-chain reputation system. "
                    "Choose a tier for BUILD score based on real project evidence:\n"
                    "TIER 0 (score=0): No meaningful repos or commits\n"
                    "TIER 1 (score=40): 1-3 repos, mostly forks/tutorials, or profile not accessible\n"
                    "TIER 2 (score=80): 4-10 repos, some real projects, regular commits\n"
                    "TIER 3 (score=120): 10-20 repos, clear builder, consistent activity\n"
                    "TIER 4 (score=160): 20+ repos or notable projects, strong technical depth\n"
                    "TIER 5 (score=200): Exceptional - major open source, industry impact\n"
                    "Reply ONLY with valid JSON."
                ),
                criteria=(
                    "Validate format only - do NOT evaluate whether the score is appropriate. "
                    "Accept if: (1) valid JSON object, (2) score is exactly one of: 0, 40, 80, 120, 160, 200, "
                    "(3) reasoning is a non-empty string. No semantic evaluation."
                ),
            )
            try:
                d = _safe_json(gh_raw)
                b = _tier(int(d.get("score", 40)))
                b_r = str(d.get("reasoning", "GitHub scored."))
            except:
                b, b_r = 40, "GitHub score parsed."

        # ── VOICE (Twitter/X) ─────────────────────────────────────────────────
        v, v_r = 0, "No Twitter/X provided."
        if has_tw:
            handle = twitter_url.rstrip("/").split("/")[-1].lstrip("@")

            def _get_twitter_input() -> str:
                try:
                    r = gl.nondet.web.get(twitter_url)
                    content = r.body.decode("utf-8")[:2000]
                except:
                    content = ""
                if len(content) > 200:
                    return "Twitter/X URL: " + twitter_url + "\n\nContent:\n" + content
                else:
                    return (
                        "Twitter/X URL: " + twitter_url + " (handle: @" + handle + ")\n"
                        "Note: Profile could not be scraped (access blocked).\n"
                        "Evaluate based on URL/handle alone."
                    )

            tw_raw = gl.eq_principle.prompt_non_comparative(
                _get_twitter_input,
                task=(
                    "Score this Twitter/X profile for ProofScore. "
                    "Choose a tier for VOICE score:\n"
                    "TIER 0 (score=0): Spam, fake, or clearly inactive account\n"
                    "TIER 1 (score=40): Real handle, profile blocked or not accessible - assign this if unsure\n"
                    "TIER 2 (score=80): Regular tweets, some professional relevance\n"
                    "TIER 3 (score=120): Clear domain expertise, consistent professional content\n"
                    "TIER 4 (score=160): Strong thought leadership, significant following\n"
                    "TIER 5 (score=200): Top-tier voice, major industry influence\n"
                    "If profile is blocked/inaccessible, assign TIER 1 (score=40). "
                    "Reply ONLY with valid JSON."
                ),
                criteria=(
                    "Validate format only - do NOT evaluate whether the score is appropriate. "
                    "Accept if: (1) valid JSON object, (2) score is exactly one of: 0, 40, 80, 120, 160, 200, "
                    "(3) reasoning is a non-empty string. No semantic evaluation."
                ),
            )
            try:
                d = _safe_json(tw_raw)
                v = _tier(int(d.get("score", 40)))
                v_r = str(d.get("reasoning", "Twitter scored."))
            except:
                v, v_r = 40, "Twitter score parsed."

        # ── CRAFT (Portfolio) ─────────────────────────────────────────────────
        c, c_r = 0, "No portfolio provided."
        if has_po:
            def _get_portfolio_input() -> str:
                try:
                    r = gl.nondet.web.get(portfolio_url)
                    content = r.body.decode("utf-8")[:3000]
                except:
                    content = ""
                if len(content) > 100:
                    return "Portfolio URL: " + portfolio_url + "\n\nContent:\n" + content
                else:
                    return (
                        "Portfolio URL: " + portfolio_url + "\n"
                        "Note: Content could not be loaded. Evaluate based on URL alone."
                    )

            po_raw = gl.eq_principle.prompt_non_comparative(
                _get_portfolio_input,
                task=(
                    "Score this portfolio for ProofScore. Accepts any professional work: "
                    "websites, Behance, Medium, GitHub Pages, npm packages, apps.\n"
                    "Choose a tier for CRAFT score:\n"
                    "TIER 0 (score=0): Broken, empty, or not real work\n"
                    "TIER 1 (score=40): Minimal/inaccessible - assign if URL couldn't load\n"
                    "TIER 2 (score=80): Real work, decent quality\n"
                    "TIER 3 (score=120): Good portfolio, clear skills, evidence of impact\n"
                    "TIER 4 (score=160): Professional-grade, strong presentation\n"
                    "TIER 5 (score=200): Exceptional, industry-recognized\n"
                    "Reply ONLY with valid JSON."
                ),
                criteria=(
                    "Validate format only - do NOT evaluate whether the score is appropriate. "
                    "Accept if: (1) valid JSON object, (2) score is exactly one of: 0, 40, 80, 120, 160, 200, "
                    "(3) reasoning is a non-empty string. No semantic evaluation."
                ),
            )
            try:
                d = _safe_json(po_raw)
                c = _tier(int(d.get("score", 40)))
                c_r = str(d.get("reasoning", "Portfolio scored."))
            except:
                c, c_r = 40, "Portfolio score parsed."

        # ── NETWORK (On-chain) ────────────────────────────────────────────────
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
                "GenLayer Bradbury explorer:\n" + (bradbury_content if bradbury_content else "No data") + "\n"
                "Ethereum Etherscan:\n" + (eth_content if eth_content else "No data")
            )

        net_raw = gl.eq_principle.prompt_non_comparative(
            _get_network_input,
            task=(
                "Score this wallet's on-chain history for ProofScore.\n"
                "Choose a tier for NETWORK score:\n"
                "TIER 1 (score=40): Valid wallet, no on-chain history (default for new wallets)\n"
                "TIER 2 (score=80): Some activity (1-20 transactions)\n"
                "TIER 3 (score=120): Moderate (20-100 transactions, some protocols)\n"
                "TIER 4 (score=160): Active (100+ transactions, multiple protocols)\n"
                "TIER 5 (score=200): Power user (DeFi, NFT, extensive activity)\n"
                "Minimum score is 40 (valid wallet exists). Reply ONLY with valid JSON."
            ),
            criteria=(
                "Validate format only - do NOT evaluate whether the score is appropriate. "
                "Accept if: (1) valid JSON object, (2) score is exactly one of: 40, 80, 120, 160, 200, "
                "(3) reasoning is a non-empty string. No semantic evaluation."
            ),
        )
        try:
            d = _safe_json(net_raw)
            n = _tier(max(40, int(d.get("score", 40))))
            n_r = str(d.get("reasoning", "Network scored."))
        except:
            n, n_r = 40, "Network score parsed."

        # ── CONSISTENCY ───────────────────────────────────────────────────────
        platform_count = sum([has_gh, has_tw, has_po])

        def _get_consistency_input() -> str:
            parts = []
            if has_gh:
                parts.append("GitHub: " + github_url + " (build score=" + str(b) + "/200)")
            if has_tw:
                parts.append("Twitter: " + twitter_url + " (voice score=" + str(v) + "/200)")
            if has_po:
                parts.append("Portfolio: " + portfolio_url + " (craft score=" + str(c) + "/200)")
            return (
                "Platforms submitted (" + str(platform_count) + " total):\n" +
                "\n".join(parts)
            )

        con_raw = gl.eq_principle.prompt_non_comparative(
            _get_consistency_input,
            task=(
                "Evaluate cross-platform CONSISTENCY for ProofScore. "
                "Do these platforms appear to belong to the same professional?\n"
                "Choose a tier:\n"
                "TIER 0 (score=0): Platforms clearly contradict or are unrelated\n"
                "TIER 1 (score=40): Same person likely, minimal professional alignment\n"
                "TIER 2 (score=80): Clear same person, skills somewhat aligned\n"
                "TIER 3 (score=120): Good alignment, professional identity cohesive\n"
                "TIER 4 (score=160): Strong alignment, platforms reinforce each other\n"
                "TIER 5 (score=200): Perfect coherence across all platforms\n"
                "Note: With only 1 platform max score is TIER 2 (80). "
                "With 2 platforms max score is TIER 3 (120). "
                "Reply ONLY with valid JSON."
            ),
            criteria=(
                "Validate format only - do NOT evaluate whether the score is appropriate. "
                "Accept if: (1) valid JSON object, (2) score is exactly one of: 0, 40, 80, 120, 160, 200, "
                "(3) reasoning is a non-empty string. No semantic evaluation."
            ),
        )
        try:
            d = _safe_json(con_raw)
            x = _tier(int(d.get("score", 80)))
            # Apply platform caps
            if platform_count <= 1:
                x = min(x, 80)
            elif platform_count == 2:
                x = min(x, 120)
            x_r = str(d.get("reasoning", "Consistency scored."))
        except:
            x, x_r = 80, "Consistency score parsed."
            if platform_count <= 1:
                x = 40

        # ── Store results ─────────────────────────────────────────────────────
        total = b + v + c + n + x

        reasoning = (
            "BUILD(" + str(b) + "): " + b_r + " | " +
            "VOICE(" + str(v) + "): " + v_r + " | " +
            "CRAFT(" + str(c) + "): " + c_r + " | " +
            "NETWORK(" + str(n) + "): " + n_r + " | " +
            "CONSISTENCY(" + str(x) + "): " + x_r
        ).replace('"', "'")

        uc = "1"
        if existing_raw is not None:
            try:
                ex = json.loads(existing_raw)
                uc = str(int(ex.get("update_count", "0")) + 1)
            except:
                uc = "2"

        data = (
            '{"build_score":"' + str(b) + '",'
            '"consistency_score":"' + str(x) + '",'
            '"craft_score":"' + str(c) + '",'
            '"github_url":"' + (github_url if has_gh else "none") + '",'
            '"last_updated":"' + now_str + '",'
            '"network_score":"' + str(n) + '",'
            '"portfolio_url":"' + (portfolio_url if has_po else "none") + '",'
            '"reasoning":"' + reasoning + '",'
            '"total_score":"' + str(total) + '",'
            '"twitter_url":"' + (twitter_url if has_tw else "none") + '",'
            '"update_count":"' + uc + '",'
            '"voice_score":"' + str(v) + '"}'
        )

        self.scores[address] = data
        self.usernames[address] = username

        if uc == "1":
            try:
                self.total_profiles = str(int(self.total_profiles) + 1)
            except:
                self.total_profiles = "1"

        entry = (
            '{"address":"' + address + '",'
            '"build_score":"' + str(b) + '",'
            '"consistency_score":"' + str(x) + '",'
            '"craft_score":"' + str(c) + '",'
            '"network_score":"' + str(n) + '",'
            '"total_score":"' + str(total) + '",'
            '"username":"' + username.replace('"', "'") + '",'
            '"voice_score":"' + str(v) + '"}'
        )
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
        for i in range(len(self.leaderboard)):
            try:
                e = json.loads(self.leaderboard[i])
                if int(e.get("total_score", "0")) < total:
                    self.leaderboard.insert(i, entry)
                    inserted = True
                    break
            except:
                pass
        if not inserted:
            self.leaderboard.append(entry)
        while len(self.leaderboard) > 50:
            self.leaderboard.pop(len(self.leaderboard) - 1)

    @gl.public.view
    def get_score(self, address: str) -> str:
        raw = self.scores.get(address, None)
        if raw is None:
            return json.dumps({
                "exists": "false", "address": address,
                "total_score": "0", "build_score": "0", "voice_score": "0",
                "craft_score": "0", "network_score": "0", "consistency_score": "0",
                "reasoning": "", "github_url": "none", "twitter_url": "none",
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
        })

    @gl.public.view
    def has_score(self, address: str) -> str:
        return "true" if self.scores.get(address, None) is not None else "false"
