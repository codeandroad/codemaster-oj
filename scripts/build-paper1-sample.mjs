import { readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sample from '../content/written-papers/cambridge-9618/2025-summer-12.mjs';
import { sha256, validateWrittenPackage } from '../packages/domain/src/written-paper-model.mjs';
const [source,output]=process.argv.slice(2);
if(!source||!output)throw new Error('Usage: node scripts/build-paper1-sample.mjs PRIVATE_SOURCE_DIRECTORY PRIVATE_OUTPUT.json');
const assets=[];
for(const [id,filename,purpose,mimeType] of [['question-paper','9618_s25_qp_12.pdf','question','application/pdf'],['mark-scheme','9618_s25_ms_12.pdf','marking','application/pdf'],['logic-circuit','logic-circuit.png','question','image/png']]){
 const data=await readFile(resolve(source,filename));assets.push({id,filename,purpose,mimeType,sha256:sha256(data),contentBase64:data.toString('base64')});
}
const pack={...sample,assets};const validated=validateWrittenPackage(pack);
await writeFile(output,JSON.stringify(pack,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({questions:sample.questions.length,marks:sample.questions.reduce((s,q)=>s+q.maxMarks,0),contentHash:validated.contentHash,output}));
