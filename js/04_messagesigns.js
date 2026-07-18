// 04_messagesigns.js — DelDOT DMS/VMS fetching, matching, banner + speech
// Part of the DE Traffic app; loaded as a classic (non-module) script so it
// shares top-level `let`/`const` scope with the other js/*.js files.

// ---------- DMS message signs ----------
// DelDOT's TMC feed is plain public JSON — no token, no account, no proxy
// needed (cleanest of the four states done so far). Messages use HTML
// <br/> tags for line/page breaks rather than NTCIP markup, so no
// decoding step is needed either — just strip/convert the tags.
async function fetchMessageSignsIfNeeded() {
  const now = Date.now();
  if (now - lastMsgSignFetch < MSG_SIGN_POLL_MS) return;
  lastMsgSignFetch = now;
  if (!MSG_SIGN_URL) {
    setDebug({ messageSigns: 'MSG_SIGN_URL not configured' });
    return;
  }
  try {
    const resp = await fetch(MSG_SIGN_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    // Feed groups signs by type ({ signTypes: [{ name: "VMS", signs: [...] }] })
    // — flatten them all into one list (there's only been a "VMS" type
    // observed so far, but this doesn't assume that stays true).
    const allSigns = (json.signTypes || []).flatMap(t => t.signs || []);
    messageSigns = parseDeDmsSigns(allSigns);
  } catch (err) {
    setDebug({ messageSigns: `fetch failed: ${err.message}` });
  }
}

// ---------- DelDOT DMS JSON parsing ----------
// DelDOT gives no separate roadway/direction fields for signs — both come
// out of the free-text "title" field, e.g. "DE 1 @ NORTH OF THOMPSONVILLE"
// or "US 301 NORTHBOUND @ SOUTH OF B". Unlike MD's titles, DE's often
// spell direction out explicitly (full word or NB/SB/EB/WB), which is a
// nice bonus when present — but not guaranteed on every sign, so this
// still degrades to "no direction known" gracefully when absent.
const DE_DMS_DIR_WORDS = {
  NORTHBOUND: 'Northbound', SOUTHBOUND: 'Southbound', EASTBOUND: 'Eastbound', WESTBOUND: 'Westbound',
  NB: 'Northbound', SB: 'Southbound', EB: 'Eastbound', WB: 'Westbound',
};

// Manual lookup by permit — DE's title field frequently omits direction
// entirely (confirmed real: "I 495 @ 12TH STREET EXIT" for a sign that's
// actually southbound-specific, no NB/SB/etc. anywhere in the text). With
// only ~23 VMS signs statewide, a hand-maintained map is more reliable
// than guessing from geometry (which would need real road-shape data we
// don't currently fetch, plus untested left/right-of-centerline math —
// a bigger, riskier feature for a driving app to get subtly wrong).
// Checked FIRST, before title-text parsing, since it's authoritative when
// present. Complete set — all 23 DE VMS signs statewide, confirmed
// manually. If DelDOT ever adds a new sign, unlisted permits just fall
// through to the (often unsuccessful) title parse below, same as before —
// unlisted permits just fall through to the (often unsuccessful) title
// parse below, same as before.
const DE_VMS_PERMIT_DIRECTIONS = {
  KVMS001: 'Southbound', // "DE 1 @ NORTH OF THOMPSONVILLE"
  KVMS002: 'Northbound', // "DE 1 @ DE 9"
  KVMS003: 'Southbound', // "DE 1 @ 0.84 MILES SOUTH OFF NORTH FREDERICA INTERCHANGE"
  KVMS004: 'Northbound', // "DE 1 @ 0.62 MILES NORTH OFF OLD CEMETERY ROAD"
  KVMS006: 'Southbound', // "DE 1 SB @ 1/2 MILE NORTH OF BO"
  NVMS001: 'Northbound', // "DE 72 @ DE 1 SB OFF RAMP"
  NVMS002: 'Northbound', // "I 95 @ DE 896 INTERCHANGE NB"
  NVMS003: 'Northbound', // "I 95 @ CHURCHMANS OFF RAMP"
  NVMS004: 'Southbound', // "I 95 @ NORTH OF PA STATE LINE"
  NVMS006: 'Northbound', // "I 495 @ US 13 - SOUTHERN INTERCHANGE"
  NVMS007: 'Southbound', // "I 495 @ 12TH STREET EXIT"
  NVMS008: 'Southbound', // "I 95 @ EAST OF CHURCHMANS ROAD IN MARSH AREA"
  NVMS010: 'Southbound', // "DE 1 SB @ KIRKWOOD ST GEORGES"
  NVMS011: 'Northbound', // "US 301 NORTHBOUND @ SOUTH OF B"
  NVMS012: 'Southbound', // "I 95 SB @ STONEY CREEK"
  NVMS013: 'Southbound', // "I 495 SB @ SUNSET DRIVE"
  NVMS017: 'Northbound', // "SR 1 NB @ NORTH OF BEAR RD RAM"
  NVMS018: 'Northbound', // "SR 1 NB @ NORTH OF US 40"
  NVMS019: 'Northbound', // "I 95 NB @ SOUTH OF DE 1"
  SVMS001: 'Northbound', // "DE 1 @ JOHNSON RD"
  SVMS004: 'Southbound', // "US 113 SOUTHBOUND @ SOUTH OF A"
  SVMS005: 'Northbound', // "US 113 NORTHBOUND @ NORTH OLD"
  SVMS009: 'Northbound', // "DE 1 @ OAKWOOD ST"
};

function parseDeDmsLocation(title, permit) {
  if (!title) return { roadway: null, direction: null };
  const t = title.toUpperCase();
  const roadway = normalizeHighwayName(t);
  const permitDirection = permit ? DE_VMS_PERMIT_DIRECTIONS[permit.toUpperCase()] : null;
  if (permitDirection) return { roadway, direction: permitDirection };
  const dirMatch = t.match(/\b(NORTHBOUND|SOUTHBOUND|EASTBOUND|WESTBOUND|NB|SB|EB|WB)\b/);
  const direction = dirMatch ? DE_DMS_DIR_WORDS[dirMatch[1]] : null;
  return { roadway, direction };
}

// Messages come as e.g. "MOVE OVER<br/>OR<br/>SLOW DOWN<br/>---------<br/>FOR<br/>STOPPED<br/>VEHICLES"
// — <br/> tags mark line/page breaks (converted to spaces for the banner),
// the "---------" divider marks a page boundary (also just a space here),
// and any other tag is stripped defensively even though none have been
// observed in samples so far.
function stripDeMessageHtml(raw) {
  if (!raw) return '';
  let text = raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/-{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // DelDOT's standard statewide "Move Over" safety message comes through
  // with zero separators between words on some signs (their source data
  // itself concatenates them — this isn't something the HTML-stripping
  // above can recover, since there's no delimiter there to begin with),
  // e.g. "MOVE OVERORSLOW DOWN...FORSTOPPEDVEHICLES" instead of
  // "MOVE OVER OR SLOW DOWN...FOR STOPPED VEHICLES". Targeted fix for
  // this one specific recurring canned message, since it shows up often —
  // won't help with other messages that have the same concatenation issue
  // if any exist, since there's no general way to guess word boundaries
  // in arbitrary squished text.
  text = text
    .replace(/\bMOVE OVERORSLOW DOWN\b/i, 'MOVE OVER OR SLOW DOWN')
    .replace(/\bFORSTOPPEDVEHICLES\b/i, 'FOR STOPPED VEHICLES');

  return text;
}

function parseDeDmsSigns(records) {
  const parsed = records
    .map(r => {
      const lat = Number(r.lat);
      const lon = Number(r.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const { roadway, direction } = parseDeDmsLocation(r.title, r.permit);
      const msgText = stripDeMessageHtml(r.message);
      return {
        Id: r.permit || r.systemId,
        Name: r.title,
        Roadway: roadway,
        DirectionOfTravel: direction,
        Latitude: lat,
        Longitude: lon,
        Messages: msgText ? [msgText] : ['NO_MESSAGE'],
        enable: r.enable, // kept for debugging, not used for matching
      };
    })
    .filter(s => s !== null && s.enable !== false);

  setDebug({
    dmsRecordCount: records.length,
    dmsParsedCount: parsed.length,
    dmsWithMessages: parsed.filter(s => s.Messages[0] !== 'NO_MESSAGE').length,
    dmsSample: parsed.filter(s => s.Messages[0] !== 'NO_MESSAGE').slice(0, 3),
  });

  return parsed;
}

// Fallback for the (probably rare, given DE's titles often already spell
// direction out) case where a sign's title has no NORTHBOUND/NB-style
// token at all — same trailing-letter/whole-word check used elsewhere.
function directionFromSignId(s) {
  const map = { N: 'Northbound', S: 'Southbound', E: 'Eastbound', W: 'Westbound' };
  if (typeof s.Name !== 'string') return null;
  const name = s.Name.trim();
  const wordMatch = /\b(North|South|East|West)\b/i.exec(name);
  if (wordMatch) return map[wordMatch[1][0].toUpperCase()];
  const letterMatch = /([NSEW])\s*[)\]]*\s*$/i.exec(name);
  return letterMatch ? map[letterMatch[1].toUpperCase()] : null;
}

// Extracted from the old inline dirMatches()/roadway-check so both the
// live "closest sign" pick and manual ahead/behind browsing use the exact
// same eligibility rules — otherwise browsing could show a sign live
// detection would never have picked (or vice versa), which would be a
// confusing inconsistency.
function messageSignDirMatches(s) {
  if (!highwayDirectionLabel) return false; // our own direction isn't known yet — can't confirm
                                              // a directional sign applies to us, so don't show it
  const signDir = s.DirectionOfTravel;
  if (signDir && signDir !== 'None' && signDir !== 'Unknown') {
    if (signDir === 'All Directions' || signDir === 'Both Directions') return true;
    return signDir === highwayDirectionLabel;
  }
  // DirectionOfTravel is missing/None/Unknown — fall back to the sign ID's
  // trailing N/S/E/W letter instead of refusing to show the sign at all.
  const inferred = directionFromSignId(s);
  return inferred ? inferred === highwayDirectionLabel : false;
}

function messageSignRoadwayMatches(s) {
  return currentHighway.some(h => (s.Roadway || '').toUpperCase().includes(h.replace('-', ''))
    || (s.Roadway || '').toUpperCase().includes(h));
}

// Direction+roadway-filtered, signed-distance-scored, sorted-nearest-first
// list of active (non-blank) message signs — shared basis for both the
// live "closest" pick and manual browsing. minDist/maxDist let callers use
// a tight window (live: a small negative buffer so a sign doesn't vanish
// the instant you pass it) or the full symmetric range (browsing: can page
// backward the same distance it can page forward), mirroring
// getScoredCameras() in 05_cameras.js.
function getScoredMessageSigns(lat, lon, minDist, maxDist) {
  if (!messageSigns.length || !currentHighway || !currentHighway.length || !highwayDirectionLabel) return [];

  return messageSigns
    .filter(s => s.Messages && s.Messages.length && s.Messages[0] !== 'NO_MESSAGE')
    .filter(messageSignDirMatches)
    .filter(messageSignRoadwayMatches)
    .map(s => {
      const straightDist = haversineMeters(lat, lon, s.Latitude, s.Longitude);
      const bearingToSign = bearingDeg(lat, lon, s.Latitude, s.Longitude);
      const dist = lastStableBearing === null
        ? straightDist
        : straightDist * Math.cos(toRad(angleDiff(bearingToSign, lastStableBearing)));
      return { sign: s, dist };
    })
    .filter(c => c.dist >= minDist && c.dist <= maxDist)
    .sort((a, b) => a.dist - b.dist);
}

function pickActiveMessageSign(lat, lon) {
  if (!messageSigns.length || !currentHighway || !currentHighway.length) return null;

  if (highwayDirectionLabel) {
    const nearbyForDebug = messageSigns
      .filter(s => s.Messages && s.Messages.length && s.Messages[0] !== 'NO_MESSAGE')
      .map(s => ({ s, dist: haversineMeters(lat, lon, s.Latitude, s.Longitude) }))
      .filter(x => x.dist <= MSG_SIGN_RANGE_M)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 5)
      .map(x => ({
        raw: x.s, // full object — check this if the field name assumptions above are wrong
        Roadway: x.s.Roadway,
        DirectionOfTravel: x.s.DirectionOfTravel,
        inferredDirection: directionFromSignId(x.s),
        dirMatched: messageSignDirMatches(x.s),
        roadwayMatched: messageSignRoadwayMatches(x.s),
        distMi: Math.round(x.dist / 160.934) / 10,
      }));
    if (nearbyForDebug.length) {
      console.log('[DMS debug] our direction:', highwayDirectionLabel, 'currentHighway:', currentHighway, nearbyForDebug);
    }
  }

  const scored = getScoredMessageSigns(lat, lon, -SWAP_BUFFER_M, MSG_SIGN_RANGE_M);
  return scored.length ? scored[0] : null;
}

