"""
FastAPI Service & APScheduler Orchestrator for Raspberry Pi Hermes News Intelligence.
- Exposes JSON and RSS 2.0 XML feeds on a configurable LAN port.
- Runs scheduled background collectors with rate-limit compliance.
- Selectively summarizes high-priority corroborated stories via M1 Mac Ollama LAN API.
"""
import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from xml.sax.saxutils import escape

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import Depends, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import desc, or_
from sqlalchemy.orm import Session

from collectors import cluster_and_persist_articles, collect_connector
from database import Article, CollectorHealth, SessionLocal, init_db
from intelligence import OllamaClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("hermes.api")

CONFIG_PATH = os.environ.get(
    "HERMES_CONFIG_PATH",
    os.path.join(os.path.dirname(__file__), "config.json"),
)


def load_config() -> Dict[str, Any]:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    if os.environ.get("OLLAMA_BASE_URL"):
        cfg.setdefault("ollama", {})["base_url"] = os.environ["OLLAMA_BASE_URL"]
    return cfg


CONFIG = load_config()
ollama_client = OllamaClient(CONFIG)
scheduler = AsyncIOScheduler()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


async def run_all_collectors(target_connector_id: Optional[str] = None) -> Dict[str, Any]:
    db = SessionLocal()
    total_inserted = 0
    try:
        connectors = CONFIG.get("connectors", [])
        for conn in connectors:
            if not conn.get("enabled", True):
                continue
            if target_connector_id and conn["id"] != target_connector_id:
                continue

            start_t = time.monotonic()
            health = db.query(CollectorHealth).filter_by(connector_id=conn["id"]).first()
            if not health:
                health = CollectorHealth(connector_id=conn["id"], name=conn["name"])
                db.add(health)
            health.status = "running"
            health.last_run_at = datetime.now(timezone.utc)
            db.commit()

            try:
                items = await collect_connector(conn, CONFIG)
                inserted = cluster_and_persist_articles(db, items, CONFIG)
                total_inserted += inserted
                health.status = "healthy"
                health.last_success_at = datetime.now(timezone.utc)
                health.articles_fetched_last = len(items)
                health.articles_inserted_last = inserted
                health.consecutive_failures = 0
                health.last_error = None
                health.latency_ms = int((time.monotonic() - start_t) * 1000)
                db.commit()
            except Exception as exc:
                health.status = "degraded"
                health.consecutive_failures = (health.consecutive_failures or 0) + 1
                health.last_error = str(exc)[:300]
                health.latency_ms = int((time.monotonic() - start_t) * 1000)
                db.commit()
                logger.warning("Connector %s error: %s", conn["id"], exc)

            await asyncio.sleep(float(CONFIG.get("retry_policy", {}).get("rate_limit_delay_seconds", 1.0)))

        # Selective M1 Ollama inference for top corroborated/high-priority stories only
        await run_selective_ollama_summaries(db)
    finally:
        db.close()
    return {"inserted": total_inserted, "timestamp": datetime.now(timezone.utc).isoformat()}


async def run_selective_ollama_summaries(db: Session) -> None:
    model = await ollama_client.discover_model()
    if not ollama_client.is_online or not model:
        return
    min_score = float(CONFIG.get("ollama", {}).get("min_score_for_inference", 65))
    max_batch = int(CONFIG.get("ollama", {}).get("max_articles_per_cycle", 5))

    candidates: List[Article] = (
        db.query(Article)
        .filter(
            Article.breaking_score >= min_score,
            Article.ai_model_used == "local-extractive-engine",
        )
        .order_by(desc(Article.corroboration_count), desc(Article.breaking_score))
        .limit(max_batch)
        .all()
    )
    for art in candidates:
        summary, used_model = await ollama_client.summarize_story(
            art.headline, art.description or "", [art.publisher]
        )
        art.ai_summary = summary
        art.ai_model_used = used_model
        db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    scheduler.add_job(run_all_collectors, "interval", minutes=12, id="hermes_master_collector", replace_existing=True)
    scheduler.start()
    asyncio.create_task(run_all_collectors())
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(
    title="Hermes Global News Intelligence API",
    version="2.0.0",
    description="Free local global news aggregator and M1 Ollama intelligence engine for Raspberry Pi.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ArticleStatePatch(BaseModel):
    is_read: Optional[bool] = None
    is_bookmarked: Optional[bool] = None


@app.get("/api/health")
async def health_check(db: Session = Depends(get_db)):
    await ollama_client.discover_model()
    total_articles = db.query(Article).count()
    collectors = db.query(CollectorHealth).all()
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "database": {
            "engine": "SQLite3 (WAL Mode)",
            "total_articles": total_articles,
        },
        "ollama": {
            "base_url": ollama_client.base_url,
            "online": ollama_client.is_online,
            "discovered_model": ollama_client.discovered_model,
            "available_models": ollama_client.available_models,
            "last_error": ollama_client.last_error,
        },
        "collectors": [
            {
                "connector_id": c.connector_id,
                "name": c.name,
                "status": c.status,
                "last_run_at": c.last_run_at.isoformat() if c.last_run_at else None,
                "articles_fetched_last": c.articles_fetched_last,
                "articles_inserted_last": c.articles_inserted_last,
                "latency_ms": c.latency_ms,
                "last_error": c.last_error,
            }
            for c in collectors
        ],
    }


