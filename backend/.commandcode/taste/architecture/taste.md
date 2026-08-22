# Architecture
- Keep low-level filesystem/JSON-reading logic in dedicated services rather than inside EJS routes. Confidence: 0.80
- Do not expose arbitrary filesystem paths to the browser — serve media only through validated /movie/:id-style routes; guard against path traversal. Confidence: 0.75
- The server must determine host status from the roomId→userId mapping; never trust a client-sent isAdmin value. Confidence: 0.70
- Do not rewrite existing working Step 1/Step 2 functionality; extend the codebase incrementally without breaking current behavior. Confidence: 0.75
- The host is the source of truth for playback state; viewers must not send playback control events, and the server must reject such actions. Confidence: 0.70
- Disable the playback speed change control for viewers (not just play/pause/seek) — a viewer altering speed changes their timeline and desyncs shared playback; only the host may change speed. Confidence: 0.70
