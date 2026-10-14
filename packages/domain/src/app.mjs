// Thin Node HTTP adapter retained solely for domain integration tests. The
// deployed API is the NestJS application in apps/api; domain services accept
// structured requests and return data, without IncomingMessage/ServerResponse.
import { createDomainServices, loadConfig, resourceArea } from './application.mjs';
import { HttpError, fail } from './security.mjs';
import { errorResponse, parseJsonBody } from './http-contract.mjs';
export {loadConfig};
export async function createApp(pool,config) {
 const services=await createDomainServices(pool,config);
 return async(req,res)=>{
  const respond=(status,body,cookie)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(cookie?{'Set-Cookie':cookie}:{})});res.end(JSON.stringify(body));};
  try {
   if(new URL(req.url,'http://api.local').pathname.replace(/\/$/,'')==='/healthz')return respond(200,await services.health());
   let size=0;const parts=[];
   if(!['GET','HEAD','OPTIONS'].includes(req.method))for await(const chunk of req){size+=chunk.length;if(size>config.bodyLimit)fail(413,'TOO_LARGE','请求过大');parts.push(chunk);}
   const body=parseJsonBody(Buffer.concat(parts),req.headers,config.bodyLimit);
   const context=await services.prepareRequest({url:req.url,method:req.method,headers:req.headers,body,ip:req.socket?.remoteAddress||'unknown'});
   const result=await services.execute(resourceArea(context.route),context);return respond(result.status,result.body,result.cookie);
  } catch(error){const result=errorResponse(error);return respond(result.status,result.body);}
 };
}
