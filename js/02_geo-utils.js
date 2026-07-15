// 02_geo-utils.js — Generic geo math helpers, highway-name normalization, camera list loading
// Part of the DE Traffic app; loaded as a classic (non-module) script so it
// shares top-level `let`/`const` scope with the other js/*.js files.

// ---------- Geo helpers ----------
function toRad(d) { return d * Math.PI / 180; }
function toDeg(r) { return r * 180 / Math.PI; }

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function angleDiff(a, b) {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function bearingToCompassLabel(bearing) {
  // Map to the 4 cardinal "of travel" labels most state DOT feeds use.
  if (bearing >= 315 || bearing < 45) return 'Northbound';
  if (bearing >= 45 && bearing < 135) return 'Eastbound';
  if (bearing >= 135 && bearing < 225) return 'Southbound';
  return 'Westbound';
}

// ---------- Highway name normalization ----------
function formatDistance(meters) {
  const miles = meters / 1609.34;
  return `${miles.toFixed(1)} mi`;
}

function normalizeHighwayName(raw) {
  if (!raw) return null;
  const s = raw.toUpperCase().trim();
  // Interstate: "I-40", "I 40", "Interstate 40" (DelDOT's own titles use "I 95", no hyphen)
  let m = s.match(/\bI[-\s]?(\d+)\b/) || s.match(/INTERSTATE\s+(\d+)/);
  if (m) return `I-${m[1]}`;
  // US Highway: "US-13", "US 13", "US Highway 13"
  m = s.match(/\bUS[-\s]?(\d+)\b/);
  if (m) return `US-${m[1]}`;
  // DE Highway: "DE-1", "DE 1" (DelDOT also occasionally uses "SR 1" for the
  // same road — the state route is literally signed "Delaware 1"/"SR 1"
  // interchangeably in different DelDOT sources, e.g. VMS titles use "SR 1"
  // while camera titles use "DE 1")
  m = s.match(/\bDE[-\s]?(\d+)\b/) || s.match(/\bSR[-\s]?(\d+)\b/);
  if (m) return `DE-${m[1]}`;
  // No route-number pattern matched (e.g. a local street name) — fall back
  // to the literal name, uppercased/trimmed.
  return s;
}

// ---------- Load static camera list ----------
// DelDOT's TMC feed is a flat top-level array (videoCameras), not wrapped
// like MD's — and unlike every other state so far, it hands us a
// ready-to-use HLS URL directly (urls.m3u8s), no stream-URL construction
// needed. The "roadway" isn't a separate field though — it's embedded in
// the free-text title (e.g. "I 95 @ DE 141 (ON RAMP)"), so we pull it out
// with normalizeHighwayName the same way VA's sign titles were parsed.
async function loadCameras() {
  try {
    const resp = await fetch(CAMERAS_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    const records = json.videoCameras || [];

    allCameras = records
      .filter(c => c.enabled !== false && c.status !== 'Unavailable')
      .map(c => {
        const lat = Number(c.lat);
        const lon = Number(c.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        const streamUrl = c.urls && (c.urls.m3u8s || c.urls.m3u8);
        if (!streamUrl) return null;
        return {
          id: c.id,
          lat, lon,
          roadway: normalizeHighwayName(c.title) || '',
          direction: '', // not a separate field — embedded (inconsistently) in title text, not reliable enough to parse out
          location: c.title || '',
          videoUrl: streamUrl, // ready-to-use HLS — no construction needed, unlike MD/VA
        };
      })
      .filter(c => c !== null);

    console.log(`Loaded ${allCameras.length} DE cameras.`);
  } catch (err) {
    // Camera load failing (CORS block, network error, endpoint down, etc.)
    // must NOT stop the rest of the app from starting — init() awaits this
    // function, so an uncaught throw here would silently kill GPS watching
    // and the simulation button along with it. Fail loud in the debug
    // panel instead, and keep going with an empty camera list.
    allCameras = [];
    setDebug({ camerasLoadError: err.message });
    console.error('Failed to load DE cameras:', err);
  }
}