// ---------- Manual ahead/behind DMS browsing ----------
// Lets you page through message signs further out than the live nearest
// match, without changing what the live auto-detected banner (and its
// one-time speech) shows — mirrors the camera browse pattern in
// 06_browse.js. Snapshots the sign list at the moment you first press a
// button (using your last known position), then Ahead/Behind just walk an
// index through that snapshot. Only ever includes signs with an active
// message (a page full of "no message" signs would be clutter, not
// information) and stays direction-filtered, same eligibility rules as
// live detection via getScoredMessageSigns() above.
let msgBrowseActive = false;
let msgBrowseList = [];
let msgBrowseIndex = 0;

function enterMsgBrowseIfNeeded() {
  if (msgBrowseActive || !lastKnownPos) return false;
  // Uses BROWSE_RANGE_M (same ~50mi range camera browsing uses) rather
  // than the tighter MSG_SIGN_RANGE_M live-detection radius — browsing
  // should be able to scan as far ahead as camera browsing does; live
  // auto-detection stays at its original tighter range so a random sign
  // 50 miles out doesn't trigger the live banner/speech.
  const list = getScoredMessageSigns(lastKnownPos.lat, lastKnownPos.lon, -BROWSE_RANGE_M, BROWSE_RANGE_M);
  if (!list.length) return false;
  // Start browsing from whichever sign is currently closest to your actual
  // position, so the first tap moves logically forward/back from where
  // you already are rather than jumping to the list's edge.
  let closestIdx = 0, closestAbs = Infinity;
  list.forEach((s, i) => { const a = Math.abs(s.dist); if (a < closestAbs) { closestAbs = a; closestIdx = i; } });
  msgBrowseList = list;
  msgBrowseIndex = closestIdx;
  msgBrowseActive = true;
  return true;
}

