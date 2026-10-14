"use client";
import Image from "next/image";

export function BrandLogo({className=""}:{className?:string}) {
 return <Image src="/codemaster-oj.png" alt="CodeMaster OJ" width={386} height={102} loading="eager" unoptimized className={`production-brand-logo ${className}`}/>;
}
