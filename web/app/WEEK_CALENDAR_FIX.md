This file intentionally does not exist in production logic; it documents the week-calendar readability regression fixed on 2026-09-17.

Key invariants covered by the browser smoke test:
- scheduled cards stay within the visible day body, including the 22:40–23:00 reading routine;
- only one set of hour labels is visible across the week;
- task content fits inside cards instead of being clipped;
- real time-grid drag/drop remains unchanged.
