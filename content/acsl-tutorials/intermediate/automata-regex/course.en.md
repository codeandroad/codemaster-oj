---
format: codemaster-learning-path
version: 1
title: ACSL Intermediate Topic 9 — Finite-State Automata and Regular Expressions
description: Four original lessons connect state-by-state tracing, complete cycles, regular-expression structure, and full-string boundary checks. Includes native diagrams, transition tables, and sixteen self-checks with worked reasoning. Prerequisites are reading arrows and distinguishing a symbol from a sequence.
category: ACSL · Intermediate
estimatedMinutes: 110
difficulty: intermediate
coverKey: general
---

# ACSL Intermediate Topic 9 — Finite-State Automata and Regular Expressions

## 章节：01. Read one symbol, then move one state

### 学习目标

- Recognize the start arrow, transition direction, and double-circle accepting states.
- Record a state after every consumed symbol, including the initial state before any input.
- Decide acceptance only after the entire input, and reject a missing transition.

### 正文

#### A state records what matters about the prefix already read

A finite-state automaton (FSA) has a finite set of states and labeled transitions. For the deterministic machines in these lessons, each current-state/input-symbol pair has at most one next state. Begin at the state with the incoming start arrow. A transition labeled `0` consumes exactly one `0`; a self-loop also consumes a symbol even though the state name does not change. A double circle marks an accepting state. The start arrow consumes nothing.

**Accept only if every input symbol has been consumed and the final current state is accepting.** Passing through an accepting state midway is insufficient. With no available transition, reject; do not skip that symbol or invent a new arrow. Our diagrams omit unavailable transitions rather than drawing a rejecting sink. The empty string, written $\lambda$, has length zero and leaves the machine in its start state.

These conventions and the regular-expression operators in this topic follow the official ACSL FSA and Regular Expressions category. Every machine, example, and self-check in this topic is original.

#### An original machine over the alphabet {0, 1}

