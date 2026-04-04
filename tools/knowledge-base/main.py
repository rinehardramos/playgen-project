"""
FastAPI HTTP interface for the PlayGen L2 Knowledge Base.

Endpoints:
  POST /embed   — push an entry into a collection
  POST /search  — semantic search over a collection
  GET  /health  — liveness probe
"""

from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from kb_client import COLLECTION_NAME, KnowledgeBaseClient

# ---------------------------------------------------------------------------
# App + client
# ---------------------------------------------------------------------------

app = FastAPI(
    title="PlayGen Knowledge Base API",
    description="Qdrant-backed semantic memory for PlayGen agents.",
    version="1.0.0",
)

_client: KnowledgeBaseClient | None = None


def get_client() -> KnowledgeBaseClient:
    global _client
    if _client is None:
        _client = KnowledgeBaseClient(
            qdrant_url=os.environ.get("QDRANT_URL", "http://qdrant:6333")
        )
    return _client


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class EmbedRequest(BaseModel):
    collection: str = Field(default=COLLECTION_NAME, description="Target Qdrant collection")
    entry: dict[str, Any] = Field(
        ...,
        description=(
            "Payload to store.  Recommended fields: "
            "title, context, symptoms, fix, date, tags[]"
        ),
    )


class EmbedResponse(BaseModel):
    id: str
    collection: str


class SearchRequest(BaseModel):
    collection: str = Field(default=COLLECTION_NAME, description="Collection to search")
    query: str = Field(..., description="Free-text query")
    top_k: int = Field(default=5, ge=1, le=50, description="Number of results to return")


class SearchResponse(BaseModel):
    results: list[dict[str, Any]]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest) -> EmbedResponse:
    """
    Upsert an entry (vector + payload) into the specified collection.

    Example body::

        {
          "collection": "agent_insights",
          "entry": {
            "title": "BullMQ worker crashes on missing Redis key",
            "context": "DJ service playlist generation pipeline",
            "symptoms": "TypeError: Cannot read properties of undefined",
            "fix": "Add null-guard before accessing job.data.stationId",
            "date": "2026-04-05",
            "tags": ["bullmq", "dj-service", "null-pointer"]
          }
        }
    """
    try:
        client = get_client()
        point_id = client.push(req.collection, req.entry)
        return EmbedResponse(id=point_id, collection=req.collection)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/search", response_model=SearchResponse)
def search(req: SearchRequest) -> SearchResponse:
    """
    Semantic search over the collection.

    Returns the *top_k* nearest neighbours with their payloads and cosine
    similarity scores.
    """
    try:
        client = get_client()
        results = client.search(req.collection, req.query, top_k=req.top_k)
        return SearchResponse(results=results)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
