# 2021 source and assessment coverage

Five supplied papers are included. After normalising the paper-number header and printer code, s21 41/42/43 have identical question content and identical TreasureChestData.txt bytes. w21 41/42 have identical question content apart from parentheses around one pseudocode OUTPUT; Pictures.txt bytes match. Each manifest independently preserves its supplied source data and metadata.

The linked-list table on QP page 2 was rendered and visually checked. The s21 mark scheme has image-only question pages; its page 7 was visually checked for the traversal rubric. All subpart marks were read from the QP.

| Series | Question | Subparts (marks; mode A=auto M=manual E=evidence) |
|---|---|---|
|s21|Q1|a 2 M; b 4 M; c(i) 6 A; c(ii) 1 E; d(i) 7 A; d(ii) 3 A; d(iii) 1 E|
|s21|Q2|a 2 M; b(i) 6 A; b(ii) 4 M; b(iii) 2 E; c 6 A|
|s21|Q3|a 5 M; b 8 A; c(i) 1 A; c(ii) 3 A; c(iii) 5 A; c(iv) 7 A; c(v) 2 E|
|w21|Q1|a 3 A; b(i) 3 A; b(ii) 2 E; c 7 A; d(i) 1 A; d(ii) 1 E|
|w21|Q2|a 5 M; b 3 A; c 2 A; d 1 M; e 8 A; f 2 M; g 7 A; h 2 E|
|w21|Q3|a 4 M; b 8 A; c 4 A; d(i) 3 A; d(ii) 1 E; e(i) 7 A; e(ii) 1 E|

All manifests total exactly 75. Automatic stages have representative public tests plus hidden boundary/alternative-data checks wherever useful. Exact output wording is not imposed where the QP asks only for an appropriate message: s21 Q2(b)(ii) is manually reviewed. Structural requirements (record declarations, private attributes, bubble-sort method, recursion/iteration, pointer persistence) still need teacher source review even when functional checks pass. Screenshots map to evidence review of saved runs; no unavailable screenshot uploader is claimed.

Known source ambiguity: w21 QP 2(a) lists constructor order description, frame colour, height, width; the published example code uses description, width, height, frame colour. The reference follows the QP. Getter tests recognise descriptive parameter names to permit both orders. The QP says ReadData raises an exception for a missing file, while the mark-scheme example catches IOError and outputs a message; the test accepts either explicit OSError propagation or handled diagnostic output. No source text files are missing. A capacity audit keeps every alternate TreasureChestData file at five records and every supplied tree array at twenty rows, including traversal tests; valid fixed-capacity loops are accepted.

Python immutable-pointer convention: original by-reference pseudocode permits equivalent Python handling; references return tree pointers and use persistent linked-list pointer variables. Test adapters accept returned tuples or global tree-pointer updates. Linked-list allocation tests inspect the real nextNode chain and full-list refusal, not a canned success string. Teachers must additionally check repeated insertion pointer persistence.

Verification at authoring time: JSON totals/limits and Python syntax parsed without running candidate/reference programs on the host. Full isolated reference and mutation runs are performed centrally and must be recorded separately; no earlier result is represented as rerun validation.
