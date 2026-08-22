# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# Frontend

- Use vanilla JavaScript and vanilla CSS only — no Tailwind, Bootstrap, Material UI, or any frontend framework. Confidence: 0.85
- Put styling in a dedicated stylesheet (e.g. src/public/css/app.css) served via Fastify, not large inline <style> blocks in EJS files. Confidence: 0.70

# Architecture

- Keep low-level filesystem/JSON-reading logic in dedicated services rather than inside EJS routes. Confidence: 0.80
- Do not expose arbitrary filesystem paths to the browser — serve media only through validated /movie/:id-style routes; guard against path traversal. Confidence: 0.75
- Do not rewrite existing working Step 1/Step 2 functionality; extend the codebase incrementally without breaking current behavior. Confidence: 0.75

# Project Constraints

- Do not introduce a database, Redis, or any external data store for this project. Confidence: 0.85
- Persist room state to a JSON file (e.g. `data/current.json`) via safe helper/service functions for this MVP, not an in-memory-only store. Confidence: 0.75
- Do not implement WebSockets, playback synchronization, admin controls, chat, authentication, HLS, or transcoding — those belong to future steps. Confidence: 0.70
