/**
 * scripts/dod-smoke.ts
 *
 * Phase 1 DoD automated smoke test harness.
 * Spawns the real observer CLI against tmp dirs and verifies observable behaviour.
 *
 * Usage:
 *   pnpm tsx scripts/dod-smoke.ts
 *
 * Exit 0 = all automated checks passed.
 * Exit 1 = one or more checks failed.
 */

import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import http from 'node:http';
import { createServer as createNetServer } from 'node:net';
import WebSocket from 'ws';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

function log(msg: string): void {
  process.stdout.write(msg + '\n');
}

let passed = 0;
let failed = 0;
const failures: string[] = [];

function pass(id: number, label: string): void {
  log(`[DoD-${id}] ✓ PASS  ${label}`);
  passed++;
}

function fail(id: number, label: string, reason: string): void {
  log(`[DoD-${id}] ✗ FAIL  ${label} — ${reason}`);
  failed++;
  failures.push(`DoD-${id}: ${reason}`);
}

// ---------------------------------------------------------------------------
// Server lifecycle helpers
// ---------------------------------------------------------------------------

interface ServerHandle {
  port: number;
  proc: ChildProcess;
  stateDir: string;
  claudeDir: string;
  tmpRoot: string;
  teardown: () => Promise<void>;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const address = srv.address();
      if (typeof address === 'object' && address !== null) {
        const port = address.port;
        srv.close(() => resolve(port));
      } else {
        reject(new Error('no port'));
      }
    });
  });
}

async function startObserver(opts: {
  classrooms?: number;
  claudeDir: string;
  stateDir: string;
  port?: number;
  staleMs?: number;
}): Promise<{ port: number; proc: ChildProcess }> {
  const cliPath = join(repoRoot, 'dist', 'observer', 'observer', 'cli.js');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AGENT_CLASSROOM_PORT: String(opts.port ?? await findFreePort()),
    AGENT_CLASSROOM_CLASSROOMS: String(opts.classrooms ?? 4),
    AGENT_CLASSROOM_CLAUDE_DIR: opts.claudeDir,
    AGENT_CLASSROOM_STATE_DIR: opts.stateDir,
    // Set a short stale threshold so DoD-5 can exercise TeacherLeft without a long wait.
    // 3000ms is long enough for DoD-3/4/7 to complete well within the threshold.
    AGENT_CLASSROOM_STALE_MS: String(opts.staleMs ?? 3000),
  };

  const proc = spawn(process.execPath, [cliPath, 'start'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const assignedPort = env.AGENT_CLASSROOM_PORT ? Number(env.AGENT_CLASSROOM_PORT) : await findFreePort();

  // Wait for "observer started" log line
  const port = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('observer did not start within 8s')), 8000);
    let buf = '';
    const onData = (chunk: Buffer): void => {
      buf += chunk.toString();
      if (buf.includes('"observer started"') || buf.includes('"msg":"observer started"')) {
        clearTimeout(timeout);
        proc.stdout?.off('data', onData);
        resolve(assignedPort);
      }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', (d: Buffer) => {
      buf += d.toString();
      if (buf.includes('"observer started"') || buf.includes('"msg":"observer started"')) {
        clearTimeout(timeout);
        resolve(assignedPort);
      }
    });
    proc.on('error', (e) => { clearTimeout(timeout); reject(e); });
    proc.on('exit', (c) => { clearTimeout(timeout); reject(new Error(`observer exited with code ${c}`)); });
  });

  return { port, proc };
}

async function stopProc(proc: ChildProcess): Promise<void> {
  proc.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => { proc.kill('SIGKILL'); resolve(); }, 3000);
    proc.on('exit', () => { clearTimeout(t); resolve(); });
  });
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => { body += c.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(4000, () => { req.destroy(new Error('timeout')); });
  });
}

// ---------------------------------------------------------------------------
// WS helper: collect messages until predicate matches or timeout
// ---------------------------------------------------------------------------

