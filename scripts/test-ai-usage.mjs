import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {createAiUsage} from '../server/ai-usage.mjs';

const run = promisify(execFile);
await mkdir('outputs/tests', {recursive: true});
const folder = await mkdtemp(path.resolve('outputs/tests/ai-usage-'));
const db = path.join(folder, 'usage.sqlite');
const sqlite = (statement, json = false) => run('sqlite3', [
  '-bail', '-cmd', '.timeout 5000', ...(json ? ['-json'] : []), db, statement,
]);
const sql = value => `'${String(value).replaceAll("'", "''")}'`;
const query = async statement => JSON.parse((await sqlite(statement, true)).stdout.trim() || '[]');
const exec = async statement => { await sqlite(statement); };
await exec(await readFile('db/schema.sql', 'utf8'));

let instant = new Date('2026-11-08T15:59:59.000Z');
const dependencies = {query, exec, sql, now: () => instant};
const usage = createAiUsage(dependencies);
const reportUsage = {
  prompt_tokens: 100,
  completion_tokens: 25,
  total_tokens: 125,
  prompt_tokens_details: {cached_tokens: 12},
  completion_tokens_details: {reasoning_tokens: 7},
  ignored: 'private-fixture-field',
};

await Promise.all(Array.from({length: 12}, (_, index) => usage.measure('report_scoring', 'kimi-fixture', async receive => {
  receive(true);
  receive(true, reportUsage);
  return index;
})));

const localError = new Error('local_validation_error');
await assert.rejects(usage.measure('report_scoring', 'kimi-fixture', async receive => {
  receive(true, reportUsage);
  throw localError;
}), error => error === localError);
await usage.measure('report_scoring', 'another-model', async receive => receive(false));
const networkError = new Error('network_error');
await assert.rejects(usage.measure('task_followup', 'kimi-fixture', async () => {
  throw networkError;
}), error => error === networkError);
await usage.measure('personal_coach', 'kimi-fixture', async receive => receive(true));

await usage.measure('management_summary', 'third-model', async receive => {
  // The ledger assigns usage to the day when the request starts.
  instant = new Date('2026-11-08T16:00:00.000Z');
  receive(true, {input_tokens: 7, output_tokens: 3, input_tokens_details: {cached_tokens: 2}});
});
await usage.measure('management_summary', 'third-model', async receive => {
  receive(true, {prompt_tokens: 2, completion_tokens: 1, total_tokens: 5, prompt_cache_hit_tokens: 1});
});

const reopened = createAiUsage(dependencies);
const today = await reopened.overview(1);
assert.equal(today.startDate, '2026-11-09');
assert.equal(today.endDate, '2026-11-09');
const todayRows = Object.fromEntries(today.modules.map(row => [row.module, row]));
assert.equal(todayRows.report_scoring.requests, 0);
assert.equal(todayRows.management_summary.requests, 1);
assert.equal(todayRows.management_summary.totalTokens, 5, 'preserve a reported total instead of recalculating it');

const lastMonth = await reopened.overview();
assert.equal(lastMonth.days, 30);
assert.equal(lastMonth.startDate, '2026-10-11');
const byModule = Object.fromEntries(lastMonth.modules.map(row => [row.module, row]));
const {models, ...scoring} = byModule.report_scoring;
assert.deepEqual(scoring, {
  module: 'report_scoring', requests: 14, failed: 1, unreported: 1,
  inputTokens: 1300, outputTokens: 325, cachedInputTokens: 156, totalTokens: 1625,
});
assert.equal(models.length, 2);
assert.equal(models[0].model, 'kimi-fixture');
assert.equal(models[0].requests, 13);
assert.equal(byModule.management_summary.totalTokens, 15);
assert.equal(byModule.management_summary.cachedInputTokens, 3);
assert.equal(byModule.personal_coach.unreported, 1);
assert.equal(byModule.personal_coach.failed, 0);
assert.equal(byModule.task_followup.unreported, 1);
assert.equal(byModule.task_followup.failed, 1);
await usage.measure('personal_coach', 'kimi-fixture', async receive => receive(true, {prompt_tokens: 6}));
const partial = (await usage.overview(1)).modules.find(row => row.module === 'personal_coach');
assert.equal(partial.totalTokens, 6, 'known input still counts toward the reported subtotal');
assert.equal(partial.unreported, 1, 'partial provider usage is flagged');
assert(!JSON.stringify(await query('SELECT * FROM ai_usage_daily')).includes('private-fixture-field'));
await assert.rejects(reopened.overview(91), /invalid_ai_usage_range/);

const unavailable = createAiUsage({...dependencies, exec: async () => { throw Error('private-db-error'); }});
let operationCalls = 0;
const messages = [];
const originalError = console.error;
try {
  console.error = (...values) => messages.push(values);
  assert.equal(await unavailable.measure('report_scoring', 'kimi-fixture', async () => ++operationCalls), 1);
  await assert.rejects(unavailable.measure('report_scoring', 'kimi-fixture', async () => {
    operationCalls++;
    throw networkError;
  }), error => error === networkError);
} finally {
  console.error = originalError;
}
assert.equal(operationCalls, 2);
assert.deepEqual(messages, [['AI usage recording failed'], ['AI usage recording failed']]);
console.log('AI usage tests passed. Synthetic database retained:', folder);
