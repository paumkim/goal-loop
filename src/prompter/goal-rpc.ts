/**
 * Mirrors goal-loop's shared RPC contract so prompter needs no source import from that repo — and, crucially,
 * no *runtime* import of `@opencode/plugin`, which is an optional peer that a clean install does not provide.
 * `Rpc.define` is a validation-only identity function; this literal has the same shape and is accepted by
 * `client.rpc()` structurally (Rpc.PortableDefinition).
 */
const sessionInput = {
  type: "object",
  properties: { sessionID: { type: "string" } },
  required: ["sessionID"],
  additionalProperties: false,
} as const

const goal = { anyOf: [{ type: "object" }, { type: "null" }] } as const

/** Mirrors goal-loop's shared RPC contract so prompter needs no source import from that repo. */
export const GoalRpc = {
  id: "goal",
  methods: {
    get: {
      input: sessionInput,
      output: { type: "object", properties: { goal }, required: ["goal"] },
    },
  },
  events: {
    changed: {
      schema: {
        type: "object",
        properties: { sessionID: { type: "string" }, goal },
        required: ["sessionID", "goal"],
      },
    },
    notice: {
      schema: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          kind: { type: "string" },
          level: { type: "string", enum: ["info", "success", "warning", "error"] },
          title: { type: "string" },
          message: { type: "string" },
        },
        required: ["sessionID", "kind", "level", "title", "message"],
      },
    },
  },
} as const
