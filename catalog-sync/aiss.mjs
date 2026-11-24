export const INDEX = 'https://www.naab-css.org/database-files';
const LIMIT=28_000_000, BASE= '2026-08-12';
const fields=['fullId','cid','breedCode','naab','name','dob','sireId','mgsId','codes','tpi','nm','beta','kappa'];
const breed={Holstein:['HO','RW'],'Kırmızı Holstein':['HO','RW'],Jersey:['JE'],'Brown Swiss':['BS'],Ayrshire:['AY'],Guernsey:['GU']};
const country={US:'USA',USA:'USA',CA:'124',CAN:'124',DE:'DEU',NL:'NLD',IT:'ITA',DK:'DNK',FR:'FRA',GB:'GBR',CZ:'CZE'};
const compact=x=>String(x||'').trim().toUpperCase().replace(/[\s().-]/g,'');
const cleanNAAB=x=>{const m=compact(x).match(/^0*(\d{1,4})([A-Z]{2})0*(\d{1,6})$/);return m&&Number(m[1])&&Number(m[3])?Number(m[1])+m[2]+Number(m[3]):'';};
const rawReg=(c,num)=>{
 if(/^\d{1,12}$/.test(num))return (country[c]||c)+num.padStart(12,'0');
 if(['AUS','BRA'].includes(c)&&/^(?=.*\d)(?=.*[A-Z])[A-Z0-9]{12}$/.test(num))return c+num;
 return '';
};
const cleanReg=x=>{
 const value=compact(x);
 const alpha=value.match(/^(?:HO|RW|JE|BS|AY|GU)?(AUS|BRA)([A-Z0-9]{12})$/);
 if(alpha)return rawReg(alpha[1],alpha[2]);
 const m=value.match(/^(?:HO|RW|JE|BS|AY|GU)?(840|124|[A-Z]{2,3})(?:M|F)?(\d{3,12})$/);
 return m?rawReg(m[1],m[2]):'';
};
export function latestURL(html){
 const hits=[...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>\s*Complete List of All Active[^<]*<\/a>/gi)];
 if(hits.length!==1)throw Error('AISS resmi indirme bağlantısı bulunamadı.');
 const u=new URL(hits[0][1],INDEX);
 if(u.origin!==new URL(INDEX).origin||u.username||u.password||!u.pathname.startsWith('/uploads/')||!decodeURIComponent(u.pathname).match(/\/Complete[ _-]+AISS(?:[ _.-]*\(?\d+\)?)?\.zip$/i)||u.search||u.hash)throw Error('AISS indirme adresi doğrulanamadı.');
 return u.href;
}
export async function bounded(stream,max){
 const reader=stream.getReader(), chunks=[]; let n=0;
 try { for(;;){const v=await reader.read();if(v.done)break;n+=v.value.length;if(n>max)throw Error('AISS dosyası boyut sınırını aştı.');chunks.push(v.value);} }
 catch(e){await reader.cancel().catch(()=>{});throw e;}
 finally{reader.releaseLock();}
 const out=new Uint8Array(n);let at=0;for(const c of chunks){out.set(c,at);at+=c.length;}return out;
}
export async function readZip(bytes){
 const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.length), u16=i=>d.getUint16(i,true), u32=i=>d.getUint32(i,true);
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(u32(i)===0x06054b50&&i+22+u16(i+20)===bytes.length){end=i;break;}
 if(end<0||u16(end+4)||u16(end+6)||u16(end+10)>32)throw Error('AISS ZIP biçimi geçersiz.');
 let p=u32(end+16);const entries=[];
 for(let k=0;k<u16(end+10);k++){
  if(p+46>end||u32(p)!==0x02014b50)throw Error('AISS ZIP dizini geçersiz.');
  const len=u16(p+28),name=new TextDecoder().decode(bytes.subarray(p+46,p+46+len));
  const m=name.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{1,2})(20\d{2})-CompleteAISS\.txt$/i);
  if(m){
   const size=u32(p+24),compressed=u32(p+20),at=u32(p+42),method=u16(p+10);
   if(size<500_000||size>LIMIT||compressed>LIMIT||at+30>end||u32(at)!==0x04034b50||![0,8].includes(method)||u16(p+8)&1)throw Error('AISS ZIP kaydı geçersiz.');
   const from=at+30+u16(at+26)+u16(at+28);if(from+compressed>end)throw Error('AISS ZIP kaydı eksik.');
   const month='jan feb mar apr may jun jul aug sep oct nov dec'.split(' ').indexOf(m[1].toLowerCase())+1;
   const release=m[3]+'-'+String(month).padStart(2,'0')+'-'+m[2].padStart(2,'0');
   if(!Number.isFinite(Date.parse(release))||new Date(release).toISOString().slice(0,10)!==release)throw Error('AISS sürüm tarihi geçersiz.');
   entries.push({name,release,method,size,compressed:bytes.subarray(from,from+compressed)});
  }
  p+=46+len+u16(p+30)+u16(p+32);
 }
 if(entries.length!==1)throw Error('ZIP içinde tek bir tarihli Complete AISS bekleniyor.');
 const {name,release,method,size,compressed}=entries[0];
 const data=method===0?compressed:await bounded(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw')),size);
 if(data.length!==size)throw Error('AISS dosyası eksik.');
 return {name,release,text:new TextDecoder('windows-1252').decode(data)};
}
function parseCSV(line){
 if(!line.includes('"'))return line.split(',');
 let q=false,b='',out=[];
 for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){b+='"';i++;}else q=!q;}else if(c===','&&!q){out.push(b);b='';}else b+=c;}
 if(q)throw Error('AISS CSV satırı geçersiz.');
 out.push(b);return out;
}
function insert(m,k,r){if(k){const list=m.get(k)||[];list.push(r);m.set(k,list);}}
const isoDOB=x=>/^(19|20)\d{6}$/.test(x)?x.slice(0,4)+'-'+x.slice(4,6)+'-'+x.slice(6):'';
export function buildFeed(csv,bulls){
 const byId=new Map(),byCode=new Map(),byFull=new Map(),catalog=[];
 let count=0,lines=0;
 for(const l of csv.split(/\r?\n/)){
  if(!l.trim())continue;lines++;
  const a=parseCSV(l);
  if(a.length!==144||!/^[A-Z]{2}$/.test(a[0]?.trim())||!['A','F','G'].includes(a[94]?.trim()))continue;
  const col=(i)=>a[i]?.trim()||'', cb=col(1),cid=rawReg(cb,col(2)),bc=col(0);
  if(!cid)continue;
  const vals=[bc+cid,cid,bc,col(7),col(8),isoDOB(col(89)),cleanReg(col(91)),cleanReg(col(92)),col(93),col(62),col(44),col(125),col(126)];
  const r=Object.fromEntries(fields.map((k,i)=>[k,vals[i]]));
  const altNAAB=col(4)+col(5)+col(6);
  if(r.name.length>200 || !/^(?:[0-9]{3}|[A-Z]{2,3})$/.test(cb)) continue;
  catalog.push({...r,marketingCode:cleanNAAB(altNAAB)?altNAAB:'',shortName:col(90),evaluationType:col(94),
    production:{ milk:col(18),fatLb:col(19),fatPercent:col(20),proteinLb:col(21),proteinPercent:col(22),reliability:col(16),daughters:col(13),herds:col(12) }});
  insert(byId,cid,r);insert(byFull,r.fullId,r);
  const keys=new Set([cleanNAAB(r.naab),cleanNAAB(col(4)+col(5)+col(6))]);for(const k of keys)insert(byCode,k,r);
  count++;
 }
 if(count<4000||count<lines*.97)throw Error('AISS sütunları veya kayıt sayısı değişti; son geçerli veri korundu.');
 const matches=Object.create(null),ancestors=Object.create(null);
 function parents(r,depth=0,seen=new Set()){
  if(depth>=4||seen.has(r.cid))return;seen.add(r.cid);
  for(const k of [r.sireId,r.mgsId]){
   const list=byId.get(k)||[], ids=new Map(list.map(a=>[a.fullId,a]));
   if(ids.size!==1)continue;
   const a=[...ids.values()][0];
   ancestors[k]={...a,id:k};
   parents(a,depth+1,seen);
  }
 }
 for(const b of bulls){
  const allowed=breed[b.breed];
  if(!allowed)continue;
  const filtered=a=>a.filter(r=>allowed.includes(r.breedCode));
  const keys=[];
  for(const v of [b.ear,b.naab]){
   if(!v)continue;
   const raw=compact(v), k=cleanNAAB(raw), reg=cleanReg(raw);
   const result=filtered(byFull.get(raw)||byCode.get(k)||byId.get(reg)||[]);
   if(result.length)keys.push(result);
  }
  if(!keys.length)continue;
  const result=new Map(keys[0].filter(r=>keys.every(other=>other.some(x=>x.fullId===r.fullId))).map(r=>[r.fullId,r]));
  if(result.size!==1)continue;
  const hit=[...result.values()][0];
  matches[b.uid]={...hit,tracked:{ear:b.ear||"",naab:b.naab||"",breed:b.breed}};
  parents(hit);
 }
 if(Object.keys(matches).length<75)throw Error('Kimlik ve ırk eşleşmeleri beklenen alt sınırın altında; önceki veri korundu.');
 return {matches,ancestors,catalog,sourceRows:count,matched:Object.keys(matches).length};
}

