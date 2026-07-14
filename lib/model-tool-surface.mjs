function toolDisplayName(tool) {
  if (typeof tool.name === "string" && tool.name.length > 0) {
    return tool.name;
  }
  if (typeof tool.namespace === "string" && tool.namespace.length > 0) {
    return tool.namespace;
  }
  return "";
}

function namespaceMembers(tool) {
  if (!Array.isArray(tool.tools)) {
    return [];
  }
  return tool.tools
    .map((entry) => entry?.name)
    .filter((name) => typeof name === "string")
    .sort();
}

export function summarizeResponsesRequest(request) {
  const tools = Array.isArray(request.tools) ? request.tools : [];
  const input = Array.isArray(request.input) ? request.input : [];
  const inputTypeCounts = {};

  for (const item of input) {
    const type = typeof item?.type === "string" ? item.type : "unknown";
    inputTypeCounts[type] = (inputTypeCounts[type] ?? 0) + 1;
  }

  const normalizedTools = tools.map((tool) => ({
    type: typeof tool?.type === "string" ? tool.type : "unknown",
    name: toolDisplayName(tool),
    deferred: tool?.defer_loading === true,
    members: namespaceMembers(tool)
  }));

  return {
    model: request.model ?? null,
    toolChoice: request.tool_choice ?? null,
    parallelToolCalls: request.parallel_tool_calls ?? null,
    toolCount: normalizedTools.length,
    tools: normalizedTools,
    inputTypeCounts,
    hasResponsesComputerTool: normalizedTools.some((tool) => tool.type === "computer"),
    nodeReplTools: normalizedTools.filter((tool) =>
      tool.name.includes("node_repl") ||
      tool.members.some((member) => member.includes("node_repl") || member === "js")
    ),
    computerProtocolInputCount:
      (inputTypeCounts.computer_call ?? 0) +
      (inputTypeCounts.computer_call_output ?? 0)
  };
}

export function parsePostedResponsesRequest(logBody) {
  const marker = "/v1/responses: ";
  const markerIndex = logBody.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error("Responses request marker was not found");
  }
  const start = logBody.indexOf("{", markerIndex + marker.length);
  if (start < 0) {
    throw new Error("Responses request JSON object was not found");
  }

  let depth = 0;
  let escaped = false;
  let inString = false;
  for (let index = start; index < logBody.length; index += 1) {
    const character = logBody[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }

    if (character === "\"") {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        const jsonText = logBody.slice(start, index + 1);
        try {
          return JSON.parse(jsonText);
        } catch (error) {
          try {
            return JSON.parse(repairNonJsonStringEscapes(jsonText));
          } catch {
            throw error;
          }
        }
      }
    }
  }

  throw new Error("Responses request JSON object was incomplete");
}

function repairNonJsonStringEscapes(value) {
  let result = "";
  let inString = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (!inString) {
      result += character;
      if (character === "\"") {
        inString = true;
      }
      continue;
    }

    if (character === "\"") {
      result += character;
      inString = false;
      continue;
    }
    if (character.charCodeAt(0) < 0x20) {
      result += JSON.stringify(character).slice(1, -1);
      continue;
    }
    if (character !== "\\") {
      result += character;
      continue;
    }

    const next = value[index + 1];
    if (next == null) {
      result += "\\\\";
      continue;
    }
    if ("\"\\/bfnrt".includes(next)) {
      result += character + next;
      index += 1;
      continue;
    }
    if (
      next === "u" &&
      /^[0-9a-fA-F]{4}$/.test(value.slice(index + 2, index + 6))
    ) {
      result += value.slice(index, index + 6);
      index += 5;
      continue;
    }

    result += "\\\\";
  }

  return result;
}
