FROM nousresearch/hermes-agent@sha256:9774f4f39a9bb8c2f68ce728ed5e99ddbad282163be56764afacf88ed952b784
COPY . /opt/ziwei-native
# Direct CLI and Cron workers import the native facade without the Gateway
# launcher. Keep the adapter immutable and reachable in every Hermes tree.
RUN ln -s /opt/ziwei-native/browser_persistence.py /opt/hermes/browser_persistence.py \
 && printf '\nfrom browser_persistence import install as _ziwei_browser_install\n_ziwei_browser_install()\n' >> /opt/hermes/tools/browser_tool.py
# Official first-boot setup seeds this template only when config.yaml is absent.
# Supply our deployment template there, before the official setup runs.
COPY config.yaml /opt/hermes/cli-config.yaml.example
# An independent s6 slot survives a Gateway failure and makes no model calls.
RUN mkdir -p /etc/s6-overlay/s6-rc.d/ziwei-guardian /etc/s6-overlay/s6-rc.d/user/contents.d \
 && printf longrun > /etc/s6-overlay/s6-rc.d/ziwei-guardian/type \
 && cp /opt/ziwei-native/guardian-run /etc/s6-overlay/s6-rc.d/ziwei-guardian/run \
 && chmod 755 /etc/s6-overlay/s6-rc.d/ziwei-guardian/run \
 && touch /etc/s6-overlay/s6-rc.d/user/contents.d/ziwei-guardian
# Keep the original CLI for non-Gateway commands, with scoped overlay launch.
RUN cp /opt/hermes/bin/hermes /opt/ziwei-native/hermes-original \
 && cp /opt/ziwei-native/hermes-runtime /opt/hermes/bin/hermes \
 && chmod 755 /opt/hermes/bin/hermes /opt/ziwei-native/hermes-original
# Only the missing free speech dependency, isolated from Hermes's managed env.
RUN /opt/hermes/tools/uv-*/uv pip install --python /opt/hermes/.venv/bin/python \
    --target /opt/ziwei-extras edge-tts==7.2.8
ENV ZIWEI_RUNTIME_GUARD=1 PYTHONDONTWRITEBYTECODE=1
ENTRYPOINT ["python", "/opt/ziwei-native/entrypoint.py"]
# Preserve the official entrypoint, privilege drop and supervision.
CMD ["python", "/opt/ziwei-native/bootstrap.py"]
