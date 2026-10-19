"""Decode a private voice attachment locally; never print diagnostic content."""
import json
import sys

try:
    import av
    from faster_whisper import WhisperModel

    with av.open(sys.argv[1]) as container:
        if not container.streams.audio or container.streams.video:
            raise ValueError("invalid_audio")
        if container.duration and container.duration / 1_000_000 > 305:
            raise ValueError("voice_too_long")
    model = WhisperModel(sys.argv[2], device="cpu", compute_type="int8", cpu_threads=1, num_workers=1, local_files_only=True)
    segments, info = model.transcribe(sys.argv[1], beam_size=3, vad_filter=True, initial_prompt="知微")
    if info.duration > 305:
        raise ValueError("voice_too_long")
    text = "".join(segment.text for segment in segments).strip()
    if not text:
        raise ValueError("voice_empty")
    print(json.dumps({"text": text}, ensure_ascii=False))
except Exception as exc:
    code = str(exc) if str(exc) in {"voice_too_long", "voice_empty"} else "voice_transcription_failed"
    print(json.dumps({"error": code}))
    sys.exit(1)
