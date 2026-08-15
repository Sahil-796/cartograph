import "./env.js";
import { describe, expect, it } from "vitest";
import { queries } from "@cartograph/graph";
import { buildToolDefinitions, toMcpTools, toOpenAITools, toolDefinitions } from "../src/index.js";

describe("buildToolDefinitions", () => {
  it("renders exactly one tool per registered query, with unique names", () => {
    expect(toolDefinitions).toHaveLength(9);
    expect(toolDefinitions).toHaveLength(queries.length);

    const names = toolDefinitions.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(queries.map((q) => q.name));
  });

  it("gives every tool a non-empty description and an object-typed parameters schema", () => {
    for (const tool of toolDefinitions) {
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.parameters.type).toBe("object");
      expect(tool.parameters.properties).toBeTruthy();
    }
  });

  it("exposes hidden_coupling's repoId param", () => {
    const tool = toolDefinitions.find((t) => t.name === "hidden_coupling");
    expect(tool).toBeDefined();
    expect(Object.keys(tool!.parameters.properties ?? {})).toEqual(
      expect.arrayContaining(["repoId", "minCount", "limit"]),
    );
  });

  it("exposes who_touched's scope param", () => {
    const tool = toolDefinitions.find((t) => t.name === "who_touched");
    expect(tool).toBeDefined();
    expect(Object.keys(tool!.parameters.properties ?? {})).toEqual(
      expect.arrayContaining(["repoId", "scope", "halfLifeDays", "includeBots"]),
    );
  });

  it("can render an arbitrary subset of query defs, not just the full registry", () => {
    const [first] = queries;
    const subset = buildToolDefinitions([first]);
    expect(subset).toHaveLength(1);
    expect(subset[0].name).toBe(first.name);
  });
});

describe("transport adapters", () => {
  it("toOpenAITools wraps every tool as a type: function entry", () => {
    const openaiTools = toOpenAITools();
    expect(openaiTools).toHaveLength(toolDefinitions.length);
    for (const [i, tool] of openaiTools.entries()) {
      expect(tool.type).toBe("function");
      expect(tool.function.name).toBe(toolDefinitions[i].name);
      expect(tool.function.parameters).toBe(toolDefinitions[i].parameters);
    }
  });

  it("toMcpTools wraps every tool with an inputSchema field", () => {
    const mcpTools = toMcpTools();
    expect(mcpTools).toHaveLength(toolDefinitions.length);
    for (const [i, tool] of mcpTools.entries()) {
      expect(tool.name).toBe(toolDefinitions[i].name);
      expect(tool.inputSchema).toBe(toolDefinitions[i].parameters);
    }
  });
});
