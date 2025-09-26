// api/flodesk-verify.js
// Vercel Node 18+

module.exports = async (req, res) => {
  // CORS for Webflow domain
  res.setHeader('Access-Control-Allow-Origin', 'https://www.genetargeting.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  try {
    let { email } = req.body || {};
    email = (email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'invalid_email' });
    }

    const apiKey = process.env.FLODESK_API_KEY;
    if (!apiKey) return res.status(500).json({ ok: false, error: 'missing_api_key' });

    const requiredSegmentId = process.env.FLODESK_REQUIRED_SEGMENT_ID || null;
    const debug = { tried: [] };

    async function call(pathEmail, encode, mode /*'basic'|'api-key'*/) {
      const id = encode ? encodeURIComponent(pathEmail) : pathEmail;
      const url = `https://api.flodesk.com/v1/subscribers/${id}`;
      const headers = {
        'Accept': 'application/json',
        'User-Agent': 'GT-Webhook/1.0'
      };
      if (mode === 'api-key') {
        headers['Authorization'] = `Api-Key ${apiKey}`;
      } else {
        headers['Authorization'] = 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64');
      }
      const resp = await fetch(url, { method: 'GET', headers });
      debug.tried.push({ url, encode, mode, status: resp.status });
      return resp;
    }

    // 1) literal + Basic
    let resp = await call(email, false, 'basic');

    // 2) encoded + Basic if 404
    if (resp.status === 404) resp = await call(email, true, 'basic');

    // 3) try Api-Key auth if 401/403
    if (resp.status === 401 || resp.status === 403) {
      resp = await call(email, false, 'api-key');
      if (resp.status === 404) resp = await call(email, true, 'api-key');
    }

    if (resp.status === 404) {
      return res.status(200).json({ ok: false, reason: 'not_found', debug });
    }
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      return res.status(resp.status).json({ ok: false, error: 'flodesk_error', detail, debug });
    }

    const data = await resp.json();
    const status = String(data?.status || '').toLowerCase();
    const segments = Array.isArray(data?.segments) ? data.segments.map(s => s.id) : [];
    const isActive = status === 'active';
    const inRequiredSegment = requiredSegmentId ? segments.includes(requiredSegmentId) : true;
    const allowed = isActive && inRequiredSegment;

    return res.status(200).json({
      ok: allowed,
      status,
      inRequiredSegment,
      reason: allowed ? 'authorized' : (isActive ? 'missing_segment' : (status ? 'inactive' : 'not_found')),
      debug
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server_error', detail: String(err?.message || err) });
  }
};
