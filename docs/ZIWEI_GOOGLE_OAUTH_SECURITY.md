# Google Drive / Sheets: phase 1 OAuth security foundation

**Status: code-only, NOT deployed, NOT connected to a Google account.**

This change adds a small opt-in OAuth core in hermes_native/google_oauth.py, separate from the running Hermes Gateway and persistent memory. No endpoints, cron tasks, or Agent tools are registered. The owner cannot authorize Google yet; a subsequent review must build the authenticated web integration and Google Picker. This is intentional: do not expose a public connect route or give the Agent unrestricted access to OAuth tokens.

## Least-privilege design

- Exactly one OAuth scope: https://www.googleapis.com/auth/drive.file
- Use Google Picker or explicit app-created files to grant file-by-file access. A list call does not enumerate all Drive documents.
- Sheets read-only operations are implemented for explicitly authorized spreadsheet IDs. No write/delete/share methods exist; these require a separate user-visible diff/approval workflow.
- OAuth authorization-code flow with PKCE S256, random single-use state and ten-minute expiration. The callback handler must verify the expected path, bind the browser session to the initiating owner and reject error responses. The integration must enforce owner authentication before calling begin().
- Require HTTPS callback URL; do not paste codes, JSON, tokens or redirects into a chat.
- Encrypt refresh token using Fernet and a separate key. Keep encryption key and OAuth client secret in Railway secret variables, never GitHub or the model context.
- SQLite state/token DB must live in a private persistent directory (0700, file 0600). Preserve volume. Backups containing the DB are sensitive.
- disconnect_local() deletes local tokens only. Full Google revocation must be performed in the user's Google Account permissions or through a separately reviewed token-revocation action.
- No Gmail, Calendar or broad Drive/Sheets scopes.

## Configuration required after integration review

Secret environment names (values never go into GitHub or chat):

- ZIWEI_GOOGLE_CLIENT_ID
- ZIWEI_GOOGLE_CLIENT_SECRET
- ZIWEI_GOOGLE_REDIRECT_URI (HTTPS callback registered in Google Cloud)
- ZIWEI_GOOGLE_FERNET_KEY (independent 32-byte Fernet key)
- HERMES_HOME (existing persistent profile)

The current Railway service does not have the four ZIWEI_GOOGLE_* variables configured. Do not add them until the owner-facing authenticated flow and Picker are ready.

## Acceptance criteria for the next phase

1. Owner-authenticated connect/disconnect screen; no publicly callable begin() endpoint.
2. Browser session-bound anti-CSRF state, HTTPS callback, and safe no-cache/no-referrer response headers.
3. Google Picker selection and drive.file-scoped read-only Sheets test.
4. Refresh-token persistence across an isolated restart, failed/replayed/expired callback tests, and revocation test.
5. Approval preview before any Sheets write, deletion, sharing or external transmission.
6. Dependency availability in pinned Hermes container and isolated tests.
7. Review no secrets appear in logs, memory, tool outputs, GitHub or user-facing messages.

Run python -m unittest discover -s hermes_native/tests -v after installing cryptography==46.0.4 in the test environment. The code is inert unless deliberately imported and configured.
