/* Exact animal-level references. No publisher file is mirrored by this app. */
(function (root) {
  'use strict';
  const entries = [
    { breed: 'FV', registration: 'DE0957165910', docs: [
      { publisher: 'ISB Genetic', title: 'HEISS · Görsel pedigri ve boğa kataloğu', type: 'pdf', url: 'https://intra.isbgenetic.cz/catalog/pdf/fleckvieh/heiss.pdf' },
      { publisher: 'ISB Genetic', title: 'HEISS · Yayımlayanın boğa sayfası', type: 'page', url: 'https://isbgenetic.cz/fleckvieh/heiss' },
    ] },
    { breed: 'FV', registration: 'DE0956067030', docs: [
      { publisher: 'CRV', title: 'HAN SOLO · Özgün pedigri sayfası', type: 'page', url: 'https://shop.crv4all.co.uk/en/sire/3b22022c-07a3-4e1f-a172-a9330e5a0515-han-solo?base=fleckvieh-de#pedigree' },
    ] },
    { breed: 'FV', registration: 'AT773272789', docs: [
      { publisher: 'CRV', title: 'GS HOCHTIROL · Görsel pedigri ve boğa kataloğu', type: 'pdf', url: 'https://shop-assets.crv4all.com/YftTc0Lc2nlfm56b2Q9az.pdf' },
      { publisher: 'Zuchtwert Austria', title: 'GS HOCHTIROL · Yayımlayanın boğa sayfası', type: 'page', url: 'https://zuchtwert.at/fleckvieh/040000773272789' },
    ] },
    { breed: 'HO', registration: '840003007971642', naab: '551HO03823', docs: [
      { publisher: 'STgenetics', title: 'HOLDON · Özgün boğa ve soy bilgisi sayfası', type: 'page', url: 'https://stgen.com/sire-directory/dairy-bull-usa.aspx?code=551HO03823&language=english&title=delicious-charl-holdon-et' },
    ] },
    { breed: 'HO', registration: '840003260126738', naab: '551HO05310', docs: [
      { publisher: 'STgenetics', title: 'MAVERICK · Özgün boğa ve soy bilgisi sayfası', type: 'page', url: 'https://www.stgen.com/sire-directory/dairy-bull-usa.aspx?code=551HO05310&language=korean-distrigen&title=genosource-maverick-et' },
    ] },
  ];
  for (const entry of entries) {
    entry.docs.forEach(Object.freeze);
    Object.freeze(entry.docs);
    Object.freeze(entry);
  }

  const key = value => String(value ?? '').toUpperCase().replace(/\s/g, '');
  function breedCode(value) {
    const breed = key(value);
    if (['HO','HOLSTEIN'].includes(breed)) return 'HO';
    if (['FV','FL','SIM','SIMENTAL','FLECKVIEH','SIMENTAL/FLECKVIEH'].includes(breed)) return 'FV';
    return '';
  }
  function registration(value, breed) {
    let raw = key(value);
    if (breed === 'HO' && raw.startsWith('HO')) raw = raw.slice(2);
    if (breed === 'HO') return /^(?:840\d{12}|USA\d{12})$/.test(raw) ? raw : '';
    if (breed === 'FV') {
      const country = { '276': 'DE', '040': 'AT' };
      const iso = raw.match(/^(276|040)(\d{12})$/);
      if (iso) raw = country[iso[1]] + iso[2];
      const parts = raw.match(/^(DE|AT)(\d{8,12})$/);
      if (parts) {
        const digits = parts[2].replace(/^0+(?=\d)/, '');
        return parts[1] + (parts[1] === 'DE' ? digits.padStart(10, '0') : digits);
      }
    }
    return '';
  }
  function naab(value) {
    const hit = key(value).match(/^(\d{1,3})HO(\d{3,6})$/);
    return hit && Number(hit[1]) && Number(hit[2]) ? Number(hit[1]) + 'HO' + Number(hit[2]) : '';
  }
  function find(subject) {
    const breed = breedCode(subject?.breed || subject?.breedCode);
    const regs = [...new Set([subject?.ear, subject?.id, subject?.fullId, subject?.pedigree?.aissId, subject?.pedigree?.fullId]
      .map(value => registration(value, breed)).filter(Boolean))];
    const code = naab(subject?.naab);
    if (regs.length > 1) return null;
    const candidates = entries.filter(entry => entry.breed === breed &&
      (regs[0] === entry.registration || (code && code === naab(entry.naab))) &&
      (!regs.length || regs[0] === entry.registration) &&
      (!code || !entry.naab || code === naab(entry.naab)));
    return candidates.length === 1 ? candidates[0] : null;
  }
  function previewUrl(doc) {
    // Only these explicitly reviewed, direct publisher PDF paths are framed.
    return doc?.type === 'pdf' && [
      'https://intra.isbgenetic.cz/catalog/pdf/fleckvieh/heiss.pdf',
      'https://shop-assets.crv4all.com/YftTc0Lc2nlfm56b2Q9az.pdf',
    ].includes(doc.url) ? doc.url : '';
  }
  const api = Object.freeze({ find, previewUrl });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PedigreeSources = api;
})(globalThis);
