import {parseArgs} from 'node:util';
import {HistoricalArchiveError, importHistoricalArchive} from '../server/historical-report-archive-tools.mjs';

try {
  const {values} = parseArgs({options: {
    package: {type: 'string'}, 'approved-list': {type: 'string'}, 'approved-list-sha256': {type: 'string'},
    'target-copy': {type: 'string'}, 'copy-declaration': {type: 'string'}, plan: {type: 'string'}, apply: {type: 'boolean'},
  }});
  if (['package', 'approved-list', 'approved-list-sha256', 'target-copy', 'copy-declaration', 'plan'].some(name => !values[name])) throw new HistoricalArchiveError('all_import_arguments_required');
  const result = await importHistoricalArchive({package: values.package, approvedList: values['approved-list'],
    approvedListSha256: values['approved-list-sha256'], targetCopy: values['target-copy'], copyDeclaration: values['copy-declaration'], plan: values.plan, apply: values.apply === true});
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ok: false, error: error instanceof HistoricalArchiveError ? error.message : 'historical_archive_import_failed'}));
  process.exitCode = 1;
}
