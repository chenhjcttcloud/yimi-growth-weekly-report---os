import {createHash} from 'node:crypto';
// Keep overview data useful without repeatedly transferring raw report content
// and locked result evidence. Managers can request either record on expansion.
export function performanceClientOverview(view) {
  return {
    ...view,
    monthly: view.monthly.map(row => ({
      ...row,
      reports: row.reports.map(report => {
        if (!report.id) return report;
        const {content, ...summary} = report;
        return {...summary, contentDeferred: true, contentVersion: createHash('sha256').update(JSON.stringify(content)).digest('hex')};
      }),
    })),
    results: view.results.map(record => {
      const {evidence_json, ...summary} = record;
      let evidence = {};
      try {
        const parsed = JSON.parse(evidence_json);
        if (parsed && typeof parsed === 'object') evidence = parsed;
      } catch {
        // A malformed legacy snapshot must not block every employee's overview.
        // The original record is retained and its detail request reports errors.
      }
      return {
        ...summary,
        evidenceDeferred: true,
        evidenceSummary: Object.fromEntries(
          ['reviewNote', 'qualityCandidate', 'legitimateReason', 'deduction']
            .filter(key => evidence[key] !== undefined)
            .map(key => [key, evidence[key]]),
        ),
      };
    }),
  };
}
