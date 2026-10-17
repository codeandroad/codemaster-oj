# Current isolated validation

Current 2025 manifests are immutable-ready at the hashes below. All reference cases pass. Blank-answer controls reject every automatic stage. Compatibility positives and empty-declaration controls also pass their respective acceptance/rejection requirements.

| Paper | Reference cases | Current SHA-256 |
| --- | ---: | --- |
| 9618_s25_41 | 22 | `83b0e556849b9a199618eccefde84c7e33fa21b51a376ee181fe9453ef5d6c49` |
| 9618_s25_42 | 28 | `3745ce178f188596c1aa9f7aa67d5acd6c49b0484c0cc78fe99fbde22111181f` |
| 9618_s25_43 | 23 | `7e83e9e664effbb2206a4158d71e18dc52e0e12ef3bfcc57280e28728cc8fe6b` |
| 9618_w25_41 | 22 | `e6104b807e55a72e952bec5988b6d746dee3c78e32ec2e0aa9c874c00e51bb28` |
| 9618_w25_42 | 20 | `c1dede90d71b623c954b3a7b000a058613fd096bf01c6cd15707020107490bc3` |
| 9618_w25_43 | 29 | `d7ec5496d621acf94a7763898e551371cb2b7ad8d28feb8d8e4b558e27309980` |

Compatibility jobs: 18 empty-declarations, 6 globals-after-definitions, 1 private-fields, 18 unguarded.

All runtime checks used the existing isolated executor. Syntax/integrity checks and source-data oracle construction were the only authoring operations on the host. The original empty-declaration and blank controls may pass an individual exception-handling case; they are rejected in every complete automatic stage.

See `validation.json` for exact per-question results and `coverage.md` for subpart mapping and teacher-review limits.
