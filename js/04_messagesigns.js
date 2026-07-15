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

function parseDeDmsLocation(title) {
  if (!title) return { roadway: null, direction: null };
  const t = title.toUpperCase();
  const roadway = normalizeHighwayName(t);
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
  return raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/-{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDeDmsSigns(records) {
  const parsed = records
    .map(r => {
      const lat = Number(r.lat);
      const lon = Number(r.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const { roadway, direction } = parseDeDmsLocation(r.title);
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

function pickActiveMessageSign(lat, lon) {
  if (!messageSigns.length || !currentHighway || !currentHighway.length) return null;

  const dirMatches = (s) => {
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
  };

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
        dirMatched: dirMatches(x.s),
        roadwayMatched: currentHighway.some(h => (x.s.Roadway || '').toUpperCase().includes(h.replace('-', ''))
          || (x.s.Roadway || '').toUpperCase().includes(h)),
        distMi: Math.round(x.dist / 160.934) / 10,
      }));
    if (nearbyForDebug.length) {
      console.log('[DMS debug] our direction:', highwayDirectionLabel, 'currentHighway:', currentHighway, nearbyForDebug);
    }
  }

  const candidates = messageSigns
    .filter(s => s.Messages && s.Messages.length && s.Messages[0] !== 'NO_MESSAGE')
    .filter(s => dirMatches(s))
    .filter(s => currentHighway.some(h => (s.Roadway || '').toUpperCase().includes(h.replace('-', ''))
      || (s.Roadway || '').toUpperCase().includes(h)))
    .map(s => {
      const straightDist = haversineMeters(lat, lon, s.Latitude, s.Longitude);
      const bearingToSign = bearingDeg(lat, lon, s.Latitude, s.Longitude);
      const dist = lastStableBearing === null
        ? straightDist
        : straightDist * Math.cos(toRad(angleDiff(bearingToSign, lastStableBearing)));
      return { sign: s, dist };
    })
    .filter(c => c.dist >= -SWAP_BUFFER_M && c.dist <= MSG_SIGN_RANGE_M);

  candidates.sort((a, b) => a.dist - b.dist);
  return candidates.length ? candidates[0] : null;
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
  const active = pickActiveMessageSign(lat, lon);

  if (!active) {
    msgBannerEl.style.display = 'none';
    activeSignId = null;
    return;
  }

  const msgText = active.sign.Messages.join(' • ');
  msgBannerEl.innerHTML = '';
  const main = document.createElement('div');
  main.textContent = msgText;
  const meta = document.createElement('span');
  meta.className = 'msg-meta';
  meta.textContent = `${formatDistance(Math.max(0, active.dist))} ahead`;
  msgBannerEl.appendChild(main);
  msgBannerEl.appendChild(meta);
  msgBannerEl.style.display = 'block';

  // Speak only when this is a genuinely new sign/message, not every poll.
  const signKey = active.sign.Id + '::' + msgText;
  if (signKey !== activeSignId && msgText !== lastSpokenMessage) {
    speakMessage(msgText);
    lastSpokenMessage = msgText;
  }
  activeSignId = signKey;
}
