// @bun
// src/tui.tsx
import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { createMemo, createSignal, Show } from "solid-js";

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
    const showStatusDialog = (title, message) => {
      setStatusDialogOpen(true);
      setScrollRef(undefined);
      context.ui.dialog.show(() => (() => {
        var _el$ = _$createElement("box"), _el$2 = _$createElement("text"), _el$3 = _$createElement("scrollbox"), _el$4 = _$createElement("text"), _el$5 = _$createElement("text");
        _$insertNode(_el$, _el$2);
        _$insertNode(_el$, _el$3);
        _$insertNode(_el$, _el$5);
        _$setProp(_el$, "flexDirection", "column");
        _$setProp(_el$, "height", "100%");
        _$setProp(_el$, "padding", 1);
        _$setProp(_el$2, "attributes", 1);
        _$insert(_el$2, title);
        _$insertNode(_el$3, _el$4);
        _$use((el) => setScrollRef(el), _el$3);
        _$setProp(_el$3, "scrollbarOptions", {
          visible: true
        });
        _$setProp(_el$3, "flexGrow", 1);
        _$setProp(_el$3, "stickyScroll", false);
        _$setProp(_el$4, "wrapMode", "word");
        _$insert(_el$4, message);
        _$insertNode(_el$5, _$createTextNode(`up/down scroll \xB7 pgup/pgdn page \xB7 home/end start/end \xB7 esc close`));
        _$effect((_$p) => _$setProp(_el$5, "fg", context.theme.text.muted, _$p));
        return _el$;
      })(), () => {
        setStatusDialogOpen(false);
        setScrollRef(undefined);
      });
      context.ui.dialog.set({
        size: "xlarge",
        centered: true
      });
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
          showStatusDialog(`${GOAL_GLYPH} /goal`, `${notice.title}

${notice.message}`);
        return;
      }
      const important = ATTENTION_KINDS.has(notice.kind);
      if (!here && !important)
        return;
      context.ui.toast.show({
        title: `${GOAL_GLYPH} ${notice.title}`,
        message: notice.message,
        variant: notice.level,
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
      append: "session.composer.top",
      render: (props) => {
        const goal = createMemo(() => live(props.sessionID));
        const label = createMemo(() => {
          const g = goal();
          if (!g || !props.sessionID)
            return "";
          const entry = entries()[props.sessionID];
          const elapsed = g.status === "active" ? g.elapsedMs + Math.max(0, now() - (entry?.receivedAt ?? now())) : g.elapsedMs;
          const state = g.status === "paused" ? "paused" : g.evaluating ? "checking" : g.waiting ? "waiting" : "active";
          const turns = g.turns > 0 ? ` \xB7 ${g.turns} turn${g.turns === 1 ? "" : "s"}` : "";
          return `${GOAL_GLYPH} goal ${state} \xB7 ${formatDurationCoarse(elapsed)}${turns}`;
        });
        const color = () => goal()?.status === "paused" ? context.theme.text.feedback.warning.base : goal()?.evaluating ? context.theme.text.feedback.info.base : context.theme.text.muted;
        return _$createComponent(Show, {
          get when() {
            return goal();
          },
          get children() {
            var _el$7 = _$createElement("box"), _el$8 = _$createElement("box"), _el$9 = _$createElement("text");
            _$insertNode(_el$7, _el$8);
            _$setProp(_el$7, "width", "100%");
            _$setProp(_el$7, "flexDirection", "row");
            _$setProp(_el$7, "justifyContent", "flex-start");
            _$insertNode(_el$8, _el$9);
            _$setProp(_el$8, "flexShrink", 0);
            _$setProp(_el$8, "onMouseUp", () => props.sessionID && void rpc.status({
              sessionID: props.sessionID
            }, at(props.sessionID)).catch(() => {}));
            _$setProp(_el$9, "wrapMode", "none");
            _$insert(_el$9, label);
            _$effect((_$p) => _$setProp(_el$9, "fg", color(), _$p));
            return _el$7;
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
      }, {
        id: "goal.status.close",
        title: "Goal status: close",
        group: "Goal",
        bind: "escape",
        enabled: () => statusDialogOpen(),
        run: () => {
          setStatusDialogOpen(false);
          setScrollRef(undefined);
          context.ui.dialog.clear();
        }
      }, {
        id: "goal.status.close-enter",
        title: "Goal status: close",
        group: "Goal",
        palette: true,
        bind: "enter",
        enabled: () => statusDialogOpen(),
        run: () => {
          setStatusDialogOpen(false);
          setScrollRef(undefined);
          context.ui.dialog.clear();
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
