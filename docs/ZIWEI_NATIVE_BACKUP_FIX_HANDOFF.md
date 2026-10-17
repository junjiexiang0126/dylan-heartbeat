# Ziwei Hermes backup ownership fix — handoff (not deployed)

## Scope

Branch: `fix/ziwei-native-backup-profile-v1`. **Do not merge into main or redeploy automatically.** The last verified Railway runtime is commit `4784957afe43482487a6f8de03ff5c6435b512aa` and should remain untouched until the correct target service is accessible.

This changes only `hermes_native/entrypoint.py` and adds offline tests. It does not alter the official Hermes runtime, model keys, persistent data or old wake-up production service.

## Root cause

The previous wrapper compared the *entire* initialized `config.yaml` byte-for-byte with the seed. Hermes initialization can change formatting or defaults, so this rejected a valid existing Profile. The original backup folders had uid/gid 0, while the Hermes process runs as uid/gid 10000.

## Safety behavior

- Existing marked profiles: verify marker; continue.
- Fresh empty profiles: write marker; continue.
- **Existing unmarked nonempty profiles**: fail closed by default. After **human review and an external backup**, the operator may set `ZIWEI_ADOPT_EXISTING_PROFILE=1` for **one controlled deployment**. Remove this environment flag afterward.
- The opt-in check verifies that the config is a regular file and includes expected Ziwei/DeepSeek/API server signatures. This is a guardrail, **not cryptographic ownership proof** or a substitute for a real backup.
- Never follow backup or archive symlinks. Only change ownership on existing `backups` and `backups/config` directories — not recursively, not on other volumes or old history.
- Pass execution back to `/opt/hermes/docker/entrypoint-dispatch.sh`, which retains the official user privilege drop.

## Required before rollout

1. Verify the correct Railway **ziwei-hermes-test** service and exact environment by ID; do not operate on the old dylan-heartbeat production service.
2. Verify a restorable snapshot of the existing `/data/hermes_native` before adoption. Confirm `config.yaml` really belongs to this native profile. Do not share secrets in logs or public GitHub.
3. Review this branch and run actual container CI (offline unit tests do not exercise official entrypoint, volume ownership, or restart).
4. Use the current proven official dispatch startup, not a custom command that bypasses the entrypoint. Roll out only after an approved, non-expired Railway deploy path is available.
5. Verify writable backups under uid 10000, Gateway/DeepSeek/tool operation, persistence after restart, an actual backup, checksum, and a **separate isolated restore**.
6. On any failed deployment revert to known working deployment without deleting the volume; never attempt repeated uncontrolled redeploys.

## Still out of scope

The v4.2 private identity/memory migration, unified memory verification, six daily autonomous activities and outbound notifications are not implemented here. Do not store sensitive memory or credentials in this public repository.
