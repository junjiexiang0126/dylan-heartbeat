# Realtime voice integration status (development branch)

This branch is **not production-ready**. Do not deploy it to the live VPS or enable the existing call button.

## Implemented
- Provider-neutral ASR -> Hermes -> sentence-level TTS orchestrator and offline mock providers.
- LiveKit HS256 room token signing and `POST /api/voice/livekit-token` under existing authenticated + CSRF-protected API routes.
- Browser room transport accepting an injected **locally bundled** LiveKit JS SDK, including microphone mute, disconnect and remote-track subscription callbacks.
- Unit-test source for call state, mock pipeline, token issuance and mocked browser transport.

## Still required before a real call
1. Bundle and serve a pinned version of the official `livekit-client` JS SDK locally; wire it into the existing call UI without changing unrelated design.
2. Build a **separate server-side LiveKit participant/worker** to subscribe to the user's audio and publish generated speech. The browser transport alone does not give Hermes access to the audio.
3. Implement VAD, speech framing, echo suppression, real interrupt/cancel of downstream inference and queued playback.
4. Add validated Zhipu ASR and MiniMax TTS adapters; confirm exact streaming formats, quotas and provider prices against official docs before enabling billing.
5. Implement Hermes adapter using the existing durable chat-session/memory path, without inventing an independent conversation or memory store.
6. Add session ownership, room expiry, concurrency and spend limits; clean up unused rooms and tracks on network loss.
7. Run `node --test test/realtime_voice*.test.js`, full regression suite, and iPhone PWA real-call acceptance before any deployment.

## Configuration (do not set yet)
- `LIVEKIT_URL` (wss://)
- `LIVEKIT_API_KEY` (server only)
- `LIVEKIT_API_SECRET` (server only)

Never send credentials to browser code, GitHub, pull requests or logs.

## Current safety boundary
The existing call button and half-duplex chat-call.js are unchanged. The new browser transport is not loaded into index.html. No live provider calls occur from these isolated modules without a caller explicitly instantiating them. No credentials are needed for offline unit tests.