async function wsCollect(
  url: string,
  predicate: (msgs: unknown[]) => boolean,
  timeoutMs = 5000,
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const msgs: unknown[] = [];
    const t = setTimeout(() => {
      ws.close();
      reject(new Error(`WS predicate not satisfied within ${timeoutMs}ms. collected: ${JSON.stringify(msgs)}`));
    }, timeoutMs);
    ws.on('message', (raw: Buffer) => {
      const msg = JSON.parse(raw.toString());
      msgs.push(msg);
      if (predicate(msgs)) {
        clearTimeout(t);
        ws.close();
        resolve(msgs);
      }
    });
    ws.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

// ---------------------------------------------------------------------------
// Main test suite
// ---------------------------------------------------------------------------

async function runTests(): Promise<void> {
  // Shared tmp directories
  const tmpRoot = mkdtempSync(join(tmpdir(), 'ac-dod-'));
  const stateDir = join(tmpRoot, 'state');
  const claudeDir = join(tmpRoot, 'claude-projects');
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(claudeDir, { recursive: true });

  log('');
  log('═══════════════════════════════════════════════════');
  log(' agent-classroom Phase 1 DoD Automated Smoke Tests');
  log('═══════════════════════════════════════════════════');
  log('');

  // ------------------------------------------------------------------
  // DoD-1: CLI start + /healthz
  // ------------------------------------------------------------------
  log('[DoD-1] CLI 起動 & /healthz エンドポイント応答確認...');
  let serverPort = 0;
  let proc: ChildProcess | null = null;
  try {
    const h = await startObserver({ claudeDir, stateDir, classrooms: 4 });
    serverPort = h.port;
    proc = h.proc;

    const { status, body } = await httpGet(`http://127.0.0.1:${serverPort}/healthz`);
    const json = JSON.parse(body) as { ok: boolean };
    if (status === 200 && json.ok === true) {
      pass(1, 'CLI 起動 & /healthz → {ok:true}');
    } else {
      fail(1, 'CLI 起動 & /healthz', `status=${status} body=${body}`);
    }
  } catch (e) {
    fail(1, 'CLI 起動 & /healthz', String(e));
    if (proc) await stopProc(proc);
    rmSync(tmpRoot, { recursive: true, force: true });
    return;
  }

  // ------------------------------------------------------------------
  // DoD-2: WS delivers ClassroomList with N=4 classrooms
  // ------------------------------------------------------------------
  log('[DoD-2] WS 接続 → ClassroomList (N=4 教室) 確認...');
  try {
    const msgs = await wsCollect(
      `ws://127.0.0.1:${serverPort}/ws`,
      (m) => m.some((x: unknown) => (x as { type: string }).type === 'ClassroomList'),
    );
    const cl = msgs.find((x: unknown) => (x as { type: string }).type === 'ClassroomList') as
      { type: string; snapshot: { classrooms: unknown[] } } | undefined;
    if (cl && cl.snapshot.classrooms.length === 4) {
      pass(2, `ClassroomList 受信 (${cl.snapshot.classrooms.length} 教室)`);
    } else {
      fail(2, 'ClassroomList', `教室数が期待値 4 と不一致: got ${cl?.snapshot.classrooms.length}`);
    }
  } catch (e) {
    fail(2, 'ClassroomList', String(e));
  }

  // ------------------------------------------------------------------
  // DoD-3: fake JSONL → TeacherEntered
  // ------------------------------------------------------------------
  log('[DoD-3] 偽 JSONL 出現 → TeacherEntered 検知...');
  const projDir1 = join(claudeDir, 'my-project');
  mkdirSync(projDir1, { recursive: true });
  const sessionFile1 = join(projDir1, 'session-abc-001.jsonl');

  // Append minimal JSONL content to trigger active state
  const assistantLine = JSON.stringify({
    type: 'assistant',
    timestamp: Date.now(),
    message: {
      content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'echo hi' } }],
    },
  }) + '\n';

  try {
    writeFileSync(sessionFile1, assistantLine);

    const msgs = await wsCollect(
      `ws://127.0.0.1:${serverPort}/ws`,
      (m) => m.some((x: unknown) => (x as { type: string }).type === 'TeacherEntered'),
      6000,
    );
    const te = msgs.find((x: unknown) => (x as { type: string }).type === 'TeacherEntered') as
      { type: string; sessionId: string } | undefined;
    if (te) {
      pass(3, `TeacherEntered 受信 (sessionId=${te.sessionId})`);
    } else {
      fail(3, 'TeacherEntered', 'メッセージが届かなかった');
    }
  } catch (e) {
    fail(3, 'TeacherEntered (fake JSONL)', String(e));
  }

  // ------------------------------------------------------------------
  // DoD-4: progress/agent_progress 行追記 → StudentEntered WS 受信
  // ------------------------------------------------------------------
  log('[DoD-4] progress/agent_progress 行追記 → StudentEntered WS 受信...');
  // Keep this WS connection open; DoD-5 reuses it to observe TeacherLeft.
  const wsForDod45 = new WebSocket(`ws://127.0.0.1:${serverPort}/ws`);
  const dod45Messages: string[] = [];
  await new Promise<void>((resolve, reject) => {
    wsForDod45.once('open', () => resolve());
    wsForDod45.once('error', reject);
  });
  wsForDod45.on('message', (data: Buffer) => dod45Messages.push(data.toString()));

  try {
    // transcript-parser.ts handles {type:'progress', subtype:'agent_progress', parentToolUseID, agentId, event}
    // StateInferrer.handleProgress emits StudentSpawned → WsBroadcaster converts to StudentEntered
    const progressRecord = JSON.stringify({
      type: 'progress',
      subtype: 'agent_progress',
      timestamp: Date.now(),
      parentToolUseID: 'tu-smoke-parent',
      agentId: 'student-smoke-1',
      event: 'tool_use',
      tool: 'Read',
    }) + '\n';
    appendFileSync(sessionFile1, progressRecord);

    // Wait for file tail (tailIntervalMs=500ms) + broadcast pipeline
    await sleep(1500);

    const sawStudentEntered = dod45Messages.some((m) => m.includes('StudentEntered'));
    if (sawStudentEntered) {
      pass(4, 'agent_progress 追記で StudentEntered を WebSocket 受信');
    } else {
      fail(4, 'agent_progress 追記後', `expected StudentEntered message; got ${dod45Messages.length} messages: ${dod45Messages.slice(0, 3).join(' | ')}`);
    }
  } catch (e) {
    fail(4, 'progress/agent_progress 行追記', String(e));
  }

  // ------------------------------------------------------------------
  // DoD-5: JSONL stale → TeacherLeft (integration: AGENT_CLASSROOM_STALE_MS=3000)
  // ------------------------------------------------------------------
  log('[DoD-5] JSONL stale → TeacherLeft (AGENT_CLASSROOM_STALE_MS=3000ms)...');
  try {
    // Observer was spawned with AGENT_CLASSROOM_STALE_MS=3000.
    // After last file activity (~1500ms ago from DoD-4 sleep), we wait an additional
    // 2500ms so total elapsed exceeds the 3000ms threshold. The scan interval is 1000ms,
    // so TeacherLeft should fire within staleMs + scanIntervalMs ≈ 4000ms of last write.
    const waitMs = 2500;
    await sleep(waitMs);

    const sawTeacherLeft = dod45Messages.some((m) => m.includes('TeacherLeft'));
    wsForDod45.close();

    if (sawTeacherLeft) {
      pass(5, `TeacherLeft broadcast を AGENT_CLASSROOM_STALE_MS=3000ms 後に WS 受信`);
    } else {
      fail(5, 'JSONL stale → TeacherLeft', `no TeacherLeft in ${dod45Messages.length} messages`);
    }
  } catch (e) {
    wsForDod45.close();
    fail(5, 'JSONL stale → TeacherLeft', String(e));
  }

  // ------------------------------------------------------------------
  // DoD-6: layout.json written (state persistence)
  // ------------------------------------------------------------------
  log('[DoD-6] layout.json 書き込み確認 (再起動後の状態復元)...');
  try {
    const stateFile = join(stateDir, 'layout.json');
    if (existsSync(stateFile)) {
      pass(6, `永続化ファイル存在: ${stateFile}`);
    } else {
      const files = readdirSync(stateDir);
      fail(6, '永続化ファイル', `layout.json が見つからない。stateDir 内: ${files.join(', ')}`);
    }
  } catch (e) {
    fail(6, '永続化ファイル', String(e));
  }

  // ------------------------------------------------------------------
  // DoD-7: 2 parallel sessions → 2 classrooms occupied
  // ------------------------------------------------------------------
  log('[DoD-7] 並行 2 JSONL → 2 教室への TeacherEntered 確認...');
  try {
    const proj2a = join(claudeDir, 'parallel-a');
    const proj2b = join(claudeDir, 'parallel-b');
    mkdirSync(proj2a, { recursive: true });
    mkdirSync(proj2b, { recursive: true });

    writeFileSync(join(proj2a, 'session-para-001.jsonl'), assistantLine);
    writeFileSync(join(proj2b, 'session-para-002.jsonl'), assistantLine);

    const msgs = await wsCollect(
      `ws://127.0.0.1:${serverPort}/ws`,
      (m) => {
        const enters = m.filter((x: unknown) => (x as { type: string }).type === 'TeacherEntered');
        return enters.length >= 2;
      },
      8000,
    );
    const enters = msgs.filter((x: unknown) => (x as { type: string }).type === 'TeacherEntered');
    if (enters.length >= 2) {
      pass(7, `並行 2 セッション → TeacherEntered × ${enters.length}`);
    } else {
      fail(7, '並行 2 セッション', `TeacherEntered が ${enters.length} 件のみ`);
    }
  } catch (e) {
    fail(7, '並行 2 セッション', String(e));
  }

  // Stop main server before DoD-8 (needs N=1 server)
  await stopProc(proc);
  proc = null;

  // ------------------------------------------------------------------
  // DoD-8: N=1 classrooms, 2nd session → Toast warn
  // ------------------------------------------------------------------
  log('[DoD-8] N=1 設定で 2 個目セッション → Toast warn 確認...');
  const stateDir8 = join(tmpRoot, 'state8');
  const claudeDir8 = join(tmpRoot, 'claude-8');
  mkdirSync(stateDir8, { recursive: true });
  mkdirSync(claudeDir8, { recursive: true });

  let proc8: ChildProcess | null = null;
  try {
    const h8 = await startObserver({ claudeDir: claudeDir8, stateDir: stateDir8, classrooms: 1 });
    proc8 = h8.proc;
    const port8 = h8.port;

    // First session → fills the 1 classroom
    const pdir8a = join(claudeDir8, 'proj-a');
    mkdirSync(pdir8a, { recursive: true });
    writeFileSync(join(pdir8a, 'session-first.jsonl'), assistantLine);

    // Wait for first TeacherEntered
    await wsCollect(
      `ws://127.0.0.1:${port8}/ws`,
      (m) => m.some((x: unknown) => (x as { type: string }).type === 'TeacherEntered'),
      6000,
    );

    // Second session → should overflow → Toast
    const pdir8b = join(claudeDir8, 'proj-b');
    mkdirSync(pdir8b, { recursive: true });
    writeFileSync(join(pdir8b, 'session-second.jsonl'), assistantLine);

    const msgs = await wsCollect(
      `ws://127.0.0.1:${port8}/ws`,
      (m) => m.some((x: unknown) => {
        const mm = x as { type: string; level?: string };
        return mm.type === 'Toast' && mm.level === 'warn';
      }),
      8000,
    );
    const toast = msgs.find((x: unknown) => {
      const mm = x as { type: string; level?: string };
      return mm.type === 'Toast' && mm.level === 'warn';
    });
    if (toast) {
      pass(8, `N=1 overflow → Toast warn 受信`);
    } else {
      fail(8, 'Toast warn', `Toast warn が届かなかった。全メッセージ: ${JSON.stringify(msgs)}`);
    }
  } catch (e) {
    fail(8, 'N=1 Toast warn', String(e));
  } finally {
    if (proc8) await stopProc(proc8);
  }

  // ------------------------------------------------------------------
  // Cleanup
  // ------------------------------------------------------------------
  if (proc) await stopProc(proc);
  rmSync(tmpRoot, { recursive: true, force: true });

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  log('');
  log('═══════════════════════════════════════════════════');
  log(` Result: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    log('');
    log('Failures:');
    for (const f of failures) log(`  - ${f}`);
  }
  log('═══════════════════════════════════════════════════');
  log('');

  if (failed > 0) process.exit(1);
}

runTests().catch((e) => {
  log(`[smoke] unexpected error: ${e}`);
  process.exit(1);
});
