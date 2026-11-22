"""
SQLite Database Initialization and Models for Hermes Global News Intelligence.
Includes composite and single-column indexes and duplicate-prevention constraints.
"""
import os
from datetime import datetime, timezone
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    event,
)
from sqlalchemy.orm import declarative_base, sessionmaker

DEFAULT_DB_PATH = os.path.expanduser("~/.hermes/data/hermes_news.db")
DB_PATH = os.path.abspath(os.path.expanduser(os.environ.get("SQLITE_DB_PATH", DEFAULT_DB_PATH)))
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 30},
    pool_pre_ping=True,
)


@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL;")
    cursor.execute("PRAGMA synchronous=NORMAL;")
    cursor.execute("PRAGMA foreign_keys=ON;")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Article(Base):
    __tablename__ = "articles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    article_id = Column(String(64), nullable=False, unique=True)
    headline = Column(String(512), nullable=False)
    publisher = Column(String(128), nullable=False)
    connector_id = Column(String(64), nullable=False)
    url = Column(String(1024), nullable=False, unique=True)
    published_at = Column(DateTime(timezone=True), nullable=False)
    collected_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    category = Column(String(64), nullable=False, default="global")
    language = Column(String(16), nullable=False, default="en")
    description = Column(Text, nullable=True)
    breaking_score = Column(Float, nullable=False, default=0.0)
    relevance_score = Column(Float, nullable=False, default=0.0)
    corroboration_count = Column(Integer, nullable=False, default=1)
    cluster_id = Column(String(64), nullable=True)
    cluster_title = Column(String(512), nullable=True)
    is_significant_event = Column(Boolean, nullable=False, default=False)
    ai_summary = Column(Text, nullable=True)
    ai_model_used = Column(String(128), nullable=True)
    is_read = Column(Boolean, nullable=False, default=False)
    is_bookmarked = Column(Boolean, nullable=False, default=False)
    normalized_fingerprint = Column(String(128), nullable=False)

    __table_args__ = (
        UniqueConstraint("url", name="uq_articles_url"),
        UniqueConstraint("article_id", name="uq_articles_article_id"),
        Index("idx_articles_published_at", "published_at"),
        Index("idx_articles_category_published", "category", "published_at"),
        Index("idx_articles_breaking_score", "breaking_score"),
        Index("idx_articles_cluster_id", "cluster_id"),
        Index("idx_articles_bookmarked_read", "is_bookmarked", "is_read"),
        Index("idx_articles_fingerprint", "normalized_fingerprint"),
    )


class CollectorHealth(Base):
    __tablename__ = "collector_health"

    connector_id = Column(String(64), primary_key=True)
    name = Column(String(128), nullable=False)
    status = Column(String(32), nullable=False, default="idle")
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    last_success_at = Column(DateTime(timezone=True), nullable=True)
    articles_fetched_last = Column(Integer, nullable=False, default=0)
    articles_inserted_last = Column(Integer, nullable=False, default=0)
    consecutive_failures = Column(Integer, nullable=False, default=0)
    last_error = Column(Text, nullable=True)
    latency_ms = Column(Integer, nullable=False, default=0)


def init_db() -> None:
    """Create tables and indexes safely if they do not exist."""
    Base.metadata.create_all(bind=engine)
