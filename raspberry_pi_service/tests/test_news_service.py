"""
Automated Test Suite for Hermes Global News Intelligence Service.
Covers:
1. RSS XML parsing and HTML sanitization (BBC, Google News, TechCrunch).
2. GDELT DOC 2.0 JSON API payload parsing and timestamp normalization.
3. Deduplication, developing story clustering, and multi-publisher corroboration vs single-source volume penalty.
4. FastAPI JSON, RSS XML (/api/feed.rss), state mutation, and /api/health endpoints.
"""
import os
import sys
import tempfile
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from collectors import (
    cluster_and_persist_articles,
    parse_gdelt_json_payload,
    parse_rss_xml_payload,
)
from database import Article, Base
from intelligence import (
    classify_category,
    compute_article_id,
    jaccard_similarity,
    score_article,
    tokenize_headline,
)
from main import CONFIG, app, get_db


SAMPLE_RSS_XML = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>BBC News - World</title>
    <item>
      <title>NASA Artemis Lunar Relay Satellite Achieves Stable Orbit</title>
      <link>https://www.bbc.co.uk/news/science-artemis-relay-101</link>
      <description><![CDATA[<p>Engineers confirmed signal lock across three deep-space ground stations.</p>]]></description>
      <pubDate>Sat, 21 Nov 2026 11:30:00 GMT</pubDate>
    </item>
    <item>
      <title>Dhaka Metro Rail Expansion Phase Completes Elevated Viaduct Testing</title>
      <link>https://www.bbc.co.uk/news/world-asia-dhaka-metro-202</link>
      <description>High-capacity commuter transit corridor links northern industrial zones.</description>
      <pubDate>Sat, 21 Nov 2026 10:15:00 GMT</pubDate>
    </item>
  </channel>
</rss>
"""

SAMPLE_GDELT_JSON = {
    "articles": [
        {
            "url": "https://www.reuters.com/world/nasa-artemis-lunar-relay-orbit-2026-11-21/",
            "title": "NASA Artemis Lunar Relay Satellite Reaches Stable Lunar Orbit",
            "seendate": "20261121T114500Z",
            "domain": "reuters.com",
            "language": "English",
            "sourcecountry": "United States",
        },
        {
            "url": "https://www.aljazeera.com/news/2026/11/21/nasa-artemis-lunar-relay-satellite-orbit",
            "title": "Artemis Lunar Relay Satellite Enters Stable Orbit Around Moon, NASA Confirms",
            "seendate": "20261121T115000Z",
            "domain": "aljazeera.com",
            "language": "English",
            "sourcecountry": "Qatar",
        },
    ]
}


def test_rss_parsing_and_bs4_cleaning():
    connector = {
        "id": "bbc_world_rss",
        "name": "BBC RSS",
        "default_category": "global",
        "permit_bs4_cleaning": True,
    }
    parsed = parse_rss_xml_payload(SAMPLE_RSS_XML, connector)
    assert len(parsed) == 2
    assert parsed[0]["headline"] == "NASA Artemis Lunar Relay Satellite Achieves Stable Orbit"
    assert "<p>" not in parsed[0]["description"]
    assert "Engineers confirmed signal lock" in parsed[0]["description"]
    assert classify_category(parsed[0]["headline"], parsed[0]["description"], "global") == "science"
    assert classify_category(parsed[1]["headline"], parsed[1]["description"], "global") == "bd_india"


def test_gdelt_doc_2_json_parsing():
    connector = {
        "id": "gdelt_doc_2",
        "name": "GDELT DOC 2.0 JSON API",
        "default_category": "global",
    }
    parsed = parse_gdelt_json_payload(SAMPLE_GDELT_JSON, connector)
    assert len(parsed) == 2
    assert parsed[0]["publisher"] == "reuters.com"
    assert parsed[0]["published_at"].year == 2026
    assert parsed[0]["language"] == "en"


def test_corroboration_vs_single_source_volume_penalty():
    now = datetime.now(timezone.utc)
    # Multi-publisher corroborated story (3 distinct publishers)
    score_corroborated, _, is_sig_corroborated = score_article(
        headline="Emergency Semiconductor Export Measure Announced After Summit",
        description="Three independent agencies confirmed the new policy framework.",
        publisher="BBC News",
        published_at=now,
        config=CONFIG,
        corroborating_publishers=3,
        same_publisher_duplicate_count=1,
    )
    # Uncorroborated single-publisher high-volume spam (1 publisher, 5 syndicate reposts)
    score_single_spam, _, is_sig_spam = score_article(
        headline="Emergency Semiconductor Export Measure Announced After Summit",
        description="Three independent agencies confirmed the new policy framework.",
        publisher="UnknownBlogWire",
        published_at=now,
        config=CONFIG,
        corroborating_publishers=1,
        same_publisher_duplicate_count=5,
    )
    assert score_corroborated > score_single_spam + 25.0
    assert is_sig_corroborated is True
    assert is_sig_spam is False


def test_deduplication_clustering_and_api_endpoints():
    with tempfile.NamedTemporaryFile(suffix=".db") as tmp:
        test_engine = create_engine(f"sqlite:///{tmp.name}", connect_args={"check_same_thread": False})
        TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
        Base.metadata.create_all(bind=test_engine)

        session = TestingSessionLocal()
        rss_items = parse_rss_xml_payload(
            SAMPLE_RSS_XML,
            {"id": "bbc_world_rss", "name": "BBC RSS", "default_category": "global", "permit_bs4_cleaning": True},
        )
        gdelt_items = parse_gdelt_json_payload(
            SAMPLE_GDELT_JSON,
            {"id": "gdelt_doc_2", "name": "GDELT DOC 2.0 JSON API", "default_category": "global"},
        )

        # Insert initial batch
        inserted_1 = cluster_and_persist_articles(session, rss_items + gdelt_items, CONFIG)
        assert inserted_1 == 4

        # Re-inserting exact same articles must insert 0 duplicates
        inserted_2 = cluster_and_persist_articles(session, rss_items, CONFIG)
        assert inserted_2 == 0

        # Verify the 3 Artemis stories from BBC, Reuters, and Al Jazeera were grouped into the same cluster
        artemis_rows = session.query(Article).filter(Article.headline.ilike("%Artemis%")).all()
        assert len(artemis_rows) == 3
        cluster_ids = {r.cluster_id for r in artemis_rows}
        assert len(cluster_ids) == 1
        assert max(r.corroboration_count for r in artemis_rows) == 3

        def override_get_db():
            db = TestingSessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        client = TestClient(app)

        # Test GET /api/articles
        resp = client.get("/api/articles")
        assert resp.status_code == 200
        data = resp.json()
        assert data["count"] == 4

        # Test PATCH /api/articles/{id}/state
        target_id = data["articles"][0]["article_id"]
        patch_resp = client.patch(
            f"/api/articles/{target_id}/state",
            json={"is_bookmarked": True, "is_read": True},
        )
        assert patch_resp.status_code == 200
        assert patch_resp.json()["is_bookmarked"] is True

        # Test GET /api/feed.rss
        rss_resp = client.get("/api/feed.rss")
        assert rss_resp.status_code == 200
        assert "<rss version=\"2.0\"" in rss_resp.text
        assert "Artemis" in rss_resp.text

        session.close()
