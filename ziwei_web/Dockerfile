FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates espeak-ng \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/voice-env \
 && /opt/voice-env/bin/pip install --no-cache-dir faster-whisper==1.2.1 edge-tts==7.2.8
# Immutable build-time model cache; user recordings never leave this service.
RUN /opt/voice-env/bin/python -c "from huggingface_hub import snapshot_download; snapshot_download('Systran/faster-whisper-base',revision='ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66',local_dir='/opt/voice-model',allow_patterns=['config.json','model.bin','tokenizer.json','vocabulary.*'])"
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY . .
ENV ZIWEI_VOICE_PYTHON=/opt/voice-env/bin/python ZIWEI_VOICE_MODEL_PATH=/opt/voice-model
CMD ["node", "server.js"]
