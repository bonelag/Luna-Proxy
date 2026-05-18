import assert from 'node:assert';

let currentDescribe = '';
let totalPassed = 0;
let totalFailed = 0;
let describePassed = 0;
let describeFailed = 0;
let currentAssertions = 0;

export function assertEqual(actual: any, expected: any, msg?: string) {
  currentAssertions++;
  try {
    assert.deepStrictEqual(actual, expected);
  } catch (e) {
    console.error(`  ✗ ${msg || ''} (assertEqual)`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
    throw e;
  }
}

export function assertTrue(condition: boolean, msg?: string) {
  currentAssertions++;
  if (!condition) {
    console.error(`  ✗ ${msg || 'assertTrue'}`);
    throw new Error(msg || 'assertTrue failed');
  }
}

export function assertFalse(condition: boolean, msg?: string) {
  currentAssertions++;
  if (condition) {
    console.error(`  ✗ ${msg || 'assertFalse'}`);
    throw new Error(msg || 'assertFalse failed');
  }
}

export function assertMatch(text: string, regex: RegExp, msg?: string) {
  currentAssertions++;
  if (!regex.test(text)) {
    console.error(`  ✗ ${msg || 'assertMatch'}`);
    console.error(`    text:  ${text.slice(0, 200)}`);
    console.error(`    regex: ${regex}`);
    throw new Error(msg || 'assertMatch failed');
  }
}

export function assertNotMatch(text: string, regex: RegExp, msg?: string) {
  currentAssertions++;
  if (regex.test(text)) {
    console.error(`  ✗ ${msg || 'assertNotMatch'}`);
    console.error(`    text:  ${text.slice(0, 200)}`);
    console.error(`    regex: ${regex}`);
    throw new Error(msg || 'assertNotMatch failed');
  }
}

export function describe(name: string, fn: () => void) {
  currentDescribe = name;
  describePassed = 0;
  describeFailed = 0;
  process.stdout.write(`\n${name}\n`);
  try {
    fn();
  } catch (e) {
    console.error(`  ✗ describe block error:`, e);
    describeFailed++;
  }
  const total = describePassed + describeFailed;
  if (total > 0) {
    process.stdout.write(`  results: ${describePassed}/${total} passed, ${describeFailed} failed\n`);
  }
  totalPassed += describePassed;
  totalFailed += describeFailed;
}

export function it(name: string, fn: (() => void) | (() => Promise<void>)) {
  currentAssertions = 0;
  const run = () => {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(() => {
        describePassed++;
        process.stdout.write(`  ✓ ${name} (async, ${currentAssertions} assertions)\n`);
      }).catch((e) => {
        describeFailed++;
        const errMsg = e instanceof Error ? e.message : String(e);
        process.stdout.write(`  ✗ ${name}: ${errMsg}\n`);
      });
    }
    describePassed++;
    process.stdout.write(`  ✓ ${name} (${currentAssertions} assertions)\n`);
    return undefined;
  };
  try {
    const result = run();
    if (result instanceof Promise) {
      pendingAsync.push(result);
    }
  } catch (e) {
    describeFailed++;
    const errMsg = e instanceof Error ? e.message : String(e);
    process.stdout.write(`  ✗ ${name}: ${errMsg}\n`);
  }
}

export async function flushAsync(): Promise<void> {
  while (pendingAsync.length > 0) {
    const batch = pendingAsync.splice(0);
    await Promise.all(batch);
  }
}

const pendingAsync: Promise<void>[] = [];

export function printSummary() {
  const total = totalPassed + totalFailed;
  process.stdout.write(`\n=== Summary: ${totalPassed}/${total} passed, ${totalFailed} failed ===\n`);
}

export { totalPassed, totalFailed };
