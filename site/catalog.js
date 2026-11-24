(function(root){
  'use strict';
  const f = x => String(x??'').toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').trim().replace(/\s+/g,' ');
  const esc = x => String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clean = x => f(x).replace(/[\s()./-]+/g,'');
  function id(x){
    const s=clean(x);
    const m=s.match(/^(\d{1,4})([a-z]{2})(\d{1,6})$/);
    return m ? +m[1]+m[2]+Number(m[3]) : s;
  }
  const breeds={AY:'Ayrshire',BS:'Brown Swiss',GU:'Guernsey',HO:'Holstein',RW:'Kırmızı Holstein',JE:'Jersey',LD:'Lineback',MS:'Milking Shorthorn',NR:'Norwegian Red',SM:'Simental / Fleckvieh',MO:'Montbéliarde',SR:'Swedish Red',WW:'WW'};
  const fmt=x=>String(x||'').replace(/^(\d{4})-(\d\d)-(\d\d)(?:T.*)?$/,'$3.$2.$1');
  const recordNum=new Intl.NumberFormat('tr-TR');
  const official='https://www.tarimorman.gov.tr/HAYGEM/Sayfalar/Detay.aspx?Liste=Duyuru&OgeId=240';
  const naab='https://www.naab-css.org/database-files';
  const sourceLabel={haygem:'HAYGEM izin listesi',naab:'NAAB AISS',local:'Çalışma kaydı'};
  const external=(u,label)=>'<a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>';
  function normalizeRows(upstream, base, records=[]){
    const baseByUid=new Map(base.map(row=>[row.uid,row]));
    const authority=new Map(records.filter(r=>r.key).map(r=>[r.key+'|'+r.breed,r]));
    const matched=new Map();
    for(const [fullId,list] of Object.entries(upstream?.tracked||{})){
      for(const t of list){
        const b=baseByUid.get(t.uid);
        if(b && b.breed===t.breed && (b.ear||'')===t.ear && (b.naab||'')===t.naab) matched.set(t.uid,fullId);
      }
    }
    const trackedByFull=new Map();
    const localKey=(x)=>{
        const raw=clean(x);
        const iso=raw.match(/^(040|276|203)(\d{12})$/);
        const p=raw.match(/^(at|de|cz)(\d{8,12})$/);
        if(iso) return ({'040':'at','276':'de','203':'cz'}[iso[1]])+iso[2].replace(/^0+/,'');
        if(p) return p[1]+p[2].replace(/^0+/,'');
        return id(x).replace(/^(?:ho|rw|bs|je|ay|gu)(?=(?:840|124|usa))/,'');
    };
    const permitFor=(ids,breed)=>{
      const matches=[...new Set(ids.filter(Boolean).map(x=>authority.get(localKey(x)+'|'+breed)).filter(Boolean))];
      return matches.length===1?matches[0]:null;
    };
    const out=base.map(b=>{
      const hk=b.group==='HAYGEM 2026' && /^hyg-/.test(b.uid) && /HAYGEM/.test(b.source||'');
      const aid=matched.get(b.uid);
      const sourceRow=permitFor([b.ear,b.naab],b.breed);
      const current=sourceRow?.breed===b.breed;
      const row={...b,name:b.name||b.ear||b.naab||'Adsız kayıt', sourceType:hk?'haygem':'local', permit:current?'current':hk?'seed':'', authority:current?sourceRow:null, idKeys:[b.ear, b.naab, aid, sourceRow?.breed===b.breed?sourceRow.ear:''].filter(Boolean),idLink:aid||''};
      if(aid){
        const entries=trackedByFull.get(aid)||[];
        entries.push(row);
        trackedByFull.set(aid,entries);
      }
      return row;
    });
    const baseKeys=new Set(out.filter(row=>row.authority).map(row=>row.authority.groupKey));
    out.push(...records.filter(row=>!baseKeys.has(row.groupKey)).map(row=>({...row,sourceType:'haygem',permit:'current',authority:row,idKeys:[row.ear,row.naab,...(row.variants||[]).map(v=>v.ear)].filter(Boolean)})));
    const full=(upstream?.rows||[]).map(r=>{
      const linked=trackedByFull.get(r.fullId)||[];
      const breed=breeds[r.breedCode]||r.breedCode;
      const authority=permitFor([r.cid,r.fullId,r.naab,r.marketingCode],breed);
      return {...r,name:r.name||r.fullId,breed,ear:r.cid,sourceType:'naab',idKeys:[r.cid,r.fullId,r.naab,r.marketingCode].filter(Boolean),permit:authority||linked.some(b=>b.permit==='current')?'current':linked.some(b=>b.permit==='seed')?'seed':'',linked,authority};

    });
    return {list:out.concat(full),full};
  }
  function ranked(list,phrase,scope,breed){
    const q=f(phrase), code=id(q), words=q.split(' ').filter(Boolean), hasId=/\d/.test(q);
    return list.flatMap((row,i)=>{
      if(scope==='haygem'&&!row.permit||scope==='naab'&&row.sourceType!=='naab'||breed&&breed!==row.breed)return [];
      const names=[row.name,row.shortName,row.pedigree?.officialName,...(row.authority?.variants||[]).map(v=>v.name)].map(f);
      const ids=row.idKeys.map(id);
      const rank=!q?4:hasId&&ids.includes(code)?0:names.includes(q)?1:hasId&&code.length>=3&&ids.some(x=>x.startsWith(code))||names.some(x=>x.startsWith(q))?2:words.every(w=>names.some(n=>n.includes(w)))?3:9;
      return rank===9?[]:[{row,i,rank}];
    }).sort((a,b)=>a.rank-b.rank||a.row.name.localeCompare(b.row.name,'tr')||String(a.row.ear||'').localeCompare(String(b.row.ear||''))).map(x=>x.i);
  }
  function mount(host,{base,onOpen,onOpenExternal,privateFeed=false}){
    if(!host||host.dataset.ready)return;
    host.dataset.ready='true';
    host.innerHTML=`<div class="catalog"><header class="cat-hero"><small>BOĞA GENETİK SORGU</small><h1>Boğa Kataloğu</h1><p>Boğa adı, NAAB kodu veya kayıt numarasıyla arayın. Uluslararası kaydı ve Türkiye izin listesini birbirinden ayırarak inceleyin.</p></header>
      <div class="cat-shell"><div class="cat-filters">
        <label>Boğa adı / kayıt numarası / NAAB<input class="input" type="search" id="catQuery" autocomplete="off" placeholder="Örn. HEISS, 551HO03823, DE0957165910"></label>
        <label>Kapsam<select id="catScope"><option value="">Tüm kaynaklar</option><option value="haygem">HAYGEM izin kaydı bulunanlar</option><option value="naab">NAAB AISS</option></select></label>
        <label>Irk<select id="catBreed"><option value="">Tüm ırklar</option></select></label></div>
      <div class="cat-meta" id="catFeed" role="status"></div><div class="cat-detail" id="catDetail" hidden></div><div class="cat-meta" id="catCount" aria-live="polite"></div><div class="cat-results" id="catRows"></div>
      <div class="cat-pager" id="catPager"></div></div></div>`;
    const $=id=>host.querySelector('#cat'+id);
    let feed=null, permits=null, failed=false, permitFailed=false, list=[], current=1, selected=-1, lastBase=null, parents=null;
    const size=24;
    const ingest=()=>{
      lastBase=base();
      const data=normalizeRows(feed,lastBase,permits?.rows);
      list=data.list;
      const byCid=new Map();
      for(const row of data.full){const matches=byCid.get(row.cid)||[];matches.push(row);byCid.set(row.cid,matches);}
      parents=byCid;
      const old=$('Breed').value;
      const names=[...new Set(list.map(r=>r.breed).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'tr'));
      $('Breed').innerHTML='<option value="">Tüm ırklar</option>'+names.map(b=>'<option>'+esc(b)+'</option>').join('');
      if(names.includes(old))$('Breed').value=old;
      const naabNote=feed
        ? recordNum.format(feed.sourceRows)+' NAAB AISS kaydı · sürüm '+fmt(feed.release)+' · kontrol '+fmt(feed.checkedAt)
        : privateFeed?(failed?'NAAB kataloğu şu anda alınamadı; çalışma kayıtları gösteriliyor.':'NAAB arşivi yükleniyor…')
        :'Bu açık sürümde çalışma kayıtları gösterilir. Tam NAAB arşivi özel çalışma alanındadır.';
      const permitNote=permits?'HAYGEM liste yayını '+fmt(permits.release)+' · '+recordNum.format(permits.permitRows)+' izin satırı':privateFeed&&permitFailed?'HAYGEM güncel listesi alınamadı; mevcut kayıtlar korunuyor.':'HAYGEM çalışma kayıtları';
      $('Feed').innerHTML=esc(naabNote)+' <span aria-hidden="true">·</span> '+external(naab,'NAAB kaynağı')+' <span aria-hidden="true">·</span> '+esc(permitNote)+' <span aria-hidden="true">·</span> '+external(official,'HAYGEM kaynağı');
      selected=-1; $('Detail').hidden=true; render();
    };
    function render(){
      const ranks=ranked(list,$('Query').value,$('Scope').value,$('Breed').value);
      const pages=Math.max(1,Math.ceil(ranks.length/size));current=Math.min(current,pages);
      $('Count').textContent=recordNum.format(ranks.length)+' kayıt'+(ranks.length?' · Sayfa '+current+'/'+pages:'');
      $('Rows').innerHTML=ranks.slice((current-1)*size,current*size).map(i=>{
        const r=list[i];
        return '<button type="button" data-catalog-row="'+i+'"><b>'+esc(r.name)+'</b><span>'+esc([r.breed,r.ear,r.naab].filter(Boolean).join(' · '))+'</span><span>'+esc(sourceLabel[r.sourceType]+(r.permit?(r.sourceType==='haygem'?'':' · HAYGEM izin kaydı var'):'')+(r.sourceType==='naab'&&r.release!==feed?.release?' · Arşivde':'')+(r.country?' · '+r.country:'')+(r.doses?' · '+recordNum.format(r.doses)+' doz':''))+'</span></button>';
      }).join('')||'<p>Bu aramayla eşleşen boğa bulunamadı.</p>';
      $('Pager').innerHTML=pages>1?'<button class="btn" type="button" data-catalog-step="-1" '+(current===1?'disabled':'')+'>Önceki</button><button class="btn" type="button" data-catalog-step="1" '+(current===pages?'disabled':'')+'>Sonraki</button>':'';
    }
    function hide(){ $('Detail').hidden=true;$('Detail').replaceChildren(); }
    function show(i){
      const r=list[i];if(!r)return;selected=i;
      const matches=r.sourceType==='naab'?r.linked||[]:[];
      const permit=r.permit? (r.permit==='current'?'HAYGEM’in son yayımlanan izin listesinde eşleşme var.':'HAYGEM çalışma listesindeki izin kaydı.'): 'Bu katalog kaydı Türkiye ithalatını veya iznini doğrulamaz.';
      const source=r.sourceType==='naab'?external(naab,'NAAB AISS veri dosyaları')+ ' · Kayıt sürümü '+esc(fmt(r.release))+(r.authority?' · '+external(official,'HAYGEM izin listesi')+' '+esc(fmt(permits.release)):'')
        :r.authority?external(official,'HAYGEM izin listesi')+' · Liste yayını '+esc(fmt(permits.release))
        :r.sourceType==='haygem'?external(official,'HAYGEM duyuru sayfası')+' · 2026 çalışma kaydı'
        :esc(r.source||'Yerel çalışma kaydı');
      const kv=(k,v)=>v?'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>':'';
      const rel=(name,cid)=>{
        if(!cid)return '';
        const hits=parents.get(cid)||[];
        const hit=hits.length===1?hits[0]:null;
        const detail=hit?'<button type="button" class="btn sm" data-catalog-row="'+list.indexOf(hit)+'">'+esc(hit.name)+'</button>':'';
        return '<p class="cat-help"><b>'+esc(name)+':</b> '+esc(cid)+' '+detail+'</p>';
      };
      const docs=root.PedigreeSources?.find(r);
      const variants=r.authority?.variants||[];
      const variantDetails=variants.length?'<details><summary>HAYGEM izin satırları ('+variants.length+')</summary>'+variants.map(v=>'<p class="cat-help">'+esc([v.line,v.name,v.importer,v.country,v.product,v.doses===null?'':recordNum.format(v.doses)+' doz'].filter(Boolean).join(' · '))+'</p>').join('')+'</details>':'';
      $('Detail').hidden=false;
      $('Detail').innerHTML=`<button type="button" class="btn sm" data-catalog-close>Kapat</button><h2 tabindex="-1">${esc(r.name)}</h2>
        <div class="cat-help">${source}</div><p class="cat-help"><b>${esc(permit)}</b> İzin kaydı fiilî ithalat veya sevkiyat kanıtı değildir.</p>
        <dl>${kv('Irk',r.breed)}${kv('Kayıt numarası',r.ear)}${kv('NAAB',r.naab||r.marketingCode)}${kv('Doğum',fmt(r.dob))}${kv('β-Kazein',r.beta||r.betaCasein)}${kv('κ-Kazein',r.kappa||r.kappaCasein)}${r.breedCode==='HO'?kv('TPI',r.tpi):''}${kv('Net Merit (NM$)',r.nm)}${r.authority?kv('Yayımlanan izin satırı',r.authority.lines?.join(', ')):''}</dl>
        ${r.production?'<details><summary>NAAB üretim değerlendirmesi</summary><dl>'+
          kv('Süt PTA (lb)',r.production.milk)+kv('Yağ PTA (lb)',r.production.fatLb)+kv('Yağ PTA (%)',r.production.fatPercent)+
          kv('Protein PTA (lb)',r.production.proteinLb)+kv('Protein PTA (%)',r.production.proteinPercent)+
          kv('Verim güvenilirliği (%)',r.production.reliability)+kv('Kız sayısı',r.production.daughters)+kv('Sürü sayısı',r.production.herds)+'</dl></details>':''}
        ${variantDetails}
        ${r.codes||r.defect?'<p class="cat-help"><b>Kaynakta bildirilen genetik kodlar:</b> '+esc([r.codes,r.defect].filter(Boolean).join(' · '))+'</p>':''}
        ${r.status&&r.sourceType!=='naab'?'<p class="cat-help"><b>Çalışma sınıflandırması:</b> '+esc(r.status)+'</p>':''}
        <h3>Pedigri</h3>${rel('Baba',r.sireId||r.pedigree?.sireId)}${rel('Ana babası',r.mgsId||r.pedigree?.mgsId)}
        ${!r.sireId&&!r.mgsId&&!r.pedigree?.sireId&&!r.pedigree?.mgsId?'<p class="cat-help">Bu kayıt için kaynakta soy bağlantısı bulunmuyor.</p>':''}
        ${r.sourceType==='naab'&&onOpenExternal?'<button type="button" class="btn" data-catalog-external>Etkileşimli soy ağacını aç</button>':''}
        ${r.uid?'<button type="button" class="btn" data-catalog-open="'+esc(r.uid)+'">Etkileşimli soy ağacını aç</button>':''}
        ${matches.length?'<h3>Eşleşen çalışma kayıtları</h3>'+matches.map(b=>'<button type="button" class="btn sm" data-catalog-open="'+esc(b.uid)+'">'+esc([b.name,b.ear,b.status].filter(Boolean).join(' · '))+'</button>').join(''):''}
        <h3>Kaynak belge</h3>${docs?docs.docs.map(d=>'<div class="cat-help"><strong>'+esc(d.publisher)+'</strong> · '+external(d.url,d.title)+(root.PedigreeSources.previewUrl(d)?'<button type="button" class="btn sm" data-catalog-preview="'+esc(d.url)+'" aria-expanded="false">PDF’yi burada göster</button>':'')+'<div></div></div>').join(''):'<p class="cat-help">Bu kimlikle eşleşen özgün görsel belge henüz eklenmedi.</p>'}`;
      $('Detail').querySelector('h2').focus();
    }
    host.addEventListener('click',e=>{
      const row=e.target.closest('[data-catalog-row]');if(row){show(+row.dataset.catalogRow);return;}
      const close=e.target.closest('[data-catalog-close]');if(close){hide();const old=$('Rows').querySelector('[data-catalog-row="'+selected+'"]');(old||$('Query')).focus();return;}
      if(e.target.closest('[data-catalog-external]')&&list[selected]&&onOpenExternal){onOpenExternal(list[selected],parents);return;}
      const tree=e.target.closest('[data-catalog-open]');if(tree){onOpen(tree.dataset.catalogOpen);return;}
      const preview=e.target.closest('[data-catalog-preview]');if(preview){
        const holder=preview.nextElementSibling, open=preview.getAttribute('aria-expanded')==='false';
        holder.replaceChildren();preview.setAttribute('aria-expanded',String(open));preview.textContent=open?'Önizlemeyi kapat':'PDF’yi burada göster';
        if(open){const el=document.createElement('iframe');el.title='Yayımlayanın özgün pedigri PDF belgesi';el.referrerPolicy='no-referrer';el.src=preview.dataset.catalogPreview;const hint=document.createElement('p');hint.textContent='PDF görünmüyorsa özgün belge bağlantısını açın.';holder.append(el,hint);}
        return;
      }
      const step=e.target.closest('[data-catalog-step]');if(step){current+=+step.dataset.catalogStep;render();$('Rows').querySelector('button')?.focus();}
    });
    let timer;
    $('Query').addEventListener('input',()=>{current=1;hide();clearTimeout(timer);timer=setTimeout(render,100);});
    for(const el of [$('Scope'),$('Breed')])el.addEventListener('change',()=>{current=1;hide();render();});
    ingest();
    if(privateFeed)Promise.allSettled([getFeed('./api/catalog','rows'),getFeed('./api/haygem','rows')]).then(([n,h])=>{
      if(n.status==='fulfilled')feed=n.value;else failed=true;
      if(h.status==='fulfilled')permits=h.value;else permitFailed=true;
      ingest();
    });
    return ()=>{if(lastBase!==base())ingest();};
  }
  async function getFeed(url,key){
    const res=await fetch(url,{signal:AbortSignal.timeout(15000),cache:'no-store'});
    if(!res.ok)throw Error('Kaynak okunamadı');
    const json=await res.json();if(!Array.isArray(json[key])||typeof json.release!=='string')throw Error('Kaynak henüz hazır değil');
    return json;
  }
  const api={mount,ranked,normalizeRows};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BullCatalog=api;
})(globalThis);
