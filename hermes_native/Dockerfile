FROM nousresearch/hermes-agent@sha256:9774f4f39a9bb8c2f68ce728ed5e99ddbad282163be56764afacf88ed952b784
COPY hermes_native /opt/ziwei-native
# Official first-boot setup seeds this template only when config.yaml is absent.
# Supply our deployment template there, before the official setup runs.
COPY hermes_native/config.yaml /opt/hermes/cli-config.yaml.example
# Preserve the official entrypoint, privilege drop and supervision.
CMD ["python", "/opt/ziwei-native/bootstrap.py"]
