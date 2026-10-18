# Hermes private transport rollout — 2026-10-18

Scope: ziwei-home-web-test only, in the existing ziwei-hermes-test environment.
The Hermes public domain remains in place pending a separate decision. No native
backend, memory, schedule, provider, credentials, persistent schema or data migration.

`ZIWEI_HERMES_URL` stays unchanged: chat and moments use its original bytes in
their existing database identity. It is not the wire address when private mode
is selected. Replacing it would risk a scope-change rejection on existing data.

`ZIWEI_HERMES_PRIVATE_HOST` selects exactly one service hostname of the form
`<single-dns-label>.railway.internal`. Only HTTP on fixed port 8642 is used.
Set it through the native service reference `${{ziwei-hermes-test.RAILWAY_PRIVATE_DOMAIN}}`.
URLs, IP literals, subdomains, wildcards, alternate ports, credentials, whitespace
and malformed/empty values are rejected. A configured private host never falls
back to public HTTPS. Requests are origin-bound; redirects are errors. Bearer
and session headers cannot be overridden by request-specific options.

Both HermesClient (chat, Work, records/memory, photos, moments, workbench) and the
retained legacy bridge use the same policy. Legacy HTTPS and isolated localhost
HTTP test fixtures continue to work when private mode is absent.

## Rollout

1. Deploy this Web commit, leaving its existing URL and key untouched. Initially
   set only `ZIWEI_HERMES_PRIVATE_PROBE_HOST` to the native private-domain reference.
2. The canary makes one authenticated GET `/v1/capabilities`, no model call and
   no native mutation. Require `WEB_PRIVATE_TRANSPORT_PROBE` with verified=true
   and the expected private host. Current normal traffic remains unchanged.
3. Then set `ZIWEI_HERMES_PRIVATE_HOST` to that same reference and redeploy only
   Web. Require `WEB_INTEGRATION_READY` transport=true, network=railway-private,
   upstream=<expected host>:8642 and stateEndpoint=true. Confirm actual private
   connections using Railway flow/DNS evidence where available.
4. Verify real chat, run recovery, existing memory reads, task/autonomy status
   without changing schedules, attachment upload and actual generated-file
   downloads. Do not interpret local fixtures as real provider acceptance.
5. Audit remaining public-host clients and callback dependencies. A historical
   URL retained solely as database identity is not a public network dependency.
6. Report outcomes and unresolved checks before considering public-domain removal.

The optional canary only reads capabilities; keeping it during rollout does not
switch ordinary traffic. Neither canary nor readiness logs contain key values,
request bodies, private memories or successful private-data responses.

On a failed canary, do not activate private mode. On a failed active switch,
restore only the prior Web transport configuration; do not reset data, restore
old volumes, roll back native Hermes or modify autonomy rules.

## Validation before deployment

Policy tests cover hostile host strings, production HTTP rejection, URL origin
escape, mandatory credentials, no public retry after a private failure, actual
temporary SQLite identity/row preservation and model-free canary behavior.
Existing integration tests exercise authenticated chat streaming, approvals,
restart recovery, read-only records and byte-exact attachment delivery against
isolated local fixtures. Work tests generate real document bytes with fake
model transports. Live acceptance remains separate and must be recorded after
the rollout; passing these checks does not prove a private deployment succeeded.
