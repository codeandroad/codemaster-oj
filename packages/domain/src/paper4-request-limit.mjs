// Larger bodies are reserved for the two bounded Paper 4 content import routes.
// Ordinary requests keep their existing limit and authorization pipeline.
export function paper4RequestBodyLimit(path,method,defaultLimit=2*1024*1024){
 const pathname=new URL(path,'http://api.local').pathname.replace(/\/$/,'');
 return method==='POST'&&['/api/v1/paper4/imports/batch-preview','/api/v1/paper4/papers/batch-import'].includes(pathname)
  ?12*1024*1024:defaultLimit;
}
