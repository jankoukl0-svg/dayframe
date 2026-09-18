# Dayframe development preview

The static build is shared by Vercel and GitHub Pages. Run `pnpm preview:build`
from `web/`; the output is `web/preview-dist/`. Relative asset URLs support both
`/` and `/dayframe/`; do not change Vercel configuration for Pages.

## GitHub Pages setup (once)

In https://github.com/jankoukl0-svg/dayframe/settings/pages select
**Build and deployment → Source → GitHub Actions**. No token or new repository
is needed. Then run **Check and publish web preview** from the Actions tab.
Pages cannot be enabled by the workflow's default GITHUB_TOKEN.

On subsequent changes to `web/` on `main`, the workflow checks TypeScript,
runs regression tests, builds, and runs Playwright against the actual static
output at `/dayframe/`. Only a verified build can be published. PRs run the
same checks without publishing. A failed check leaves the live version intact.

Expected URL: https://jankoukl0-svg.github.io/dayframe/
Always open this URL in a browser before reporting a successful deployment.
The workflow's deployment environment also records the published URL.

Vercel remains https://dayframe2.vercel.app. Each origin has its own localStorage;
existing data is not deleted, but it does not automatically appear on the other
host. Both use `dayframe-v1`, schema 5. There is no cloud account sync yet.
