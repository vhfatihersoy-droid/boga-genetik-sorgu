import {bounded} from "./aiss.mjs";
export const HAYGEM_INDEX='https://www.tarimorman.gov.tr/HAYGEM/Sayfalar/Detay.aspx?Liste=Duyuru&OgeId=240';
const HY_STORAGE='haygem/latest.json';
const hyText=s=>String(s??'').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(m,k)=>{
 if(k[0]==='#'){const n=k[1].toLowerCase()==='x'?parseInt(k.slice(2),16):Number(k.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}
 return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[k]||m;
});
const tr=x=>String(x||'').toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').trim();
const tidy=x=>String(x||'').trim().replace(/\s+/g,' ');
export function haygemRelease(html,now=new Date()){
 const urls=new Map();
 for(const hit of html.matchAll(/href\s*=\s*["']([^"']+\.xlsx)["']/gi)){
  const u=new URL(hyText(hit[1]),HAYGEM_INDEX);
  if(u.origin!==new URL(HAYGEM_INDEX).origin||u.search||u.hash||u.username||u.password)continue;
  const p=decodeURIComponent(u.pathname);
  const m=p.match(/^\/HAYGEM\/Belgeler\/DB_Islah\/İTHALAT İZNİ VERİLEN DONDURULMUŞ BOĞA SPERMASI BİLGİLERİ\/(20\d{2}) YILI\/\1_YILI_ITHALAT_IZNI_VERILEN_DONDURULMUS_BOGA_SPERMA_BILGILERI_(\d{1,2})[._-](\d{1,2})[._-](20\d{2})[^/]*\.xlsx$/i);
  if(!m||m[1]!==m[4])continue;
  const date=m[4]+'-'+m[3].padStart(2,'0')+'-'+m[2].padStart(2,'0');
  if(!Number.isNaN(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date&&date<=now.toISOString().slice(0,10)){
   const set=urls.get(date)||new Set();set.add(u.href);urls.set(date,set);
  }
 }
 const release=[...urls.keys()].sort().at(-1);
 if(!release||urls.get(release).size!==1)throw Error('HAYGEM güncel Excel bağlantısı doğrulanamadı.');
 return {release,url:[...urls.get(release)][0]};
}
async function hyParts(bytes){
 const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),v=i=>d.getUint32(i,true),w=i=>d.getUint16(i,true);
 const target=new Set(['xl/sharedStrings.xml','xl/worksheets/sheet1.xml']);
 const entries=new Map();
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v(i)===0x06054b50&&i+22+w(i+20)===bytes.length){end=i;break;}
 if(end<0||w(end+4)||w(end+6)||w(end+10)>5000)throw Error('HAYGEM Excel dizini okunamadı.');
 let p=v(end+16);
 for(let i=0;i<w(end+10);i++){
  if(p+46>end||v(p)!==0x02014b50)throw Error('HAYGEM Excel dizini geçersiz.');
  const n=w(p+28),x=w(p+30),c=w(p+32),name=new TextDecoder().decode(bytes.subarray(p+46,p+46+n));
  if(target.has(name)){
   const size=v(p+24),len=v(p+20),at=v(p+42),method=w(p+10);
   if(entries.has(name)||w(p+8)&1||size>8_000_000||at+30>=end||v(at)!==0x04034b50||![0,8].includes(method))throw Error('HAYGEM Excel bileşeni geçersiz.');
   const offset=at+30+w(at+26)+w(at+28);
   if(offset+len>end)throw Error('HAYGEM Excel bileşeni eksik.');
   const data=bytes.subarray(offset,offset+len);
   const raw=method===0?data:await bounded(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')),size);
   if(raw.length!==size)throw Error('HAYGEM Excel bileşeni eksik.');
   entries.set(name,new TextDecoder().decode(raw));
  }
  p+=46+n+x+c;
 }
 if(!entries.has('xl/worksheets/sheet1.xml'))throw Error('HAYGEM veri sayfası bulunamadı.');
 return entries;
}
export function haygemKey(x){
 let raw=tr(x).replace(/[\s()./-]+/g,'').replace(/^(?:ho|rw|bs|je|ay|gu)(?=(?:840|124|usa))/,'');
 const iso=raw.match(/^(040|276|203)(\d{12})$/);
 if(iso)raw=({'040':'at','276':'de','203':'cz'}[iso[1]])+iso[2];
 const local=raw.match(/^(at|de|cz)(\d{8,12})$/);
 if(local)return local[1]+local[2].replace(/^0+/,'');
 const n=raw.match(/^(\d{1,4})([a-z]{2})(\d{1,6})$/);
 if(n)return Number(n[1])+n[2]+Number(n[3]);
 return /^[a-z0-9]{5,24}$/.test(raw)?raw:'';
}
export function haygemBreed(x){
 const k=tr(x).replace(/\s*\((erkek|disi)\)\s*$/,'').replace(/\s+/g,' ');
 const m=[
  [/^holstein$/,'Holstein'],[/^(?:kirmizi holstein|red holstein|k\.holstein)$/,'Kırmızı Holstein'],[/^(?:simmental|simental|fleckvieh)$/,'Simental / Fleckvieh'],
  [/^(?:belcika mavisi|british blue|belgium blue)$/,'Belçika Mavisi'],[/^(?:angus|aberdeen angus|aberden angus)$/,'Angus'],
  [/^(?:limuzin|limousin|limousine)$/,'Limuzin'],[/^(?:charolais|sarole)$/,'Şarole'],[/^(?:piemontese|piemontesa)$/,'Piemontese'],
  [/^brown swiss$/,'Brown Swiss'],[/^jersey$/,'Jersey'],[/^hereford$/,'Hereford'],[/^montbeliarde$/,'Montbéliarde'],[/^wagyu$/,'Wagyu'],
 ];
 return m.find(([r])=>r.test(k))?.[1]||tidy(x);
}
export async function parseHaygem(bytes){
 const parts=await hyParts(bytes);
 const textNodes=s=>[...String(s||'').matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map(m=>hyText(m[1])).join('');
 const shared=[...(parts.get('xl/sharedStrings.xml')||'').matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(m=>textNodes(m[1]));
 const rows=[...parts.get('xl/worksheets/sheet1.xml').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(m=>{
  const row=Object.create(null);
  for(const c of m[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
   const pos=c[1].match(/\br="([A-H])\d+"/),type=c[1].match(/\bt="([^"]+)"/)?.[1];
   if(!pos)continue;
   const value=c[2]?.match(/<v>([^<]+)<\/v>/)?.[1];
   row[pos[1]]=tidy(type==='s'?shared[Number(value)]:type==='inlineStr'?textNodes(c[2]):hyText(value));
  }
  return row;
 });
 if(!/ITHALAT IZIN|ithalat izin/i.test(tr(rows[0]?.A))||!/kupe numarasi/.test(tr(rows[1]?.D))||!/boga adi/.test(tr(rows[1]?.E))||!/boga irki/.test(tr(rows[1]?.F)))throw Error('HAYGEM Excel sütun düzeni değişti.');
 const byKey=new Map();let permitRows=0,unmatchedRows=0;
 for(const r of rows.slice(2)){
  if(!/^\d+$/.test(r.A)||!r.D||!r.E||!r.F)continue;
  const k=haygemKey(r.D), breed=haygemBreed(r.F), key=k+'|'+breed;
  permitRows++;
  if(!k)unmatchedRows++;
  const groupKey=k?key:'line:'+r.A;
  if(!byKey.has(groupKey))byKey.set(groupKey,{key:k,groupKey,breed,ear:r.D,name:r.E,naab:/^\d{1,4}[A-Z]{2}\d{1,6}$/i.test(r.D)?r.D:'',lines:[],variants:[]});
  const group=byKey.get(groupKey);
  group.lines.push(Number(r.A));
  group.variants.push({line:Number(r.A),name:r.E,ear:r.D,breed:r.F,importer:r.B,country:r.C,product:r.G,doses:/^\d+$/.test(r.H)?Number(r.H):null});
 }
 if(permitRows<50||permitRows>10_000||unmatchedRows>permitRows*.15)throw Error('HAYGEM izin satırları doğrulanamadı; önceki liste korundu.');
 return {rows:[...byKey.values()],permitRows,unmatchedRows};
}
export async function readHaygem(bucket){const old=await bucket.get(HY_STORAGE);return old?await old.json():null;}
export async function refreshHaygem(bucket,request=fetch,now=new Date()){
 const old=await readHaygem(bucket);
 if(old&&now-Date.parse(old.checkedAt)<6*3600_000)return {result:'recent',release:old.release,permitRows:old.permitRows};
 const opts={redirect:'manual',signal:AbortSignal.timeout(25000)};
 const page=await request(HAYGEM_INDEX,opts);
 if(!page.ok||!page.body)throw Error('HAYGEM duyurusu okunamadı.');
 const {release,url}=haygemRelease(new TextDecoder().decode(await bounded(page.body,2_500_000)),now);
 if(old&&release<old.release)throw Error('HAYGEM önceki sürüme döndü; son liste korundu.');
 const file=await request(url,{redirect:'manual',signal:AbortSignal.timeout(25000)});
 if(!file.ok||!file.body)throw Error('HAYGEM Excel dosyası alınamadı.');
 const bytes=await bounded(file.body,12_000_000);
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const same=old?.sha256===hash&&old?.release===release;
 const next=same?{...old,checkedAt:now.toISOString()}:{...await parseHaygem(bytes),release,source:url,sha256:hash,checkedAt:now.toISOString()};
 if(old&&!same&&old.release<release)await bucket.put('haygem/archive/'+old.release+'.json',JSON.stringify(old),{httpMetadata:{contentType:'application/json'}});
 await bucket.put(HY_STORAGE,JSON.stringify(next),{httpMetadata:{contentType:'application/json'}});
 return {result:same?'unchanged':'updated',release,permitRows:next.permitRows};
}