```diagram
{
  "id": "suffix-01",
  "width": 560,
  "height": 300,
  "alt": {
    "en": "Binary automaton. Start S; accepting B. S: 0 to A, 1 to S. A: 0 to A, 1 to B. B: 0 to A, 1 to S.",
    "zh": "二进制状态机。初态 S，接受态 B。S：0 到 A，1 到 S；A：0 到 A，1 到 B；B：0 到 A，1 到 S。"
  },
  "elements": [
    {
      "type": "line",
      "x1": 25,
      "y1": 140,
      "x2": 63,
      "y2": 140
    },
    {
      "type": "polyline",
      "points": [
        [
          54,
          135
        ],
        [
          63,
          140
        ],
        [
          54,
          145
        ]
      ]
    },
    {
      "type": "circle",
      "cx": 90,
      "cy": 140,
      "r": 27
    },
    {
      "type": "circle",
      "cx": 270,
      "cy": 140,
      "r": 27
    },
    {
      "type": "circle",
      "cx": 450,
      "cy": 140,
      "r": 27
    },
    {
      "type": "circle",
      "cx": 450,
      "cy": 140,
      "r": 21
    },
    {
      "type": "text",
      "x": 90,
      "y": 146,
      "text": "S",
      "fontSize": 17,
      "anchor": "middle"
    },
    {
      "type": "text",
      "x": 270,
      "y": 146,
      "text": "A",
      "fontSize": 17,
      "anchor": "middle"
    },
    {
      "type": "text",
      "x": 450,
      "y": 146,
      "text": "B",
      "fontSize": 17,
      "anchor": "middle"
    },
    {
      "type": "line",
      "x1": 117,
      "y1": 140,
      "x2": 243,
      "y2": 140
    },
    {
      "type": "polyline",
      "points": [
        [
          234,
          135
        ],
        [
          243,
          140
        ],
        [
          234,
          145
        ]
      ]
    },
    {
      "type": "text",
      "x": 180,
      "y": 129,
      "text": "0",
      "fontSize": 17,
      "anchor": "middle"
    },
    {
      "type": "line",
      "x1": 297,
      "y1": 140,
      "x2": 423,
      "y2": 140
    },
    {
      "type": "polyline",
      "points": [
        [
          414,
          135
        ],
        [
          423,
          140
        ],
        [
          414,
          145
        ]
      ]
    },
    {
      "type": "text",
      "x": 360,
      "y": 129,
      "text": "1",
      "fontSize": 17,
      "anchor": "middle"
    },
    {
      "type": "path",
      "d": "M 72 120 C 30 45 150 45 108 120"
    },
    {
      "type": "polyline",
      "points": [
        [
          116.85,
          114.67
        ],
        [
          108,
          120
        ],
        [
          108.15,
          109.67
        ]
      ]
    },
    {
      "type": "text",
      "x": 90,
      "y": 55,
      "text": "1",
      "fontSize": 17,
      "anchor": "middle"
    },
    {
      "type": "path",
      "d": "M 252 120 C 210 45 330 45 288 120"
    },
    {
      "type": "polyline",
      "points": [
        [
          296.85,
          114.67
        ],
        [
          288,
          120
        ],
        [
          288.15,
          109.67
        ]
      ]
    },
    {
      "type": "text",
      "x": 270,
      "y": 55,
      "text": "0",
      "fontSize": 17,
      "anchor": "middle"
    },
    {
      "type": "path",
      "d": "M 432 160 C 405 211 315 211 288 160"
    },
    {
      "type": "polyline",
      "points": [
        [
          288.15,
          170.33
        ],
        [
          288,
          160
        ],
        [
          296.85,
          165.33
        ]
      ]
    },
    {
      "type": "text",
      "x": 360,
      "y": 225,
      "text": "0",
      "fontSize": 17,
      "anchor": "middle"
    },
    {
      "type": "path",
      "d": "M 455 167 C 470 290 70 290 85 167"
    },
    {
      "type": "polyline",
      "points": [
        [
          80,
          176
        ],
        [
          85,
          167
        ],
        [
          90,
          176
        ]
      ]
    },
    {
      "type": "text",
      "x": 270,
      "y": 287,
      "text": "1",
      "fontSize": 17,
      "anchor": "middle"
    }
  ]
}
```

The same machine in a transition table makes every direction explicit. Start at `S`; only `B` accepts.

| Current state | Read `0` | Read `1` |
| --- | --- | --- |
| `S` | `A` | `S` |
| `A` | `A` | `B` |
| `B` | `A` | `S` |

The state meanings provide a second way to check the arrows: `A` means the prefix ends in `0`; `B` means it ends in `01`; `S` means neither of these, including the empty prefix. Thus the complete accepted strings are precisely the binary strings ending in `01`. That description is a claim to verify with traces, not permission to stop reading early.

#### Trace `1001` one symbol at a time

| Consumed prefix | Symbol just read | Current state |
| --- | --- | --- |
| $\lambda$ | — | `S` |
| `1` | `1` | `S` |
| `10` | `0` | `A` |
| `100` | `0` | `A` |
| `1001` | `1` | `B` |

The trace is `S → S → A → A → B`. All four symbols are consumed in `B`, so accept. In contrast, `010` has trace `S → A → B → A`: the accepting state is visited after two symbols, but the third symbol leaves it. Reject `010`.

For $\lambda$, the trace contains only `S`. Because `S` is not accepting, reject the empty string. An input containing `2` is outside this machine's stated alphabet and cannot be accepted.

### 检查点

**1.** Trace `10101` and decide acceptance. Include the state before reading the first symbol.

**2.** Trace `011`. Explain why recognizing the prefix `01` does not settle the result.

**3.** For the same machine, decide whether $\lambda$, `0`, `01`, and `001` are accepted. Which is the shortest accepted string?

**4.** A second machine starts at `U`, with `U --0→ V` and `V --1→ W`; only `W` accepts. There are no other arrows. Classify `01`, `010`, and `0`, identifying the exact failure point when an arrow is missing.

Completion standard: one consumed symbol per transition, a complete trace, and a final-state check after the last symbol.

