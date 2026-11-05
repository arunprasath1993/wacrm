/**
 * Copy-paste JSON import / export for the flow editor.
 *
 * Drawing a big flow edge-by-edge on the canvas is slow. This module
 * lets the editor dump the authored graph as plain JSON (to copy,
 * back up, share, or hand to an LLM) and load a pasted JSON back in.
 *
 * The JSON shape is deliberately the same one `/api/flows/[id]` PUT
 * accepts — name, trigger, entry_node_id, nodes[] — plus a `version`
 * tag. Edges stay inside each node's config (`next_node_key`,
 * `true_next` / `false_next`, button / list-row `next_node_key`), so
 * there is nothing extra to wire up.
 *
 * Parsing only checks STRUCTURE (valid JSON, known node types, unique
 * keys). Semantic problems — dangling edges, missing button titles —
 * are left to `validateFlowForActivation`, which already renders them
 * in the editor's validation panel after import. That keeps half-done
 * drafts importable, same as saving a half-done draft.
 *
 * Positions are optional. A paste with no positions (the common case
 * for hand-written or LLM-written JSON) gets a dagre layout here,
 * because the canvas only auto-lays-out once per mount.
 */

import { getT } from "@/lib/i18n/translate";
import type { BuilderNode } from "@/components/flows/shared";
import { deriveCanvasEdges } from "./edges";
import { autoLayout, shouldAutoLayout } from "./layout";
import type { FlowNodeType } from "./types";

const t = getT("Flows.jsonIo");

export const FLOW_JSON_VERSION = 1;

type TriggerType = "keyword" | "first_inbound_message" | "manual";

export interface FlowJson {
  version: number;
  name: string;
  description: string;
  trigger_type: TriggerType;
  trigger_config: Record<string, unknown>;
  entry_node_id: string | null;
  nodes: BuilderNode[];
}

/** The editor fields a JSON import can overwrite. Status is never imported. */
export type FlowJsonInput = Omit<FlowJson, "version">;

// Record (not array) so adding a FlowNodeType without listing it here
// is a compile error.
const NODE_TYPES: Record<FlowNodeType, true> = {
  start: true,
  send_message: true,
  send_buttons: true,
  send_list: true,
  send_media: true,
  collect_input: true,
  condition: true,
  set_tag: true,
  start_booking: true,
  handoff: true,
  end: true,
};

const TRIGGER_TYPES: readonly TriggerType[] = [
  "keyword",
  "first_inbound_message",
  "manual",
];

export function flowToJson(input: FlowJsonInput): string {
  const doc: FlowJson = {
    version: FLOW_JSON_VERSION,
    name: input.name,
    description: input.description,
    trigger_type: input.trigger_type,
    trigger_config: input.trigger_config,
    entry_node_id: input.entry_node_id,
    nodes: input.nodes.map((n) => ({
      node_key: n.node_key,
      node_type: n.node_type,
      config: n.config,
      position_x: n.position_x ?? 0,
      position_y: n.position_y ?? 0,
    })),
  };
  return JSON.stringify(doc, null, 2);
}

export type ParseFlowJsonResult =
  | { ok: true; value: FlowJsonInput }
  | { ok: false; error: string };

/**
 * Parse pasted text into editor state. Top-level fields that are
 * missing fall back to `current`, so a paste of just `{ "nodes": [...] }`
 * replaces the graph and keeps the flow's name and trigger.
 */
export function parseFlowJson(
  text: string,
  current: FlowJsonInput,
): ParseFlowJsonResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: t("invalidJson", { detail }) };
  }
  if (!isObject(raw)) {
    return { ok: false, error: t("notObject") };
  }

  if (
    raw.version !== undefined &&
    (typeof raw.version !== "number" || raw.version > FLOW_JSON_VERSION)
  ) {
    return {
      ok: false,
      error: t("unsupportedVersion", { version: String(raw.version) }),
    };
  }

  if (!Array.isArray(raw.nodes)) {
    return { ok: false, error: t("nodesMissing") };
  }

  const nodes: BuilderNode[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.nodes.length; i += 1) {
    const n: unknown = raw.nodes[i];
    const at = i + 1;
    if (!isObject(n)) {
      return { ok: false, error: t("nodeNotObject", { index: at }) };
    }
    const key = typeof n.node_key === "string" ? n.node_key.trim() : "";
    if (!key) {
      return { ok: false, error: t("nodeKeyMissing", { index: at }) };
    }
    if (seen.has(key)) {
      return { ok: false, error: t("nodeKeyDuplicate", { key }) };
    }
    seen.add(key);
    if (typeof n.node_type !== "string" || !(n.node_type in NODE_TYPES)) {
      return {
        ok: false,
        error: t("nodeTypeUnknown", {
          key,
          type: String(n.node_type),
          allowed: Object.keys(NODE_TYPES).join(", "),
        }),
      };
    }
    if (n.config !== undefined && !isObject(n.config)) {
      return { ok: false, error: t("configNotObject", { key }) };
    }
    nodes.push({
      node_key: key,
      node_type: n.node_type as FlowNodeType,
      config: (n.config as Record<string, unknown> | undefined) ?? {},
      position_x: toInt(n.position_x),
      position_y: toInt(n.position_y),
    });
  }

  let trigger_type = current.trigger_type;
  if (raw.trigger_type !== undefined) {
    if (!TRIGGER_TYPES.includes(raw.trigger_type as TriggerType)) {
      return {
        ok: false,
        error: t("triggerTypeUnknown", {
          type: String(raw.trigger_type),
          allowed: TRIGGER_TYPES.join(", "),
        }),
      };
    }
    trigger_type = raw.trigger_type as TriggerType;
  }

  let trigger_config = current.trigger_config;
  if (raw.trigger_config !== undefined) {
    if (!isObject(raw.trigger_config)) {
      return { ok: false, error: t("triggerConfigNotObject") };
    }
    trigger_config = raw.trigger_config;
  } else if (trigger_type !== current.trigger_type) {
    // The old trigger's config doesn't belong to the new trigger type.
    trigger_config = {};
  }

  // entry_node_id is a node_key. An unknown one is kept as-is so the
  // validation panel can point at it; when absent, default to the
  // first start node like addNode() does.
  const entry_node_id =
    typeof raw.entry_node_id === "string" && raw.entry_node_id.trim()
      ? raw.entry_node_id.trim()
      : (nodes.find((n) => n.node_type === "start")?.node_key ?? null);

  return {
    ok: true,
    value: {
      name:
        typeof raw.name === "string" && raw.name.trim()
          ? raw.name.trim()
          : current.name,
      description:
        typeof raw.description === "string"
          ? raw.description
          : current.description,
      trigger_type,
      trigger_config,
      entry_node_id,
      nodes: layoutIfUnpositioned(nodes),
    },
  };
}

function layoutIfUnpositioned(nodes: BuilderNode[]): BuilderNode[] {
  if (!shouldAutoLayout(nodes)) return nodes;
  const positions = autoLayout(
    nodes.map((n) => ({ id: n.node_key })),
    deriveCanvasEdges(nodes).map((e) => ({ source: e.source, target: e.target })),
  );
  return nodes.map((n) => {
    const p = positions.get(n.node_key);
    return p
      ? { ...n, position_x: Math.round(p.x), position_y: Math.round(p.y) }
      : n;
  });
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toInt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0;
}
