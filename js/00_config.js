// 00_config.js — Configuration constants (Overpass, camera feed, DMS, tuning params)
// Part of the DE Traffic app; loaded as a classic (non-module) script so it
// shares top-level `let`/`const` scope with the other js/*.js files.

// ---------- Config ----------
// DelDOT's own live TMC feed — the same one their traffic map calls.
// Public, unauthenticated JSON, and (unlike MD/VA) CORS-friendly enough to
// call directly from a browser on a different origin — no proxy needed.
// Comes with ready-to-use HLS URLs built in (urls.m3u8s), so no separate
// stream-URL construction step either. The "?id=4yte" param some captured
// requests included turned out unnecessary — dropped here since a static
// key baked into someone else's frontend JS isn't something to depend on.
const CAMERAS_URL = 'https://tmc.deldot.gov/json/videocamera.json';
const MIN_DISPLACEMENT_M = 40;     // min movement before recomputing bearing
const BEARING_DISAGREE_DEG = 45;   // how much new bearing must differ to challenge current direction
const BEARING_CONFIRM_COUNT = 2;   // consecutive disagreeing samples needed to flip direction
const HIGHWAY_RECHECK_MS = 6000;   // re-run highway snap at most this often (base rate — backs off on repeated failures, see overpassFailStreak in 01_state.js)
const HIGHWAY_RECHECK_MAX_MS = 90000; // cap for the exponential backoff below, so we never go longer than 90s between attempts even during a sustained outage/rate-limit
const HIGHWAY_CONFIRM_COUNT = 2;   // consecutive matching reads needed before switching displayed highway
const MAX_SEARCH_DIST_M = 24140.2; // ~15 miles — cameras farther than this on your highway are ignored
const SWAP_BUFFER_M = 402.336;     // 1320 ft (1/4 mile) — a camera stays the displayed
                                    // "nearest"/"next" camera, counting down through negative
                                    // distance, until it's this far behind you
const BROWSE_RANGE_M = 80467;      // ~50 miles — how far the manual ahead/behind scan can look
const MANIFEST_TIMEOUT_MS = 12000; // if a stream hasn't started playing within this long, treat as stalled
const MAX_STREAM_RETRIES = 3;      // automatic retry attempts before showing a manual "tap to retry" button

// ---- Mile marker lookup ----
// DelDOT's Milemarkers layer ("comes directly from TSDM", their roadway
// asset system, so it's a real operational dataset, not a stale one-off
// export). Field names are unconfirmed against live sample data (the
// query endpoint only returns an empty form when fetched non-interactively
// — same issue hit with MD initially), so this is built from the schema's
// field aliases and is defensive/debuggable if wrong: see
// parseDeMilemarker() in 03_highway.js and check the Debug panel's
// sampleRouteAttrs if mileposts don't show up correctly.
const MILEMARKER_QUERY_URL = 'https://enterprise.firstmap.delaware.gov/arcgis/rest/services/Transportation/DE_Assets/FeatureServer/6/query';
const MILEMARKER_SEARCH_RADIUS_M = 900;  // ~0.56mi — wide enough to bracket the two nearest signs
const MILEMARKER_RECHECK_MS = 8000;      // how often we re-query for the current milepost

// ---- Highway shield images (Wikipedia / Wikimedia Commons) ----
// Special:FilePath redirects straight to the file, so it works as a plain
// <img src> with no API key or CORS preflight needed. We try a short list
// of likely filenames per route type and fall back silently if none load.
const COMMONS_FILEPATH = 'https://commons.wikimedia.org/wiki/Special:FilePath/';

// ---- DelDOT message signs (DMS/VMS) ----
// Same TMC feed family as cameras above — public, unauthenticated, no
// proxy needed. message field uses HTML <br/> tags for line breaks
// (converted to spaces in 04_messagesigns.js) rather than NTCIP markup, so
// no decoding step needed either — this is the cleanest DMS source of the
// four states done so far.
const MSG_SIGN_URL = 'https://tmc.deldot.gov/json/vmsg-vms.json';
const MSG_SIGN_RANGE_M = 16093.4;   // 10 miles
const MSG_SIGN_POLL_MS = 30000;     // re-poll signs this often so a sign 10mi out
                                     // can't silently change message before we reach it
