import {parseArgs} from 'node:util';
import {HistoricalArchiveError, prepareHistoricalArchive} from '../server/historical-report-archive-tools.mjs';

try {
  const {values} = parseArgs({options: {
    package: {type: 'string'}, 'approved-list': {type: 'string'}, 'approved-list-sha256': {type: 'string'},
    'target-copy': {type: 'string'}, 'copy-declaration': {type: 'string'}, out: {type: 'string'},
  }});
  if (Object.values(values).length !== 6) throw new HistoricalArchiveError('all_prepare_arguments_required');
  const result = await prepareHistoricalArchive({package: values.package, approvedList: values['approved-list'],
    approvedListSha256: values['approved-list-sha256'], targetCopy: values['target-copy'], copyDeclaration: values['copy-declaration'], out: values.out});
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ok: false, error: error instanceof HistoricalArchiveError ? error.message : 'historical_archive_prepare_failed'}));
  process.exitCode = 1;
}
