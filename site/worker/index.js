const APP_HTML = __APP_HTML__;
const SEED = __SEED__;
const BACKUP_FILES = __BACKUP_FILES__;

const DEFAULT_OWNER_EMAIL = 'engin.umut.ufuk@gmail.com';
const ROLES = ['Yönetici', 'Araştırmacı', 'Görüntüleyici'];
const VALID_STATUSES = [
  'Taşıyıcı',
  'Arı',
  'Kamuya açık kayıtta doğrulanamadı',
  'Bekliyor',
];
const MAX_PAYLOAD_BYTES = 2_500_000;

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

const JSON_HEADERS = {
  ...SECURITY_HEADERS,
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const emailKey = (value) => String(value || '').trim().toLowerCase();
const getOwnerEmail = (env) => emailKey(env?.OWNER_EMAIL || DEFAULT_OWNER_EMAIL);
const isSafeHttpUrl = (value) => {
  const s = String(value || '').trim();
  if (!s) return true;
  try {
    const parsed = new URL(s);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const cloneSeed = () => structuredClone(SEED);

async function loadState(env) {
  let row = await env.DB.prepare(
    'SELECT revision, state_json, updated_at FROM site_state WHERE id = ?'
  )
    .bind('main')
    .first();

  if (!row) {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO site_state (id, revision, state_json, updated_at) VALUES (?, ?, ?, ?)'
    )
      .bind('main', 1, JSON.stringify(cloneSeed()), new Date().toISOString())
      .run();

    row = await env.DB.prepare(
      'SELECT revision, state_json, updated_at FROM site_state WHERE id = ?'
    )
      .bind('main')
      .first();
  }

  try {
    return {
      revision: Number(row.revision),
      state: JSON.parse(row.state_json),
      updatedAt: row.updated_at,
    };
  } catch {
    return {
      revision: Number(row.revision),
      state: cloneSeed(),
      updatedAt: row.updated_at,
    };
  }
}

async function authenticate(request, env) {
  const userId = request.headers.get('oai-authenticated-user-id');
  const email = emailKey(request.headers.get('oai-authenticated-user-email'));
  if (!userId || !email) {
    return { error: 'ChatGPT hesabıyla giriş yapın.', status: 401 };
  }

  let { revision, state, updatedAt } = await loadState(env);
  const fullName = request.headers.get('oai-authenticated-user-full-name') || email;
  const ownerEmail = getOwnerEmail(env);

  if (email === ownerEmail && !state.users.some((u) => emailKey(u.email) === email)) {
    state.users.push({ name: fullName, email, role: 'Yönetici', active: true });
    const now = new Date().toISOString();
    const res = await env.DB.prepare(
      'UPDATE site_state SET state_json = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?'
    )
      .bind(JSON.stringify(state), now, 'main', revision)
      .run();

    if (!res.meta?.changes) {
      return { error: 'Giriş durumu değişti. Yeniden deneyin.', status: 409 };
    }
    revision += 1;
    updatedAt = now;
  }

  const user = state.users.find((u) => emailKey(u.email) === email && u.active === true);
  if (!user) {
    return {
      error: `${email} hesabı etkin kullanıcı listesinde değil. Site yöneticisine başvurun.`,
      status: 403,
    };
  }

  return {
    user: { name: user.name || fullName, email, role: user.role },
    revision,
    state,
    updatedAt,
    userId,
  };
}

function sanitizePedigree(p) {
  if (!p || typeof p !== 'object') return undefined;
  return {
    aissId: String(p.aissId || '').trim().slice(0, 60),
    fullId: String(p.fullId || '').trim().slice(0, 60),
    officialName: String(p.officialName || '').trim().slice(0, 200),
    sireId: String(p.sireId || '').trim().slice(0, 60),
    mgsId: String(p.mgsId || '').trim().slice(0, 60),
    damName: String(p.damName || '').trim().slice(0, 200),
    damId: String(p.damId || '').trim().slice(0, 60),
    source: String(p.source || '').trim().slice(0, 160),
  };
}

function sanitizeBull(b) {
  const out = {
    uid: String(b?.uid || '').trim().slice(0, 120),
    name: String(b?.name || '').trim().slice(0, 200),
    ear: String(b?.ear || '').trim().slice(0, 80),
    naab: String(b?.naab || '').trim().slice(0, 80),
    breed: String(b?.breed || '').trim().slice(0, 80),
    status: VALID_STATUSES.includes(b?.status)
      ? b.status
      : 'Kamuya açık kayıtta doğrulanamadı',
    defect: String(b?.defect || '').trim().slice(0, 120),
    codes: String(b?.codes || '').trim().slice(0, 300),
    attention: String(b?.attention || '').trim().slice(0, 400),
    source: String(b?.source || '').trim().slice(0, 200),
    evidence: String(b?.evidence || '').trim().slice(0, 1000),
    note: String(b?.note || '').trim().slice(0, 3000),
    group: String(b?.group || '').trim().slice(0, 80),
    country: String(b?.country || '').trim().slice(0, 80),
    importer: String(b?.importer || '').trim().slice(0, 200),
    doses: Number.isFinite(Number(b?.doses)) ? Math.max(0, Math.round(Number(b.doses))) : 0,
    dob: String(b?.dob || '').trim().slice(0, 20),
    betaCasein: String(b?.betaCasein || '').trim().slice(0, 20),
    kappaCasein: String(b?.kappaCasein || '').trim().slice(0, 20),
    tpi: String(b?.tpi || '').trim().slice(0, 20),
    nm: String(b?.nm || '').trim().slice(0, 20),
  };
  const ped = sanitizePedigree(b?.pedigree);
  if (ped) out.pedigree = ped;
  return out;
}

function sanitizeSource(s) {
  return {
    name: String(s?.name || '').trim().slice(0, 160),
    type: String(s?.type || '').trim().slice(0, 120),
    url: String(s?.url || '').trim().slice(0, 1000),
    template: String(s?.template || s?.url || '').trim().slice(0, 1000),
    note: String(s?.note || '').trim().slice(0, 500),
    active: Boolean(s?.active),
  };
}

function cleanState(s) {
  const pedIdx =
    s?.pedigreeIndex && typeof s.pedigreeIndex === 'object' && !Array.isArray(s.pedigreeIndex)
      ? s.pedigreeIndex
      : {};
  return {
    bulls: Array.isArray(s?.bulls) ? s.bulls.map(sanitizeBull) : [],
    pedigreeIndex: pedIdx,
    sources: Array.isArray(s?.sources) ? s.sources.map(sanitizeSource) : [],
    users: Array.isArray(s?.users) ? s.users : [],
    audit: Array.isArray(s?.audit) ? s.audit.slice(0, 2000) : [],
    legacyMigrationDone: Boolean(s?.legacyMigrationDone),
  };
}

function validateStateShape(s) {
  if (
    !s ||
    !Array.isArray(s.bulls) ||
    !Array.isArray(s.sources) ||
    !Array.isArray(s.users) ||
    !Array.isArray(s.audit)
  ) {
    return 'Kayıt yapısı geçersiz.';
  }
  if (s.bulls.length >= 25_000 || s.sources.length >= 500 || s.users.length >= 500) {
    return 'Kayıt sayısı üst sınırı aşıyor.';
  }
  for (const b of s.bulls) {
    if (!b?.name || !b?.breed || (!b?.ear && !b?.naab)) {
      return 'Boğa kaydında ad, ırk ve en az bir kimlik numarası zorunludur.';
    }
    if (!isSafeHttpUrl(b.evidence)) {
      return `Geçersiz kanıt URL protokolü: ${b.name}`;
    }
  }
  for (const src of s.sources) {
    if (!src?.name || !src?.url || !isSafeHttpUrl(src.url) || !isSafeHttpUrl(src.template)) {
      return `Geçersiz kaynak URL adresi: ${src?.name || 'adsız'}`;
    }
  }
  return null;
}

async function storeState(env, current, next, expectedRevision) {
  const isAdmin = current.user.role === 'Yönetici';
  const ownerEmail = getOwnerEmail(env);

  // Yönetici olmayan kullanıcılar mevcut kullanıcı listesini değiştiremez (gizlilik koruması)
  const finalState = {
    ...next,
    users: isAdmin ? next.users : current.state.users,
  };

  if (isAdmin) {
    const owner = finalState.users.find((u) => emailKey(u.email) === ownerEmail);
    if (!owner || owner.role !== 'Yönetici' || owner.active !== true) {
      return json({ error: 'Sistem yöneticisi silinemez veya pasifleştirilemez.' }, 400);
    }
    for (const u of finalState.users) {
      if (
        !u?.name ||
        !/^\S+@\S+\.\S+$/.test(String(u.email || '')) ||
        !ROLES.includes(u.role) ||
        typeof u.active !== 'boolean'
      ) {
        return json({ error: 'Kullanıcı kaydı geçersiz.' }, 400);
      }
    }
  }

  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    'UPDATE site_state SET state_json = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?'
  )
    .bind(JSON.stringify(finalState), now, 'main', expectedRevision)
    .run();

  if (!res.meta?.changes) {
    return json(
      {
        error: 'Kayıt başka kullanıcı tarafından güncellendi. Yenileyip tekrar deneyin.',
        currentRevision: current.revision,
      },
      409
    );
  }

  return json({ ok: true, revision: expectedRevision + 1, updatedAt: now });
}

// ---------------------------------------------------------------------------
// Saf JS ZIP Oluşturucu (UTF-8 dosya adı bayrağı 0x0800 ve gerçek DOS tarih/saat)
// ---------------------------------------------------------------------------
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

const u16 = (n) => [n & 255, (n >>> 8) & 255];
const u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

function joinBytes(parts) {
  const total = parts.reduce((acc, part) => acc + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getUTCFullYear());
  const dosDate = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  const dosTime =
    (date.getUTCHours() << 11) |
    (date.getUTCMinutes() << 5) |
    Math.floor(date.getUTCSeconds() / 2);
  return { dosDate, dosTime };
}

function buildZip(files) {
  const enc = new TextEncoder();
  const { dosDate, dosTime } = dosDateTime();
  const UTF8_FLAG = 0x0800;
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [path, content] of Object.entries(files)) {
    const name = enc.encode(path);
    const data = typeof content === 'string' ? enc.encode(content) : content;
    const crc = crc32(data);

    const local = joinBytes([
      new Uint8Array([
        0x50, 0x4b, 0x03, 0x04,
        ...u16(20),
        ...u16(UTF8_FLAG),
        ...u16(0),
        ...u16(dosTime),
        ...u16(dosDate),
        ...u32(crc),
        ...u32(data.length),
        ...u32(data.length),
        ...u16(name.length),
        ...u16(0),
      ]),
      name,
      data,
    ]);
    locals.push(local);

    const central = joinBytes([
      new Uint8Array([
        0x50, 0x4b, 0x01, 0x02,
        ...u16(20),
        ...u16(20),
        ...u16(UTF8_FLAG),
        ...u16(0),
        ...u16(dosTime),
        ...u16(dosDate),
        ...u32(crc),
        ...u32(data.length),
        ...u32(data.length),
        ...u16(name.length),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(offset),
      ]),
      name,
    ]);
    centrals.push(central);
    offset += local.length;
  }

  const centralBytes = joinBytes(centrals);
  const endRecord = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06,
    ...u16(0),
    ...u16(0),
    ...u16(centrals.length),
    ...u16(centrals.length),
    ...u32(centralBytes.length),
    ...u32(offset),
    ...u16(0),
  ]);

  return joinBytes([...locals, centralBytes, endRecord]);
}

