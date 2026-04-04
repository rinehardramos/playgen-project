"""
Seed the agent_insights collection with 3 real bugs fixed in the PlayGen project.

Run once after the kb-api container is up:
  python seed.py
or inside the container:
  docker compose exec kb-api python seed.py
"""

from __future__ import annotations

import os
import sys

from kb_client import COLLECTION_NAME, KnowledgeBaseClient

SEEDS = [
    {
        "id": "seed-001-fastify-rate-limit-v10",
        "title": "@fastify/rate-limit v10 incompatible with Fastify v4",
        "context": (
            "DJ service and Station service both use @fastify/rate-limit. "
            "After upgrading to v10, all services failed to start because "
            "v10 requires Fastify v5."
        ),
        "symptoms": (
            "TypeError: fastify.addHook is not a function — thrown at startup "
            "when registering the rate-limit plugin."
        ),
        "fix": (
            "Pinned @fastify/rate-limit to ^9.1.0 in both services/dj/package.json "
            "and services/station/package.json. "
            "v9 is the last version compatible with Fastify v4."
        ),
        "date": "2026-04-04",
        "tags": ["fastify", "rate-limit", "dependency", "dj-service", "station-service"],
    },
    {
        "id": "seed-002-vercel-pnpm-tailwind",
        "title": "Vercel build fails: tailwind/postcss not found in production",
        "context": (
            "Frontend is deployed to Vercel from a pnpm monorepo. "
            "Tailwind CSS and PostCSS are used for styling. "
            "NODE_ENV=production caused devDependencies to be skipped."
        ),
        "symptoms": (
            "Vercel build error: Cannot find module 'tailwindcss'. "
            "Build succeeds locally but fails in CI/CD pipeline."
        ),
        "fix": (
            "Moved tailwindcss and postcss from devDependencies to dependencies "
            "in frontend/package.json so they are installed even with NODE_ENV=production. "
            "Also added outputFileTracingRoot to next.config.js to ensure pnpm "
            "workspace packages resolve correctly."
        ),
        "date": "2026-04-04",
        "tags": ["vercel", "nextjs", "tailwind", "pnpm", "monorepo", "ci-cd"],
    },
    {
        "id": "seed-003-bullmq-missing-station-id",
        "title": "BullMQ playlist generation job crashes on missing stationId",
        "context": (
            "Scheduler service enqueues playlist generation jobs via BullMQ. "
            "Jobs are processed by a worker that reads job.data.stationId to "
            "fetch the station config before generating."
        ),
        "symptoms": (
            "UnhandledPromiseRejection: Cannot read properties of undefined "
            "(reading 'stationId'). Worker exits, job moves to failed state, "
            "no playlist is generated."
        ),
        "fix": (
            "Added a null-guard at the top of the worker's process() function: "
            "if (!job.data?.stationId) throw new Error('Missing stationId in job data'). "
            "This produces a clear error message and prevents cascading failures. "
            "Also added validation in the enqueue path to reject jobs without stationId."
        ),
        "date": "2026-04-05",
        "tags": ["bullmq", "scheduler-service", "null-pointer", "validation", "worker"],
    },
]


def main() -> None:
    url = os.environ.get("QDRANT_URL", "http://localhost:6333")
    print(f"Connecting to Qdrant at {url} …")
    client = KnowledgeBaseClient(qdrant_url=url)

    for entry in SEEDS:
        # Make a copy so push() can pop 'id' without mutating our list
        point_id = client.push(COLLECTION_NAME, dict(entry))
        print(f"  Seeded [{point_id}] {entry['title']}")

    print(f"\nDone — {len(SEEDS)} entries seeded into '{COLLECTION_NAME}'.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
