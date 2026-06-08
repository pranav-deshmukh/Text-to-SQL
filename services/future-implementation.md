# Future Implementation Notes

## Current TypeScript Codebase Issues To Fix In Python

### 1. Retriever currently ignores the question
Current behavior loads all chunks from Qdrant into the prompt instead of using semantic retrieval.

Impact:
- grows prompt size linearly with schema size
- will become unstable as more databases and objects are added
- makes retrieval tuning variables effectively unused

Python target:
- support both `all` and `similarity` modes cleanly
- default to similarity + controlled expansion
- keep `all` mode only as a debug or small-schema fallback

### 2. Dead retrieval code paths exist
`searchDocuments`, `getDocumentById`, and graph expansion logic remain in the TypeScript retriever even when all-chunks mode is used.

Python target:
- separate retrieval strategies behind a clean interface
- avoid carrying unused paths in the main execution path

### 3. Prompt quality is too fragile
Prompt changes have repeatedly drifted toward database-specific examples, which hurts correctness across multiple databases.

Python target:
- keep prompts generic and schema-driven
- split prompt construction into reusable sections
- consider separate planning and generation prompts if needed

### 4. No dedicated SQL critique stage in the stable path
The codebase has shown repeated aggregation and join-path mistakes. A second-pass SQL critic is still an enhancement rather than a standard safety layer.

Python target:
- add an optional reviewer node for fan-out joins, bad entity resolution, and unsafe aggregations
- gate it by query type or feature flag if latency matters

### 5. DB registry is recomputed repeatedly
`getRegisteredDatabases()` reparses environment configuration on every call.

Python target:
- parse once at startup
- validate once
- inject the registry into dependent modules

### 6. Retry settings are hardcoded
Agent retries are currently hardcoded in app config instead of being environment-driven.

Python target:
- expose retries, retrieval mode, and model settings through typed settings

### 7. Hash-based Qdrant point IDs can collide
The current vector store uses a 32-bit hash for logical IDs.

Python target:
- use deterministic string or UUID-compatible point IDs where supported
- otherwise document collision risk and add collision detection tests

### 8. Missing strong test coverage for core agent behavior
There is no obvious focused test suite for retrieval mode, join correctness, or retry routing.

Python target:
- add tests for graph routing, registry parsing, retrieval behavior, and validator edge cases

### 9. State/status semantics are loose
Node functions mix status updates and error fields inconsistently.

Python target:
- define a stricter state contract
- reserve status for terminal state and rely on explicit error fields for routing

### 10. Full-schema prompting can hide true entity-resolution problems
Examples in the current codebase show failures caused by role/entity resolution rather than missing schema.

Python target:
- add an explicit entity-resolution step before SQL generation
- keep role mapping generic across databases

### 11. Async API currently wraps sync database drivers
The Python FastAPI code uses synchronous `pyodbc` and bcrypt work inside async route handlers.

Impact:
- can block the event loop under load
- acceptable for early migration, but not ideal for production throughput

Python target:
- move blocking DB/auth work behind threadpool helpers or use a dedicated worker pattern
- benchmark auth, chat history, and query execution separately before production cutover
