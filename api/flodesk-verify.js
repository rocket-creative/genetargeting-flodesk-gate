// api/flodesk-verify.js
// Node 18+ on Vercel (global fetch available)

module.exports = async (req, res) => {
  // --- CORS (required since Webflow and Vercel are different domains) ---
  res.setHeader('Access-Control-Allow-Origin', 'https://www.genetargeting.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST for actual work
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    // Parse body (Vercel gives parsed JSON in req.body)
    const { email } = req.body || {};
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'invalid_email' });
    }

    // Secrets from Vercel → Project → Settings → Environment Variables
    const apiKey = process.env.FLODESK_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ ok: false, error: 'missing_api_key' });
    }

    const requiredSegmentId = process.env.FLODESK_REQUIRED_SEGMENT_ID || null;

    // Flodesk: GET /v1/subscribers/{id_or_email}
    const url = `https://api.flodesk.com/v1/subscribers/${encodeURIComponent(email)}`;

    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64'),
        'Accept': 'application/json',
        'User-Agent': 'GT-Webhook/1.0'
      }
    });

    // Not found
    if (resp.status === 404) {
      return res.status(200).json({ ok: false, reason: 'not_found' });
    }

    // Other errors
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      return res.status(resp.status).json({ ok: false, error: 'flodesk_error', detail: t });
    }

    const data = await resp.json();
    const status = String(data?.status || '').toLowerCase(); // active, unsubscribed, etc.
    const segments = Array.isArray(data?.segments) ? data.segments.map(s => s.id) : [];

    const isActive = status === 'active';
    const inRequiredSegment = requiredSegmentId ? segments.includes(requiredSegmentId) : true;
    const allowed = isActive && inRequiredSegment;

    return res.status(200).json({
      ok: allowed,
      status,
      inRequiredSegment,
      reason: allowed ? 'authorized' : (isActive ? 'missing_segment' : 'inactive')
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server_error', detail: String(err?.message || err) });
  }
};
