"use client";
import Image from "next/image";

export function BrandLogo({className=""}:{className?:string}) {
 return <span className={`inline-block production-brand-logo ${className}`}>
  <Image src="/brand/codemaster-oj-light-v2.svg" alt="CodeMaster OJ" width={372} height={88} loading="eager" unoptimized className="block h-auto w-full dark:hidden"/>
  <Image src="/brand/codemaster-oj-dark-v2.svg" alt="CodeMaster OJ" width={372} height={88} loading="eager" unoptimized className="hidden h-auto w-full dark:block"/>
 </span>;
}
