import { describe, it, expect } from 'vitest';
import { parseLine } from '../../src/observer/parser/transcript-parser.js';

describe('parseLine', () => {
  it('detects tool_use in assistant record', () => {
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: 1000,
      message: { content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: {} }] },
    });
    expect(parseLine(line)).toEqual([
      { kind: 'ToolUseDetected', toolUseId: 'tu_1', toolName: 'Read', isBackground: false, at: 1000 },
    ]);
  });

  it('detects multiple tool_use in a single assistant record', () => {
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: 1200,
      message: { content: [
        { type: 'tool_use', id: 'tu_2', name: 'Bash', input: {} },
        { type: 'text', text: 'hi' },
        { type: 'tool_use', id: 'tu_3', name: 'Edit', input: {} },
      ]},
    });
    const result = parseLine(line);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ kind: 'ToolUseDetected', toolUseId: 'tu_2' });
    expect(result[1]).toMatchObject({ kind: 'ToolUseDetected', toolUseId: 'tu_3' });
  });

  it('detects text-only assistant as TextOnly', () => {
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: 2000,
      message: { content: [{ type: 'text', text: 'done' }] },
    });
    expect(parseLine(line)).toEqual([{ kind: 'TextOnlyAssistant', at: 2000 }]);
  });

  it('detects tool_result in user record', () => {
    const line = JSON.stringify({
      type: 'user',
      timestamp: 3000,
      message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' }] },
    });
    expect(parseLine(line)).toEqual([
      { kind: 'ToolResultDetected', toolUseId: 'tu_1', at: 3000 },
    ]);
  });

  it('detects progress with parentToolUseID', () => {
    const line = JSON.stringify({
      type: 'progress',
      subtype: 'agent_progress',
      timestamp: 4000,
      parentToolUseID: 'tu_parent',
      agentId: 'sub_a',
      event: 'tool_use',
      tool: 'Read',
    });
    expect(parseLine(line)).toEqual([
      { kind: 'ProgressDetected', parentToolUseId: 'tu_parent', agentId: 'sub_a', event: 'tool_use', at: 4000 },
    ]);
  });

  it('detects turn_duration', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'turn_duration',
      timestamp: 5000,
      duration_ms: 1200,
    });
    expect(parseLine(line)).toEqual([{ kind: 'TurnDurationDetected', at: 5000 }]);
  });

  it('returns empty for unknown / malformed lines', () => {
    expect(parseLine('{"type":"unknown"}')).toEqual([]);
    expect(parseLine('not json')).toEqual([]);
    expect(parseLine('')).toEqual([]);
  });

  it('returns [] for assistant record with empty content array', () => {
    const line = JSON.stringify({ type: 'assistant', timestamp: 9000, message: { content: [] } });
    expect(parseLine(line)).toEqual([]);
  });

  it('detects queue-operation enqueue as BackgroundAgentCompleted', () => {
    const line = JSON.stringify({
      type: 'queue-operation',
      operation: 'enqueue',
      timestamp: 7000,
      content: '<task-notification>\n<task-id>abc</task-id>\n<tool-use-id>toolu_bg_1</tool-use-id>\n</task-notification>',
    });
    expect(parseLine(line)).toEqual([
      { kind: 'BackgroundAgentCompleted', toolUseId: 'toolu_bg_1', at: 7000 },
    ]);
  });

  it('detects isBackground flag on Agent tool_use', () => {
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: 8000,
      message: { content: [{ type: 'tool_use', id: 'tu_bg', name: 'Agent', input: { run_in_background: true, prompt: 'test' } }] },
    });
    const result = parseLine(line);
    expect(result).toEqual([
      { kind: 'ToolUseDetected', toolUseId: 'tu_bg', toolName: 'Agent', isBackground: true, at: 8000 },
    ]);
  });

  it('isBackground is false for Agent tool_use without run_in_background', () => {
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: 8500,
      message: { content: [{ type: 'tool_use', id: 'tu_fg', name: 'Agent', input: { prompt: 'test' } }] },
    });
    const result = parseLine(line);
    expect(result).toEqual([
      { kind: 'ToolUseDetected', toolUseId: 'tu_fg', toolName: 'Agent', isBackground: false, at: 8500 },
    ]);
  });

  it('returns [] for queue-operation enqueue without tool-use-id', () => {
    const line = JSON.stringify({
      type: 'queue-operation',
      operation: 'enqueue',
      timestamp: 9500,
      content: '<task-notification><task-id>abc</task-id></task-notification>',
    });
    expect(parseLine(line)).toEqual([]);
  });
});
