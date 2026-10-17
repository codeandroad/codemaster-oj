# Current isolated validation

Current 2026 manifests are immutable-ready at the hashes below. All reference cases pass. Blank-answer controls reject every automatic stage. Compatibility positives and empty-declaration controls also pass their respective acceptance/rejection requirements.

| Paper | Reference cases | Current SHA-256 |
| --- | ---: | --- |
| 9618_s26_41 | 17 | `2526072d3734bcacf763db93b9a7efdd6d0185a146e463a54fbc96d29409c42b` |
| 9618_s26_42 | 17 | `e6370fab96442c5125aa13058b16083f12be4ae9a580d9fa622c3ee8a9045e3d` |
| 9618_s26_43 | 23 | `7d47ab31882ad0b1f927966f31c34b93fb1ffd51d43099fb13f3c63928b0ce51` |

Compatibility jobs: 9 empty-declarations, 4 globals-after-definitions, 9 unguarded.

All runtime checks used the existing isolated executor. Syntax/integrity checks and source-data oracle construction were the only authoring operations on the host. The original empty-declaration and blank controls may pass an individual exception-handling case; they are rejected in every complete automatic stage.

See `validation.json` for exact per-question results and `coverage.md` for subpart mapping and teacher-review limits.
