# 2022 source and assessment coverage

Six supplied papers are included as four substantive task sets. Normalised QP body comparison verified s22 41/43 identical and w22 41/43 identical; printer/header differences are immaterial. Their respective HighScore.txt and IntegerData.txt bytes also match. Every manifest embeds its own supplied source text unchanged. s22 42 and w22 42 are distinct.

|Set|Question|Original subparts: marks / mode (A automatic, M manual, E evidence)|
|---|---|---|
|s22 41/43|Q1|a 2M, b 6A, c 3A, d(i) 2A, d(ii) 1E, e(i) 3M, e(ii) 5M, e(iii) 2A, e(iv) 1E, f 4A|
|s22 41/43|Q2|a 5M, b 2A, c 2A, d 2A, e 3M, f 8A, g(i) 2A, g(ii) 1E|
|s22 41/43|Q3|a 2M, b 7A, c 6A, d(i) 5M, d(ii) 1E|
|s22 42|Q1|a 3M, b 3M, c 6A, d(i) 5M, d(ii) 1E, e(i) 5A, e(ii) 2E|
|s22 42|Q2|a 4M, b(i) 5A, b(ii) 3A, b(iii) 1E, c(i) 8A, c(ii) 2E|
|s22 42|Q3|a 5M, b 3A, c 7A, d 6A, e(i) 5A, e(ii) 1E|
|w22 41/43|Q1|a 2M, b 6A, c 7A, d(i) 3M, d(ii) 1E, e 4A|
|w22 41/43|Q2|a(i) 5M, a(ii) 3A, a(iii) 2M, b(i) 6M, b(ii) 2A, b(iii) 2M, c(i) 6A, c(ii) 4M, c(iii) 1E|
|w22 41/43|Q3|a 3M, b 2M, c 5A, d 7A, e(i) 3A, e(ii) 1E|
|w22 42|Q1|a 3M, b 3A, c 5A, d 2A, e 5A, f 3A, g(i) 1A, g(ii) 1E|
|w22 42|Q2|a 4M, b 3A, c 2A, d 7A, e 5A, f 7A, g(i) 2A, g(ii) 1E|
|w22 42|Q3|a 3M, b 6A, c 4A, d 6A, e(i) 1A, e(ii) 1E|

Every paper totals 75. Stage IDs preserve the original subpart identity. Every automatic stage has a real output/state/file oracle. Public representative tests are accompanied by useful hidden boundary, alternate-input or alternate-file tests. Source-structure marks (private attributes, comments, required sorts, recursion, procedure calls) remain teacher-reviewed even for automatic stages. Appropriate-message branches with no prescribed wording, unnamed user procedures and evidence are not replaced with canned PASS programs. Original screenshot tasks use saved-run evidence.

Source clarifications are explicit in student text:
- s22 41/43 Q1 OutputHighScores visits all eleven array entries, as confirmed visually on mark-scheme page 7; the new file contains only the top ten. File checks allow an optional terminal newline.
- s22 42 QP page 6 was rendered and visually inspected: the printed midpoint `(Lower + (Upper - 1)) DIV ...` can fail to terminate at inclusive single-element intervals. The classroom adaptation specifies correct inclusive bounds and an in-range midpoint; its reference uses `(Lower + Upper)//2`. Hidden tests cover the last index, one element and an empty interval. This is an identified source correction, not a silent change.
- s22 42 ChooseCard accepts user indices 1..30; the driver accepts a consistent one-based or zero-based return by checking selected actual cards in the completed program.
- w22 41/43 Q1 does not state the sorting direction. Both monotone numerical directions are accepted; the reference follows the ascending mark-scheme example.
- w22 42 QP example says Qui Y=0, but supplied Characters.txt says Qui=(84,9). The adapted statement retains the output format and uses actual post-left-move coordinates (83,9).
- w22 42 Q3 pseudocode uses an exclusive Start; mark-scheme RecursiveOutput instead takes the final occupied index. Both consistent conventions are accepted, including a nonzero-head boundary case.

No required source text files are missing. The capacity/domain audit keeps high-score files at ten records, card files at thirty valid numbered/coloured cards, integer files at one hundred values in 1..100, character files at ten records, binary-search arrays at ten by ten, and near-full job queues with ninety-nine real occupied rows. Empty ADT operations and deliberately invalid user inputs are tested only where the original contract requires them. Images/PDFs and evidence.doc are not imported as runtime files. NewHighScore.txt is declared as a collected output; source data files are kept in initialFiles.

Authoring verification parses all JSON, Python references and drivers and checks marks and case limits without executing student/reference programs on the host. Declaration loading retains safe array-initializer loops, preserves future annotations, and supports dataclass records without running input-driven main routines. Central isolated reference/mutation validation is a separate current-implementation step and must be reported independently.
