# Realtime voice integration (2026-10-20)

Development branch only. No production VPS access, deployment, or memory migration.

## Runtime

The existing authenticated/CSRF-checked Web server owns one LiveKit worker at a time.
`POST /api/voice/livekit-token` starts the worker before returning the microphone-only
client token. The browser uses the existing call dialog. When the feature is off or
keys are missing the original recording/upload call implementation stays available.
Append `?voice=legacy` to force that fallback.

`LiveKitParticipant` uses pinned `@livekit/rtc-node`, subscribes only to the issued
user identity's microphone, and publishes a native AudioSource. Native WebRTC decodes
Opus, resamples and downmixes to 16 kHz mono. A bounded PCM buffer produces 320-sample
20 ms frames. Energy VAD submits short WAV utterances to Zhipu; this is utterance-based
ASR, not a continuous ASR WebSocket. MiniMax HTTP SSE PCM is published with backpressure.
The final aggregate audio chunk is excluded to prevent double playback.

`HermesVoiceAdapter` uses the existing `HermesClient` and its configured native Web
session. It creates no persona, separate memory, or model client. Hermes retains the
native conversation; the existing native-history sync can import it into the Web
archive. Voice text is not duplicated into the local live-message database. Approval
requests stop this voice turn; handle work requiring approval in normal chat.

Barge-in invalidates old audio and aborts ASR/LLM/TTS at speech onset. `/stop` targets
only the voice run and polls for a terminal status. If cancellation/admission cannot
be confirmed the service blocks further calls until the operator checks Hermes and
restarts the Web process. Disconnecting a browser alone is not a model cancellation.

## Configuration (server environment only)

- `ZIWEI_REALTIME_VOICE_ENABLED=true` (off by default)
- `LIVEKIT_URL=wss://...` (no credentials/path/query in URL)
- `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- `ZHIPU_API_KEY`
- `MINIMAX_API_KEY`, `MINIMAX_VOICE_ID` (choose an available voice)
- Optional `MINIMAX_TTS_ENDPOINT`: documented China/international HTTPS endpoint.
  Default: `https://api.minimax.cn/v1/t2a_v2`.
- Existing Hermes variables and `current-session.txt` continue to apply.

No actual keys belong in this repository or frontend. Set quotas on provider accounts
as well. The guardrails are submitted-unit caps, **not measured RMB billing**:
15 minute calls, 20 ASR requests/300 submitted seconds, 4,000 TTS characters, one call
at a time, 12 starts/hour persisted in the existing Web data directory. Silence does
not invoke ASR; muted audio is discarded. LiveKit room time may still incur charges,
and requests already sent can remain billable after cancellation. This does not cap
arbitrary Hermes tools/delegations or replace upstream model spending controls.

The browser sends a heartbeat every 10 seconds; a lost/auth-expired browser lease
closes the worker within about 35 seconds. SDK handles transient reconnects within
the same room; terminal disconnection requires a new call. Page hide hangs up.
The existing Web server single-process/data-directory lock is required; do not run
multiple independently configured Web replicas and assume this is a distributed lock.

## Verification

```sh
cd ziwei_web
npm ci
npm run build:voice
npm run test:voice
npm run check
npm test
```

Real transport test, no provider keys (LiveKit 1.13.10):

```sh
livekit-server --dev --bind 127.0.0.1 --node-ip 127.0.0.1 --keys 'devkey: local-test-secret-not-production'
node scripts/realtime_voice_loopback.js
```

The loopback sends 48 kHz stereo through a real room, receives 16 kHz mono in the
worker, invokes provider contract fixtures, and receives synthesized test audio over
WebRTC. It is **not** evidence of paid ASR/TTS or a real Hermes model response.
CI: `.github/workflows/realtime-voice.yml` creates no production service.
This Work sandbox rejects LiveKit's netlink network-interface syscall, so the local
LiveKit daemon cannot start here. Native SDK loading and native resampling can run.
The isolated GitHub Actions run 39432621231 subsequently passed the actual
LiveKit audio roundtrip on commit 44ef6e0. This is transport evidence only.

Before live acceptance: run the transport CI; then configure keys in an isolated
staging environment, verify both directions, voice ID, pronunciation/latency, iPhone
Safari/PWA playback activation, echo/barge-in, mute, network recovery, hangup cancellation,
provider usage, and Hermes native history continuity. Do not deploy from this document.

## Official contracts checked

- https://docs.bigmodel.cn/api-reference/模型-api/语音转文本
- https://docs.bigmodel.cn/cn/guide/models/sound-and-video/glm-asr-2512
- https://platform.minimax.cn/docs/api-reference/speech-t2a-http
- https://docs.livekit.io/reference/client-sdk-node/
- https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/programmatic-integration.md

The installed SDK declarations, not an older reference snippet, determine exact enum
and constructor usage. Models: `glm-asr-2512`, `speech-2.8-turbo`.
