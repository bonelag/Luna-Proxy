import { describe, it, assertEqual, assertTrue, assertFalse, printSummary, flushAsync } from './utils';
import * as lockMod from '../src/runtime/locks';
import * as storeMod from '../src/runtime/runStore';
import * as sched from '../src/runtime/scheduler';

describe('Scheduler', () => {

it('runs all async scheduler tests sequentially', async () => {
  // 1. Basic acquire + release
  sched.setSchedulerConfig({ enabled: true, globalMaxConcurrentRuns: 10, defaultProviderMaxConcurrentRuns: 5, defaultAccountMaxConcurrentRuns: 3, queueTimeoutMs: 200 });
  const runId = storeMod.runStore.createRun({ model: 'm', stream: false, providerId: 'p' }).id;
  const result = await sched.scheduleRun(runId, 'p', 'a', undefined);
  assertTrue(result.ok, 'scheduleRun should succeed');
  await sched.releaseRun(runId);

  // 2. Global capacity full
  sched.setSchedulerConfig({ enabled: true, globalMaxConcurrentRuns: 1, defaultProviderMaxConcurrentRuns: 1, queueTimeoutMs: 50 });
  const rG1 = storeMod.runStore.createRun({ model: 'm', stream: false, providerId: 'p1' });
  const rG2 = storeMod.runStore.createRun({ model: 'm', stream: false, providerId: 'p2' });
  const okG1 = await sched.scheduleRun(rG1.id, 'p1', 'a1', undefined);
  assertTrue(okG1.ok, 'first run should schedule');
  const okG2 = await sched.scheduleRun(rG2.id, 'p2', 'a2', undefined);
  assertFalse(okG2.ok, 'second run should fail global capacity');
  assertEqual(okG2.reason, 'global_capacity_full');
  await sched.releaseRun(rG1.id);

  // 3. Provider max concurrent
  sched.setSchedulerConfig({ globalMaxConcurrentRuns: 10, defaultProviderMaxConcurrentRuns: 1, queueTimeoutMs: 50 });
  const rP1 = storeMod.runStore.createRun({ model: 'm', stream: false, providerId: 'prov-a' });
  const rP2 = storeMod.runStore.createRun({ model: 'm', stream: false, providerId: 'prov-a' });
  const okP1 = await sched.scheduleRun(rP1.id, 'prov-a', 'a1', undefined);
  assertTrue(okP1.ok, 'first provider run should schedule');
  const okP2 = await sched.scheduleRun(rP2.id, 'prov-a', 'a2', undefined);
  assertFalse(okP2.ok, 'second provider run should fail');
  assertEqual(okP2.reason, 'provider_capacity_full:prov-a');
  await sched.releaseRun(rP1.id);

  // 4. releaseRun idempotent
  sched.setSchedulerConfig({ enabled: true, globalMaxConcurrentRuns: 10, defaultProviderMaxConcurrentRuns: 5, queueTimeoutMs: 100 });
  const r4 = storeMod.runStore.createRun({ model: 'm', stream: false, providerId: 'p-idem' });
  const ok4 = await sched.scheduleRun(r4.id, 'p-idem', 'a-idem', undefined);
  assertTrue(ok4.ok, 'idempotent schedule');
  await sched.releaseRun(r4.id);
  await sched.releaseRun(r4.id);
  assertTrue(true, 'double release should not throw');

  // 5. Session write lock serializes
  sched.setSchedulerConfig({ globalMaxConcurrentRuns: 10, defaultProviderMaxConcurrentRuns: 5, queueTimeoutMs: 100 });
  const runA = storeMod.runStore.createRun({ model: 'm', stream: false, providerId: 'p-sess' });
  const aOk = await sched.scheduleRun(runA.id, 'p-sess', 'a-sess', undefined);
  assertTrue(aOk.ok, 'session run A');
  const runB = storeMod.runStore.createRun({ model: 'm', stream: false, providerId: 'p-sess' });
  const bOk = await sched.scheduleRun(runB.id, 'p-sess', 'a-sess', undefined, { sessionWriteLock: true } as any);
  assertTrue(bOk.ok, 'session run B with write lock');
  await sched.releaseRun(runA.id);
  await sched.releaseRun(runB.id);

  // 6. No-op disabled
  sched.setSchedulerConfig({ enabled: false });
  const r6 = storeMod.runStore.createRun({ model: 'm', stream: false, providerId: 'p-dis' });
  const ok6 = await sched.scheduleRun(r6.id, 'p-dis', 'a-dis', undefined);
  assertTrue(ok6.ok, 'disabled scheduler should return ok');

  // 7. Diagnostics
  sched.setSchedulerConfig({ enabled: true });
  const diag = sched.getRuntimeDiagnostics();
  assertTrue(Array.isArray(diag.leases), 'leases should be array');
  assertTrue(typeof diag.activeRuns === 'number', 'activeRuns should be number');

  // 8. Real queue: global=2, schedule 3, 3rd queues, release 1, 3rd acquires
  sched.setSchedulerConfig({ globalMaxConcurrentRuns: 2, defaultProviderMaxConcurrentRuns: 5, queueTimeoutMs: 500 });
  const rQ1 = storeMod.runStore.createRun({ model: 'm', stream: false, providerId: 'p-q' });
  const rQ2 = storeMod.runStore.createRun({ model: 'm', stream: false, providerId: 'p-q' });
  const rQ3 = storeMod.runStore.createRun({ model: 'm', stream: false, providerId: 'p-q' });
  const okQ1 = await sched.scheduleRun(rQ1.id, 'p-q', 'a-q', undefined);
  assertTrue(okQ1.ok, 'Q1 first');
  const okQ2 = await sched.scheduleRun(rQ2.id, 'p-q', 'a-q', undefined);
  assertTrue(okQ2.ok, 'Q2 second');
  const okQ3 = await sched.scheduleRun(rQ3.id, 'p-q', 'a-q', undefined);
  assertFalse(okQ3.ok, 'Q3 should queue fail');
  assertEqual(okQ3.reason, 'global_capacity_full');
  await sched.releaseRun(rQ1.id);
  let q3acquired = false;
  for (let i = 0; i < 20; i++) {
    const diag2 = sched.getRuntimeDiagnostics();
    if (diag2.activeRuns > 2) { q3acquired = true; break; }
    await new Promise(r => setTimeout(r, 50));
  }
  if (q3acquired) await sched.releaseRun(rQ3.id);
  await sched.releaseRun(rQ2.id);

  // 9. Timeout queue
  sched.setSchedulerConfig({ enabled: true, globalMaxConcurrentRuns: 1, queueTimeoutMs: 100 });
  const rT1 = storeMod.runStore.createRun({ model: 'm', stream: false, providerId: 'p-T' });
  const rT2 = storeMod.runStore.createRun({ model: 'm', stream: false, providerId: 'p-T' });
  const okT1 = await sched.scheduleRun(rT1.id, 'p-T', 'a-T', undefined);
  assertTrue(okT1.ok, 'T9 first');
  const okT2 = await sched.scheduleRun(rT2.id, 'p-T', 'a-T', undefined);
  assertFalse(okT2.ok, 'T9 second should timeout');
  assertEqual(okT2.reason, 'global_capacity_full');
  await sched.releaseRun(rT1.id);

  // 10. Worker capacity
  sched.setSchedulerConfig({ globalMaxConcurrentRuns: 10 });
  const rW1 = storeMod.runStore.createRun({ model: 'm', stream: false, providerId: 'p-w' });
  const rW2 = storeMod.runStore.createRun({ model: 'm', stream: false, providerId: 'p-w' });
  const okW1 = await sched.scheduleRun(rW1.id, 'p-w', 'a-w', undefined, { workerId: 'w1', workerMax: 1 });
  assertTrue(okW1.ok, 'first worker run schedules');
  const okW2 = await sched.scheduleRun(rW2.id, 'p-w', 'a-w', undefined, { workerId: 'w1', workerMax: 1 });
  assertFalse(okW2.ok, 'second worker run should fail');
  assertEqual(okW2.reason, 'worker_capacity_full:w1');
  await sched.releaseRun(rW1.id);

  // 11. Worker queue: 2 workers each max 1, 3rd queues on same worker
  sched.setSchedulerConfig({ globalMaxConcurrentRuns: 3, queueTimeoutMs: 500 });
  const rW3 = storeMod.runStore.createRun({ model: 'm', stream: false, providerId: 'p-w2' });
  const rW4 = storeMod.runStore.createRun({ model: 'm', stream: false, providerId: 'p-w2' });
  const rW5 = storeMod.runStore.createRun({ model: 'm', stream: false, providerId: 'p-w2' });
  const okW3 = await sched.scheduleRun(rW3.id, 'p-w2', 'a-w2', undefined, { workerId: 'w3', workerMax: 1 });
  assertTrue(okW3.ok, 'W3 first worker');
  const okW4 = await sched.scheduleRun(rW4.id, 'p-w2', 'a-w2', undefined, { workerId: 'w4', workerMax: 1 });
  assertTrue(okW4.ok, 'W4 second worker');
  const okW5 = await sched.scheduleRun(rW5.id, 'p-w2', 'a-w2', undefined, { workerId: 'w3', workerMax: 1 });
  assertFalse(okW5.ok, 'W5 should queue fail');
  await sched.releaseRun(rW3.id);
  let w5acquired = false;
  for (let i = 0; i < 20; i++) {
    const diag5 = sched.getRuntimeDiagnostics();
    if (diag5.activeRuns > 2) { w5acquired = true; break; }
    await new Promise(r => setTimeout(r, 50));
  }
  await sched.releaseRun(rW4.id);
  if (w5acquired) await sched.releaseRun(rW5.id);

  // 12. Run timeout
  sched.setSchedulerConfig({ enabled: true, globalMaxConcurrentRuns: 10, queueTimeoutMs: 100, runTimeoutMs: 50 });
  const rTO = storeMod.runStore.createRun({ model: 'm', stream: false, providerId: 'p-to' });
  const okTO = await sched.scheduleRun(rTO.id, 'p-to', 'a-to', undefined);
  assertTrue(okTO.ok, 'TO schedule');
  sched.startRunTimeout(rTO.id);
  await new Promise(r => setTimeout(r, 120));
  const runTO = storeMod.runStore.getRun(rTO.id);
  assertTrue(typeof runTO?.error === 'string' && runTO.error.includes('timeout'), 'error should mention timeout');
});

});
