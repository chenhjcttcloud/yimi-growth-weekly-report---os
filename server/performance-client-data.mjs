import {createHash} from 'node:crypto';
// Keep overview data useful without repeatedly transferring raw report content
// and locked result evidence. Managers can request either record on expansion.
const reportHeaderFields=['id','employeeUserId','name','department','month','start','end','submittedAt','status','submitted','timestampUnknown','late','onTime','candidate','scoringPolicy'];
export function performanceClientOverview(view, {reportMode='details'}={}) {
  const headersOnly=reportMode==='headers';
  return {
    ...view,
    monthly: view.monthly.map(row => ({
      ...row,
      reports: row.reports.map(report => {
        if(headersOnly)return {...Object.fromEntries(reportHeaderFields.filter(key=>Object.hasOwn(report,key)).map(key=>[key,report[key]])),detailsDeferred:true};
        if (!report.id) return report;
        const {content, ...summary} = report;
        return {...summary, contentDeferred: true, contentVersion: createHash('sha256').update(JSON.stringify(content)).digest('hex')};
      }),
    })),
    collaborations: headersOnly ? view.collaborations.map(cycle=>{
      const {assignments,...summary}=cycle;
      return {...summary,detailsDeferred:true};
    }) : view.collaborations,
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

// The employee-month read is manager-authorized by the caller. Only the chosen
// employee's facts and rating assignments enter this payload; company-wide
// cycle counts remain the same values shown in the overview.
export function performanceClientEmployeeMonth(view,userId,month){
  const scoped={
    ...view,
    monthly:view.monthly.filter(row=>row.userId===userId&&row.month===month),
    collaborations:view.collaborations.filter(cycle=>cycle.month===month).map(cycle=>({...cycle,assignments:(cycle.assignments||[]).filter(assignment=>assignment.evaluee_user_id===userId)})),
    results:view.results.filter(record=>record.employee_user_id===userId&&record.month===month),
  };
  const client=performanceClientOverview(scoped);
  return {monthly:client.monthly[0]||null,collaborations:client.collaborations,results:client.results};
}
