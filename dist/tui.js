// @bun
// src/tui.tsx
import { use as _$use } from "@opentui/solid";
import { createTextNode as _$createTextNode3 } from "@opentui/solid";
import { insertNode as _$insertNode3 } from "@opentui/solid";
import { memo as _$memo3 } from "@opentui/solid";
import { createComponent as _$createComponent3 } from "@opentui/solid";
import { effect as _$effect3 } from "@opentui/solid";
import { insert as _$insert3 } from "@opentui/solid";
import { setProp as _$setProp3 } from "@opentui/solid";
import { createElement as _$createElement3 } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { TextAttributes as TextAttributes3 } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createMemo, createSignal, Show as Show3 } from "solid-js";

// src/core/format.ts
var GOAL_GLYPH = "\u25CE";
function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor(total % 3600 / 60);
  const s = total % 60;
  if (h > 0)
    return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0)
    return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}
function formatDurationCoarse(ms) {
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  if (minutes < 1)
    return "<1m";
  if (minutes < 60)
    return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}
function formatTokens(n) {
  if (n < 1000)
    return String(Math.round(n));
  if (n < 1e6)
    return `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k`;
  return `${(n / 1e6).toFixed(2)}M`;
}
function formatCost(usd) {
  if (usd <= 0)
    return "$0";
  return usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;
}
function formatSpend(spend) {
  const parts = [`${formatTokens(spend.input + spend.cacheRead + spend.cacheWrite)} in`, `${formatTokens(spend.output + spend.reasoning)} out`];
  if (spend.cacheRead > 0)
    parts.push(`${formatTokens(spend.cacheRead)} cached`);
  if (spend.cost > 0)
    parts.push(formatCost(spend.cost));
  return parts.join(" \xB7 ");
}
function truncate(text, max) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}\u2026`;
}

// src/core/types.ts
var LIVE_STATUSES = new Set(["active", "paused"]);
var isLive = (status) => LIVE_STATUSES.has(status);

// src/status-dialog.tsx
import { createTextNode as _$createTextNode2 } from "@opentui/solid";
import { memo as _$memo2 } from "@opentui/solid";
import { createComponent as _$createComponent2 } from "@opentui/solid";
import { insertNode as _$insertNode2 } from "@opentui/solid";
import { effect as _$effect2 } from "@opentui/solid";
import { insert as _$insert2 } from "@opentui/solid";
import { setProp as _$setProp2 } from "@opentui/solid";
import { createElement as _$createElement2 } from "@opentui/solid";
import { Show as Show2 } from "solid-js";
import { TextAttributes as TextAttributes2 } from "@opentui/core";

// src/tui-history.tsx
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { For, Show } from "solid-js";

// src/core/history.ts
var BAR_CELLS = 18;
function renderBar(done, max, cells = BAR_CELLS) {
  const width = Math.max(1, Math.floor(cells));
  const safeMax = typeof max === "number" && Number.isFinite(max) && max > 0 ? max : 0;
  const safeDone = Number.isFinite(done) ? Math.max(0, done) : 0;
  const filled = safeMax === 0 ? 0 : Math.min(width, Math.max(0, Math.round(safeDone / safeMax * width)));
  return { filled, text: "\u2588".repeat(filled) + "\u2591".repeat(width - filled) };
}
function barCaption(current, max, done) {
  const safeDone = Number.isFinite(done) ? Math.max(0, done) : 0;
  const v = Number.isFinite(current) && current >= 1 ? Math.floor(current) : 1;
  return typeof max === "number" && Number.isFinite(max) && max > 0 ? `v${v} of at most ${Math.floor(max)} \xB7 ${safeDone} complete` : `v${v} \xB7 ${safeDone} complete`;
}
function verdictGlyph(verdict) {
  switch (verdict) {
    case "met":
      return "\u2713";
    case "impossible":
      return "\u2298";
    default:
      return "\u2717";
  }
}
function iterationDurations(entries, setAt) {
  const out = [];
  let previous = setAt;
  for (const entry of entries) {
    const span = Number.isFinite(entry.endedAt) ? entry.endedAt - previous : 0;
    out.push(Math.max(0, span));
    previous = Number.isFinite(entry.endedAt) ? entry.endedAt : previous;
  }
  return out;
}
function trailWindow(history, limit = 24) {
  const total = history.length;
  const shown = limit >= total ? history : history.slice(total - limit);
  return { shown, total };
}
function verdictCounts(history) {
  let met = 0;
  let not_met = 0;
  let impossible = 0;
  for (const entry of history) {
    if (entry.verdict === "met")
      met += 1;
    else if (entry.verdict === "impossible")
      impossible += 1;
    else
      not_met += 1;
  }
  return { met, not_met, impossible, total: history.length };
}
function lastVerdict(history) {
  return history.length === 0 ? undefined : history[history.length - 1];
}
function renderPips(done, max) {
  if (typeof max !== "number" || !Number.isFinite(max))
    return "";
  const cap = Math.floor(max);
  if (cap < 1 || cap > 8)
    return "";
  const filled = Math.min(Math.max(0, Math.floor(Number.isFinite(done) ? done : 0)), cap);
  return "\u25CF".repeat(filled) + "\u25CB".repeat(cap - filled);
}
function paceEstimate(durations, max) {
  if (durations.length === 0)
    return;
  if (typeof max !== "number" || !Number.isFinite(max) || max <= 0)
    return;
  const left = Math.floor(max) - durations.length;
  if (left <= 0)
    return;
  const perIteration = durations.reduce((sum, span) => sum + span, 0) / durations.length;
  return { perIteration, remaining: perIteration * left };
}
function iterationVerdictMix(history, entries, setAt) {
  const out = [];
  let start = setAt;
  for (const entry of entries) {
    const end = entry.endedAt;
    const slice = history.filter((verdict) => verdict.at > start && verdict.at <= end);
    out.push(slice.length === 0 ? undefined : verdictCounts(slice));
    start = end;
  }
  return out;
}
function verdictStreak(history) {
  const last = history[history.length - 1];
  if (!last)
    return { verdict: undefined, count: 0 };
  let count = 1;
  for (let index = history.length - 2;index >= 0; index -= 1) {
    if (history[index]?.verdict !== last.verdict)
      break;
    count += 1;
  }
  return { verdict: last.verdict, count };
}
function relativeTime(endedAt, nowMs) {
  const delta = Math.max(0, nowMs - endedAt);
  if (!Number.isFinite(delta))
    return "just now";
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1)
    return "just now";
  if (minutes < 60)
    return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}
function pauseDiagnostics(stall, retries) {
  const clean = (value) => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `stall ${clean(stall)} \xB7 retries ${clean(retries)}`;
}
function loopTotals(entries, setAt) {
  let turns = 0;
  let tools = 0;
  let lastEnded = 0;
  for (const entry of entries) {
    turns += Number.isFinite(entry.turns) ? entry.turns : 0;
    tools += Number.isFinite(entry.toolCalls) ? entry.toolCalls : 0;
    if (Number.isFinite(entry.endedAt) && entry.endedAt > lastEnded)
      lastEnded = entry.endedAt;
  }
  const spanMs = entries.length === 0 ? 0 : Math.max(0, lastEnded - setAt);
  return { iterations: entries.length, turns, tools, spanMs };
}
function localTime(ms) {
  if (!Number.isFinite(ms))
    return "--:--";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime()))
    return "--:--";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
function currentIterationVerdict(history, entries, setAt) {
  const from = entries.length > 0 ? entries[entries.length - 1].endedAt : setAt;
  for (let index = history.length - 1;index >= 0; index -= 1) {
    const entry = history[index];
    if (entry.at > from)
      return entry;
    break;
  }
  return;
}
function turnsSinceVerdict(turns, verdictTurn) {
  if (!Number.isFinite(turns) || !Number.isFinite(verdictTurn))
    return 0;
  return Math.max(0, Math.floor(turns) - Math.floor(verdictTurn));
}

// src/tui-history.tsx
var SUMMARY_MAX = 400;
var label = (theme, text) => (() => {
  var _el$ = _$createElement("text");
  _$setProp(_el$, "flexShrink", 0);
  _$setProp(_el$, "width", 10);
  _$insert(_el$, text);
  _$effect((_$p) => _$setProp(_el$, "fg", theme.text.faint, _$p));
  return _el$;
})();
var colorFor = (theme, verdict) => verdict === "met" ? theme.text.feedback.info.base : verdict === "impossible" ? theme.text.feedback.warning.base : theme.text.faint;
var LoopSection = (props) => {
  const theme = () => props.theme;
  const history = () => props.goal.loopHistory ?? [];
  const done = () => history().length;
  const max = () => props.goal.loopMaxLoops;
  const current = () => Math.max(1, props.goal.loopIteration ?? done() + 1);
  const bar = () => renderBar(done(), max());
  const durations = () => iterationDurations(history(), props.goal.setAt);
  const pace = () => paceEstimate(durations(), max());
  const mixes = () => iterationVerdictMix(props.goal.history ?? [], history(), props.goal.setAt);
  const mixSuffix = (index) => {
    const mix = mixes()[index];
    return mix ? ` \xB7 ${mix.met}\u2713 ${mix.not_met}\u2717${mix.impossible > 0 ? ` ${mix.impossible}\u2298` : ""}` : "";
  };
  const endedSuffix = (entry) => ` \xB7 ended ${relativeTime(entry.endedAt, nowMs())} at ${localTime(entry.endedAt)}`;
  const paused = () => props.goal.status === "paused";
  const stateWord = () => {
    const s = props.goal.status;
    if (s === "paused")
      return "paused";
    if (s !== "active")
      return s;
    return props.goal.evaluating ? "checking" : props.goal.waiting ? "waiting" : "active";
  };
  const nowMs = () => props.nowMs?.() ?? Date.now();
  const iterVerdict = () => currentIterationVerdict(props.goal.history ?? [], history(), props.goal.setAt);
  const turnsSince = () => {
    const v = iterVerdict();
    return v ? turnsSinceVerdict(props.goal.turns, v.turn) : 0;
  };
  const streakSuffix = () => {
    const s = verdictStreak(props.goal.history ?? []);
    return s.count >= 2 && s.verdict ? ` \xB7 ${s.count}\xD7 ${s.verdict.replace("_", " ")} in a row` : "";
  };
  const isTerminal = () => props.goal.status === "achieved" || props.goal.status === "impossible" || props.goal.status === "cleared" || props.goal.status === "failed";
  const capReached = () => typeof max() === "number" && Number.isFinite(max()) && done() >= max();
  const livePace = () => isTerminal() ? undefined : pace();
  const finished = () => history().length > 0 && (isTerminal() || capReached());
  const totals = () => loopTotals(history(), props.goal.setAt);
  const finalGlyph = () => props.goal.status === "achieved" ? "\u2713" : props.goal.status === "impossible" ? "\u2298" : "\u2717";
  const finalColor = () => props.goal.status === "achieved" ? theme().text.feedback.info.base : props.goal.status === "impossible" ? theme().text.feedback.warning.base : theme().text.faint;
  const nowColor = () => {
    const s = props.goal.status;
    if (s === "paused" || s === "impossible")
      return theme().text.feedback.warning.base;
    if (s === "active")
      return theme().text.feedback.info.base;
    return theme().text.faint;
  };
  return (() => {
    var _el$2 = _$createElement("box"), _el$3 = _$createElement("box"), _el$4 = _$createElement("text"), _el$5 = _$createElement("box"), _el$6 = _$createElement("box"), _el$7 = _$createElement("box"), _el$0 = _$createElement("box"), _el$1 = _$createElement("text"), _el$10 = _$createElement("box"), _el$11 = _$createElement("text"), _el$13 = _$createElement("text");
    _$insertNode(_el$2, _el$3);
    _$insertNode(_el$2, _el$5);
    _$insertNode(_el$2, _el$0);
    _$insertNode(_el$2, _el$10);
    _$setProp(_el$2, "flexDirection", "column");
    _$setProp(_el$2, "gap", 1);
    _$insertNode(_el$3, _el$4);
    _$setProp(_el$3, "flexDirection", "row");
    _$setProp(_el$3, "gap", 2);
    _$insert(_el$3, () => label(theme(), "loop"), _el$4);
    _$setProp(_el$4, "wrapMode", "none");
    _$insert(_el$4, () => barCaption(current(), max(), done()));
    _$insertNode(_el$5, _el$6);
    _$insertNode(_el$5, _el$7);
    _$setProp(_el$5, "flexDirection", "row");
    _$setProp(_el$5, "gap", 2);
    _$setProp(_el$6, "width", 10);
    _$setProp(_el$6, "flexShrink", 0);
    _$setProp(_el$7, "flexDirection", "row");
    _$setProp(_el$7, "flexShrink", 0);
    _$insert(_el$7, _$createComponent(Show, {
      get when() {
        return bar().filled > 0;
      },
      get children() {
        var _el$8 = _$createElement("text");
        _$setProp(_el$8, "wrapMode", "none");
        _$insert(_el$8, () => "\u2588".repeat(bar().filled));
        _$effect((_$p) => _$setProp(_el$8, "fg", theme().text.feedback.info.base, _$p));
        return _el$8;
      }
    }), null);
    _$insert(_el$7, _$createComponent(Show, {
      get when() {
        return BAR_CELLS - bar().filled > 0;
      },
      get children() {
        var _el$9 = _$createElement("text");
        _$setProp(_el$9, "wrapMode", "none");
        _$insert(_el$9, () => "\u2591".repeat(BAR_CELLS - bar().filled));
        _$effect((_$p) => _$setProp(_el$9, "fg", theme().text.faint, _$p));
        return _el$9;
      }
    }), null);
    _$insert(_el$2, _$createComponent(Show, {
      get when() {
        return livePace();
      },
      children: (estimate) => (() => {
        var _el$17 = _$createElement("box"), _el$18 = _$createElement("text");
        _$insertNode(_el$17, _el$18);
        _$setProp(_el$17, "flexDirection", "row");
        _$setProp(_el$17, "gap", 2);
        _$insert(_el$17, () => label(theme(), "pace"), _el$18);
        _$setProp(_el$18, "wrapMode", "none");
        _$insert(_el$18, () => `~${formatDurationCoarse(estimate().perIteration)}/iteration \xB7 ~${formatDurationCoarse(estimate().remaining)} left at this pace`);
        _$effect((_$p) => _$setProp(_el$18, "fg", theme().text.faint, _$p));
        return _el$17;
      })()
    }), _el$0);
    _$insertNode(_el$0, _el$1);
    _$setProp(_el$0, "flexDirection", "row");
    _$setProp(_el$0, "gap", 2);
    _$insert(_el$0, () => label(theme(), "objective"), _el$1);
    _$setProp(_el$1, "wrapMode", "word");
    _$setProp(_el$1, "flexGrow", 1);
    _$insert(_el$1, () => props.goal.loopObjective ?? "?");
    _$insert(_el$2, _$createComponent(For, {
      get each() {
        return history();
      },
      children: (entry, index) => (() => {
        var _el$19 = _$createElement("box"), _el$20 = _$createElement("box"), _el$21 = _$createElement("text"), _el$23 = _$createElement("text");
        _$insertNode(_el$19, _el$20);
        _$setProp(_el$19, "flexDirection", "column");
        _$insertNode(_el$20, _el$21);
        _$insertNode(_el$20, _el$23);
        _$setProp(_el$20, "flexDirection", "row");
        _$setProp(_el$20, "gap", 2);
        _$insert(_el$20, () => label(theme(), `v${entry.version}`), _el$21);
        _$insertNode(_el$21, _$createTextNode(`\u2713`));
        _$setProp(_el$21, "wrapMode", "none");
        _$setProp(_el$21, "flexShrink", 0);
        _$setProp(_el$23, "wrapMode", "none");
        _$insert(_el$23, () => `met \xB7 ${entry.turns} turn${entry.turns === 1 ? "" : "s"} \xB7 ${entry.toolCalls} tool${entry.toolCalls === 1 ? "" : "s"} \xB7 ${formatDuration(durations()[index()] ?? 0)}${mixSuffix(index())}${endedSuffix(entry)}`);
        _$insert(_el$19, _$createComponent(Show, {
          get when() {
            return entry.summary.trim().length > 0;
          },
          get children() {
            var _el$24 = _$createElement("box"), _el$25 = _$createElement("text"), _el$27 = _$createElement("text");
            _$insertNode(_el$24, _el$25);
            _$insertNode(_el$24, _el$27);
            _$setProp(_el$24, "flexDirection", "row");
            _$setProp(_el$24, "gap", 2);
            _$insertNode(_el$25, _$createTextNode(`\u2502`));
            _$setProp(_el$25, "flexShrink", 0);
            _$setProp(_el$25, "width", 10);
            _$setProp(_el$27, "wrapMode", "word");
            _$setProp(_el$27, "flexGrow", 1);
            _$insert(_el$27, () => `\u2502 ${truncate(entry.summary, SUMMARY_MAX)}`);
            _$effect((_p$) => {
              var _v$0 = theme().text.faint, _v$1 = theme().text.faint;
              _v$0 !== _p$.e && (_p$.e = _$setProp(_el$25, "fg", _v$0, _p$.e));
              _v$1 !== _p$.t && (_p$.t = _$setProp(_el$27, "fg", _v$1, _p$.t));
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$24;
          }
        }), null);
        _$effect((_p$) => {
          var _v$10 = theme().text.feedback.info.base, _v$11 = theme().text.base;
          _v$10 !== _p$.e && (_p$.e = _$setProp(_el$21, "fg", _v$10, _p$.e));
          _v$11 !== _p$.t && (_p$.t = _$setProp(_el$23, "fg", _v$11, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$19;
      })()
    }), _el$10);
    _$insertNode(_el$10, _el$11);
    _$insertNode(_el$10, _el$13);
    _$setProp(_el$10, "flexDirection", "row");
    _$setProp(_el$10, "gap", 2);
    _$insert(_el$10, () => label(theme(), "now"), _el$11);
    _$insertNode(_el$11, _$createTextNode(`\u25CE`));
    _$setProp(_el$11, "wrapMode", "none");
    _$setProp(_el$11, "flexShrink", 0);
    _$setProp(_el$13, "wrapMode", "word");
    _$setProp(_el$13, "flexGrow", 1);
    _$insert(_el$13, () => `v${current()} \xB7 ${stateWord()} \xB7 ${props.goal.turns} turn${props.goal.turns === 1 ? "" : "s"}${paused() ? ` \xB7 ${pauseDiagnostics(props.goal.stall, props.goal.retries)}` : ""} \xB7 ${formatDurationCoarse(props.elapsedMs())} elapsed${streakSuffix()}`);
    _$insert(_el$10, _$createComponent(Show, {
      get when() {
        return iterVerdict();
      },
      children: (entry) => (() => {
        var _el$28 = _$createElement("box"), _el$29 = _$createElement("text"), _el$31 = _$createElement("text"), _el$32 = _$createElement("text");
        _$insertNode(_el$28, _el$29);
        _$insertNode(_el$28, _el$31);
        _$insertNode(_el$28, _el$32);
        _$setProp(_el$28, "flexDirection", "row");
        _$setProp(_el$28, "gap", 1);
        _$setProp(_el$28, "flexShrink", 0);
        _$insertNode(_el$29, _$createTextNode(`\xB7 last`));
        _$setProp(_el$29, "wrapMode", "none");
        _$setProp(_el$31, "wrapMode", "none");
        _$insert(_el$31, () => verdictGlyph(entry().verdict));
        _$setProp(_el$32, "wrapMode", "none");
        _$insert(_el$32, (() => {
          var _c$ = _$memo(() => turnsSince() === 0);
          return () => _c$() ? "this turn" : `${turnsSince()} turn${turnsSince() === 1 ? "" : "s"} since`;
        })());
        _$effect((_p$) => {
          var _v$12 = theme().text.muted, _v$13 = colorFor(theme(), entry().verdict), _v$14 = TextAttributes.BOLD, _v$15 = theme().text.faint;
          _v$12 !== _p$.e && (_p$.e = _$setProp(_el$29, "fg", _v$12, _p$.e));
          _v$13 !== _p$.t && (_p$.t = _$setProp(_el$31, "fg", _v$13, _p$.t));
          _v$14 !== _p$.a && (_p$.a = _$setProp(_el$31, "attributes", _v$14, _p$.a));
          _v$15 !== _p$.o && (_p$.o = _$setProp(_el$32, "fg", _v$15, _p$.o));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined,
          o: undefined
        });
        return _el$28;
      })()
    }), null);
    _$insert(_el$2, _$createComponent(Show, {
      get when() {
        return finished();
      },
      get children() {
        var _el$14 = _$createElement("box"), _el$15 = _$createElement("text"), _el$16 = _$createElement("text");
        _$insertNode(_el$14, _el$15);
        _$insertNode(_el$14, _el$16);
        _$setProp(_el$14, "flexDirection", "row");
        _$setProp(_el$14, "gap", 2);
        _$insert(_el$14, () => label(theme(), "final"), _el$15);
        _$setProp(_el$15, "wrapMode", "none");
        _$setProp(_el$15, "flexShrink", 0);
        _$insert(_el$15, finalGlyph);
        _$setProp(_el$16, "wrapMode", "none");
        _$insert(_el$16, () => `loop ${props.goal.status} \xB7 ${totals().iterations} iteration${totals().iterations === 1 ? "" : "s"} \xB7 ${totals().turns} turns \xB7 ${totals().tools} tools \xB7 ${formatDurationCoarse(totals().spanMs)} wall`);
        _$effect((_p$) => {
          var _v$ = finalColor(), _v$2 = TextAttributes.BOLD, _v$3 = theme().text.base;
          _v$ !== _p$.e && (_p$.e = _$setProp(_el$15, "fg", _v$, _p$.e));
          _v$2 !== _p$.t && (_p$.t = _$setProp(_el$15, "attributes", _v$2, _p$.t));
          _v$3 !== _p$.a && (_p$.a = _$setProp(_el$16, "fg", _v$3, _p$.a));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined
        });
        return _el$14;
      }
    }), null);
    _$insert(_el$2, _$createComponent(VerdictTrail, {
      get theme() {
        return theme();
      },
      get history() {
        return props.goal.history ?? [];
      }
    }), null);
    _$effect((_p$) => {
      var _v$4 = theme().text.base, _v$5 = TextAttributes.BOLD, _v$6 = theme().text.base, _v$7 = nowColor(), _v$8 = TextAttributes.BOLD, _v$9 = theme().text.base;
      _v$4 !== _p$.e && (_p$.e = _$setProp(_el$4, "fg", _v$4, _p$.e));
      _v$5 !== _p$.t && (_p$.t = _$setProp(_el$4, "attributes", _v$5, _p$.t));
      _v$6 !== _p$.a && (_p$.a = _$setProp(_el$1, "fg", _v$6, _p$.a));
      _v$7 !== _p$.o && (_p$.o = _$setProp(_el$11, "fg", _v$7, _p$.o));
      _v$8 !== _p$.i && (_p$.i = _$setProp(_el$11, "attributes", _v$8, _p$.i));
      _v$9 !== _p$.n && (_p$.n = _$setProp(_el$13, "fg", _v$9, _p$.n));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined
    });
    return _el$2;
  })();
};
var VerdictTrail = (props) => {
  const trail = () => trailWindow(props.history, 24);
  return _$createComponent(Show, {
    get when() {
      return trail().shown.length > 0;
    },
    get children() {
      var _el$33 = _$createElement("box"), _el$34 = _$createElement("box"), _el$35 = _$createElement("text"), _el$36 = _$createTextNode(` `), _el$37 = _$createTextNode(` of `), _el$38 = _$createTextNode(` verdict`);
      _$insertNode(_el$33, _el$34);
      _$insertNode(_el$33, _el$35);
      _$setProp(_el$33, "flexDirection", "row");
      _$setProp(_el$33, "gap", 2);
      _$insert(_el$33, () => label(props.theme, "trail"), _el$34);
      _$setProp(_el$34, "flexDirection", "row");
      _$setProp(_el$34, "flexShrink", 0);
      _$insert(_el$34, _$createComponent(For, {
        get each() {
          return trail().shown;
        },
        children: (entry) => (() => {
          var _el$39 = _$createElement("text");
          _$setProp(_el$39, "wrapMode", "none");
          _$insert(_el$39, () => verdictGlyph(entry.verdict));
          _$effect((_$p) => _$setProp(_el$39, "fg", colorFor(props.theme, entry.verdict), _$p));
          return _el$39;
        })()
      }));
      _$insertNode(_el$35, _el$36);
      _$insertNode(_el$35, _el$37);
      _$insertNode(_el$35, _el$38);
      _$setProp(_el$35, "wrapMode", "none");
      _$setProp(_el$35, "flexShrink", 0);
      _$insert(_el$35, () => trail().shown.length, _el$37);
      _$insert(_el$35, () => trail().total, _el$38);
      _$insert(_el$35, () => trail().total === 1 ? "" : "s", null);
      _$effect((_$p) => _$setProp(_el$35, "fg", props.theme.text.muted, _$p));
      return _el$33;
    }
  });
};
var HistoryBlock = (props) => {
  const theme = () => props.theme;
  const history = () => props.goal.history ?? [];
  const counts = () => verdictCounts(history());
  const last = () => lastVerdict(history());
  const streak = () => verdictStreak(history());
  const streakSuffix = () => {
    const s = streak();
    return s.count >= 2 && s.verdict ? ` \xB7 ${s.count}\xD7 ${s.verdict.replace("_", " ")} in a row` : "";
  };
  const elapsed = () => formatDurationCoarse(props.elapsedMs());
  const countsText = () => {
    const c = counts();
    const parts = [`${c.met} met`, `${c.not_met} not_met`];
    if (c.impossible > 0)
      parts.push(`${c.impossible} impossible`);
    return parts.join(" \xB7 ");
  };
  return (() => {
    var _el$40 = _$createElement("box"), _el$41 = _$createElement("box");
    _$insertNode(_el$40, _el$41);
    _$setProp(_el$40, "flexDirection", "column");
    _$setProp(_el$40, "gap", 1);
    _$setProp(_el$41, "flexDirection", "row");
    _$setProp(_el$41, "gap", 2);
    _$insert(_el$41, () => label(theme(), "history"), null);
    _$insert(_el$41, _$createComponent(Show, {
      get when() {
        return last();
      },
      get fallback() {
        return (() => {
          var _el$42 = _$createElement("text"), _el$43 = _$createTextNode(`no verdicts yet \xB7 `), _el$44 = _$createTextNode(` elapsed`);
          _$insertNode(_el$42, _el$43);
          _$insertNode(_el$42, _el$44);
          _$setProp(_el$42, "wrapMode", "none");
          _$insert(_el$42, elapsed, _el$44);
          _$effect((_$p) => _$setProp(_el$42, "fg", theme().text.faint, _$p));
          return _el$42;
        })();
      },
      children: (entry) => (() => {
        var _el$45 = _$createElement("box"), _el$46 = _$createElement("text"), _el$47 = _$createElement("text");
        _$insertNode(_el$45, _el$46);
        _$insertNode(_el$45, _el$47);
        _$setProp(_el$45, "flexDirection", "row");
        _$setProp(_el$45, "gap", 2);
        _$setProp(_el$45, "flexGrow", 1);
        _$setProp(_el$46, "wrapMode", "none");
        _$setProp(_el$46, "flexShrink", 0);
        _$insert(_el$46, () => verdictGlyph(entry().verdict));
        _$setProp(_el$47, "wrapMode", "word");
        _$setProp(_el$47, "flexGrow", 1);
        _$insert(_el$47, () => `last ${entry().verdict.replace("_", " ")} (turn ${entry().turn}) \xB7 ${props.goal.turns} turn${props.goal.turns === 1 ? "" : "s"} \xB7 ${countsText()} \xB7 ${elapsed()} elapsed${streakSuffix()}`);
        _$effect((_p$) => {
          var _v$16 = colorFor(theme(), entry().verdict), _v$17 = TextAttributes.BOLD, _v$18 = theme().text.base;
          _v$16 !== _p$.e && (_p$.e = _$setProp(_el$46, "fg", _v$16, _p$.e));
          _v$17 !== _p$.t && (_p$.t = _$setProp(_el$46, "attributes", _v$17, _p$.t));
          _v$18 !== _p$.a && (_p$.a = _$setProp(_el$47, "fg", _v$18, _p$.a));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined
        });
        return _el$45;
      })()
    }), null);
    _$insert(_el$40, _$createComponent(VerdictTrail, {
      get theme() {
        return theme();
      },
      get history() {
        return history();
      }
    }), null);
    return _el$40;
  })();
};

// src/status-dialog.tsx
var StatusDialogBody = (props) => {
  const theme = () => props.theme;
  const label = (text) => (() => {
    var _el$ = _$createElement2("text");
    _$setProp2(_el$, "flexShrink", 0);
    _$setProp2(_el$, "width", 10);
    _$insert2(_el$, text);
    _$effect2((_$p) => _$setProp2(_el$, "fg", theme().text.faint, _$p));
    return _el$;
  })();
  const field = (name, children, wide = false) => (() => {
    var _el$2 = _$createElement2("box"), _el$3 = _$createElement2("text");
    _$insertNode2(_el$2, _el$3);
    _$setProp2(_el$2, "flexDirection", "row");
    _$setProp2(_el$2, "gap", 2);
    _$insert2(_el$2, () => label(name), _el$3);
    _$setProp2(_el$3, "wrapMode", "word");
    _$setProp2(_el$3, "flexGrow", wide ? 1 : 0);
    _$insert2(_el$3, children);
    _$effect2((_$p) => _$setProp2(_el$3, "fg", theme().text.base, _$p));
    return _el$2;
  })();
  const stateColor = () => props.goal?.status === "paused" ? theme().text.feedback.warning.base : props.goal?.status === "active" ? theme().text.feedback.info.base : theme().text.muted;
  const g = () => props.goal;
  return _$createComponent2(Show2, {
    get when() {
      return g();
    },
    get fallback() {
      return (() => {
        var _el$4 = _$createElement2("text");
        _$setProp2(_el$4, "wrapMode", "word");
        _$insert2(_el$4, () => props.fallback);
        _$effect2((_$p) => _$setProp2(_el$4, "fg", theme().text.base, _$p));
        return _el$4;
      })();
    },
    children: (goal) => (() => {
      var _el$5 = _$createElement2("box"), _el$6 = _$createElement2("box"), _el$7 = _$createElement2("text"), _el$8 = _$createElement2("text"), _el$9 = _$createTextNode2(` \xB7 `), _el$0 = _$createTextNode2(` turn`);
      _$insertNode2(_el$5, _el$6);
      _$setProp2(_el$5, "flexDirection", "column");
      _$setProp2(_el$5, "gap", 1);
      _$setProp2(_el$5, "paddingRight", 3);
      _$insertNode2(_el$6, _el$7);
      _$insertNode2(_el$6, _el$8);
      _$setProp2(_el$6, "flexDirection", "row");
      _$setProp2(_el$6, "gap", 2);
      _$insert2(_el$7, () => goal().status);
      _$insertNode2(_el$8, _el$9);
      _$insertNode2(_el$8, _el$0);
      _$insert2(_el$8, () => formatDurationCoarse(props.elapsedMs()), _el$9);
      _$insert2(_el$8, () => goal().turns, _el$0);
      _$insert2(_el$8, () => goal().turns === 1 ? "" : "s", null);
      _$insert2(_el$8, (() => {
        var _c$ = _$memo2(() => !!goal().evaluating);
        return () => _c$() ? " \xB7 checking" : goal().waiting ? " \xB7 waiting" : "";
      })(), null);
      _$insert2(_el$5, () => field("goal", goal().condition, true), null);
      _$insert2(_el$5, _$createComponent2(Show2, {
        get when() {
          return goal().reason;
        },
        children: (reason) => field(goal().status === "active" ? "evaluator" : "reason", reason(), true)
      }), null);
      _$insert2(_el$5, _$createComponent2(Show2, {
        get when() {
          return goal().spend;
        },
        children: (spend) => field("spend", formatSpend(spend()))
      }), null);
      _$insert2(_el$5, _$createComponent2(Show2, {
        get when() {
          return goal().loopEnabled;
        },
        get children() {
          return _$createComponent2(LoopSection, {
            get goal() {
              return goal();
            },
            get theme() {
              return theme();
            },
            get elapsedMs() {
              return props.elapsedMs;
            },
            get nowMs() {
              return props.nowMs;
            }
          });
        }
      }), null);
      _$insert2(_el$5, _$createComponent2(Show2, {
        get when() {
          return !goal().loopEnabled;
        },
        get children() {
          return _$createComponent2(HistoryBlock, {
            get goal() {
              return goal();
            },
            get theme() {
              return theme();
            },
            get elapsedMs() {
              return props.elapsedMs;
            }
          });
        }
      }), null);
      _$effect2((_p$) => {
        var _v$ = stateColor(), _v$2 = TextAttributes2.BOLD, _v$3 = theme().text.muted;
        _v$ !== _p$.e && (_p$.e = _$setProp2(_el$7, "fg", _v$, _p$.e));
        _v$2 !== _p$.t && (_p$.t = _$setProp2(_el$7, "attributes", _v$2, _p$.t));
        _v$3 !== _p$.a && (_p$.a = _$setProp2(_el$8, "fg", _v$3, _p$.a));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined
      });
      return _el$5;
    })()
  });
};

// src/rpc.ts
import { Rpc } from "@opencode/plugin/rpc";
var sessionInput = {
  type: "object",
  properties: { sessionID: { type: "string" } },
  required: ["sessionID"],
  additionalProperties: false
};
var goal = { anyOf: [{ type: "object" }, { type: "null" }] };
var GoalRpc = Rpc.define({
  id: "goal",
  methods: {
    get: {
      input: sessionInput,
      output: { type: "object", properties: { goal }, required: ["goal"] }
    },
    list: {
      input: { type: "object", additionalProperties: false },
      output: { type: "object", properties: { goals: { type: "array", items: { type: "object" } } }, required: ["goals"] }
    },
    status: {
      input: sessionInput,
      output: { type: "object" }
    },
    clear: {
      input: sessionInput,
      output: { type: "object", properties: { cleared: { type: "boolean" } }, required: ["cleared"] }
    }
  },
  events: {
    changed: {
      schema: {
        type: "object",
        properties: { sessionID: { type: "string" }, goal },
        required: ["sessionID", "goal"]
      }
    },
    notice: {
      schema: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          kind: { type: "string" },
          level: { type: "string", enum: ["info", "success", "warning", "error"] },
          title: { type: "string" },
          message: { type: "string" }
        },
        required: ["sessionID", "kind", "level", "title", "message"]
      }
    }
  }
});

// src/tui.tsx
var TICK_MS = 15000;
var ATTENTION_KINDS = new Set(["achieved", "impossible", "failed", "paused"]);
var elapsedOf = (g, receivedAt, nowMs) => g.status === "active" ? g.elapsedMs + Math.max(0, nowMs - (receivedAt ?? nowMs)) : g.elapsedMs;
var goalsEqual = (a, b) => {
  if (a === b)
    return true;
  if (!a || !b)
    return false;
  return JSON.stringify(a) === JSON.stringify(b);
};
var ClampedColumn = (props) => {
  const dimensions = useTerminalDimensions();
  return (() => {
    var _el$ = _$createElement3("box");
    _$setProp3(_el$, "flexDirection", "column");
    _$setProp3(_el$, "height", "100%");
    _$setProp3(_el$, "paddingLeft", 3);
    _$setProp3(_el$, "paddingRight", 3);
    _$setProp3(_el$, "paddingBottom", 1);
    _$setProp3(_el$, "gap", 1);
    _$insert3(_el$, () => props.children);
    _$effect3((_$p) => _$setProp3(_el$, "maxHeight", Math.max(8, dimensions().height - 1), _$p));
    return _el$;
  })();
};
var tui_default = Plugin.define({
  id: "opencode-goal.tui",
  setup(context) {
    const rpc = context.client.rpc(GoalRpc);
    const [entries, setEntries] = createSignal({});
    const [now, setNow] = createSignal(Date.now());
    const [statusDialogOpen, setStatusDialogOpen] = createSignal(false);
    const [scrollRef, setScrollRef] = createSignal(undefined);
    const requested = new Set;
    const statusBody = (sessionID, fallback) => {
      const entry = () => entries()[sessionID];
      const goal = () => entry()?.goal ?? undefined;
      const elapsed = () => {
        const g = goal();
        return g ? elapsedOf(g, entry()?.receivedAt, now()) : 0;
      };
      return _$createComponent3(StatusDialogBody, {
        get goal() {
          return goal();
        },
        fallback,
        get theme() {
          return context.theme;
        },
        elapsedMs: elapsed,
        nowMs: () => now()
      });
    };
    const showStatusDialog = (sessionID, fallback) => {
      try {
        showStatusDialogInner(sessionID, fallback);
      } catch (error) {
        try {
          context.ui.toast.show({
            title: "goal plugin error (dialog)",
            message: String(error?.stack ?? error).slice(0, 900),
            variant: "error",
            duration: 30000
          });
        } catch {}
      }
    };
    const showStatusDialogInner = (sessionID, fallback) => {
      setScrollRef(undefined);
      refresh(sessionID).catch(() => {});
      const looped = () => Boolean(entries()[sessionID]?.goal?.loopEnabled);
      context.ui.dialog.show(() => _$createComponent3(ClampedColumn, {
        get children() {
          return [(() => {
            var _el$2 = _$createElement3("box"), _el$3 = _$createElement3("text"), _el$4 = _$createTextNode3(` /goal`), _el$5 = _$createElement3("text");
            _$insertNode3(_el$2, _el$3);
            _$insertNode3(_el$2, _el$5);
            _$setProp3(_el$2, "flexDirection", "row");
            _$setProp3(_el$2, "justifyContent", "space-between");
            _$setProp3(_el$2, "gap", 2);
            _$insertNode3(_el$3, _el$4);
            _$insert3(_el$3, GOAL_GLYPH, _el$4);
            _$insert3(_el$3, () => looped() ? " \xB7 loop" : "", null);
            _$insertNode3(_el$5, _$createTextNode3(`esc`));
            _$setProp3(_el$5, "flexShrink", 0);
            _$effect3((_p$) => {
              var _v$ = TextAttributes3.BOLD, _v$2 = context.theme.text.base, _v$3 = context.theme.text.muted;
              _v$ !== _p$.e && (_p$.e = _$setProp3(_el$3, "attributes", _v$, _p$.e));
              _v$2 !== _p$.t && (_p$.t = _$setProp3(_el$3, "fg", _v$2, _p$.t));
              _v$3 !== _p$.a && (_p$.a = _$setProp3(_el$5, "fg", _v$3, _p$.a));
              return _p$;
            }, {
              e: undefined,
              t: undefined,
              a: undefined
            });
            return _el$2;
          })(), (() => {
            var _el$7 = _$createElement3("scrollbox");
            _$use((el) => setScrollRef(el), _el$7);
            _$setProp3(_el$7, "scrollX", false);
            _$setProp3(_el$7, "flexGrow", 1);
            _$setProp3(_el$7, "stickyScroll", false);
            _$setProp3(_el$7, "contentOptions", {
              minHeight: 0
            });
            _$insert3(_el$7, () => statusBody(sessionID, fallback));
            return _el$7;
          })(), (() => {
            var _el$8 = _$createElement3("text");
            _$insertNode3(_el$8, _$createTextNode3(`up/down scroll \xB7 pgup/pgdn page \xB7 home/end start/end \xB7 esc close`));
            _$effect3((_$p) => _$setProp3(_el$8, "fg", context.theme.text.faint, _$p));
            return _el$8;
          })()];
        }
      }), () => {
        setStatusDialogOpen(false);
        setScrollRef(undefined);
      });
      context.ui.dialog.set({
        size: "xlarge",
        centered: true
      });
      setStatusDialogOpen(true);
    };
    const at = (sessionID) => {
      const location = context.data.session.get(sessionID)?.location ?? context.location;
      return location ? {
        location
      } : undefined;
    };
    const refresh = (sessionID) => rpc.get({
      sessionID
    }, at(sessionID)).then((result) => put(sessionID, result.goal));
    const put = (sessionID, goal) => setEntries((previous) => {
      const existing = previous[sessionID];
      if (existing && goalsEqual(existing.goal, goal))
        return previous;
      return {
        ...previous,
        [sessionID]: {
          goal,
          receivedAt: Date.now()
        }
      };
    });
    const ensure = (sessionID) => {
      if (requested.has(sessionID))
        return;
      requested.add(sessionID);
      refresh(sessionID).catch(() => requested.delete(sessionID));
    };
    const live = (sessionID) => {
      try {
        if (!sessionID)
          return;
        ensure(sessionID);
        const goal = entries()[sessionID]?.goal;
        return goal && isLive(goal.status) ? goal : undefined;
      } catch {
        return;
      }
    };
    const currentSession = () => {
      try {
        const route = context.ui.router.current();
        return route.type === "session" ? route.sessionID : undefined;
      } catch {
        return;
      }
    };
    const safeToast = (options) => {
      try {
        context.ui.toast.show({
          ...options,
          variant: options.variant ?? "info"
        });
      } catch {}
    };
    const onNotice = (notice) => {
      try {
        onNoticeInner(notice);
      } catch {
        safeToast({
          title: "goal plugin notice handler failed",
          message: "see logs",
          variant: "error",
          duration: 8000
        });
      }
    };
    const onNoticeInner = (notice) => {
      const here = currentSession() === notice.sessionID;
      if (notice.kind === "status") {
        showStatusDialog(notice.sessionID, notice.message);
        return;
      }
      const important = ATTENTION_KINDS.has(notice.kind);
      if (!here && !important)
        return;
      safeToast({
        title: `${GOAL_GLYPH} ${notice.title}`,
        message: notice.message,
        variant: notice.level,
        sessionID: notice.sessionID,
        duration: notice.level === "error" || notice.level === "warning" ? 8000 : 4000
      });
      if (important)
        try {
          context.attention.notify({
            title: `OpenCode \xB7 ${notice.title}`,
            message: notice.message,
            notification: {
              when: "blurred"
            },
            sound: {
              name: notice.kind === "achieved" ? "done" : "error",
              when: "blurred"
            }
          });
        } catch {}
    };
    const offChanged = rpc.events.on("changed", (event) => {
      try {
        const data = event?.data;
        if (data && typeof data.sessionID === "string")
          put(data.sessionID, data.goal ?? null);
      } catch {}
    });
    const offNotice = rpc.events.on("notice", (event) => {
      try {
        onNotice(event?.data);
      } catch {}
    });
    const timer = setInterval(() => {
      if (Object.values(entries()).some((entry) => entry.goal?.status === "active"))
        setNow(Date.now());
    }, TICK_MS);
    context.ui.slot({
      append: "prompt.footer",
      render: (props) => {
        const goal = createMemo(() => {
          try {
            return props.mode === "normal" ? live(props.sessionID) : undefined;
          } catch {
            return;
          }
        });
        const label = createMemo(() => {
          try {
            const g = goal();
            if (!g || !props.sessionID)
              return "";
            const entry = entries()[props.sessionID];
            const elapsed = elapsedOf(g, entry?.receivedAt, now());
            const state = g.status === "paused" ? "paused" : g.evaluating ? "checking" : g.waiting ? "waiting" : "active";
            const turns = g.turns > 0 ? ` \xB7 ${g.turns} turn${g.turns === 1 ? "" : "s"}` : "";
            if (g.loopEnabled) {
              const cap = typeof g.loopMaxLoops === "number" && g.loopMaxLoops > 0 ? `/${g.loopMaxLoops}` : "";
              const pips = renderPips(g.loopHistory?.length ?? 0, g.loopMaxLoops);
              return `${GOAL_GLYPH} loop \xB7 v${g.loopIteration ?? 1}${cap}${pips ? ` ${pips}` : ""} \xB7 ${state} \xB7 ${formatDurationCoarse(elapsed)}${turns}`;
            }
            return `${GOAL_GLYPH} goal ${state} \xB7 ${formatDurationCoarse(elapsed)}${turns}`;
          } catch {
            return "";
          }
        });
        const color = () => {
          try {
            return goal()?.status === "paused" ? context.theme.text.feedback.warning.base : goal()?.evaluating ? context.theme.text.feedback.info.base : context.theme.text.muted;
          } catch {
            return context.theme.text.muted;
          }
        };
        return _$createComponent3(Show3, {
          get when() {
            return goal();
          },
          get children() {
            var _el$0 = _$createElement3("box"), _el$1 = _$createElement3("text");
            _$insertNode3(_el$0, _el$1);
            _$setProp3(_el$0, "flexShrink", 0);
            _$setProp3(_el$0, "onMouseUp", () => {
              try {
                if (props.sessionID)
                  context.keymap.dispatch("goal.status");
              } catch {}
            });
            _$setProp3(_el$1, "wrapMode", "none");
            _$insert3(_el$1, label);
            _$effect3((_$p) => _$setProp3(_el$1, "fg", color(), _$p));
            return _el$0;
          }
        });
      }
    });
    context.keymap.layer(() => ({
      mode: "global",
      priority: 100,
      enabled: () => statusDialogOpen(),
      commands: [{
        id: "goal.status.scroll-up",
        title: "Goal status: scroll up",
        group: "Goal",
        bind: "up",
        enabled: () => statusDialogOpen(),
        run: () => {
          try {
            scrollRef()?.scrollBy(-3);
          } catch {}
        }
      }, {
        id: "goal.status.scroll-down",
        title: "Goal status: scroll down",
        group: "Goal",
        bind: "down",
        enabled: () => statusDialogOpen(),
        run: () => {
          try {
            scrollRef()?.scrollBy(3);
          } catch {}
        }
      }, {
        id: "goal.status.page-up",
        title: "Goal status: page up",
        group: "Goal",
        bind: "pageup",
        enabled: () => statusDialogOpen(),
        run: () => {
          try {
            scrollRef()?.scrollBy(-15);
          } catch {}
        }
      }, {
        id: "goal.status.page-down",
        title: "Goal status: page down",
        group: "Goal",
        bind: "pagedown",
        enabled: () => statusDialogOpen(),
        run: () => {
          try {
            scrollRef()?.scrollBy(15);
          } catch {}
        }
      }, {
        id: "goal.status.home",
        title: "Goal status: scroll to start",
        group: "Goal",
        bind: "home",
        enabled: () => statusDialogOpen(),
        run: () => {
          try {
            scrollRef()?.scrollTo(0);
          } catch {}
        }
      }, {
        id: "goal.status.end",
        title: "Goal status: scroll to end",
        group: "Goal",
        bind: "end",
        enabled: () => statusDialogOpen(),
        run: () => {
          try {
            scrollRef()?.scrollTo(Number.MAX_SAFE_INTEGER);
          } catch {}
        }
      }]
    }));
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "goal.status",
        title: "Goal: show status",
        group: "Goal",
        palette: true,
        enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal),
        run: () => {
          const sessionID = currentSession();
          if (sessionID)
            rpc.status({
              sessionID
            }, at(sessionID)).catch(() => {});
        }
      }, {
        id: "goal.clear",
        title: "Goal: clear",
        group: "Goal",
        palette: true,
        enabled: () => Boolean(live(currentSession())),
        run: () => {
          const sessionID = currentSession();
          if (sessionID)
            rpc.clear({
              sessionID
            }, at(sessionID)).catch(() => {});
        }
      }, {
        id: "goal.loop.status",
        title: "Goal loop: show status",
        group: "Goal",
        palette: true,
        enabled: () => Boolean(live(currentSession())?.loopEnabled ?? entries()[currentSession() ?? ""]?.goal?.loopEnabled),
        run: () => {
          const sessionID = currentSession();
          if (sessionID)
            rpc.status({
              sessionID
            }, at(sessionID)).catch(() => {});
        }
      }, {
        id: "goal.loop.clear",
        title: "Goal loop: clear",
        group: "Goal",
        palette: true,
        enabled: () => Boolean(live(currentSession())?.loopEnabled),
        run: () => {
          const sessionID = currentSession();
          if (sessionID)
            rpc.clear({
              sessionID
            }, at(sessionID)).catch(() => {});
        }
      }]
    }));
    return () => {
      clearInterval(timer);
      offChanged();
      offNotice();
      setStatusDialogOpen(false);
      setScrollRef(undefined);
    };
  }
});
export {
  tui_default as default
};
