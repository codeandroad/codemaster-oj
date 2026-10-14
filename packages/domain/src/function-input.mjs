// The same protocol is enforced at HTTP admission and again by the trusted worker.
export function parseJsonValue(text) {
 const value=JSON.parse(text);return validateJsonValue(value);
}
export function validateJsonValue(value) {
 let nodes=0;
 const check=(entry,depth)=>{
  if(depth>64||++nodes>50000)throw new Error('JSON exceeds the supported nesting or value count.');
  if(typeof entry==='number'&&!Number.isFinite(entry))throw new Error('JSON numbers must be finite.');
  if(entry&&typeof entry==='object')for(const child of Object.values(entry))check(child,depth+1);
 };
 check(value,0);return value;
}
export function parseFunctionInput(text) {
 const value=parseJsonValue(text);
 if(Array.isArray(value))return value;
 if(value&&typeof value==='object'&&Array.isArray(value.args)&&Object.keys(value).every(key=>key==='args'||key==='kwargs')&&(!Object.hasOwn(value,'kwargs')||(value.kwargs&&typeof value.kwargs==='object'&&!Array.isArray(value.kwargs))))return value;
 throw new Error('Function input must be an argument array or an object with args and optional kwargs.');
}
