import {handleLuqLedger} from './luq-ledger.mjs';
import {handleLuqAssistance} from './luq-assistance.mjs';
import {handleLuqRules} from './luq-rules.mjs';
import {handleProblemPublicStatements} from './problem-public-statements.mjs';

export async function handleLuq(ctx){
 if(!ctx.route.startsWith('/luq/'))return null;
 for(const handler of [handleLuqLedger,handleLuqRules,handleLuqAssistance,handleProblemPublicStatements]){
  const result=await handler(ctx);if(result)return result;
 }
 return null;
}
