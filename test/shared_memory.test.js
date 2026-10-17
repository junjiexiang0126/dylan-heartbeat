const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readMemories } = require('../autonomous_agent');

test('shared reader loads Ziwei-home aliases, prefers authoritative files and never reads credentials', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-shared-memory-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const folder of ['identity', 'memory', 'goals', 'history', 'config']) fs.mkdirSync(path.join(dir, folder));
  for (const [name, content] of Object.entries({ 'identity/system_prompt.txt': '人格原文', 'identity/care_rules.txt': '相处规则', 'identity/autonomy.txt': '自主规则', 'memory/core_memory.md': '旧核心记忆', 'goals/long_term_goals.md': '长期目标', 'history/shared_history.txt': '共同经历', 'config/credentials.md': 'MUST_NOT_LOAD_SECRET' })) fs.writeFileSync(path.join(dir, name), content);
  assert.match(readMemories(dir), /人格原文/);
  assert.match(readMemories(dir), /相处规则/);
  assert.match(readMemories(dir), /共同经历/);
  assert.doesNotMatch(readMemories(dir), /MUST_NOT_LOAD_SECRET/);
  fs.writeFileSync(path.join(dir, 'memory.md'), '权威核心记忆');
  assert.match(readMemories(dir), /权威核心记忆/);
  assert.doesNotMatch(readMemories(dir), /旧核心记忆/);
  fs.writeFileSync(path.join(dir, 'memory.md'), '下一轮最新记忆');
  assert.match(readMemories(dir), /下一轮最新记忆/);
});

test('missing memory is optional and oversized files have bounded context', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-shared-memory-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(readMemories(dir), '');
  fs.writeFileSync(path.join(dir, 'system_prompt.txt'), 'a'.repeat(25000) + 'OUTSIDE_BOUND');
  assert.equal(readMemories(dir), 'system_prompt.txt:\n' + 'a'.repeat(24000));
});