### 参考答案

**1.** `S → S → A → B → A → B`. The five symbols are consumed; the final state is `B`, so accept `10101`.

**2.** `S → A → B → S`. After the prefix `01`, the machine is in `B`, but the final `1` takes it to `S`. Reject `011` because the complete input ends in a nonaccepting state.

**3.** The traces are: $\lambda$: `S`, reject; `0`: `S → A`, reject; `01`: `S → A → B`, accept; `001`: `S → A → A → B`, accept. The shortest accepted string is `01`, length 2. Neither the empty string nor either one-symbol string ends in `01`.

**4.** `01`: `U → V → W`, accept. `010`: after `01` the machine reaches `W`, but the third symbol `0` has no outgoing transition, so reject at symbol 3. `0`: `U → V`, reject because the complete input ends at nonaccepting `V`. Finishing at a nonaccepting state and becoming blocked before completion are different reasons for rejection.

### 关联题目

[]

## 章节：02. Describe complete paths and repeat complete cycles

### 学习目标

- Separate a mandatory entry path, a repeatable return cycle, and an exit path.
- Translate a path to concatenation and a repeatable cycle to a grouped Kleene star.
- Use short counterexamples to distinguish plausible language descriptions.

### 正文

#### A cycle is a return to the same state

```diagram
{
  "id": "paired-cycle",
  "width": 520,
  "height": 370,
  "alt": {
    "en": "Start P; accepting F. P to Q on m. Q to R on n. R to Q on p. Q to F on q. All other transitions are absent.",
    "zh": "初态 P，接受态 F。P 读 m 到 Q；Q 读 n 到 R；R 读 p 到 Q；Q 读 q 到 F。其他转移不存在。"
  },
  "elements": [
    {
      "type": "line",
      "x1": 20,
      "y1": 110,
      "x2": 53,
      "y2": 110
    },
    {
      "type": "polyline",
      "points": [
        [
          44,
          105
        ],
        [
          53,
          110
        ],
        [
          44,
          115
        ]
      ]
    },
    {
      "type": "circle",
      "cx": 80,
      "cy": 110,
      "r": 27
    },
    {
      "type": "circle",
      "cx": 250,
      "cy": 110,
      "r": 27
    },
    {
      "type": "circle",
      "cx": 430,
      "cy": 110,
      "r": 27
    },
    {
      "type": "circle",
      "cx": 250,
      "cy": 285,
      "r": 27
    },
    {
      "type": "circle",
      "cx": 250,
      "cy": 285,
      "r": 21
    },
    {
      "type": "text",
      "x": 80,
      "y": 116,
      "text": "P",
      "fontSize": 17,
      "anchor": "middle"
    },
    {
      "type": "text",
      "x": 250,
      "y": 116,
      "text": "Q",
      "fontSize": 17,
      "anchor": "middle"
    },
    {
      "type": "text",
      "x": 430,
      "y": 116,
      "text": "R",
      "fontSize": 17,
      "anchor": "middle"
    },
    {
      "type": "text",
      "x": 250,
      "y": 291,
      "text": "F",
      "fontSize": 17,
      "anchor": "middle"
    },
    {
      "type": "line",
      "x1": 107,
      "y1": 110,
      "x2": 223,
      "y2": 110
    },
    {
      "type": "polyline",
      "points": [
        [
          214,
          105
        ],
        [
          223,
          110
        ],
        [
          214,
          115
        ]
      ]
    },
    {
      "type": "text",
      "x": 165,
      "y": 99,
      "text": "m",
      "fontSize": 17,
      "anchor": "middle"
    },
    {
      "type": "path",
      "d": "M 270 92 C 320 35 360 35 410 92"
    },
    {
      "type": "polyline",
      "points": [
        [
          407.2,
          82.2
        ],
        [
          410,
          92
        ],
        [
          400.2,
          89.2
        ]
      ]
    },
    {
      "type": "text",
      "x": 340,
      "y": 40,
      "text": "n",
      "fontSize": 17,
      "anchor": "middle"
    },
    {
      "type": "path",
      "d": "M 410 128 C 360 185 320 185 270 128"
    },
    {
      "type": "polyline",
      "points": [
        [
          272.8,
          137.8
        ],
        [
          270,
          128
        ],
        [
          279.8,
          130.8
        ]
      ]
    },
    {
      "type": "text",
      "x": 340,
      "y": 197,
      "text": "p",
      "fontSize": 17,
      "anchor": "middle"
    },
    {
      "type": "line",
      "x1": 250,
      "y1": 137,
      "x2": 250,
      "y2": 258
    },
    {
      "type": "polyline",
      "points": [
        [
          255,
          249
        ],
        [
          250,
          258
        ],
        [
          245,
          249
        ]
      ]
    },
    {
      "type": "text",
      "x": 270,
      "y": 204,
      "text": "q",
      "fontSize": 17,
      "anchor": "middle"
    }
  ]
}
```

