import { describe, it, expect } from "vitest";
import { flowToJson, parseFlowJson, type FlowJsonInput } from "./json-io";

const current: FlowJsonInput = {
  name: "Existing flow",
  description: "keep me",
  trigger_type: "keyword",
  trigger_config: { keywords: ["hi"] },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "" },
      position_x: 10,
      position_y: 20,
    },
  ],
};

function parseOk(text: string) {
  const r = parseFlowJson(text, current);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.value;
}

function parseErr(text: string) {
  const r = parseFlowJson(text, current);
  if (r.ok) throw new Error("expected an error");
  return r.error;
}

describe("flowToJson / parseFlowJson", () => {
  it("round-trips the editor state", () => {
    const json = flowToJson(current);
    expect(JSON.parse(json).version).toBe(1);
    expect(parseOk(json)).toEqual(current);
  });

  it("keeps current name / description / trigger when only nodes are pasted", () => {
    const v = parseOk(
      JSON.stringify({
        nodes: [{ node_key: "start", node_type: "start", config: {} }],
      }),
    );
    expect(v.name).toBe("Existing flow");
    expect(v.description).toBe("keep me");
    expect(v.trigger_type).toBe("keyword");
    expect(v.trigger_config).toEqual({ keywords: ["hi"] });
  });

  it("resets trigger_config when trigger_type changes without one", () => {
    const v = parseOk(
      JSON.stringify({ trigger_type: "manual", nodes: [] }),
    );
    expect(v.trigger_type).toBe("manual");
    expect(v.trigger_config).toEqual({});
  });

  it("defaults entry_node_id to the first start node", () => {
    const v = parseOk(
      JSON.stringify({
        nodes: [
          { node_key: "hello", node_type: "send_message", config: {} },
          { node_key: "begin", node_type: "start", config: {} },
        ],
      }),
    );
    expect(v.entry_node_id).toBe("begin");
  });

  it("defaults a missing config to {}", () => {
    const v = parseOk(
      JSON.stringify({ nodes: [{ node_key: "bye", node_type: "end" }] }),
    );
    expect(v.nodes[0].config).toEqual({});
  });

  it("auto-lays-out nodes that have no positions", () => {
    const v = parseOk(
      JSON.stringify({
        nodes: [
          { node_key: "start", node_type: "start", config: { next_node_key: "hi" } },
          { node_key: "hi", node_type: "send_message", config: { text: "Hi", next_node_key: "bye" } },
          { node_key: "bye", node_type: "end", config: {} },
        ],
      }),
    );
    const ys = v.nodes.map((n) => n.position_y ?? 0);
    // Top-to-bottom chain: each node sits below the previous one.
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
  });

  it("keeps explicit positions untouched", () => {
    const v = parseOk(
      JSON.stringify({
        nodes: [
          { node_key: "start", node_type: "start", config: {}, position_x: 5, position_y: 7 },
        ],
      }),
    );
    expect(v.nodes[0]).toMatchObject({ position_x: 5, position_y: 7 });
  });

  it("rejects invalid JSON", () => {
    expect(parseErr("{ nope")).toMatch(/Not valid JSON/);
  });

  it("rejects a non-object top level", () => {
    expect(parseErr("[]")).toMatch(/must be an object/);
  });

  it("rejects a missing nodes array", () => {
    expect(parseErr("{}")).toMatch(/"nodes"/);
  });

  it("rejects duplicate node keys", () => {
    expect(
      parseErr(
        JSON.stringify({
          nodes: [
            { node_key: "a", node_type: "end" },
            { node_key: "a", node_type: "end" },
          ],
        }),
      ),
    ).toMatch(/Duplicate node_key "a"/);
  });

  it("rejects an unknown node_type", () => {
    expect(
      parseErr(JSON.stringify({ nodes: [{ node_key: "x", node_type: "http_fetch" }] })),
    ).toMatch(/unknown node_type "http_fetch"/);
  });

  it("rejects an unknown trigger_type", () => {
    expect(
      parseErr(JSON.stringify({ trigger_type: "cron", nodes: [] })),
    ).toMatch(/Unknown trigger_type "cron"/);
  });

  it("rejects a newer JSON version", () => {
    expect(parseErr(JSON.stringify({ version: 2, nodes: [] }))).toMatch(
      /version: 2/,
    );
  });
});
