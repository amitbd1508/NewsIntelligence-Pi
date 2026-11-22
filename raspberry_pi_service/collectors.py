"""
11 Independent News Connectors for Raspberry Pi Hermes Service:
1. GDELT DOC 2.0 JSON API
2. Google News RSS
3. BBC RSS
4. Al Jazeera RSS
5. NPR RSS
6. DW RSS
7. TechCrunch RSS
8. Ars Technica RSS
9. NDTV RSS
10. Times of India RSS
11. NASA and UN News RSS

Features:
- Retry with exponential backoff
- Rate limit courtesy delays and custom User-Agent
- BeautifulSoup4 HTML snippet sanitization only where permitted by connector policy
- Duplicate URL and normalized fingerprint deduplication
"""
import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import feedparser
import httpx
from bs4 import BeautifulSoup
from dateutil import parser as date_parser

from database import Article, CollectorHealth
from intelligence import (
    OllamaClient,
    build_extractive_summary,
    classify_category,
    compute_article_id,
    compute_fingerprint,
    jaccard_similarity,
    score_article,
    tokenize_headline,
)

logger = logging.getLogger("hermes.collectors")

USER_AGENT = "HermesNewsIntelligence/2.0 (RaspberryPi-Local; +http://localhost:8088)"


def sanitize_snippet(raw_html: Optional[str], permit_bs4: bool = True) -> str:
    if not raw_html:
        return ""
    if not permit_bs4:
        return raw_html.strip()[:600]
    soup = BeautifulSoup(raw_html, "html.parser")
    text = soup.get_text(separator=" ", strip=True)
    return text[:600]


def parse_timestamp(raw_date: Optional[str]) -> datetime:
    if not raw_date:
        return datetime.now(timezone.utc)
    try:
        # GDELT compact format e.g. 20261121T120000Z
        if len(raw_date) == 16 and raw_date.endswith("Z") and "T" in raw_date:
            dt = datetime.strptime(raw_date, "%Y%m%dT%H%M%SZ")
            return dt.replace(tzinfo=timezone.utc)
        dt = date_parser.parse(raw_date)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


