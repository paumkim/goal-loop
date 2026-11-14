// @bun
// src/tui.tsx
import { use as _$use } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { TextAttributes } from "@opentui/core";
import { createMemo, createSignal, For, Show } from "solid-js";

// src/core/format.ts
var GOAL_GLYPH = "\u25CE";
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
      var _el$ = _$createElement("text");
      _$setProp(_el$, "flexShrink", 0);
      _$setProp(_el$, "width", 10);
      _$insert(_el$, text);
      _$effect((_$p) => _$setProp(_el$, "fg", context.theme.text.faint, _$p));
      return _el$;
    })();
    const field = (name, children, wide = false) => (() => {
      var _el$2 = _$createElement("box"), _el$3 = _$createElement("text");
      _$insertNode(_el$2, _el$3);
      _$setProp(_el$2, "flexDirection", "row");
      _$setProp(_el$2, "gap", 2);
      _$insert(_el$2, () => label(name), _el$3);
      _$setProp(_el$3, "wrapMode", "word");
      _$setProp(_el$3, "flexGrow", wide ? 1 : 0);
      _$insert(_el$3, children);
      _$effect((_$p) => _$setProp(_el$3, "fg", context.theme.text.base, _$p));
      return _el$2;
    })();
    const statusBody = (sessionID, fallback) => {
      const entry = () => entries()[sessionID];
      const goal = () => entry()?.goal ?? undefined;
      const elapsed = () => {
        const g = goal();
        if (!g)
          return 0;
        return g.status === "active" ? g.elapsedMs + Math.max(0, now() - (entry()?.receivedAt ?? now())) : g.elapsedMs;
      };
      const stateColor = () => goal()?.status === "paused" ? context.theme.text.feedback.warning.base : goal()?.status === "active" ? context.theme.text.feedback.info.base : context.theme.text.muted;
      return _$createComponent(Show, {
        get when() {
          return goal();
        },
        get fallback() {
          return (() => {
            var _el$4 = _$createElement("text");
            _$setProp(_el$4, "wrapMode", "word");
            _$insert(_el$4, fallback);
            _$effect((_$p) => _$setProp(_el$4, "fg", context.theme.text.base, _$p));
            return _el$4;
          })();
        },
        children: (g) => (() => {
          var _el$5 = _$createElement("box"), _el$6 = _$createElement("box"), _el$7 = _$createElement("text"), _el$8 = _$createElement("text"), _el$9 = _$createTextNode(` \xB7 `), _el$0 = _$createTextNode(` turn`);
          _$insertNode(_el$5, _el$6);
          _$setProp(_el$5, "flexDirection", "column");
          _$setProp(_el$5, "gap", 1);
          _$insertNode(_el$6, _el$7);
          _$insertNode(_el$6, _el$8);
          _$setProp(_el$6, "flexDirection", "row");
          _$setProp(_el$6, "gap", 2);
          _$insert(_el$7, () => g().status);
          _$insertNode(_el$8, _el$9);
          _$insertNode(_el$8, _el$0);
          _$insert(_el$8, () => formatDurationCoarse(elapsed()), _el$9);
          _$insert(_el$8, () => g().turns, _el$0);
          _$insert(_el$8, () => g().turns === 1 ? "" : "s", null);
          _$insert(_el$8, (() => {
            var _c$ = _$memo(() => !!g().evaluating);
            return () => _c$() ? " \xB7 checking" : g().waiting ? " \xB7 waiting" : "";
          })(), null);
          _$insert(_el$5, () => field("goal", g().condition, true), null);
          _$insert(_el$5, _$createComponent(Show, {
            get when() {
              return g().reason;
            },
            children: (reason) => field(g().status === "active" ? "evaluator" : "reason", reason(), true)
          }), null);
          _$insert(_el$5, _$createComponent(Show, {
            get when() {
              return g().spend;
            },
            children: (spend) => field("spend", formatSpend(spend()))
          }), null);
          _$insert(_el$5, _$createComponent(Show, {
            get when() {
              return g().loopEnabled;
            },
            get children() {
              var _el$1 = _$createElement("box"), _el$10 = _$createElement("text"), _el$11 = _$createTextNode(`loop \xB7 v`), _el$12 = _$createTextNode(` of at most `);
              _$insertNode(_el$1, _el$10);
              _$setProp(_el$1, "flexDirection", "column");
              _$setProp(_el$1, "gap", 1);
              _$insertNode(_el$10, _el$11);
              _$insertNode(_el$10, _el$12);
              _$insert(_el$10, () => g().loopIteration ?? 1, _el$12);
              _$insert(_el$10, () => g().loopMaxLoops ?? "?", null);
              _$insert(_el$1, () => field("objective", g().loopObjective ?? "?", true), null);
              _$insert(_el$1, _$createComponent(For, {
                get each() {
                  return g().loopHistory ?? [];
                },
                children: (entry) => field(`v${entry.version}`, `met \xB7 ${entry.turns} turn${entry.turns === 1 ? "" : "s"} \xB7 ${entry.summary}`, true)
              }), null);
              _$effect((_$p) => _$setProp(_el$10, "fg", context.theme.text.faint, _$p));
              return _el$1;
            }
          }), null);
          _$effect((_p$) => {
            var _v$ = stateColor(), _v$2 = TextAttributes.BOLD, _v$3 = context.theme.text.muted;
            _v$ !== _p$.e && (_p$.e = _$setProp(_el$7, "fg", _v$, _p$.e));
            _v$2 !== _p$.t && (_p$.t = _$setProp(_el$7, "attributes", _v$2, _p$.t));
            _v$3 !== _p$.a && (_p$.a = _$setProp(_el$8, "fg", _v$3, _p$.a));
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
    const showStatusDialog = (sessionID, fallback) => {
      setScrollRef(undefined);
      rpc.get({
        sessionID
      }, at(sessionID)).then((result) => put(sessionID, result.goal)).catch(() => {});
      const looped = () => Boolean(entries()[sessionID]?.goal?.loopEnabled);
      context.ui.dialog.show(() => (() => {
        var _el$13 = _$createElement("box"), _el$14 = _$createElement("box"), _el$15 = _$createElement("text"), _el$16 = _$createTextNode(` /goal`), _el$17 = _$createElement("text"), _el$19 = _$createElement("scrollbox"), _el$20 = _$createElement("text");
        _$insertNode(_el$13, _el$14);
        _$insertNode(_el$13, _el$19);
        _$insertNode(_el$13, _el$20);
        _$setProp(_el$13, "flexDirection", "column");
        _$setProp(_el$13, "height", "100%");
        _$setProp(_el$13, "paddingLeft", 3);
        _$setProp(_el$13, "paddingRight", 3);
        _$setProp(_el$13, "paddingBottom", 1);
        _$setProp(_el$13, "gap", 1);
        _$insertNode(_el$14, _el$15);
        _$insertNode(_el$14, _el$17);
        _$setProp(_el$14, "flexDirection", "row");
        _$setProp(_el$14, "justifyContent", "space-between");
        _$setProp(_el$14, "gap", 2);
        _$insertNode(_el$15, _el$16);
        _$insert(_el$15, GOAL_GLYPH, _el$16);
        _$insert(_el$15, () => looped() ? " \xB7 loop" : "", null);
        _$insertNode(_el$17, _$createTextNode(`esc`));
        _$setProp(_el$17, "flexShrink", 0);
        _$use((el) => setScrollRef(el), _el$19);
        _$setProp(_el$19, "scrollbarOptions", {
          visible: true
        });
        _$setProp(_el$19, "flexGrow", 1);
        _$setProp(_el$19, "stickyScroll", false);
        _$setProp(_el$19, "contentOptions", {
          minHeight: 0
        });
        _$insert(_el$19, () => statusBody(sessionID, fallback));
        _$insertNode(_el$20, _$createTextNode(`up/down scroll \xB7 pgup/pgdn page \xB7 home/end start/end \xB7 esc close`));
        _$effect((_p$) => {
          var _v$4 = TextAttributes.BOLD, _v$5 = context.theme.text.base, _v$6 = context.theme.text.muted, _v$7 = context.theme.text.faint;
          _v$4 !== _p$.e && (_p$.e = _$setProp(_el$15, "attributes", _v$4, _p$.e));
          _v$5 !== _p$.t && (_p$.t = _$setProp(_el$15, "fg", _v$5, _p$.t));
          _v$6 !== _p$.a && (_p$.a = _$setProp(_el$17, "fg", _v$6, _p$.a));
          _v$7 !== _p$.o && (_p$.o = _$setProp(_el$20, "fg", _v$7, _p$.o));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined,
          o: undefined
        });
        return _el$13;
      })(), () => {
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
    const put = (sessionID, goal) => setEntries((previous) => ({
      ...previous,
      [sessionID]: {
        goal,
        receivedAt: Date.now()
      }
    }));
    const ensure = (sessionID) => {
      if (requested.has(sessionID))
        return;
      requested.add(sessionID);
      rpc.get({
        sessionID
      }, at(sessionID)).then((result) => put(sessionID, result.goal)).catch(() => requested.delete(sessionID));
    };
    const live = (sessionID) => {
      if (!sessionID)
        return;
      ensure(sessionID);
      const goal = entries()[sessionID]?.goal;
      return goal && (goal.status === "active" || goal.status === "paused") ? goal : undefined;
    };
    const currentSession = () => {
      const route = context.ui.router.current();
      return route.type === "session" ? route.sessionID : undefined;
    };
    const onNotice = (notice) => {
      const here = currentSession() === notice.sessionID;
      if (notice.kind === "status") {
        if (here)
          showStatusDialog(notice.sessionID, notice.message);
        return;
      }
      const important = ATTENTION_KINDS.has(notice.kind);
      if (!here && !important)
        return;
      context.ui.toast.show({
        title: `${GOAL_GLYPH} ${notice.title}`,
        message: notice.message,
        variant: notice.level,
        sessionID: notice.sessionID,
        duration: notice.level === "error" || notice.level === "warning" ? 8000 : 4000
      });
      if (important)
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
    };
    const offChanged = rpc.events.on("changed", (event) => {
      const data = event.data;
      if (typeof data.sessionID === "string")
        put(data.sessionID, data.goal ?? null);
    });
    const offNotice = rpc.events.on("notice", (event) => onNotice(event.data));
    const timer = setInterval(() => {
      if (Object.values(entries()).some((entry) => entry.goal?.status === "active"))
        setNow(Date.now());
    }, TICK_MS);
    context.ui.slot({
      append: "prompt.footer",
      render: (props) => {
        const goal = createMemo(() => props.mode === "normal" ? live(props.sessionID) : undefined);
        const label = createMemo(() => {
          const g = goal();
          if (!g || !props.sessionID)
            return "";
          const entry = entries()[props.sessionID];
          const elapsed = g.status === "active" ? g.elapsedMs + Math.max(0, now() - (entry?.receivedAt ?? now())) : g.elapsedMs;
          const state = g.status === "paused" ? "paused" : g.evaluating ? "checking" : g.waiting ? "waiting" : "active";
          const turns = g.turns > 0 ? ` \xB7 ${g.turns} turn${g.turns === 1 ? "" : "s"}` : "";
          if (g.loopEnabled)
            return `${GOAL_GLYPH} loop \xB7 v${g.loopIteration ?? 1} \xB7 ${state} \xB7 ${formatDurationCoarse(elapsed)}${turns}`;
          return `${GOAL_GLYPH} goal ${state} \xB7 ${formatDurationCoarse(elapsed)}${turns}`;
        });
        const color = () => goal()?.status === "paused" ? context.theme.text.feedback.warning.base : goal()?.evaluating ? context.theme.text.feedback.info.base : context.theme.text.muted;
        return _$createComponent(Show, {
          get when() {
            return goal();
          },
          get children() {
            var _el$22 = _$createElement("box"), _el$23 = _$createElement("text");
            _$insertNode(_el$22, _el$23);
            _$setProp(_el$22, "flexShrink", 0);
            _$setProp(_el$22, "onMouseUp", () => props.sessionID && context.keymap.dispatch("goal.status"));
            _$setProp(_el$23, "wrapMode", "none");
            _$insert(_el$23, label);
            _$effect((_$p) => _$setProp(_el$23, "fg", color(), _$p));
            return _el$22;
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
        run: () => scrollRef()?.scrollBy(-3)
      }, {
        id: "goal.status.scroll-down",
        title: "Goal status: scroll down",
        group: "Goal",
        bind: "down",
        enabled: () => statusDialogOpen(),
        run: () => scrollRef()?.scrollBy(3)
      }, {
        id: "goal.status.page-up",
        title: "Goal status: page up",
        group: "Goal",
        bind: "pageup",
        enabled: () => statusDialogOpen(),
        run: () => scrollRef()?.scrollBy(-15)
      }, {
        id: "goal.status.page-down",
        title: "Goal status: page down",
        group: "Goal",
        bind: "pagedown",
        enabled: () => statusDialogOpen(),
        run: () => scrollRef()?.scrollBy(15)
      }, {
        id: "goal.status.home",
        title: "Goal status: scroll to start",
        group: "Goal",
        bind: "home",
        enabled: () => statusDialogOpen(),
        run: () => scrollRef()?.scrollTo(0)
      }, {
        id: "goal.status.end",
        title: "Goal status: scroll to end",
        group: "Goal",
        bind: "end",
        enabled: () => statusDialogOpen(),
        run: () => scrollRef()?.scrollTo(Number.MAX_SAFE_INTEGER)
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