function moveMsgAhead() {
  const justEntered = enterMsgBrowseIfNeeded();
  if (!msgBrowseActive) return;
  if (!justEntered) msgBrowseIndex = Math.min(msgBrowseIndex + 1, Math.max(0, msgBrowseList.length - 1));
  updateMessageBanner(lastKnownPos.lat, lastKnownPos.lon);
}

function moveMsgBehind() {
  const justEntered = enterMsgBrowseIfNeeded();
  if (!msgBrowseActive) return;
  if (!justEntered) msgBrowseIndex = Math.max(msgBrowseIndex - 1, 0);
  updateMessageBanner(lastKnownPos.lat, lastKnownPos.lon);
}

function exitMsgBrowse() {
  msgBrowseActive = false;
  msgBrowseList = [];
  msgBrowseIndex = 0;
  if (lastKnownPos) updateMessageBanner(lastKnownPos.lat, lastKnownPos.lon);
}

// Shows/hides the small ◀ Closest ▶ controls row. Kept deliberately
// minimal (mobile real estate) — hidden entirely unless there's at least
// one sign to browse to, so it adds zero footprint on quiet stretches of
// highway. The middle button is a static "Closest" label that returns to
// live tracking, matching the camera scan bar's "Closest Cam" button.
function renderMessageBrowseControls(hasBrowsableSigns) {
  const controls = document.getElementById('msg-scan-controls');
  if (!controls) return; // markup not present — degrade silently rather than throw
  const counter = document.getElementById('msg-scan-counter-btn');
  const behindBtn = document.getElementById('msg-scan-behind-btn');
  const aheadBtn = document.getElementById('msg-scan-ahead-btn');

  if (!hasBrowsableSigns && !msgBrowseActive) {
    controls.style.display = 'none';
    return;
  }
  controls.style.display = '';
  counter.textContent = 'Closest';
  counter.classList.toggle('active', msgBrowseActive);
  if (msgBrowseActive) {
    behindBtn.disabled = msgBrowseIndex <= 0;
    aheadBtn.disabled = msgBrowseIndex >= msgBrowseList.length - 1;
  } else {
    behindBtn.disabled = false; // live mode's arrows always just START browsing from here
    aheadBtn.disabled = false;
  }
}

