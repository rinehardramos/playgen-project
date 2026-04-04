"""
KnowledgeBaseClient — lightweight wrapper around Qdrant for agent memory.

Collections:
  agent_insights — resolved bugs, architectural decisions, patterns

Payload schema per entry:
  title     : str   — short summary of the insight
  context   : str   — background / where it came from
  symptoms  : str   — observable signals / error messages
  fix       : str   — applied resolution
  date      : str   — ISO-8601 date (YYYY-MM-DD)
  tags      : list[str]
"""

from __future__ import annotations

import os
import uuid
from typing import Any

from qdrant_client import QdrantClient
from qdrant_client.http.models import (
    Distance,
    PointStruct,
    VectorParams,
)
from sentence_transformers import SentenceTransformer

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

COLLECTION_NAME = "agent_insights"
EMBEDDING_MODEL = "all-MiniLM-L6-v2"
VECTOR_SIZE = 384  # all-MiniLM-L6-v2 output dimension
DEFAULT_TOP_K = 5

# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


class KnowledgeBaseClient:
    """
    Thin layer over Qdrant.  Can be used both as a library import and via
    the FastAPI HTTP interface in main.py.
    """

    def __init__(self, qdrant_url: str | None = None) -> None:
        url = qdrant_url or os.environ.get("QDRANT_URL", "http://localhost:6333")
        self._qdrant = QdrantClient(url=url)
        self._encoder = SentenceTransformer(EMBEDDING_MODEL)
        self._ensure_collection(COLLECTION_NAME)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _ensure_collection(self, collection: str) -> None:
        """Create the collection if it doesn't already exist."""
        existing = {c.name for c in self._qdrant.get_collections().collections}
        if collection not in existing:
            self._qdrant.create_collection(
                collection_name=collection,
                vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
            )

    def _embed(self, text: str) -> list[float]:
        return self._encoder.encode(text).tolist()

    @staticmethod
    def _entry_to_text(entry: dict[str, Any]) -> str:
        """Concatenate payload fields into a single string for embedding."""
        parts = [
            entry.get("title", ""),
            entry.get("context", ""),
            entry.get("symptoms", ""),
            entry.get("fix", ""),
        ]
        return " ".join(p for p in parts if p)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def push(self, collection: str, entry: dict[str, Any]) -> str:
        """
        Upsert a vector + payload into *collection*.

        If entry contains an ``id`` key it is used as the point ID (allows
        idempotent updates); otherwise a random UUID is generated.

        Returns the point ID.
        """
        self._ensure_collection(collection)

        point_id = entry.pop("id", None) or str(uuid.uuid4())
        vector = self._embed(self._entry_to_text(entry))

        self._qdrant.upsert(
            collection_name=collection,
            points=[
                PointStruct(
                    id=point_id,
                    vector=vector,
                    payload=entry,
                )
            ],
        )
        return point_id

    def search(
        self,
        collection: str,
        query_text: str,
        top_k: int = DEFAULT_TOP_K,
    ) -> list[dict[str, Any]]:
        """
        Return the *top_k* nearest neighbours for *query_text*.

        Each result dict contains:
          id, score, title, context, symptoms, fix, date, tags
        """
        self._ensure_collection(collection)
        vector = self._embed(query_text)

        hits = self._qdrant.search(
            collection_name=collection,
            query_vector=vector,
            limit=top_k,
        )

        results = []
        for hit in hits:
            payload = hit.payload or {}
            results.append(
                {
                    "id": hit.id,
                    "score": hit.score,
                    **payload,
                }
            )
        return results
