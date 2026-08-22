# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# Frontend

- Use vanilla JavaScript and vanilla CSS only — no Tailwind, Bootstrap, Material UI, or any frontend framework. Confidence: 0.85
- Put styling in a dedicated stylesheet (e.g. src/public/css/app.css) served via Fastify, not large inline <style> blocks in EJS files. Confidence: 0.70

# Architecture
See [architecture/taste.md](architecture/taste.md)
# Project Constraints

- Do not introduce a database, Redis, or any external data store for this project. Confidence: 0.85
- Persist room state to a JSON file (e.g. `data/current.json`) via safe helper/service functions for this MVP, not an in-memory-only store. Confidence: 0.75
- Do not implement chat, authentication, HLS, transcoding, admin transfer, voice/video calls, or a database/Redis — those remain future/excluded. WebSockets and playback synchronization ARE implemented (Step 4). Confidence: 0.75