Start at `P`; only `F` accepts. A dash means no transition; it never means “remain in place.”

| Current state | Read `m` | Read `n` | Read `p` | Read `q` |
| --- | --- | --- | --- | --- |
| `P` | `Q` | — | — | — |
| `Q` | — | `R` | — | `F` |
| `R` | — | — | `Q` | — |
| `F` | — | — | — | — |

Every accepting walk begins by consuming `m` to reach `Q`. At `Q`, either exit immediately on `q`, or traverse `Q --n→ R --p→ Q` and return. This two-edge return consumes the **whole block `np`**. Repeat the block any nonnegative number of times, then consume `q` to finish at `F`.

The language is described by `m(np)*q`, where `*` means zero or more copies of the immediately preceding symbol or parenthesized group. An explicit family is $m(np)^kq$, $k\ge0$, with length $2+2k$. The exponent in this family counts copies; it is mathematical notation, not a regex `^` operator. Zero cycles gives `mq`; one gives `mnpq`; two give `mnpnpq`.

| Input | Complete trace or first blockage | Result |
| --- | --- | --- |
| `mq` | `P → Q → F` | Accept |
| `mnpq` | `P → Q → R → Q → F` | Accept |
| `mnpnpq` | `P → Q → R → Q → R → Q → F` | Accept |
| `mnq` | `P → Q → R`; no `q` from `R` | Reject |
| `mnppq` | `P → Q → R → Q`; no `p` from `Q` | Reject |

There is no arrow out of `F`, so an otherwise accepted string with an extra suffix is rejected. Completing a cycle is optional; completing the input is compulsory.

#### Order and grouping carry information

`m(np)*q` is not `mn*pq`. The latter repeats only `n` and requires a single `p`, so it accepts `mpq`. The machine cannot read `p` immediately after its initial `m`. Conversely, `mq` is accepted by the machine but lacks the mandatory `p` in `mn*pq`.

Nor is `(np)*` the same as `n*p*`: `nnpp` satisfies `n*p*` but not `(np)*`, because every `n` in the alternating cycle must be followed immediately by `p` before another `n` can occur. Repetition does not permit reordering.

#### Different accepting states describe different stopping points

If `R` were also accepting, one could finish after the `n` half of a final cycle. The resulting description would be `m(np)*q | m(np)*n`: either use the original exit or finish in `R`. Here `|` means union, so spaces around it are only typesetting. We write compact forms when testing literal strings.

Adding the start state `P` to the accepting states instead would add only $\lambda$ to the original language: no arrow returns to `P`. Changing which states accept changes which complete paths may finish; it does not create new transitions.

### 检查点

**1.** For the original machine, trace `mnpnpnpq`, `mnpq`, and `mnq`. Count complete `np` cycles in each accepted string.

**2.** Supply one string accepted only by `m(np)*q` and one accepted only by `mn*pq`. Explain the compulsory part each candidate violates.

**3.** Suppose both `R` and `F` accept, while all arrows remain unchanged. Classify `mn`, `mnpn`, `mnp`, and `mq`. Give a language description covering both possible ending states.

