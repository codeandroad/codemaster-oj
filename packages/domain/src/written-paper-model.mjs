import { createHash } from 'node:crypto';
import { fail, field, integer, enumValue } from './security.mjs';

const invalid = message => fail(400, 'WRITTEN_VALIDATION', message);
const id = value => { if (typeof value !== 'string' || ['__proto__','prototype','constructor'].includes(value) || !/^[a-zA-Z0-9_.-]{1,80}$/.test(value)) invalid('Invalid content identifier.'); return value; };
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function pngBytes(base64, limit = 1048576) {
 if (typeof base64 !== 'string' || base64.length > Math.ceil(limit / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) invalid('Upload a PNG image within the size limit.');
 const data = Buffer.from(base64, 'base64');
 if (data.length < 45 || data.length > limit || data.toString('base64') !== base64 ||
 !data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || data.toString('ascii',12,16) !== 'IHDR' ||
 data.readUInt32BE(16) < 1 || data.readUInt32BE(20) < 1 || data.readUInt32BE(16) > 6000 || data.readUInt32BE(20) > 6000 ||
 data.readUInt32BE(16) * data.readUInt32BE(20) > 16000000 || data.toString('ascii', data.length-8, data.length-4) !== 'IEND') invalid('Invalid PNG image.');
 return data;
}
export function answerFields(question) {
 return question.fields?.map(f => f.id) ?? question.table.rows.flatMap(row => question.table.columns.filter(c => c.editable).map(c => `${row.id}.${c.id}`));
}
export function validateWrittenPackage(input) {
 if (!input || input.format !== 'campus-written-paper' || input.schemaVersion !== 1 || !input.paper || !Array.isArray(input.questions) || !input.questions.length || input.questions.length > 100) invalid('Use a structured written-paper package (version 1).');
 const p = input.paper;
 if (p.board !== 'Cambridge' || p.syllabus !== '9618' || p.component !== 1 || p.maxMarks !== 75 || p.durationMinutes !== 90) invalid('This release supports Cambridge 9618 Paper 1, 75 marks, 90 minutes.');
 const paper = { slug:id(p.slug), title:field(p.title,'Title',{max:200}), board:p.board, syllabus:p.syllabus, component:1,
  year:integer(p.year,2021,2100,'Year'), session:enumValue(p.session,['summer','autumn'],'Session'), variant:integer(p.variant,11,13,'Variant'),
  syllabusVersion:field(p.syllabusVersion,'Syllabus version',{max:100}), maxMarks:75, durationMinutes:90 };
 const seen = new Set();
 const questions = input.questions.map(q => {
  if (!q || seen.has(id(q.id))) invalid('Duplicate question.'); seen.add(q.id);
  const item = { id:q.id, label:field(q.label,'Question number',{max:30}), group:field(q.group,'Group',{max:40}),
   statement:field(q.statement,'Statement',{max:30000}), maxMarks:integer(q.maxMarks,1,30,'Marks'),
   sourcePages:q.sourcePages, images:q.images ?? [] };
  if (!Array.isArray(item.sourcePages) || !item.sourcePages.length || item.sourcePages.some(n => !Number.isInteger(n)||n<1||n>100) || !Array.isArray(item.images)||item.images.length>6) invalid('Invalid question sources.');
  item.images.forEach(id);
  if (q.fields) {
   if (!Array.isArray(q.fields)||!q.fields.length||q.fields.length>30) invalid('Invalid answer fields.');
   item.fields=q.fields.map(f=>({id:id(f.id),label:field(f.label,'Field label',{max:300}),multiline:f.multiline===true}));
  } else {
   if (!q.table||!Array.isArray(q.table.columns)||!Array.isArray(q.table.rows)||!q.table.columns.length||q.table.columns.length>10||!q.table.rows.length||q.table.rows.length>30) invalid('Invalid answer table.');
   const columns=q.table.columns.map(c=>({id:id(c.id),label:field(c.label,'Column',{max:100}),editable:c.editable===true}));
   if (new Set(columns.map(c=>c.id)).size!==columns.length||!columns.some(c=>c.editable)) invalid('Invalid table columns.');
   const rows=q.table.rows.map(r=>({id:id(r.id),cells:Object.fromEntries(columns.filter(c=>!c.editable).map(c=>[c.id,field(r.cells?.[c.id]??'','Cell',{min:0,max:300})]))}));
   if(new Set(rows.map(r=>r.id)).size!==rows.length) invalid('Duplicate table rows.');
   item.table={columns,rows};
  }
  const fields=answerFields(item);
  if (new Set(fields).size!==fields.length) invalid('Duplicate answer fields.');
  if (!q.rubric||!Array.isArray(q.rubric.points)||!q.rubric.points.length||q.rubric.points.length>40) invalid('Provide marking points.');
  item.rubric={guidance:field(q.rubric.guidance??'','Marking guidance',{min:0,max:10000}),points:q.rubric.points.map(p=>{
   const point={id:id(p.id),text:field(p.text,'Marking point',{max:2000}),maxMarks:integer(p.maxMarks??1,1,10,'Point marks')};
   if(p.auto){
    if(!fields.includes(p.auto.field)||!Array.isArray(p.auto.accepted)||!p.auto.accepted.length||p.auto.accepted.length>20) invalid('Invalid exact answer rule.');
    point.auto={field:p.auto.field,accepted:p.auto.accepted.map(a=>field(a,'Accepted answer',{max:300})),normalization:enumValue(p.auto.normalization,['exact','case','binary'],'Normalization')};
   }
   return point;
  })};
  if(new Set(item.rubric.points.map(p=>p.id)).size!==item.rubric.points.length||item.rubric.points.reduce((s,p)=>s+p.maxMarks,0)<item.maxMarks) invalid('Invalid marking point totals.');
  return item;
 });
 if(questions.reduce((sum,q)=>sum+q.maxMarks,0)!==75) invalid('Question marks must total 75.');
 if(!Array.isArray(input.assets)||!input.assets.length||input.assets.length>50) invalid('Include source assets.');
 let size=0;const assetIds=new Set(),hashPurposes=new Map();
 const assets=input.assets.map(a=>{
  if(!a||assetIds.has(id(a.id))) invalid('Duplicate asset.');assetIds.add(a.id);
  const purpose=enumValue(a.purpose,['question','marking'],'Asset purpose'),mimeType=enumValue(a.mimeType,['image/png','application/pdf'],'Asset type');
  let data;
  if(mimeType==='image/png')data=pngBytes(a.contentBase64,2097152);
  else {if(typeof a.contentBase64!=='string'||a.contentBase64.length>2800000)invalid('Invalid PDF size.');data=Buffer.from(a.contentBase64,'base64');if(data.length>2097152||data.toString('base64')!==a.contentBase64||data.toString('ascii',0,5)!=='%PDF-')invalid('Invalid PDF.');}
  const hash=sha256(data);if(a.sha256!==hash)invalid('Asset checksum mismatch.');
  if(hashPurposes.has(hash)&&hashPurposes.get(hash)!==purpose)invalid('Question and marking assets must be separate.');hashPurposes.set(hash,purpose);
  size+=data.length;
  return {id:a.id,purpose,mimeType,sha256:hash,filename:field(a.filename,'Source filename',{max:200}),content:data};
 });
 if(size>8*1024*1024)invalid('Package assets exceed 8 MiB.');
 for(const q of questions)for(const image of q.images)if(!assets.some(a=>a.id===image&&a.purpose==='question'&&a.mimeType==='image/png'))invalid('Unknown question image.');
 if(!assets.some(a=>a.purpose==='question'&&a.mimeType==='application/pdf')||!assets.some(a=>a.purpose==='marking'&&a.mimeType==='application/pdf'))invalid('Include both original paper and mark scheme PDFs.');
 const definition={paper,questions,assets:assets.map(({content,...a})=>a)};
 return {definition,assets,contentHash:sha256(JSON.stringify(definition))};
}
export function publicDefinition(definition, marking=false) {
 return {paper:definition.paper,questions:definition.questions.map(({rubric,...q})=>marking?{...q,rubric}:q),assets:definition.assets.filter(a=>marking||a.purpose==='question')};
}
export function validateAnswers(definition, value) {
 if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(id=>!definition.questions.some(q=>q.id===id)))invalid('Invalid answer questions.');
 return Object.fromEntries(definition.questions.map(q=>{
  const answer=value[q.id]??{},keys=answerFields(q);
  if(!answer.values||typeof answer.values!=='object'||Array.isArray(answer.values)||Object.keys(answer.values).some(k=>!keys.includes(k))) {if(value[q.id])invalid('Invalid answer fields.');}
  const attachments=answer.attachments??[];
  if(!Array.isArray(attachments)||attachments.length>3||new Set(attachments).size!==attachments.length)invalid('At most 3 images per question.');
  return [q.id,{values:Object.fromEntries(keys.map(k=>[k,field(answer.values?.[k]??'','Answer',{min:0,max:8000,trim:false})])),working:field(answer.working??'','Working',{min:0,max:8000,trim:false}),flagged:answer.flagged===true,attachments}];
 }));
}
export function automaticSuggestions(definition, answers) {
 const normalize=(s,mode)=>mode==='binary'?s.replace(/\s/g,''):mode==='case'?s.trim().toLowerCase():s.trim();
 return Object.fromEntries(definition.questions.map(q=>[q.id,Object.fromEntries(q.rubric.points.filter(p=>p.auto).map(p=>{
  const value=answers[q.id]?.values?.[p.auto.field]??'';
  return [p.id,p.auto.accepted.some(a=>normalize(a,p.auto.normalization)===normalize(value,p.auto.normalization))?p.maxMarks:0];
 }))]));
}
export function validateMarks(definition, marks, complete=false) {
 if(!marks||typeof marks!=='object'||Array.isArray(marks)||Object.keys(marks).some(id=>!definition.questions.some(q=>q.id===id)))invalid('Invalid marks.');
 const output={};let score=0;
 for(const q of definition.questions){
  const mark=marks[q.id];if(!mark){if(complete)invalid(`Review question ${q.label} before publishing.`);continue;}
  if(!mark.points||typeof mark.points!=='object'||Array.isArray(mark.points)||Object.keys(mark.points).some(id=>!q.rubric.points.some(p=>p.id===id)))invalid('Invalid marking points.');
  const points={};for(const p of q.rubric.points){if(mark.points[p.id]===undefined){if(complete)invalid(`Review all points in ${q.label}.`);continue;}points[p.id]=integer(mark.points[p.id],0,p.maxMarks,'Point score');}
  const total=Math.min(q.maxMarks,Object.values(points).reduce((s,n)=>s+n,0));score+=total;
  output[q.id]={points,score:total,feedback:field(mark.feedback??'','Feedback',{min:0,max:4000})};
 }
 return {marks:output,score};
}