async def fetch_with_backoff(
    client: httpx.AsyncClient,
    url: str,
    max_attempts: int = 3,
    base_backoff: float = 1.5,
    max_backoff: float = 15.0,
) -> httpx.Response:
    last_exc: Optional[Exception] = None
    for attempt in range(1, max_attempts + 1):
        try:
            resp = await client.get(
                url,
                headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/xml, application/json, text/xml, */*"},
                follow_redirects=True,
            )
            if resp.status_code == 429:
                wait = min(max_backoff, base_backoff * (2 ** attempt))
                logger.warning("Rate limited (429) on %s, backing off %.1fs", url, wait)
                await asyncio.sleep(wait)
                continue
            resp.raise_for_status()
            return resp
        except Exception as exc:
            last_exc = exc
            if attempt < max_attempts:
                wait = min(max_backoff, base_backoff * (2 ** (attempt - 1)))
                logger.warning("Attempt %d/%d failed for %s: %s. Retrying in %.1fs", attempt, max_attempts, url, exc, wait)
                await asyncio.sleep(wait)
    raise RuntimeError(f"Failed to fetch {url} after {max_attempts} attempts: {last_exc}")


def parse_gdelt_json_payload(payload: Dict[str, Any], connector: Dict[str, Any]) -> List[Dict[str, Any]]:
    articles_raw = payload.get("articles", [])
    parsed: List[Dict[str, Any]] = []
    for item in articles_raw:
        title = (item.get("title") or "").strip()
        url = (item.get("url") or "").strip()
        if not title or not url:
            continue
        domain = (item.get("domain") or "GDELT Global Wire").strip()
        seendate = item.get("seendate")
        language = (item.get("language") or "English")[:2].lower()
        source_country = item.get("sourcecountry") or ""
        snippet = f"Source domain: {domain}" + (f" ({source_country})" if source_country else "")
        parsed.append({
            "headline": title,
            "url": url,
            "publisher": domain,
            "connector_id": connector["id"],
            "published_at": parse_timestamp(seendate),
            "language": language or "en",
            "description": snippet,
            "default_category": connector.get("default_category", "global"),
        })
    return parsed


def parse_rss_xml_payload(xml_text: str, connector: Dict[str, Any], source_override: Optional[str] = None) -> List[Dict[str, Any]]:
    feed = feedparser.parse(xml_text)
    feed_title = source_override or feed.feed.get("title") or connector["name"].replace(" RSS", "")
    permit_bs4 = bool(connector.get("permit_bs4_cleaning", True))
    parsed: List[Dict[str, Any]] = []

    for entry in feed.entries[:30]:
        title = (entry.get("title") or "").strip()
        link = (entry.get("link") or "").strip()
        if not title or not link:
            continue
        publisher = feed_title
        if "source" in entry and isinstance(entry.source, dict) and entry.source.get("title"):
            publisher = entry.source.get("title")
        elif " - " in title and connector["id"] == "google_news_rss":
            parts = title.rsplit(" - ", 1)
            if len(parts) == 2 and len(parts[1]) < 45:
                title, publisher = parts[0].strip(), parts[1].strip()

        raw_summary = entry.get("summary") or entry.get("description") or ""
        clean_desc = sanitize_snippet(raw_summary, permit_bs4=permit_bs4)
        pub_date = entry.get("published") or entry.get("updated") or ""

        parsed.append({
            "headline": title,
            "url": link,
            "publisher": publisher[:120],
            "connector_id": connector["id"],
            "published_at": parse_timestamp(pub_date),
            "language": "en",
            "description": clean_desc,
            "default_category": connector.get("default_category", "global"),
        })
    return parsed


async def collect_connector(
    connector: Dict[str, Any],
    config: Dict[str, Any],
) -> List[Dict[str, Any]]:
    retry_cfg = config.get("retry_policy", {})
    max_attempts = int(retry_cfg.get("max_attempts", 3))
    base_backoff = float(retry_cfg.get("base_backoff_seconds", 1.5))
    max_backoff = float(retry_cfg.get("max_backoff_seconds", 15.0))

    async with httpx.AsyncClient(timeout=15.0) as client:
        ctype = connector.get("type", "rss")
        if ctype == "gdelt_json":
            resp = await fetch_with_backoff(client, connector["url"], max_attempts, base_backoff, max_backoff)
            return parse_gdelt_json_payload(resp.json(), connector)
        elif ctype == "multi_rss":
            combined: List[Dict[str, Any]] = []
            for url in connector.get("urls", []):
                label = "NASA" if "nasa.gov" in url else "UN News"
                resp = await fetch_with_backoff(client, url, max_attempts, base_backoff, max_backoff)
                combined.extend(parse_rss_xml_payload(resp.text, connector, source_override=label))
                await asyncio.sleep(0.5)
            return combined
        else:
            resp = await fetch_with_backoff(client, connector["url"], max_attempts, base_backoff, max_backoff)
            return parse_rss_xml_payload(resp.text, connector)


def cluster_and_persist_articles(
    session,
    raw_items: List[Dict[str, Any]],
    config: Dict[str, Any],
) -> int:
    """
    Deduplicate by URL & headline fingerprint, group related stories into developing clusters,
    compute breaking and corroboration scores, and persist new rows.
    """
    existing_articles: List[Article] = (
        session.query(Article)
        .order_by(Article.published_at.desc())
        .limit(400)
        .all()
    )
    existing_urls = {a.url for a in existing_articles}
    existing_ids = {a.article_id for a in existing_articles}

    inserted_count = 0
    for item in raw_items:
        url = item["url"].strip()
        headline = item["headline"].strip()
        art_id = compute_article_id(url, headline)
        if url in existing_urls or art_id in existing_ids:
            continue

        tokens = tokenize_headline(headline)
        fingerprint = compute_fingerprint(headline)

        # Look for matching story cluster across existing articles
        matched_cluster_id: Optional[str] = None
        matched_cluster_title: Optional[str] = None
        cluster_publishers = {item["publisher"].lower()}
        same_pub_count = 1

        for existing in existing_articles:
            sim = jaccard_similarity(tokens, tokenize_headline(existing.headline))
            if sim >= 0.36 or existing.normalized_fingerprint == fingerprint:
                matched_cluster_id = existing.cluster_id or f"cluster-{existing.article_id[:10]}"
                matched_cluster_title = existing.cluster_title or existing.headline
                cluster_publishers.add(existing.publisher.lower())
                if existing.publisher.lower() == item["publisher"].lower():
                    same_pub_count += 1

        if not matched_cluster_id:
            matched_cluster_id = f"cluster-{art_id[:10]}"
            matched_cluster_title = headline

        corroboration_count = len(cluster_publishers)
        category = classify_category(headline, item.get("description", ""), item["default_category"])
        breaking_score, relevance_score, is_significant = score_article(
            headline=headline,
            description=item.get("description", ""),
            publisher=item["publisher"],
            published_at=item["published_at"],
            config=config,
            corroborating_publishers=corroboration_count,
            same_publisher_duplicate_count=same_pub_count,
        )

        new_article = Article(
            article_id=art_id,
            headline=headline,
            publisher=item["publisher"],
            connector_id=item["connector_id"],
            url=url,
            published_at=item["published_at"],
            collected_at=datetime.now(timezone.utc),
            category=category,
            language=item.get("language", "en"),
            description=item.get("description", ""),
            breaking_score=breaking_score,
            relevance_score=relevance_score,
            corroboration_count=corroboration_count,
            cluster_id=matched_cluster_id,
            cluster_title=matched_cluster_title,
            is_significant_event=is_significant,
            ai_summary=build_extractive_summary(headline, item.get("description", ""), corroboration_count),
            ai_model_used="local-extractive-engine",
            is_read=False,
            is_bookmarked=False,
            normalized_fingerprint=fingerprint,
        )
        session.add(new_article)
        existing_articles.insert(0, new_article)
        existing_urls.add(url)
        existing_ids.add(art_id)
        inserted_count += 1

        # Update corroboration counts on sibling articles in the same cluster
        if corroboration_count > 1:
            for existing in existing_articles:
                if existing.cluster_id == matched_cluster_id:
                    existing.corroboration_count = max(existing.corroboration_count, corroboration_count)
                    if is_significant:
                        existing.is_significant_event = True

    session.commit()
    return inserted_count