**4.** Instead, suppose only `P` and `F` accept. Classify $\lambda$, `m`, and `mq`. Why does accepting the start state not make every prefix acceptable?

### 参考答案

**1.** `mnpnpnpq`: `P → Q → R → Q → R → Q → R → Q → F`, accept, three complete cycles. `mnpq`: `P → Q → R → Q → F`, accept, one cycle. `mnq`: `P → Q → R`, then no `q` transition; reject. The unfinished `n` is not a complete `np` cycle.

**2.** `mq` belongs only to `m(np)*q`: zero cycles are permitted, whereas `mn*pq` still requires `p`. `mpq` belongs only to `mn*pq`: its `n*` is empty, but the original machine has no `p` transition from `Q`.

**3.** `mn`: `P → Q → R`, accept; `mnpn`: `P → Q → R → Q → R`, accept; `mnp`: `P → Q → R → Q`, reject; `mq`: `P → Q → F`, accept. A description is `m(np)*q|m(np)*n`. The second branch allows zero complete cycles before the final `n`, so it includes `mn`.

**4.** $\lambda$ leaves the machine in accepting `P`, so accept. `m` ends in nonaccepting `Q`, so reject. `mq` ends in `F`, so accept. The language is $\lambda\;|\;m(np)^*q$. A start-state acceptance decision applies to empty input; reading input still moves the machine along its arrows.

### 关联题目

[]

## 章节：03. Read the scope of every regular-expression operator

### 学习目标

- Apply repetition before concatenation before union, using parentheses to change scope.
- Interpret a character class as one character, including ranges and negation.
- Distinguish formal ACSL notation from implementation-specific programming regex syntax.

### 正文

#### Expressions describe sets of complete strings

In formal regular expressions, adjacency means concatenation, `|` (or the ACSL union notation `U`) offers alternatives, and `*` allows zero or more copies. Parentheses group a complete subexpression. Repetition binds most tightly, followed by concatenation, then union: `ab|cd*` means `(ab)|(c(d*))`, not `(ab|cd)*`. Formal $\lambda$ denotes the empty string, not a Greek letter in the input. A mathematical union symbol or `U` should not be pasted into a programming regex as though every engine interprets it as union.

ACSL also uses practical regex notation: `+` means one or more copies, `?` means zero or one, and `.` matches one character in the single-line examples here. Thus `ka?b+` accepts `kb`, `kab`, and `kabb`, but rejects `kaab` and `ka`. Parentheses matter: `(uv)+` repeats the two-character block; `uv+` repeats only `v`.

Programming libraries have dialects, flags, escape rules, and search APIs. This course uses the ACSL operators stated here and asks whether the **entire candidate string** belongs to the language. It does not assume that a successful substring search is acceptance. Anchors, backreferences, and programming-language string escaping are not required for these lessons.

#### One bracket expression consumes exactly one character

`[D-F]` means one of `D`, `E`, or `F`. `[D-F2-4]` combines two inclusive ranges into one choice. It does not mean a sequence consisting of a letter followed by a digit. Use `[D-F][2-4]` for that two-character sequence. Matching is case-sensitive unless a problem explicitly says otherwise.

A `^` immediately after the opening `[` negates the class: `[^mx]` means one character other than lowercase `m` or `x`, not “some other letter.” It can match a digit or punctuation. `[^mx]*` may match the empty string because `*` repeats the whole class zero times.

Inside a class, a `^` that is **not the first class character is literal**. Therefore `[g^j]` contains `g`, `^`, and `j`; `[^g^j]` excludes those three characters. In the second form, only the first `^` performs negation. Similarly `[r|t]` contains the literal vertical bar as well as `r` and `t`; outside a class, `r|t` is union and does not accept a vertical bar. These examples deliberately use different symbols from the associated contest questions.

#### Match chunks, then check what remains

Consider `[D-F][2-5]*[^mx]`. It requires an initial `D`–`F`, then any number of digits `2`–`5`, then exactly one final character other than `m` or `x`. Minimum length is 2: the starred middle may be empty, but the first and last classes are compulsory.