function speakMessage(text) {
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel(); // don't stack overlapping announcements
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.95;
    window.speechSynthesis.speak(utter);
  } catch (err) {
    console.warn('Speech synthesis failed:', err);
  }
}

async function updateMessageBanner(lat, lon) {
  await fetchMessageSignsIfNeeded();

  const contentEl = document.getElementById('msg-banner-content') || msgBannerEl;

  let active, isLive, hasBrowsableSigns;
  if (msgBrowseActive) {
    active = msgBrowseList[msgBrowseIndex] || null;
    isLive = false;
    hasBrowsableSigns = msgBrowseList.length > 0;
  } else {
    active = pickActiveMessageSign(lat, lon);
    isLive = true;
    hasBrowsableSigns = getScoredMessageSigns(lat, lon, -BROWSE_RANGE_M, BROWSE_RANGE_M).length > 0;
  }

  renderMessageBrowseControls(hasBrowsableSigns);

  if (!active) {
    msgBannerEl.style.display = 'none';
    if (isLive) activeSignId = null;
    return;
  }

  const msgText = active.sign.Messages.join(' • ');
  contentEl.innerHTML = '';
  const main = document.createElement('div');
  main.textContent = msgText;
  const meta = document.createElement('span');
  meta.className = 'msg-meta';
  meta.textContent = isLive
    ? `${formatDistance(Math.max(0, active.dist))} ahead`
    : `${formatDistance(Math.abs(active.dist))} ${active.dist >= 0 ? 'ahead' : 'behind'}`;
  contentEl.appendChild(main);
  contentEl.appendChild(meta);
  msgBannerEl.style.display = 'block';

  if (isLive) {
    const signKey = active.sign.Id + '::' + msgText;
    if (signKey !== activeSignId && msgText !== lastSpokenMessage) {
      speakMessage(msgText);
      lastSpokenMessage = msgText;
    }
    activeSignId = signKey;
  }
}
