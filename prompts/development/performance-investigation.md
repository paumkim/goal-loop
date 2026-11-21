# Performance Investigation

Find a real performance problem, fix it with evidence, and prove behavior is
unchanged.

## Before acting
- Discover the project's benchmark, profiling, test, and build commands from its
  docs and scripts.
- Identify the user-visible symptom: slow command, high CPU/memory, latency,
  render churn, startup time, or oversized artifact. Define what "better" means.

## Investigate
1. **Baseline:** measure the current behavior with a repeatable command, benchmark,
   profile, or trace. Record environment constraints that affect the numbers.
2. **Locate bottleneck:** profile or instrument the hot path. Identify where time,
   memory, or work is actually spent; do not optimize by intuition alone.
3. **Choose a fix:** pick the smallest change that targets the measured bottleneck.
   Consider complexity, memory, and maintainability tradeoffs.
4. **Implement:** make the change while preserving observable behavior and public
   APIs. Add guards/comments only where the optimization is non-obvious.
5. **Re-measure:** run the same measurement method after the fix and compare.

## Rules
- No "feels faster" claims. Every improvement claim needs before/after evidence.
- Do not trade correctness for speed. Add or run regression tests for affected
  behavior.
- Do not micro-optimize cold paths without evidence.
- Keep benchmarks/scripts you add reproducible; remove throwaway instrumentation.

## Verify
- Paste before/after measurements with the exact commands used.
- Run relevant tests, typecheck, lint, and build commands; paste quoted output.
- Show `git diff --stat` and explain any tradeoff (memory, complexity, caching).

## Report
- Symptom and metric:
- Bottleneck with `file:line` evidence:
- Change made:
- Before/after numbers:
- Checks run and behavior-preservation evidence:
