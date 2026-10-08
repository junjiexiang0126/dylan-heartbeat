const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runAutonomousCycle, readState, parseDecision } = require('../autonomous_agent');
const date = new Date('2026-10-08T14:00:00Z');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function decision(extra = {}) { return JSON.stringify({ action: 'diary', reason: '记录', diary: '今日反思', tasks: [], notification: null, ...extra }); }
function options(dir, extra = {}) {
  return { dir, now: date, env: {}, model: async () => decision(), push: async () => ({ ok: true }), recordEvent: async () => {}, ...extra };
}
test('empty chat still wakes, saves diary and restart respects next run', async t => {
  const dir = fixture(t);
  await runAutonomousCycle(options(dir));
  assert.equal(readState(dir).activities[0].diary, '今日反思');
  assert.match(fs.readFileSync(path.join(dir, 'autonomous_journal.md'), 'utf8'), /今日反思/);
  assert.equal((await runAutonomousCycle(options(dir, { model: () => { throw Error('must not call'); } }))).skipped, 'not_due');
});
test('tasks persist across cycles and completion needs an actual artifact', async t => {
  const dir = fixture(t);
  const task = { id: 'essay', title: '哲学提纲', status: 'pending', nextStep: '写提纲' };
  await runAutonomousCycle(options(dir, { model: async () => decision({ action: 'plan', tasks: [task] }) }));
  await runAutonomousCycle(options(dir, { now: new Date(+date + 3600000), model: async messages => {
    assert.equal(JSON.parse(messages[1].content).tasks[0].id, 'essay');
    return decision({ action: 'continue_task', output: '一、哲学基本问题；二、两大派别。', tasks: [{ ...task, status: 'completed', nextStep: '' }] });
  } }));
  assert.equal(readState(dir).tasks[0].status, 'completed');
  assert.throws(() => parseDecision(decision({ action: 'plan', tasks: [{ ...task, status: 'completed' }] }), []));
});
test('invalid output records failure with backoff, never sends or mutates tasks', async t => {
  const dir = fixture(t);
  await assert.rejects(runAutonomousCycle(options(dir, { model: async () => '{broken', push: () => assert.fail('push') })));
  assert.equal(readState(dir).activities.length, 0);
  assert.equal(readState(dir).nextRunAt, new Date(+date + 900000).toISOString());
});
test('push is opt in, cooldown enforced and failed delivery preserves work', async t => {
  const dir = fixture(t);
  const model = async () => decision({ notification: { title: '知微', body: '有新计划' } });
  let calls = 0;
  const push = async () => { calls++; throw Error('offline'); };
  assert.equal((await runAutonomousCycle(options(dir, { model, push }))).notificationStatus, 'disabled');
  const env = { AUTONOMOUS_PUSH_ENABLED: 'true' };
  assert.equal((await runAutonomousCycle(options(dir, { model, push, env, now: new Date(+date + 3600000) }))).notificationStatus, 'failed');
  assert.equal((await runAutonomousCycle(options(dir, { model, push, env, now: new Date(+date + 7200000) }))).notificationStatus, 'cooldown');
  assert.equal(calls, 1);
  assert.equal(readState(dir).activities.length, 3);
});
test('overlapping cycles call model once', async t => {
  const dir = fixture(t);
  let finish;
  const first = runAutonomousCycle(options(dir, { model: () => new Promise(resolve => { finish = resolve; }) }));
  assert.equal((await runAutonomousCycle(options(dir))).skipped, 'busy');
  finish(decision());
  await first;
});
test('memory files loaded and failed gateway does not erase activity', async t => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'long_term_goals.md'), '制定长期计划');
  const activity = await runAutonomousCycle(options(dir, { model: async messages => {
    assert.match(messages[1].content, /制定长期计划/); return decision();
  }, recordEvent: async () => { throw Error('gateway down'); } }));
  assert.equal(activity.eventStatus, 'failed');
  assert.equal(readState(dir).activities.length, 1);
});
test('corrupt state is preserved and lock released', async t => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'autonomous_state.json'), 'corrupt');
  await assert.rejects(runAutonomousCycle(options(dir)));
  assert.equal(fs.readFileSync(path.join(dir, 'autonomous_state.json'), 'utf8'), 'corrupt');
  assert.equal(fs.existsSync(path.join(dir, 'autonomous.lock')), false);
});
test('unknown tools, duplicate ids, phantom completion and reopen are rejected', () => {
  assert.throws(() => parseDecision(decision({ action: 'shell' }), []));
  const task = { id: 'x', title: 'x', status: 'pending', nextStep: '' };
  assert.throws(() => parseDecision(decision({ tasks: [task, task] }), []));
  assert.throws(() => parseDecision(decision({ action: 'continue_task', output: 'x', tasks: [{ ...task, status: 'completed' }] }), []));
  assert.throws(() => parseDecision(decision({ tasks: [task] }), [{ ...task, status: 'completed' }]));
});