async function importLocalStorage(request, env, current) {
  if (current.user.role !== 'Yönetici') {
    return json({ error: 'Yerel veri aktarımını yalnızca yönetici yapabilir.' }, 403);
  }
  const raw = await request.text();
  if (raw.length > MAX_PAYLOAD_BYTES) {
    return json({ error: 'Aktarım dosyası çok büyük.' }, 413);
  }

  let old;
  try {
    old = JSON.parse(raw);
  } catch {
    return json({ error: 'Yerel kayıt okunamadı.' }, 400);
  }

  const s = cleanState(current.state);
  const norm = (x) => String(x || '').toUpperCase().replace(/[\s().-]/g, '');
  const bullKey = (b) => `${norm(b.ear || b.naab)}|${norm(b.breed)}`;

  const bulls = new Map(s.bulls.map((b) => [bullKey(b), b]));
  for (const rawBull of Array.isArray(old.bulls) ? old.bulls : []) {
    const b = sanitizeBull(rawBull);
    if (b.name && b.breed && (b.ear || b.naab) && isSafeHttpUrl(b.evidence)) {
      bulls.set(bullKey(b), b);
    }
  }
  s.bulls = [...bulls.values()];

  const sources = new Map(s.sources.map((x) => [x.url, x]));
  for (const rawSrc of Array.isArray(old.sources) ? old.sources : []) {
    const src = sanitizeSource(rawSrc);
    if (src.name && src.url && isSafeHttpUrl(src.url) && isSafeHttpUrl(src.template)) {
      sources.set(src.url, src);
    }
  }
  s.sources = [...sources.values()];

  const ownerEmail = getOwnerEmail(env);
  const users = new Map(s.users.map((u) => [emailKey(u.email), u]));
  for (const u of Array.isArray(old.users) ? old.users : []) {
    const mail = emailKey(u?.email);
    if (u?.name && /^\S+@\S+\.\S+$/.test(mail) && mail !== ownerEmail) {
      users.set(mail, {
        name: String(u.name).trim(),
        email: mail,
        role: ROLES.includes(u.role) && u.role !== 'Yönetici' ? u.role : 'Görüntüleyici',
        active: Boolean(u.active),
      });
    }
  }
  s.users = [...users.values()];
  s.audit = [...(Array.isArray(old.audit) ? old.audit : []), ...s.audit].slice(0, 2000);
  s.legacyMigrationDone = true;

  return storeState(env, current, s, current.revision);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health' && request.method === 'GET') {
      try {
        const { revision, updatedAt } = await loadState(env);
        return json({ ok: true, revision, updatedAt });
      } catch {
        return json({ ok: false, error: 'Veri tabanı erişim hatası.' }, 503);
      }
    }

    if (url.pathname === '/api/backup.zip' && request.method === 'GET') {
      const a = await authenticate(request, env);
      if (a.error) return json({ error: a.error }, a.status);
      if (a.user.role !== 'Yönetici') {
        return json({ error: 'Yedek indirme yalnızca yöneticilere açık.' }, 403);
      }

      const exportedAt = new Date().toISOString();
      const state = cleanState(a.state);
      const fullRow = {
        id: 'main',
        revision: a.revision,
        state_json: JSON.stringify(state),
        updated_at: a.updatedAt || exportedAt,
      };
      const sqlPayload = JSON.stringify(state).replace(/'/g, "''");
      const files = {
        ...BACKUP_FILES,
        'database/current_state.json': JSON.stringify(
          { exported_at: exportedAt, revision: a.revision, state },
          null,
          2
        ),
        'database/site_state_row.json': JSON.stringify(fullRow, null, 2),
        'database/restore_site_state.sql': `INSERT OR REPLACE INTO site_state (id, revision, state_json, updated_at) VALUES ('main', ${a.revision}, '${sqlPayload}', '${exportedAt}');\n`,
        'README_TR.md': BACKUP_FILES['README_TR.md']
          .replace('{{EXPORTED_AT}}', exportedAt)
          .replace('{{BULL_COUNT}}', String(state.bulls.length))
          .replace('{{USER_COUNT}}', String(state.users.length)),
      };

      return new Response(buildZip(files), {
        headers: {
          ...SECURITY_HEADERS,
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="Boga_Genetik_Sorgu_Tam_Yedek_${exportedAt.slice(0, 10)}.zip"`,
          'Cache-Control': 'private, no-store',
        },
      });
    }

    if (url.pathname === '/api/session' && request.method === 'GET') {
      const a = await authenticate(request, env);
      if (a.error) return json({ error: a.error }, a.status);
      return json({
        user: a.user,
        legacyMigrationDone: Boolean(a.state.legacyMigrationDone),
      });
    }

    if (url.pathname === '/api/state' && request.method === 'GET') {
      const a = await authenticate(request, env);
      if (a.error) return json({ error: a.error }, a.status);
      const safe = cleanState(a.state);
      // Yönetici dışındaki rollerin diğer kullanıcıların e-posta listesini görmesini engelle
      if (a.user.role !== 'Yönetici') {
        safe.users = [];
      }
      return json({ state: safe, revision: a.revision, updatedAt: a.updatedAt });
    }

    if (url.pathname === '/api/state' && request.method === 'PUT') {
      const a = await authenticate(request, env);
      if (a.error) return json({ error: a.error }, a.status);
      if (!['Yönetici', 'Araştırmacı'].includes(a.user.role)) {
        return json({ error: 'Bu kullanıcı kayıt değiştiremez.' }, 403);
      }

      const raw = await request.text();
      if (raw.length > MAX_PAYLOAD_BYTES) {
        return json({ error: 'Gönderilen kayıt çok büyük.' }, 413);
      }

      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return json({ error: 'JSON okunamadı.' }, 400);
      }

      if (!Number.isInteger(body?.revision)) {
        return json({ error: 'Geçerli sürüm (revision) numarası gerekli.' }, 400);
      }

      const cleaned = cleanState(body.state);
      const validationError = validateStateShape(cleaned);
      if (validationError) {
        return json({ error: validationError }, 400);
      }

      return storeState(env, a, cleaned, body.revision);
    }

    if (url.pathname === '/api/migrate-local' && request.method === 'POST') {
      const a = await authenticate(request, env);
      if (a.error) return json({ error: a.error }, a.status);
      return importLocalStorage(request, env, a);
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'API yolu bulunamadı.' }, 404);
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(APP_HTML, {
        headers: {
          ...SECURITY_HEADERS,
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    return new Response('Not found', { status: 404, headers: SECURITY_HEADERS });
  },
};
