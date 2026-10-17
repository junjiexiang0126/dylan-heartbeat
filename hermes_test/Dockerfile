FROM python:3.14-slim
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates xz-utils build-essential && rm -rf /var/lib/apt/lists/*
RUN git init /opt/hermes && git -C /opt/hermes remote add origin https://github.com/NousResearch/hermes-agent.git && git -C /opt/hermes fetch --depth 1 origin 1744a19e0df568c647e4f3ff9c37f2a284a282fb && git -C /opt/hermes checkout FETCH_HEAD
COPY scripts/build_runtime.sh /tmp/build_runtime.sh
ENV HERMES_HOME=/opt/hermes-build
RUN bash /tmp/build_runtime.sh
WORKDIR /app
COPY . /app
ENV HERMES_SOURCE=/opt/hermes HERMES_PYTHON=/opt/hermes-env/bin/python ZIWEI_DATA_DIR=/data/ziwei-hermes-test HOST=0.0.0.0 PORT=8080
EXPOSE 8080
CMD ["bash", "scripts/start.sh"]
