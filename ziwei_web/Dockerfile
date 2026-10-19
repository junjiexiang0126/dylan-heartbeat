FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates poppler-utils fonts-noto-cjk \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/voice-env \
 && /opt/voice-env/bin/pip install --no-cache-dir faster-whisper==1.2.1 av==16.0.1 edge-tts==7.3.1
# Immutable build-time model cache; user recordings never leave this service.
RUN /opt/voice-env/bin/python -c "from huggingface_hub import snapshot_download; snapshot_download('Systran/faster-whisper-base',revision='ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66',local_dir='/opt/voice-model',allow_patterns=['config.json','model.bin','tokenizer.json','vocabulary.*'])"
# Public SpeechBrain Mandarin fixture (Apache-2.0), acceptance only.
RUN /opt/voice-env/bin/python -c "import urllib.request,hashlib,pathlib; b=urllib.request.urlopen('https://huggingface.co/speechbrain/asr-transformer-aishell/resolve/31a6fb170466042f78313449c95e39c288e6ba69/example_mandarin.wav',timeout=30).read(); assert hashlib.sha256(b).hexdigest()=='bc86e7fd26157eaf3357850c85b4c5f6578e7ab5ed5e08eb791c5001ad64bd4a'; pathlib.Path('/opt/voice-acceptance.wav').write_bytes(b)"
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY . .
ENV ZIWEI_VOICE_PYTHON=/opt/voice-env/bin/python ZIWEI_VOICE_MODEL_PATH=/opt/voice-model
CMD ["node", "server.js"]
