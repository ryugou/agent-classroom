export type ParsedRecord =
  | { kind: 'ToolUseDetected'; toolUseId: string; toolName: string; isBackground: boolean; at: number }
  | { kind: 'ToolResultDetected'; toolUseId: string; at: number }
  | { kind: 'TextOnlyAssistant'; at: number }
  | { kind: 'ProgressDetected'; parentToolUseId: string; agentId: string; event: string; at: number }
  | { kind: 'TurnDurationDetected'; at: number }
  | { kind: 'BackgroundAgentCompleted'; toolUseId: string; at: number };

export function parseLine(line: string): ParsedRecord[] {
  if (!line.trim()) return [];
  let rec: unknown;
  try { rec = JSON.parse(line); } catch { return []; }
  if (typeof rec !== 'object' || rec === null) return [];
  const r = rec as Record<string, unknown>;
  // fallback to parse-time if record lacks a numeric timestamp (e.g. malformed live stream)
  const at = typeof r.timestamp === 'number' ? r.timestamp : Date.now();

  if (r.type === 'assistant') return parseAssistant(r, at);
  if (r.type === 'user') return parseUser(r, at);
  if (r.type === 'progress' && r.subtype === 'agent_progress') return parseProgress(r, at);
  if (r.type === 'system' && r.subtype === 'turn_duration') return [{ kind: 'TurnDurationDetected', at }];
  if (r.type === 'queue-operation' && r.operation === 'enqueue') return parseQueueEnqueue(r, at);
  return [];
}

function parseAssistant(r: Record<string, unknown>, at: number): ParsedRecord[] {
  const msg = r.message as { content?: unknown[] } | undefined;
  const content = msg?.content;
  if (!Array.isArray(content)) return [];
  const out: ParsedRecord[] = [];
  let anyToolUse = false;
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
      const input = b.input as Record<string, unknown> | undefined;
      const isBackground = input?.run_in_background === true;
      out.push({ kind: 'ToolUseDetected', toolUseId: b.id, toolName: b.name, isBackground, at });
      anyToolUse = true;
    }
  }
  if (!anyToolUse && content.length > 0) out.push({ kind: 'TextOnlyAssistant', at });
  return out;
}

function parseUser(r: Record<string, unknown>, at: number): ParsedRecord[] {
  const msg = r.message as { content?: unknown[] } | undefined;
  const content = msg?.content;
  if (!Array.isArray(content)) return [];
  const out: ParsedRecord[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
      out.push({ kind: 'ToolResultDetected', toolUseId: b.tool_use_id, at });
    }
  }
  return out;
}

function parseProgress(r: Record<string, unknown>, at: number): ParsedRecord[] {
  if (typeof r.parentToolUseID !== 'string') return [];
  if (typeof r.agentId !== 'string') return [];
  if (typeof r.event !== 'string') return [];
  return [{
    kind: 'ProgressDetected',
    parentToolUseId: r.parentToolUseID,
    agentId: r.agentId,
    event: r.event,
    at,
  }];
}

function parseQueueEnqueue(r: Record<string, unknown>, at: number): ParsedRecord[] {
  const content = typeof r.content === 'string' ? r.content : '';
  const match = content.match(/<tool-use-id>(.*?)<\/tool-use-id>/);
  if (!match) return [];
  return [{ kind: 'BackgroundAgentCompleted', toolUseId: match[1]!, at }];
}