@app.get("/api/articles")
def list_articles(
    category: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    bookmarked: Optional[bool] = Query(None),
    unread_only: Optional[bool] = Query(None),
    breaking_only: Optional[bool] = Query(None),
    limit: int = Query(80, ge=1, le=250),
    db: Session = Depends(get_db),
):
    query = db.query(Article)
    if category and category not in ("all", "top"):
        query = query.filter(Article.category == category)
    if bookmarked is True:
        query = query.filter(Article.is_bookmarked.is_(True))
    if unread_only is True:
        query = query.filter(Article.is_read.is_(False))
    if breaking_only is True:
        query = query.filter(Article.breaking_score >= 70.0)
    if q:
        pattern = f"%{q.strip()}%"
        query = query.filter(
            or_(
                Article.headline.ilike(pattern),
                Article.description.ilike(pattern),
                Article.publisher.ilike(pattern),
            )
        )
    if category == "top":
        rows = query.order_by(desc(Article.relevance_score), desc(Article.breaking_score), desc(Article.published_at)).limit(limit).all()
    else:
        rows = query.order_by(desc(Article.published_at), desc(Article.breaking_score)).limit(limit).all()

    return {
        "count": len(rows),
        "articles": [
            {
                "article_id": r.article_id,
                "headline": r.headline,
                "publisher": r.publisher,
                "connector_id": r.connector_id,
                "url": r.url,
                "published_at": r.published_at.isoformat(),
                "collected_at": r.collected_at.isoformat(),
                "category": r.category,
                "language": r.language,
                "description": r.description,
                "breaking_score": r.breaking_score,
                "relevance_score": r.relevance_score,
                "corroboration_count": r.corroboration_count,
                "cluster_id": r.cluster_id,
                "cluster_title": r.cluster_title,
                "is_significant_event": r.is_significant_event,
                "ai_summary": r.ai_summary,
                "ai_model_used": r.ai_model_used,
                "is_read": r.is_read,
                "is_bookmarked": r.is_bookmarked,
            }
            for r in rows
        ],
    }


@app.patch("/api/articles/{article_id}/state")
def update_article_state(article_id: str, patch: ArticleStatePatch, db: Session = Depends(get_db)):
    art = db.query(Article).filter_by(article_id=article_id).first()
    if not art:
        raise HTTPException(status_code=404, detail="Article not found")
    if patch.is_read is not None:
        art.is_read = patch.is_read
    if patch.is_bookmarked is not None:
        art.is_bookmarked = patch.is_bookmarked
    db.commit()
    return {"article_id": art.article_id, "is_read": art.is_read, "is_bookmarked": art.is_bookmarked}


@app.post("/api/collect")
async def trigger_collection(connector_id: Optional[str] = None):
    result = await run_all_collectors(target_connector_id=connector_id)
    return result


@app.get("/api/feed.rss")
def rss_output(category: Optional[str] = Query(None), db: Session = Depends(get_db)):
    query = db.query(Article)
    if category and category != "all":
        query = query.filter(Article.category == category)
    articles = query.order_by(desc(Article.published_at)).limit(50).all()

    items_xml = []
    for a in articles:
        items_xml.append(
            f"""    <item>
      <guid isPermaLink="false">{escape(a.article_id)}</guid>
      <title>{escape(a.headline)}</title>
      <link>{escape(a.url)}</link>
      <dc:creator>{escape(a.publisher)}</dc:creator>
      <category>{escape(a.category)}</category>
      <pubDate>{a.published_at.strftime('%a, %d %b %Y %H:%M:%S +0000')}</pubDate>
      <description>{escape(a.ai_summary or a.description or '')}</description>
    </item>"""
        )

    rss_doc = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Hermes Global News Intelligence Feed</title>
    <link>http://127.0.0.1:8088</link>
    <description>Local corroborated global news intelligence from Raspberry Pi and M1 Ollama</description>
    <lastBuildDate>{datetime.now(timezone.utc).strftime('%a, %d %b %Y %H:%M:%S +0000')}</lastBuildDate>
{chr(10).join(items_xml)}
  </channel>
</rss>"""
    return Response(content=rss_doc, media_type="application/rss+xml")


if __name__ == "__main__":
    import uvicorn
    svc = CONFIG.get("service", {})
    host = os.environ.get("HERMES_HOST", svc.get("lan_host", "127.0.0.1"))
    port = int(os.environ.get("HERMES_PORT", svc.get("lan_port", 8088)))
    uvicorn.run("main:app", host=host, port=port, reload=False)
