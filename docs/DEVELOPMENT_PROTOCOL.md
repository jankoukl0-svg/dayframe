# Dayframe Development Protocol

This document is the default engineering and release protocol for every Dayframe change in `web/`.

## 1. Start with a feature contract

Before implementation, write down the behavior that must be true when the change is complete:

- acceptance behavior;
- explicit non-goals;
- product invariants that must not regress;
- persistence/migration implications;
- failure behavior and edge cases.

Do not widen scope while repairing CI unless the new issue is required to satisfy the contract.

## 2. Development loop

Use this state machine:

`SPEC → IMPLEMENT → TARGETED TEST → SELF-FIX → FULL REGRESSION → REVIEW → SELF-FIX → MERGE → DEPLOY → SMOKE VERIFY`

Rules:

1. Work from fresh `main` on a dedicated branch.
2. Implement the smallest coherent change.
3. Add or update the test that proves the intended behavior.
4. Run targeted checks before treating the branch as a merge candidate.
5. A failed targeted check is repaired before the full regression suite runs.
6. The full browser suite remains mandatory before merge.
7. Review is useful only after the targeted gate is green.
8. Any code change creates a new head and invalidates CI/review evidence from the previous head.
9. Never weaken, skip, delete, quarantine, or loosen a legitimate test simply to obtain a green build.
10. A test assertion may change only when the intended product behavior changed and the old assertion is demonstrably stale.

## 3. CI architecture

The PR workflow is intentionally layered.

### Fast gate

Runs first:

- frozen dependency install;
- TypeScript typecheck;
- deterministic planning/unit regressions;
- static preview build;
- targeted browser tests selected from the changed files.

The selector is `web/scripts/select-e2e-tests.mjs`. When a new feature gets a dedicated E2E suite, update the selector so changes to that feature run its suite early.

### Full regression

Only starts after the fast gate succeeds.

The complete Playwright suite is split across four shards. Shards use `fail-fast: false` so one failing shard does not hide independent failures in other shards. This is deliberate: one CI run should reveal as many real regressions as possible instead of uncovering them one at a time.

The reusable browser runner is `web/scripts/run-static-e2e.sh`. Failed browser runs retain Playwright traces/screenshots as workflow artifacts.

### Main / Pages

The same full regression remains mandatory on `main`. GitHub Pages deploys only after the regression gate succeeds.

## 4. Failure classification

Every failure should be classified before editing code:

- `PRODUCT_BUG`: implementation violates the feature contract.
- `TEST_BUG`: test expectation/setup is stale or objectively incorrect.
- `CI_INFRA`: workflow, environment, dependency, server, or runner problem.
- `FLAKY`: nondeterministic failure with no relevant code change.
- `REVIEW`: valid review feedback not yet addressed.
- `DEPLOY`: production build, deployment, alias, or runtime verification failure.

Fix the root cause for that class. Do not use product changes to mask infrastructure failures or test changes to mask product bugs.

If the same failure class is repaired three times without meaningful progress, stop patching symptoms and perform root-cause analysis before another change.

## 5. Review and merge

For a merge candidate:

- latest-head fast gate is green;
- latest-head full regression is green;
- latest-head review has no relevant unresolved findings;
- PR is mergeable against current `main`.

Use squash merge with the exact expected head SHA so a moved PR head cannot be merged accidentally.

## 6. Production definition of done

"Code written" is not done. "PR merged" is not done.

A release is done only when:

1. PR is merged;
2. `main` points to the expected merge commit;
3. the matching Vercel production deployment is READY;
4. the production alias points to that exact deployment;
5. the production smoke check passes.

For Dayframe web production, verify `dayframe2.vercel.app`.

## 7. Communication policy

Routine waiting is not a user-facing blocker. During a release loop, do not stop merely because CI, review, or deployment is pending.

User-facing outcomes should normally be one of:

- production verified and complete; or
- a real blocker requiring a product decision, permission, external action, or unsafe/non-minimal change.

## 8. Efficiency rules

- Diagnose from exact failing logs before editing.
- Prefer targeted tests during repair iterations.
- Keep the full regression mandatory but parallel.
- Preserve traces/screenshots for failed browser tests to avoid diagnostic reruns.
- Use current-head evidence only.
- Avoid unrelated cleanup inside feature PRs.
- Do not trigger redundant deployments.
- GitHub event-driven CI is the fast path; periodic external watchers are only a safety net, not the primary release engine.

## 9. Stuck pipeline watchdog

Pending is not automatically healthy.

- Treat a CI/review/deployment as healthy waiting only while it shows recent progress.
- If a latest-head CI run has no jobs, no status movement, or no updated activity for roughly 10 minutes, classify it as `CI_STUCK` instead of silently waiting.
- Inspect competing runs in the same concurrency group; newer commits can cancel or starve older runs.
- Attempt one safe automatic recovery using the native rerun/retry mechanism when available.
- Never create a chain of retry-only commits. If a retry commit is the only available trigger, allow at most one, then surface the external blocker.
- Batch all known fixes from one diagnosis into one commit whenever possible so a logical repair creates one CI run, not several competing runs.
- Apply the same stale-progress rule to review and deployment stages.
- A watcher must never use an unconditional rule equivalent to “pending => do nothing forever”.

