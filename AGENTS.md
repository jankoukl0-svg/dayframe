# AGENTS.md

These instructions apply to all engineering work in this repository.

## Source of truth

- Active product work belongs in `web/`.
- `main` is the source of truth.
- Read `HANDOFF.md` for product context.
- Read and follow `docs/DEVELOPMENT_PROTOCOL.md` for implementation, testing, review, merge, deployment, and completion rules.

## Required loop

Use:

`SPEC → IMPLEMENT → TARGETED TEST → SELF-FIX → FULL REGRESSION → REVIEW → SELF-FIX → MERGE → DEPLOY → SMOKE VERIFY`

Do not call a change done before production verification.

## Safety and scope

- Preserve explicit feature contracts and existing product invariants.
- Prefer the smallest coherent fix.
- Never weaken or skip a legitimate test to make CI green.
- Treat every new commit as a new head requiring fresh CI evidence.
- Diagnose exact logs before editing.
- Classify failures as PRODUCT_BUG, TEST_BUG, CI_INFRA, FLAKY, REVIEW, or DEPLOY.
- After three unsuccessful repairs in the same failure class, perform root-cause analysis instead of another symptom patch.
- Avoid unrelated cleanup in feature PRs.

## Testing

- Run relevant/changed E2E coverage first.
- Keep the complete browser regression mandatory before merge.
- When adding a new E2E feature suite, update `web/scripts/select-e2e-tests.mjs` so it is selected by relevant source changes.
- Preserve failure traces/screenshots when available.

## Release

- Require green latest-head CI and clean relevant latest-head review.
- Squash-merge using the exact expected head SHA.
- Verify `main` points to the merge commit.
- Verify the matching Vercel production deployment is READY and the production alias points to that exact deployment.
