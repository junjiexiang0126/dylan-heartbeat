# Face ID entry follow-up — 2026-10-15

User-confirmed acceptance: real status publishing/sync/persistence and real approval responses now work. These are no longer open blockers.

## Problem and change

The deployed Web service exposes passkey support (`/api/session` reports `passkeyAvailable: true`). The existing registration UI was below the entire profile and appearance form, named only “device unlock”; the login entry was hidden when the platform-authenticator capability probe returned false or threw.

Move the existing security group to the top of Settings, label registration and login “Face ID / 设备解锁”, keep the login entry visible with a specific unsupported-browser or server-configuration explanation, and allow the actual WebAuthn ceremony to determine authenticator availability. Missing registration passwords are rejected locally. Cancellation, unsupported authenticators and RP/domain mismatch have explicit recovery instructions. Profile/appearance settings, credential validation and server user-verification requirements are preserved.

This uses system passkeys. The OS chooses Face ID, fingerprint or device passcode. Adding a Home Screen shortcut does not register a credential or automatically lock an existing 30-day signed-in session.

## Validation

- Syntax checks passed.
- Seven Chromium browser tests passed: three phone viewport sizes, security group order, visible registration entry, standalone flag/capability false, unsupported API, unavailable server, password requirement, cancellation, existing profile/tab regression, and virtual-authenticator registration/signature verification/login/replay rejection/removal.
- Virtual-authenticator verification is not physical iPhone Face ID verification.
- iPhone Safari and Home Screen PWA acceptance remains pending.

## Manual deployment and acceptance

Deploy only the existing Web service (`ziwei-home-web-test`, root `/ziwei_web`) from `fix/face-id-entry`. Do not change the native service. No deployment was executed by this task.

1. Close/reopen or refresh the existing Home Screen app, log in with the access password if needed.
2. Open Settings in the upper right. The first group should read “Face ID / 设备解锁”.
3. Enter the access password and tap “开启 Face ID / 设备解锁”. Complete the system passkey creation prompt.
4. Tap “锁定 / 退出此设备”, then “用 Face ID / 设备解锁”. Confirm access is restored after system verification.
5. Verify cancellation preserves password login. Close/reopen settings and confirm the saved credential count.
6. If the system does not offer Face ID, inspect the displayed error and iPhone passkey/biometric settings. Do not claim device enrollment from the presence of a button alone.

Rollback: deploy the prior Web commit `c233f351f4763f20c070acd2ca40374e4ab6e920`. Keep existing Web storage. This change does not migrate stored credentials or memories.
