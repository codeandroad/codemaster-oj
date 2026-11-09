import {handleScholarshipLedger} from './scholarship-ledger.mjs';
import {handleScholarshipAssistance} from './scholarship-assistance.mjs';
import {handleScholarshipRules} from './scholarship-rules.mjs';
import {handleProblemPublicStatements} from './problem-public-statements.mjs';

export async function handleScholarship(ctx){
 if(!ctx.route.startsWith('/scholarship/'))return null;
 for(const handler of [handleScholarshipLedger,handleScholarshipRules,handleScholarshipAssistance,handleProblemPublicStatements]){
  const result=await handler(ctx);if(result)return result;
 }
 return null;
}
