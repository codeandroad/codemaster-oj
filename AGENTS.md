# Campus Judge production

- This directory is a standalone production system. Do not import files, packages, fixtures, configuration or assets from the adjacent prototype `../myoj-prototype/`.
- Use Next.js App Router, React and TypeScript for `apps/web`, NestJS and TypeScript for `apps/api`. Keep runtime dependencies scoped to each application's package and lockfile.
- Database migrations, transactional grading rules, session security and isolated judge execution belong to `packages/domain`; production API transport belongs to NestJS.
- Keep application and worker PostgreSQL roles separate. Never execute student code in API or web processes, mount a Docker socket, or grant the executor database access.
- Preserve database volumes and user data across upgrades. Never reset demo accounts, passwords, activities or grades during a routine restart.
- Keep `docs/campus-judge-design-summary.md` topic anchors and decision timeline stable so superseded prototype and production choices remain traceable.
- Keep credentials in ignored private files; do not add test passwords or deployment secrets to source or documentation.
- Run meaningful transport, authorization, grading and sandbox checks after changes to those boundaries. Clearly distinguish earlier validation from checks rerun on the current implementation.
