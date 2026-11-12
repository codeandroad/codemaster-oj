// Historical merge receipts and aliases are retained, but school maintenance
// is retired now that the unified ACSL source belongs to the platform.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {localCourseOptions} from './lib/local-acsl-course-api.mjs';

export async function mergeAcslTutorials(argv=process.argv.slice(2)){
 localCourseOptions(argv,{merging:true});
 throw Error('School ACSL merges are retired. The unified source is maintained by platform administrators through scripts/import-acsl-course.mjs and scripts/extend-acsl-course.mjs. Existing split courses require an explicit data-preserving migration.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await mergeAcslTutorials();
