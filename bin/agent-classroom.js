#!/usr/bin/env node
import('../dist/observer/observer/cli.js').catch((err) => {
  console.error('[agent-classroom] CLI load failed:', err);
  process.exit(1);
});
