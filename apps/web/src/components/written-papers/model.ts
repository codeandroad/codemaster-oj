export type Point = {id:string;text:string;maxMarks:number;auto?:{field:string;accepted:string[];normalization:string}};
export type Question = {id:string;label:string;group:string;statement:string;maxMarks:number;sourcePages:number[];images:string[];
 fields?:{id:string;label:string;multiline:boolean}[];
 table?:{columns:{id:string;label:string;editable:boolean}[];rows:{id:string;cells:Record<string,string>}[]};
 rubric?:{guidance:string;points:Point[]}};
export type Definition = {paper:{title:string;year:number;session:string;variant:number;maxMarks:number;durationMinutes:number};questions:Question[];
 assets:{id:string;purpose:string;mimeType:string;filename:string}[]};
export type Answer = {values:Record<string,string>;working:string;flagged:boolean;attachments:string[]};
export type Answers = Record<string,Answer>;
export type Mark = {points:Record<string,number>;feedback:string;score?:number};
export type Attempt = {id:string;paperId:string;versionId:string;state:'draft'|'submitted'|'released';revision:number;gradingRevision:number;
 definition:Definition;answers:Answers;canEdit:boolean;canReview:boolean;studentName?:string;score:number|null;
 marks:Record<string,Mark>;suggestions?:Record<string,Record<string,number>>;notes?:Record<string,string>;selfMarks?:Record<string,number>};
export const emptyAnswer=():Answer=>({values:{},working:'',flagged:false,attachments:[]});
export function fieldKeys(q:Question){return q.fields?.map(f=>f.id)??q.table!.rows.flatMap(r=>q.table!.columns.filter(c=>c.editable).map(c=>`${r.id}.${c.id}`));}
export function answered(q:Question,a?:Answer){return !!a&&(fieldKeys(q).some(k=>a.values[k]?.trim())||!!a.working.trim()||a.attachments.length>0);}
export function writtenHref(base:string,params:Record<string,string>={}){const [path,query]=base.split('?');const search=new URLSearchParams(query);for(const [k,v]of Object.entries(params))search.set(k,v);return path+(search.size?`?${search}`:'');}
export const controlClass='w-full min-h-12 rounded-md border border-border-strong bg-background px-3 py-2 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