| Candidate | First class | Starred middle | Final class | Result |
| --- | --- | --- | --- | --- |
| `D2` | `D` | $\lambda$ | `2` | Accept |
| `F44!` | `F` | `44` | `!` | Accept |
| `E3x` | `E` | `3` | `x` is forbidden | Reject |
| `D` | `D` | $\lambda$ | Missing | Reject |
| `F55^` | `F` | `55` | `^` | Accept |

A character may qualify for more than one adjacent part. In `D2`, the `2` must be left for the final class; consuming it in the middle would leave a required part empty. Acceptance requires at least one valid complete division into parts, not a particular greedy hand-trace.

### 检查点

**1.** Test `N`, `M3`, `P66?`, `Q4!`, and `N5z` against `[M-P][3-6]*[^az]`. For each acceptance, show the three parts.

**2.** For each of `r`, `^`, `u`, `v`, and `7`, compare membership in `[r^u]` and `[^r^u]`. What does the second `^` mean in the negated class?

**3.** Compare `h(i|jk)*l` with `hi|jkl` on `hl`, `hijkl`, `hjkjkl`, `hi`, and `jkl`. Explain the group being repeated and the scope of union.

**4.** Test `vf`, `veff`, `veef`, and `v` against `ve?f+`. Give an accepted string for `(uv)+` that `uv+` rejects, and one accepted by `uv+` that `(uv)+` rejects.

### 参考答案

**1.** `N` rejects: the final class is missing. `M3` accepts with `M`, $\lambda$, `3`; `P66?` accepts with `P`, `66`, `?`. `Q4!` rejects because `Q` is outside `M`–`P`. `N5z` rejects because its required last character is `z`, which the final class excludes.

**2.** `[r^u]` accepts `r`, `^`, and `u`, and rejects `v` and `7`. `[^r^u]` rejects `r`, `^`, and `u`, and accepts `v` and `7`. The first `^` negates; the later `^` is one of the literal forbidden characters. Neither class consumes two characters at once.

**3.** `h(i|jk)*l` accepts `hl` (zero repeated blocks), `hijkl` (blocks `i`, `jk`), and `hjkjkl` (blocks `jk`, `jk`); it rejects `hi` and `jkl` because the mandatory outer `h` and `l` are not both present. `hi|jkl` accepts exactly `hi` or `jkl`, so it rejects the first three candidates. Its union separates two complete alternatives; it does not repeat anything.

**4.** `vf` accepts: zero `e`, one `f`. `veff` accepts: one `e`, two `f`s. `veef` rejects because `e?` allows at most one `e`. `v` rejects because `f+` requires at least one `f`. `uvuv` is accepted only by `(uv)+`; `uvv` is accepted only by `uv+`. The former repeats a pair, while the latter keeps one initial `u` and repeats `v`.

### 关联题目

[]

## 章节：04. Use boundaries and counterexamples to verify a language

### 学习目标

- Check empty input, minimum length, extra suffixes, and complete consumption systematically.
- Handle overlapping adjacent classes by finding a valid complete split.
- Compare an FSA and a regular expression without mistaking a few examples for a proof.

### 正文

#### Start with the boundaries that expose hidden assumptions

Use this sequence: identify the alphabet and mandatory parts; test $\lambda$; test a shortest possible input; test a near miss with an extra or missing symbol; then inspect repeated blocks. Write a reason for each rejection.

| Expression | Empty string? | Short accepted example | Revealing rejection |
| --- | --- | --- | --- |
| `a*` | Yes | `a` | `b` |
| `aa*` | No | `a` | $\lambda$ |
| `(ab)*` | Yes | `ab` | `aba` |
| `a\|bc` | No | `a` | `ac` |
| `(a\|b)c` | No | `ac` | `a` |

`a|bc` offers `a` or `bc`; `(a|b)c` requires a final `c` in either branch. Zero copies of `(ab)` contribute no characters, so $\lambda$ is accepted by `(ab)*`. It is not the same as the single character `a` or a literal printed lambda symbol.

