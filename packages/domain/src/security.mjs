import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';

export class HttpError extends Error { constructor(status, code, message) { super(message); this.status=status; this.code=code; } }
export function fail(status, code, message) { throw new HttpError(status,code,message); }
export const randomToken = () => randomBytes(24).toString('base64url');
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
export const sessionHash = (token,secret) => createHmac('sha256',secret).update(token).digest('hex');
export function safeEqual(a,b) { const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||'')); return x.length===y.length && timingSafeEqual(x,y); }
export function field(value,name,{min=1,max=200,trim=true}={}) {
 if(typeof value!=='string') fail(400,'VALIDATION',`${name}必须是文本`);
 const v=trim?value.trim():value;
 if(v.length<min||v.length>max||v.includes('\u0000')) fail(400,'VALIDATION',`${name}长度须为 ${min}–${max} 个字符`);
 return v;
}
export const username = value => {
 const v=field(value,'用户名',{min:3,max:40}).toLowerCase();
 if(!/^[a-z0-9][a-z0-9_.-]*$/.test(v)) fail(400,'VALIDATION','用户名仅允许英文字母、数字、点、下划线和短横线'); return v;
};
export const password = value => field(value,'密码',{min:8,max:128,trim:false});
export const uuid = (value,name='ID') => { if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) fail(400,'VALIDATION',`${name}格式无效`); return value; };
export function submissionId(value) { const s=String(value).replace(/^SUB/i,''); if(!/^[1-9]\d{0,17}$/.test(s)) fail(400,'VALIDATION','提交编号无效');return s; }
export function enumValue(value,values,name) { if(!values.includes(value)) fail(400,'VALIDATION',`${name}无效`);return value; }
export function genderValue(value) { return value===null?null:enumValue(value,['male','female','other','undisclosed'],'性别'); }
export function integer(value,min,max,name) { if(!Number.isInteger(value)||value<min||value>max) fail(400,'VALIDATION',`${name}须为 ${min}–${max} 的整数`);return value; }
export function bytes(value,name,max=262144) { const text=field(value,name,{min:0,max,trim:false});if(Buffer.byteLength(text)>max) fail(413,'TOO_LARGE',`${name}超过大小限制`);return text; }
export function hashPassword(value) { return argon2.hash(password(value),{type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1}); }
export const verifyPassword = (hash,value) => argon2.verify(hash,value);
export function parseCookie(header='') {
 const result={}; for(const item of header.split(';')) { const i=item.indexOf('=');if(i>0){try{result[item.slice(0,i).trim()]=decodeURIComponent(item.slice(i+1));}catch{}} } return result;
}
export function sessionCookie(token,{secure=true,maxAge=604800}={}) { return `campus_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`; }
export function checkMutation(req,session,origins) {
 const origin=req.headers.origin;
 if(!origin||!origins.includes(origin)) fail(403,'ORIGIN','请求来源未授权');
 if(session&&!safeEqual(req.headers['x-csrf-token'],session.csrf_token)) fail(403,'CSRF','安全凭据失效，请刷新后重试');
}
export class RateLimiter {
 constructor({max=10,windowMs=60000,clock=Date.now}={}) { this.max=max;this.windowMs=windowMs;this.clock=clock;this.entries=new Map(); }
 check(key) {
  const now=this.clock();let r=this.entries.get(key);
  if(!r||r.reset<=now) {r={count:0,reset:now+this.windowMs};this.entries.set(key,r);}
  if(++r.count>this.max) fail(429,'RATE_LIMIT','请求过于频繁，请稍后再试');
  if(this.entries.size>10000) for(const [k,v] of this.entries) {if(v.reset<=now)this.entries.delete(k);}
 }
}
export function canonicalHash(value) { return tokenHash(JSON.stringify(value)); }