export async function readSnapshot(bucket){
 const obj=await bucket.get('aiss/latest.json');return obj?await obj.json():null;
}
export async function refreshSnapshot(bucket,bulls,request=fetch,now=new Date()){
 const old=await readSnapshot(bucket);
 if(old?.schema===2&&Array.isArray(old.catalog)&&now-Date.parse(old.checkedAt)<6*3600_000)return {result:'recent',release:old.release,matched:old.matched,checkedAt:old.checkedAt};
 const opts={redirect:'manual',signal:AbortSignal.timeout(18000)};
 const page=await request(INDEX,opts);if(!page.ok||!page.body)throw Error('NAAB resmî dosya sayfası okunamadı.');
 const url=latestURL(new TextDecoder().decode(await bounded(page.body,600_000)));
 const file=await request(url,{redirect:'manual',signal:AbortSignal.timeout(25000)});if(!file.ok||!file.body)throw Error('NAAB Complete AISS arşivi indirilemedi.');
 const bytes=await bounded(file.body,10_000_000);
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
 let next;
 if(old?.schema===2&&old.sha256===hash&&Array.isArray(old.catalog))next={...old,checkedAt:now.toISOString()};
 else{
  const z=await readZip(bytes);
  if(z.release<(old?.release||BASE)||z.release>now.toISOString().slice(0,10))throw Error('NAAB sürüm tarihi kabul edilen aralık dışında.');
  const fresh=buildFeed(z.text,bulls);
  const liveIds=new Set(fresh.catalog.map(r=>r.fullId));
  const historic=(old?.catalog||[]).filter(r=>!liveIds.has(r.fullId)).map(r=>({...r,release:r.release||old.release}));
  if(fresh.catalog.length+historic.length>50_000)throw Error('Katalog kayıt sınırına ulaştı; önceki veri korundu.');
  next={...fresh,schema:2,catalog:[...fresh.catalog.map(r=>({...r,release:z.release})),...historic],release:z.release,file:z.name,source:url,sha256:hash,checkedAt:now.toISOString(),appliedAt:now.toISOString()};
  // The private bucket retains the original publisher archive and field-layout document.
  await bucket.put('aiss/raw/'+z.release+'-'+hash+'.zip',bytes,{httpMetadata:{contentType:'application/zip'}});
  // Keep exact historical snapshots separately; the active snapshot is replaced only after all validation.
  if(old?.file&&old.release<next.release&&Array.isArray(old.catalog)){
   await bucket.put('aiss/archive/'+old.release+'.json',JSON.stringify(old),{httpMetadata:{contentType:'application/json'}});
  }
 }
 await bucket.put('aiss/latest.json',JSON.stringify(next),{httpMetadata:{contentType:'application/json'}});
 return {result:old?.schema===2&&old.sha256===hash&&Array.isArray(old.catalog)?'unchanged':'updated',release:next.release,matched:next.matched,checkedAt:next.checkedAt};
}
