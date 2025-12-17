// /api/assets.js
import { sql } from '@vercel/postgres';
import { randomUUID } from 'node:crypto';

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      tur TEXT NOT NULL,
      model TEXT NOT NULL,
      seri TEXT NOT NULL,
      atanan TEXT,
      departman TEXT,
      durum TEXT,
      konum TEXT,
      tarih DATE,
      not TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
}

function requireAdmin(req, res) {
  const pass = (req.headers['x-admin-password'] || '').toString().trim();
  if (!process.env.ADMIN_PASSWORD || pass !== process.env.ADMIN_PASSWORD) {
    json(res, 401, { error: 'Yetkisiz işlem (şifre).' });
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  await ensureTable();

  if (req.method === 'GET') {
    const { rows } = await sql`
      SELECT * FROM assets
      ORDER BY (tarih IS NULL), tarih DESC, updated_at DESC;
    `;
    return json(res, 200, rows);
  }

  // JSON body parse
  let body = {};
  try {
    body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
  } catch {
    body = {};
  }

  if (req.method === 'POST') {
    if (!requireAdmin(req, res)) return;

    const id = (body.id || '').trim() || randomUUID();
    const tur = (body.tur || '').trim();
    const model = (body.model || '').trim();
    const seri = (body.seri || '').trim();

    if (!tur || !model || !seri) return json(res, 400, { error: 'tur/model/seri zorunlu.' });

    const atanan = (body.atanan || '').trim();
    const departman = (body.departman || '').trim();
    const durum = (body.durum || '').trim();
    const konum = (body.konum || '').trim();
    const tarih = body.tarih || null;
    const nott = (body.not || '').trim();

    const { rows } = await sql`
      INSERT INTO assets (id, tur, model, seri, atanan, departman, durum, konum, tarih, not)
      VALUES (${id}, ${tur}, ${model}, ${seri}, ${atanan}, ${departman}, ${durum}, ${konum}, ${tarih}, ${nott})
      ON CONFLICT (id) DO UPDATE SET
        tur = EXCLUDED.tur,
        model = EXCLUDED.model,
        seri = EXCLUDED.seri,
        atanan = EXCLUDED.atanan,
        departman = EXCLUDED.departman,
        durum = EXCLUDED.durum,
        konum = EXCLUDED.konum,
        tarih = EXCLUDED.tarih,
        not = EXCLUDED.not,
        updated_at = NOW()
      RETURNING *;
    `;
    return json(res, 200, rows[0]);
  }

  if (req.method === 'DELETE') {
    if (!requireAdmin(req, res)) return;

    // tek kayıt silme
    const id = (req.query?.id || body.id || '').toString().trim();
    if (!id) return json(res, 400, { error: 'id gerekli.' });

    await sql`DELETE FROM assets WHERE id = ${id};`;
    return json(res, 200, { ok: true });
  }

  res.statusCode = 405;
  res.end('Method Not Allowed');
}
