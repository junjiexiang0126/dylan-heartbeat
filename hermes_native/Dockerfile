FROM nousresearch/hermes-agent@sha256:9774f4f39a9bb8c2f68ce728ed5e99ddbad282163be56764afacf88ed952b784
COPY hermes_native /opt/ziwei-native
# Preserve the official entrypoint, privilege drop and supervision.
CMD ["python", "/opt/ziwei-native/bootstrap.py"]
