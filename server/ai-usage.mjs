const modules = ['report_scoring', 'management_summary', 'personal_coach', 'task_followup'];
const dateFormat = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Shanghai'});

const tokenCount = (...values) => values.find(value => Number.isSafeInteger(value) && value >= 0);

function normalizeUsage(usage) {
  const input = tokenCount(usage?.prompt_tokens, usage?.input_tokens);
  const output = tokenCount(usage?.completion_tokens, usage?.output_tokens);
  const total = tokenCount(usage?.total_tokens);
  const cached = tokenCount(
    usage?.prompt_tokens_details?.cached_tokens,
    usage?.input_tokens_details?.cached_tokens,
    usage?.prompt_cache_hit_tokens,
    usage?.cached_tokens,
  );
  return {
    unreported: Number(input === undefined || output === undefined),
    inputTokens: input ?? 0,
    outputTokens: output ?? 0,
    cachedInputTokens: cached ?? 0,
    totalTokens: total ?? (input ?? 0) + (output ?? 0),
  };
}

const emptyTotals = () => ({requests: 0, failed: 0, unreported: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0});

export function createAiUsage({query, exec, sql, now = () => new Date()}) {
  async function record(day, module, model, successful, usage) {
    const {unreported, inputTokens, outputTokens, cachedInputTokens, totalTokens} = normalizeUsage(usage);
    await exec(`INSERT INTO ai_usage_daily(usage_date,module,model,requests,failed,unreported,input_tokens,output_tokens,cached_input_tokens,total_tokens)
      VALUES (${sql(day)},${sql(module)},${sql(model)},1,${successful ? 0 : 1},${unreported},${inputTokens},${outputTokens},${cachedInputTokens},${totalTokens})
      ON CONFLICT(usage_date,module,model) DO UPDATE SET
        requests = ai_usage_daily.requests + 1,
        failed = ai_usage_daily.failed + excluded.failed,
        unreported = ai_usage_daily.unreported + excluded.unreported,
        input_tokens = ai_usage_daily.input_tokens + excluded.input_tokens,
        output_tokens = ai_usage_daily.output_tokens + excluded.output_tokens,
        cached_input_tokens = ai_usage_daily.cached_input_tokens + excluded.cached_input_tokens,
        total_tokens = ai_usage_daily.total_tokens + excluded.total_tokens;`);
  }

  async function measure(module, model, operation) {
    const day = dateFormat.format(now());
    let successful = false;
    let usage;
    const receive = (ok, reportedUsage) => {
      successful = ok === true;
      if (reportedUsage != null) usage = reportedUsage;
    };
    try {
      return await operation(receive);
    } finally {
      try {
        await record(day, module, model || 'unknown', successful, usage);
      } catch {
        // An accounting failure must not trigger a second model call or hide its response.
        console.error('AI usage recording failed');
      }
    }
  }

  async function overview(days = 30) {
    if (!Number.isInteger(days) || days < 1 || days > 90) throw Error('invalid_ai_usage_range');
    const endDate = dateFormat.format(now());
    const start = new Date(`${endDate}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - days + 1);
    const startDate = start.toISOString().slice(0, 10);
    const rows = await query(`SELECT module, model, SUM(requests) AS requests, SUM(failed) AS failed,
        SUM(unreported) AS unreported, SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens,
        SUM(cached_input_tokens) AS cachedInputTokens, SUM(total_tokens) AS totalTokens
      FROM ai_usage_daily WHERE usage_date BETWEEN ${sql(startDate)} AND ${sql(endDate)}
      GROUP BY module, model ORDER BY module, requests DESC, model;`);
    const totals = new Map(modules.map(module => [module, {module, ...emptyTotals(), models: []}]));
    for (const row of rows) {
      const module = totals.get(row.module);
      if (!module) continue;
      const model = {model: row.model, ...emptyTotals()};
      for (const key of Object.keys(emptyTotals())) {
        model[key] = Number(row[key]);
        module[key] += model[key];
      }
      module.models.push(model);
    }
    return {days, startDate, endDate, modules: [...totals.values()]};
  }

  return {measure, overview};
}