#### Leave enough input for the mandatory last part

For `[3-6]*[5-8]`, reserve the final character for `[5-8]`, and check every preceding character against `[3-6]`.

| Input | Repeated prefix | Mandatory last character | Result |
| --- | --- | --- | --- |
| `5` | $\lambda$ | `5` | Accept |
| `56` | `5` | `6` | Accept |
| `58` | `5` | `8` | Accept |
| `65` | `6` | `5` | Accept |
| `79` | `7` is outside `[3-6]` | `9` is outside `[5-8]` | Reject |

A failed split does not prove rejection when another split could work. Here the final part has fixed length one, so reserving that last character removes ambiguity. More generally, try all plausible boundaries without changing the order of characters.

#### “Contains a match” is a different question

`cabd` contains the substring `ab`, but does not belong to the language `ab`: the `c` and `d` remain unconsumed. A programming search API may report a match. That result answers a different question from full-string acceptance. If using software to check a lesson, choose full-match semantics and the intended dialect explicitly; do not rely on a search default.

For the first lesson's machine, `(0|1)*01` is a language description. The prefix may be any binary string, including empty, but the final two symbols must be `01`. The state invariant proves the connection: after any consumed prefix, `B` holds exactly when that prefix ends in `01`. At end of input, the machine therefore agrees with the expression for all binary strings, not merely the examples tested.

Checking every string up to a chosen length is useful for finding a counterexample, but cannot by itself prove equivalence for arbitrarily long inputs. One counterexample is enough to disprove equivalence. For example, `a*b*` rejects `ba`, while `(a|b)*` accepts it. The former separates an `a` phase from a `b` phase; the latter permits mixing throughout.

### 检查点

**1.** Test `6`, `46`, `679`, and `89` against `[4-7]*[6-9]`. Show the exact prefix/final-character split for accepted cases.

**2.** Compare `a*b*` and `(a|b)*` on $\lambda$, `abba`, `bbb`, and `aaab`. Are the languages equivalent? Give the shortest counterexample and explain why it is shortest.

**3.** Use both the first lesson's state table and `(0|1)*01` to classify `001`, `0011`, $\lambda$, and `01`. A search tool finds `01` inside `0011`; why does the machine still reject the whole string?

**4.** In formal notation, $\lambda\;|\;cd$ is over the alphabet {c, d}. Classify empty input, `cd`, `c`, `cdd`, and an input consisting of the literal printed character `λ`. Why might typing `λ|cd` into a programming regex tool give a different result?

### 参考答案

**1.** `6`: $\lambda$ plus `6`, accept. `46`: `4` plus `6`, accept. `679`: `67` plus `9`, accept. `89` rejects: reserving `9` for the last class leaves `8`, which is outside `[4-7]`. The prefix may be empty but may not contain an out-of-range character.

**2.** Both accept $\lambda$, `bbb`, and `aaab`. Only `(a|b)*` accepts `abba`: `a*b*` cannot return to `a` after entering its `b` part. The languages are not equivalent. A shortest counterexample is `ba`, length 2: empty input and both length-one strings `a` and `b` are accepted by both expressions, so no shorter counterexample exists.

**3.** `001`: `S → A → A → B`, accept; `0011`: `S → A → A → B → S`, reject; $\lambda$: `S`, reject; `01`: `S → A → B`, accept. The expression gives the same decisions: only `001` and `01` end in `01`. A substring of `0011` ends there, but the complete input still has a trailing `1`. Full-string matching cannot discard it.

**4.** Accept empty input through the $\lambda$ branch and `cd` through the other branch. Reject `c` (incomplete), `cdd` (extra `d`), and the literal input `λ` (not in the alphabet and not empty). In a typical programming regex, a typed Greek `λ` is an ordinary character, so `λ|cd` does not encode the formal empty-string branch. Translate the intended semantics before using a programming tool; visual resemblance is not semantic equivalence.

### 关联题目

[]
