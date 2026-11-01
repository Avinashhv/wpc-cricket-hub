// Vercel serverless function — fetches PlayHQ team fixture page and returns clean fixture list
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url query param required' });

  let html;
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-AU,en;q=0.9'
      }
    });
    if (!resp.ok) return res.status(502).json({ error: `PlayHQ returned ${resp.status}` });
    html = await resp.text();
  } catch (e) {
    return res.status(502).json({ error: 'Could not fetch PlayHQ: ' + e.message });
  }

  // Extract Next.js page data
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return res.status(422).json({ error: 'Could not find __NEXT_DATA__ in PlayHQ page' });

  let pageProps;
  try {
    const nextData = JSON.parse(m[1]);
    pageProps = nextData?.props?.pageProps || {};
  } catch (e) {
    return res.status(422).json({ error: 'Could not parse PlayHQ data: ' + e.message });
  }

  // Walk the pageProps tree looking for arrays that look like fixtures
  const fixtures = extractFixtures(pageProps);
  if (!fixtures.length) {
    // Return raw keys for debugging
    return res.status(422).json({ error: 'No fixtures found', keys: Object.keys(pageProps) });
  }

  res.json({ ok: true, fixtures });
}

function extractFixtures(pageProps) {
  // PlayHQ stores fixtures in different shapes depending on page type.
  // Try known paths first, then do a deep search.

  const candidates = [
    pageProps?.teamSeasonFixtures,
    pageProps?.fixtures,
    pageProps?.rounds,
  ].filter(Boolean);

  // Deep search if nothing found at top level
  if (!candidates.length) deepCollect(pageProps, candidates);

  const fixtures = [];

  for (const candidate of candidates) {
    // Shape 1: array of round objects with .fixtures[] inside
    if (Array.isArray(candidate) && candidate[0]?.fixtures) {
      for (const round of candidate) {
        const roundNum = round.round ?? round.roundNumber ?? round.number;
        for (const f of (round.fixtures || [])) {
          const fx = parseFixture(f, roundNum);
          if (fx) fixtures.push(fx);
        }
      }
      if (fixtures.length) return fixtures;
    }
    // Shape 2: flat array of fixture objects
    if (Array.isArray(candidate) && candidate[0]?.startTime) {
      for (const f of candidate) {
        const fx = parseFixture(f, null);
        if (fx) fixtures.push(fx);
      }
      if (fixtures.length) return fixtures;
    }
    // Shape 3: object with .rounds[]
    if (candidate?.rounds) {
      for (const round of candidate.rounds) {
        const roundNum = round.round ?? round.roundNumber ?? round.number;
        for (const f of (round.fixtures || [])) {
          const fx = parseFixture(f, roundNum);
          if (fx) fixtures.push(fx);
        }
      }
      if (fixtures.length) return fixtures;
    }
  }

  return fixtures;
}

function deepCollect(obj, out, depth = 0) {
  if (depth > 6 || !obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    if (obj.length && (obj[0]?.startTime || obj[0]?.fixtures || obj[0]?.rounds)) {
      out.push(obj);
    }
    obj.forEach(v => deepCollect(v, out, depth + 1));
  } else {
    Object.values(obj).forEach(v => deepCollect(v, out, depth + 1));
  }
}

function parseFixture(f, roundNum) {
  if (!f || typeof f !== 'object') return null;

  // Extract start time
  const raw = f.startTime || f.dateTime || f.date || f.scheduledStartTime;
  if (!raw) return null;
  const dt = new Date(raw);
  if (isNaN(dt)) return null;

  // Round — may be on the fixture itself or passed in
  const round = roundNum
    ?? f.round?.number ?? f.round?.roundNumber ?? f.roundNumber ?? f.round;

  // Teams
  const home = f.homeTeam?.teamName || f.homeTeam?.name || f.home?.name || '';
  const away = f.awayTeam?.teamName || f.awayTeam?.name || f.away?.name || '';
  if (!home && !away) return null;

  // Venue
  const venue = f.venue?.name || f.venue?.displayName || f.ground?.name || '';

  // Date parts
  const dateStr = dt.toISOString().slice(0, 10); // YYYY-MM-DD
  const timeStr = dt.toISOString().slice(11, 16); // HH:MM UTC — caller converts

  return {
    round: round != null ? String(round) : null,
    date: dateStr,
    time: timeStr,
    venue,
    homeTeam: home,
    awayTeam: away,
    status: f.status || 'upcoming',
    id: f.id || f.fixtureId || null,
  };
}
