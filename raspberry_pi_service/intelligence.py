"""
Local News Intelligence, Corroboration & M1 Ollama Inference Engine.
- Prioritizes stories based on configured interests.
- Detects breaking news and developing story clusters across publishers.
- Separates verified multi-publisher corroboration from single-publisher volume noise.
- Dynamically discovers the currently running model on M1 Mac Ollama via /api/tags.
- Continues gracefully when Ollama is offline.
"""
import hashlib
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple
import httpx

logger = logging.getLogger("hermes.intelligence")

STOPWORDS: Set[str] = {
    "the", "and", "for", "that", "this", "with", "from", "after", "over",
    "into", "under", "about", "amid", "says", "said", "will", "have", "has",
    "are", "was", "were", "been", "their", "what", "when", "where", "which",
    "while", "could", "would", "should", "new", "more", "report", "reports",
    "news", "update", "live", "video", "watch", "today", "year", "years",
}

BREAKING_SIGNALS: Dict[str, int] = {
    "breaking": 22,
    "urgent": 20,
    "emergency": 18,
    "earthquake": 20,
    "ceasefire": 18,
    "summit": 12,
    "launch": 12,
    "launches": 12,
    "outage": 16,
    "Acquisition": 12,
    "sanctions": 15,
    "interest rate": 15,
    "breakthrough": 14,
    "evacuation": 18,
    "Grounded": 15,
    "collision": 18,
    "cyclone": 18,
    "floods": 16,
    "indictment": 15,
    "ruling": 13,
}

CATEGORY_RULES: List[Tuple[str, List[str]]] = [
    ("bd_india", [
        "bangladesh", "dhaka", "chittagong", "sylhet", "india", "new delhi",
        "mumbai", "bengaluru", "kolkata", "chennai", "hyderabad", "isro",
        "sensex", "nifty", "rupee", "taka", "bay of bengal"
    ]),
    ("us_texas", [
        "texas", "austin", "houston", "dallas", "san antonio", "fort worth",
        "el paso", "ercot", "boca chica", "starbase", "u.s.", "united states",
        "white house", "congress", "senate", "supreme court", "pentagon", "federal"
    ]),
    ("travel_aviation", [
        "aviation", "airline", "airlines", "boeing", "airbus", "faa", "easa",
        "airport", "flight", "flights", "airspace", "jet", "runway", "travel",
        "passenger", "cargo plane", "Biman", "IndiGo", "Air India"
    ]),
    ("ai_tech", [
        "ai", "artificial intelligence", "llm", "ollama", "openai", "gemini",
        "anthropic", "nvidia", "gpu", "semiconductor", "chip", "raspberry pi",
        "linux", "open source", "cybersecurity", "quantum", "robotics", "apple m1",
        "neural", "transformer", "cloud computing", "software"
    ]),
    ("science", [
        "nasa", "jwst", "telescope", "exoplanet", "mars", "lunar", "artemis",
        "cern", "physics", "genome", "crispr", "climate", "fusion", "astronomy",
        "spacecraft", "orbit", "researchers", "scientist", "nature", "biology"
    ]),
    ("business", [
        "market", "markets", "stocks", "treasury", "inflation", "gdp",
        "central bank", "fed", "ecb", "trade", "tariff", "earnings", "ipo",
        "oil", "commodities", "supply chain", "venture", "economy", "economic"
    ]),
]


def compute_article_id(url: str, headline: str) -> str:
    canonical_url = url.strip().split("#")[0]
    raw = f"{canonical_url}::{headline.strip().lower()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def tokenize_headline(text: str) -> Set[str]:
    cleaned = re.sub(r"[^a-zA-Z0-9\s]", " ", text.lower())
    tokens = {
        tok for tok in cleaned.split()
        if len(tok) > 2 and tok not in STOPWORDS
    }
    return tokens


def compute_fingerprint(headline: str) -> str:
    tokens = sorted(list(tokenize_headline(headline)))[:8]
    if not tokens:
        return hashlib.md5(headline.lower().encode("utf-8")).hexdigest()[:16]
    return "-".join(tokens)


def jaccard_similarity(tokens_a: Set[str], tokens_b: Set[str]) -> float:
    if not tokens_a or not tokens_b:
        return 0.0
    intersection = len(tokens_a.intersection(tokens_b))
    union = len(tokens_a.union(tokens_b))
    return intersection / union if union > 0 else 0.0


def classify_category(headline: str, description: str, default_category: str) -> str:
    combined = f"{headline} {description or ''}".lower()
    for category, keywords in CATEGORY_RULES:
        for kw in keywords:
            if re.search(rf"\b{re.escape(kw.lower())}\b", combined):
                return category
    return default_category


