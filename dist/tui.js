// @bun
// src/tui.tsx
import { use as _$use } from "@opentui/solid";
import { createTextNode as _$createTextNode2 } from "@opentui/solid";
import { memo as _$memo2 } from "@opentui/solid";
import { createComponent as _$createComponent2 } from "@opentui/solid";
import { insertNode as _$insertNode2 } from "@opentui/solid";
import { effect as _$effect2 } from "@opentui/solid";
import { insert as _$insert2 } from "@opentui/solid";
import { setProp as _$setProp2 } from "@opentui/solid";
import { createElement as _$createElement2 } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { TextAttributes as TextAttributes2 } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createMemo, createSignal, Show as Show2 } from "solid-js";

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
  const endedSuffix = (entry) => ` \xB7 ended ${relativeTime(entry.endedAt, nowMs())}`;
  const paused = () => props.goal.status === "paused";
  const stateWord = () => paused() ? "paused" : props.goal.evaluating ? "checking" : props.goal.waiting ? "waiting" : "active";
  const nowMs = () => props.nowMs?.() ?? Date.now();
  const nowColor = () => paused() ? theme().text.feedback.warning.base : theme().text.feedback.info.base;
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
        return pace();
      },
      children: (estimate) => (() => {
        var _el$14 = _$createElement("box"), _el$15 = _$createElement("text");
        _$insertNode(_el$14, _el$15);
        _$setProp(_el$14, "flexDirection", "row");
        _$setProp(_el$14, "gap", 2);
        _$insert(_el$14, () => label(theme(), "pace"), _el$15);
        _$setProp(_el$15, "wrapMode", "none");
        _$insert(_el$15, () => `~${formatDurationCoarse(estimate().perIteration)}/iteration \xB7 ~${formatDurationCoarse(estimate().remaining)} left at this pace`);
        _$effect((_$p) => _$setProp(_el$15, "fg", theme().text.faint, _$p));
        return _el$14;
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
        var _el$16 = _$createElement("box"), _el$17 = _$createElement("box"), _el$18 = _$createElement("text"), _el$20 = _$createElement("text");
        _$insertNode(_el$16, _el$17);
        _$setProp(_el$16, "flexDirection", "column");
        _$insertNode(_el$17, _el$18);
        _$insertNode(_el$17, _el$20);
        _$setProp(_el$17, "flexDirection", "row");
        _$setProp(_el$17, "gap", 2);
        _$insert(_el$17, () => label(theme(), `v${entry.version}`), _el$18);
        _$insertNode(_el$18, _$createTextNode(`\u2713`));
        _$setProp(_el$18, "wrapMode", "none");
        _$setProp(_el$18, "flexShrink", 0);
        _$setProp(_el$20, "wrapMode", "none");
        _$insert(_el$20, () => `met \xB7 ${entry.turns} turn${entry.turns === 1 ? "" : "s"} \xB7 ${entry.toolCalls} tool${entry.toolCalls === 1 ? "" : "s"} \xB7 ${formatDuration(durations()[index()] ?? 0)}${mixSuffix(index())}${endedSuffix(entry)}`);
        _$insert(_el$16, _$createComponent(Show, {
          get when() {
            return entry.summary.trim().length > 0;
          },
          get children() {
            var _el$21 = _$createElement("box"), _el$22 = _$createElement("text"), _el$24 = _$createElement("text");
            _$insertNode(_el$21, _el$22);
            _$insertNode(_el$21, _el$24);
            _$setProp(_el$21, "flexDirection", "row");
            _$setProp(_el$21, "gap", 2);
            _$insertNode(_el$22, _$createTextNode(`\u2502`));
            _$setProp(_el$22, "flexShrink", 0);
            _$setProp(_el$22, "width", 10);
            _$setProp(_el$24, "wrapMode", "word");
            _$setProp(_el$24, "flexGrow", 1);
            _$insert(_el$24, () => `\u2502 ${truncate(entry.summary, SUMMARY_MAX)}`);
            _$effect((_p$) => {
              var _v$7 = theme().text.faint, _v$8 = theme().text.faint;
              _v$7 !== _p$.e && (_p$.e = _$setProp(_el$22, "fg", _v$7, _p$.e));
              _v$8 !== _p$.t && (_p$.t = _$setProp(_el$24, "fg", _v$8, _p$.t));
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$21;
          }
        }), null);
        _$effect((_p$) => {
          var _v$9 = theme().text.feedback.info.base, _v$0 = theme().text.base;
          _v$9 !== _p$.e && (_p$.e = _$setProp(_el$18, "fg", _v$9, _p$.e));
          _v$0 !== _p$.t && (_p$.t = _$setProp(_el$20, "fg", _v$0, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$16;
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
    _$setProp(_el$13, "wrapMode", "none");
    _$insert(_el$13, () => `v${current()} \xB7 ${stateWord()} \xB7 ${props.goal.turns} turn${props.goal.turns === 1 ? "" : "s"}${paused() ? ` \xB7 ${pauseDiagnostics(props.goal.stall, props.goal.retries)}` : ""} \xB7 ${formatDurationCoarse(props.elapsedMs())} elapsed`);
    _$insert(_el$2, _$createComponent(VerdictTrail, {
      get theme() {
        return theme();
      },
      get history() {
        return props.goal.history ?? [];
      }
    }), null);
    _$effect((_p$) => {
      var _v$ = theme().text.base, _v$2 = TextAttributes.BOLD, _v$3 = theme().text.base, _v$4 = nowColor(), _v$5 = TextAttributes.BOLD, _v$6 = theme().text.base;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$4, "fg", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$4, "attributes", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp(_el$1, "fg", _v$3, _p$.a));
      _v$4 !== _p$.o && (_p$.o = _$setProp(_el$11, "fg", _v$4, _p$.o));
      _v$5 !== _p$.i && (_p$.i = _$setProp(_el$11, "attributes", _v$5, _p$.i));
      _v$6 !== _p$.n && (_p$.n = _$setProp(_el$13, "fg", _v$6, _p$.n));
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
      var _el$25 = _$createElement("box"), _el$26 = _$createElement("box"), _el$27 = _$createElement("text"), _el$28 = _$createTextNode(` `), _el$29 = _$createTextNode(` of `), _el$30 = _$createTextNode(` verdict`);
      _$insertNode(_el$25, _el$26);
      _$insertNode(_el$25, _el$27);
      _$setProp(_el$25, "flexDirection", "row");
      _$setProp(_el$25, "gap", 2);
      _$insert(_el$25, () => label(props.theme, "trail"), _el$26);
      _$setProp(_el$26, "flexDirection", "row");
      _$setProp(_el$26, "flexShrink", 0);
      _$insert(_el$26, _$createComponent(For, {
        get each() {
          return trail().shown;
        },
        children: (entry) => (() => {
          var _el$31 = _$createElement("text");
          _$setProp(_el$31, "wrapMode", "none");
          _$insert(_el$31, () => verdictGlyph(entry.verdict));
          _$effect((_$p) => _$setProp(_el$31, "fg", colorFor(props.theme, entry.verdict), _$p));
          return _el$31;
        })()
      }));
      _$insertNode(_el$27, _el$28);
      _$insertNode(_el$27, _el$29);
      _$insertNode(_el$27, _el$30);
      _$setProp(_el$27, "wrapMode", "none");
      _$setProp(_el$27, "flexShrink", 0);
      _$insert(_el$27, () => trail().shown.length, _el$29);
      _$insert(_el$27, () => trail().total, _el$30);
      _$insert(_el$27, () => trail().total === 1 ? "" : "s", null);
      _$effect((_$p) => _$setProp(_el$27, "fg", props.theme.text.muted, _$p));
      return _el$25;
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
    var _el$32 = _$createElement("box"), _el$33 = _$createElement("box");
    _$insertNode(_el$32, _el$33);
    _$setProp(_el$32, "flexDirection", "column");
    _$setProp(_el$32, "gap", 1);
    _$setProp(_el$33, "flexDirection", "row");
    _$setProp(_el$33, "gap", 2);
    _$insert(_el$33, () => label(theme(), "history"), null);
    _$insert(_el$33, _$createComponent(Show, {
      get when() {
        return last();
      },
      get fallback() {
        return (() => {
          var _el$34 = _$createElement("text"), _el$35 = _$createTextNode(`no verdicts yet \xB7 `), _el$36 = _$createTextNode(` elapsed`);
          _$insertNode(_el$34, _el$35);
          _$insertNode(_el$34, _el$36);
          _$setProp(_el$34, "wrapMode", "none");
          _$insert(_el$34, elapsed, _el$36);
          _$effect((_$p) => _$setProp(_el$34, "fg", theme().text.faint, _$p));
          return _el$34;
        })();
      },
      children: (entry) => (() => {
        var _el$37 = _$createElement("box"), _el$38 = _$createElement("text"), _el$39 = _$createElement("text");
        _$insertNode(_el$37, _el$38);
        _$insertNode(_el$37, _el$39);
        _$setProp(_el$37, "flexDirection", "row");
        _$setProp(_el$37, "gap", 2);
        _$setProp(_el$37, "flexGrow", 1);
        _$setProp(_el$38, "wrapMode", "none");
        _$setProp(_el$38, "flexShrink", 0);
        _$insert(_el$38, () => verdictGlyph(entry().verdict));
        _$setProp(_el$39, "wrapMode", "word");
        _$setProp(_el$39, "flexGrow", 1);
        _$insert(_el$39, () => `last ${entry().verdict.replace("_", " ")} (turn ${entry().turn}) \xB7 ${props.goal.turns} turn${props.goal.turns === 1 ? "" : "s"} \xB7 ${countsText()} \xB7 ${elapsed()} elapsed${streakSuffix()}`);
        _$effect((_p$) => {
          var _v$1 = colorFor(theme(), entry().verdict), _v$10 = TextAttributes.BOLD, _v$11 = theme().text.base;
          _v$1 !== _p$.e && (_p$.e = _$setProp(_el$38, "fg", _v$1, _p$.e));
          _v$10 !== _p$.t && (_p$.t = _$setProp(_el$38, "attributes", _v$10, _p$.t));
          _v$11 !== _p$.a && (_p$.a = _$setProp(_el$39, "fg", _v$11, _p$.a));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined
        });
        return _el$37;
      })()
    }), null);
    _$insert(_el$32, _$createComponent(VerdictTrail, {
      get theme() {
        return theme();
      },
      get history() {
        return history();
      }
    }), null);
    return _el$32;
  })();
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
    var _el$ = _$createElement2("box");
    _$setProp2(_el$, "flexDirection", "column");
    _$setProp2(_el$, "height", "100%");
    _$setProp2(_el$, "paddingLeft", 3);
    _$setProp2(_el$, "paddingRight", 3);
    _$setProp2(_el$, "paddingBottom", 1);
    _$setProp2(_el$, "gap", 1);
    _$insert2(_el$, () => props.children);
    _$effect2((_$p) => _$setProp2(_el$, "maxHeight", Math.max(8, dimensions().height - 1), _$p));
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
    const LABEL = 10;
    const label = (text) => (() => {
      var _el$2 = _$createElement2("text");
      _$setProp2(_el$2, "flexShrink", 0);
      _$setProp2(_el$2, "width", 10);
      _$insert2(_el$2, text);
      _$effect2((_$p) => _$setProp2(_el$2, "fg", context.theme.text.faint, _$p));
      return _el$2;
    })();
    const field = (name, children, wide = false) => (() => {
      var _el$3 = _$createElement2("box"), _el$4 = _$createElement2("text");
      _$insertNode2(_el$3, _el$4);
      _$setProp2(_el$3, "flexDirection", "row");
      _$setProp2(_el$3, "gap", 2);
      _$insert2(_el$3, () => label(name), _el$4);
      _$setProp2(_el$4, "wrapMode", "word");
      _$setProp2(_el$4, "flexGrow", wide ? 1 : 0);
      _$insert2(_el$4, children);
      _$effect2((_$p) => _$setProp2(_el$4, "fg", context.theme.text.base, _$p));
      return _el$3;
    })();
    const statusBody = (sessionID, fallback) => {
      const entry = () => entries()[sessionID];
      const goal = () => entry()?.goal ?? undefined;
      const elapsed = () => {
        const g = goal();
        return g ? elapsedOf(g, entry()?.receivedAt, now()) : 0;
      };
      const stateColor = () => goal()?.status === "paused" ? context.theme.text.feedback.warning.base : goal()?.status === "active" ? context.theme.text.feedback.info.base : context.theme.text.muted;
      return _$createComponent2(Show2, {
        get when() {
          return goal();
        },
        get fallback() {
          return (() => {
            var _el$5 = _$createElement2("text");
            _$setProp2(_el$5, "wrapMode", "word");
            _$insert2(_el$5, fallback);
            _$effect2((_$p) => _$setProp2(_el$5, "fg", context.theme.text.base, _$p));
            return _el$5;
          })();
        },
        children: (g) => (() => {
          var _el$6 = _$createElement2("box"), _el$7 = _$createElement2("box"), _el$8 = _$createElement2("text"), _el$9 = _$createElement2("text"), _el$0 = _$createTextNode2(` \xB7 `), _el$1 = _$createTextNode2(` turn`);
          _$insertNode2(_el$6, _el$7);
          _$setProp2(_el$6, "flexDirection", "column");
          _$setProp2(_el$6, "gap", 1);
          _$insertNode2(_el$7, _el$8);
          _$insertNode2(_el$7, _el$9);
          _$setProp2(_el$7, "flexDirection", "row");
          _$setProp2(_el$7, "gap", 2);
          _$insert2(_el$8, () => g().status);
          _$insertNode2(_el$9, _el$0);
          _$insertNode2(_el$9, _el$1);
          _$insert2(_el$9, () => formatDurationCoarse(elapsed()), _el$0);
          _$insert2(_el$9, () => g().turns, _el$1);
          _$insert2(_el$9, () => g().turns === 1 ? "" : "s", null);
          _$insert2(_el$9, (() => {
            var _c$ = _$memo2(() => !!g().evaluating);
            return () => _c$() ? " \xB7 checking" : g().waiting ? " \xB7 waiting" : "";
          })(), null);
          _$insert2(_el$6, () => field("goal", g().condition, true), null);
          _$insert2(_el$6, _$createComponent2(Show2, {
            get when() {
              return g().reason;
            },
            children: (reason) => field(g().status === "active" ? "evaluator" : "reason", reason(), true)
          }), null);
          _$insert2(_el$6, _$createComponent2(Show2, {
            get when() {
              return g().spend;
            },
            children: (spend) => field("spend", formatSpend(spend()))
          }), null);
          _$insert2(_el$6, _$createComponent2(Show2, {
            get when() {
              return g().loopEnabled;
            },
            get children() {
              return _$createComponent2(LoopSection, {
                get goal() {
                  return g();
                },
                get theme() {
                  return context.theme;
                },
                elapsedMs: elapsed,
                nowMs: () => now()
              });
            }
          }), null);
          _$insert2(_el$6, _$createComponent2(Show2, {
            get when() {
              return !g().loopEnabled;
            },
            get children() {
              return _$createComponent2(HistoryBlock, {
                get goal() {
                  return g();
                },
                get theme() {
                  return context.theme;
                },
                elapsedMs: elapsed
              });
            }
          }), null);
          _$effect2((_p$) => {
            var _v$ = stateColor(), _v$2 = TextAttributes2.BOLD, _v$3 = context.theme.text.muted;
            _v$ !== _p$.e && (_p$.e = _$setProp2(_el$8, "fg", _v$, _p$.e));
            _v$2 !== _p$.t && (_p$.t = _$setProp2(_el$8, "attributes", _v$2, _p$.t));
            _v$3 !== _p$.a && (_p$.a = _$setProp2(_el$9, "fg", _v$3, _p$.a));
            return _p$;
          }, {
            e: undefined,
            t: undefined,
            a: undefined
          });
          return _el$6;
        })()
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
      context.ui.dialog.show(() => _$createComponent2(ClampedColumn, {
        get children() {
          return [(() => {
            var _el$10 = _$createElement2("box"), _el$11 = _$createElement2("text"), _el$12 = _$createTextNode2(` /goal`), _el$13 = _$createElement2("text");
            _$insertNode2(_el$10, _el$11);
            _$insertNode2(_el$10, _el$13);
            _$setProp2(_el$10, "flexDirection", "row");
            _$setProp2(_el$10, "justifyContent", "space-between");
            _$setProp2(_el$10, "gap", 2);
            _$insertNode2(_el$11, _el$12);
            _$insert2(_el$11, GOAL_GLYPH, _el$12);
            _$insert2(_el$11, () => looped() ? " \xB7 loop" : "", null);
            _$insertNode2(_el$13, _$createTextNode2(`esc`));
            _$setProp2(_el$13, "flexShrink", 0);
            _$effect2((_p$) => {
              var _v$4 = TextAttributes2.BOLD, _v$5 = context.theme.text.base, _v$6 = context.theme.text.muted;
              _v$4 !== _p$.e && (_p$.e = _$setProp2(_el$11, "attributes", _v$4, _p$.e));
              _v$5 !== _p$.t && (_p$.t = _$setProp2(_el$11, "fg", _v$5, _p$.t));
              _v$6 !== _p$.a && (_p$.a = _$setProp2(_el$13, "fg", _v$6, _p$.a));
              return _p$;
            }, {
              e: undefined,
              t: undefined,
              a: undefined
            });
            return _el$10;
          })(), (() => {
            var _el$15 = _$createElement2("scrollbox");
            _$use((el) => setScrollRef(el), _el$15);
            _$setProp2(_el$15, "scrollbarOptions", {
              visible: true
            });
            _$setProp2(_el$15, "flexGrow", 1);
            _$setProp2(_el$15, "stickyScroll", false);
            _$setProp2(_el$15, "contentOptions", {
              minHeight: 0
            });
            _$insert2(_el$15, () => statusBody(sessionID, fallback));
            return _el$15;
          })(), (() => {
            var _el$16 = _$createElement2("text");
            _$insertNode2(_el$16, _$createTextNode2(`up/down scroll \xB7 pgup/pgdn page \xB7 home/end start/end \xB7 esc close`));
            _$effect2((_$p) => _$setProp2(_el$16, "fg", context.theme.text.faint, _$p));
            return _el$16;
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
        return _$createComponent2(Show2, {
          get when() {
            return goal();
          },
          get children() {
            var _el$18 = _$createElement2("box"), _el$19 = _$createElement2("text");
            _$insertNode2(_el$18, _el$19);
            _$setProp2(_el$18, "flexShrink", 0);
            _$setProp2(_el$18, "onMouseUp", () => {
              try {
                if (props.sessionID)
                  context.keymap.dispatch("goal.status");
              } catch {}
            });
            _$setProp2(_el$19, "wrapMode", "none");
            _$insert2(_el$19, label);
            _$effect2((_$p) => _$setProp2(_el$19, "fg", color(), _$p));
            return _el$18;
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