def score_article(
    headline: str,
    description: str,
    publisher: str,
    published_at: datetime,
    config: Dict[str, Any],
    corroborating_publishers: int = 1,
    same_publisher_duplicate_count: int = 1,
) -> Tuple[float, float, bool]:
    """
    Compute (breaking_score, relevance_score, is_significant_event).
    Crucially distinguishes multi-publisher verification from single-publisher volume spikes.
    """
    combined = f"{headline} {description or ''}".lower()
    interests: Dict[str, int] = config.get("interests", {}).get("keywords", {})
    trusted_pubs: List[str] = [
        p.lower() for p in config.get("interests", {}).get("high_trust_publishers", [])
    ]

    # 1. Interest relevance scoring
    relevance = 25.0
    for kw, weight in interests.items():
        if kw.lower() in combined:
            relevance += float(weight)

    # 2. Breaking & urgency signal scoring
    breaking = 20.0
    for signal, weight in BREAKING_SIGNALS.items():
        if signal.lower() in combined:
            breaking += float(weight)

    # 3. Recency boost
    now = datetime.now(timezone.utc)
    if published_at.tzinfo is None:
        published_at = published_at.replace(tzinfo=timezone.utc)
    age_hours = max(0.0, (now - published_at).total_seconds() / 3600.0)
    if age_hours <= 1.0:
        breaking += 22.0
    elif age_hours <= 4.0:
        breaking += 14.0
    elif age_hours <= 12.0:
        breaking += 7.0
    elif age_hours > 36.0:
        breaking -= 12.0

    # 4. Publisher trust verification
    is_trusted = any(tp in publisher.lower() for tp in trusted_pubs)
    if is_trusted:
        breaking += 8.0
        relevance += 6.0

    # 5. Corroboration vs Single-Publisher Volume Penalty
    # Multiple DISTINCT publishers reporting the same event boosts confidence.
    # High volume from the SAME single publisher is capped and damped so syndicated spam
    # is never mistaken for confirmed global importance.
    if corroborating_publishers >= 3:
        corroboration_boost = min(30.0, (corroborating_publishers - 1) * 11.0)
        breaking += corroboration_boost
        relevance += corroboration_boost * 0.7
    elif corroborating_publishers == 2:
        breaking += 12.0
        relevance += 8.0
    elif same_publisher_duplicate_count >= 3 and corroborating_publishers == 1:
        # Uncorroborated high volume from single publisher -> dampen score
        breaking = max(15.0, breaking - 14.0)

    breaking_score = round(min(99.0, max(5.0, breaking)), 1)
    relevance_score = round(min(99.0, max(10.0, relevance)), 1)
    is_significant = (corroborating_publishers >= 3) or (
        corroborating_publishers >= 2 and breaking_score >= 76.0 and is_trusted
    )
    return breaking_score, relevance_score, is_significant


def build_extractive_summary(headline: str, description: str, corroboration_count: int) -> str:
    clean_desc = (description or "").strip()
    prefix = (
        f"[Corroborated across {corroboration_count} publishers] "
        if corroboration_count >= 2
        else "[Local Extractive Brief] "
    )
    if clean_desc and len(clean_desc) > 35:
        sentences = re.split(r"(?<=[.!?])\s+", clean_desc)
        summary = " ".join(sentences[:2]).strip()
        return f"{prefix}{summary}"
    return f"{prefix}{headline}."


class OllamaClient:
    """
    LAN-accessible Ollama client for Apple M1 Mac.
    Dynamically discovers the active/installed model via /api/tags instead of hardcoding.
    """

    def __init__(self, config: Dict[str, Any]):
        ollama_cfg = config.get("ollama", {})
        self.base_url = ollama_cfg.get("base_url", "http://192.168.1.50:11434").rstrip("/")
        self.timeout = float(ollama_cfg.get("timeout_seconds", 18))
        self.discovered_model: Optional[str] = None
        self.available_models: List[str] = []
        self.is_online: bool = False
        self.last_checked: Optional[str] = None
        self.last_error: Optional[str] = None

    async def discover_model(self) -> Optional[str]:
        """Query M1 Mac Ollama /api/tags or /api/ps to discover the configured model."""
        self.last_checked = datetime.now(timezone.utc).isoformat()
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                # First check running models in memory (/api/ps)
                try:
                    ps_resp = await client.get(f"{self.base_url}/api/ps")
                    if ps_resp.status_code == 200:
                        ps_models = [
                            m.get("name") for m in ps_resp.json().get("models", []) if m.get("name")
                        ]
                        if ps_models:
                            self.discovered_model = ps_models[0]
                            self.available_models = ps_models
                            self.is_online = True
                            self.last_error = None
                            return self.discovered_model
                except Exception:
                    pass

                # Then check installed models (/api/tags)
                resp = await client.get(f"{self.base_url}/api/tags")
                resp.raise_for_status()
                data = resp.json()
                models = [
                    m.get("name") for m in data.get("models", []) if m.get("name")
                ]
                self.available_models = models
                self.is_online = True
                self.last_error = None
                if models:
                    self.discovered_model = models[0]
                    logger.info("Discovered M1 Ollama model: %s", self.discovered_model)
                    return self.discovered_model
                self.last_error = "Ollama reachable but no models pulled yet"
                return None
        except Exception as exc:
            self.is_online = False
            self.last_error = str(exc)
            logger.debug("Ollama offline or unreachable at %s: %s", self.base_url, exc)
            return None

    async def summarize_story(
        self, headline: str, description: str, publishers: List[str]
    ) -> Tuple[str, str]:
        """
        Generate concise intelligence brief via M1 Ollama if online,
        or fall back gracefully to local extractive engine.
        """
        model = self.discovered_model or await self.discover_model()
        if not self.is_online or not model:
            return (
                build_extractive_summary(headline, description, len(set(publishers))),
                "local-extractive-fallback",
            )

        prompt = (
            "You are the Hermes Global News Intelligence Engine running locally on Apple M1.\n"
            "Summarize this verified news story in 2 factual, neutral sentences without speculation.\n"
            f"Publishers reporting: {', '.join(sorted(set(publishers)))}\n"
            f"Headline: {headline}\n"
            f"Context: {description or 'No additional snippet provided.'}\n"
            "Brief:"
        )
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    f"{self.base_url}/api/generate",
                    json={
                        "model": model,
                        "prompt": prompt,
                        "stream": False,
                        "options": {"temperature": 0.2, "num_predict": 120},
                    },
                )
                resp.raise_for_status()
                text = resp.json().get("response", "").strip()
                if text:
                    return text, model
        except Exception as exc:
            self.is_online = False
            self.last_error = str(exc)
            logger.warning("Ollama generation failed, using local fallback: %s", exc)

        return (
            build_extractive_summary(headline, description, len(set(publishers))),
            "local-extractive-fallback",
        )
