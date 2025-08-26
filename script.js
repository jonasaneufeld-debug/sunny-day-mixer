// Web Audio API multi-stem synced mixer
// Replace existing script.js with this file and redeploy.

const files = {
  instruments: "sunny_day_instruments.wav",
  bass:        "sunny_day_bass.wav",
  vocals:      "sunny_day_vocals.wav",
  drums:       "sunny_day_drums.wav"
};

let audioCtx;
const buffers = {};        // decoded AudioBuffer per track
const gainNodes = {};      // per-track GainNode (for volume & mute)
let sources = {};          // currently playing BufferSource nodes
let isPlaying = false;
let startTime = 0;         // audioCtx.currentTime when playback started
let pauseOffset = 0;       // seconds into the song when paused
let masterDuration = 0;    // longest buffer duration
let endTimeout = null;

const statusEl = document.getElementById('status');
const playBtn = document.getElementById('playPause');
const stopBtn = document.getElementById('stop');
const timeEl = document.getElementById('time');
const trackRows = Array.from(document.querySelectorAll('.track'));

// helper to format seconds to mm:ss
function fmt(sec){
  if (!isFinite(sec) || sec < 0) return "00:00";
  const m = Math.floor(sec/60).toString().padStart(2,'0');
  const s = Math.floor(sec%60).toString().padStart(2,'0');
  return `${m}:${s}`;
}

async function initAudio() {
  try {
    statusEl.textContent = "Loading stems…";
    // create context on user gesture later; but decode files now using OfflineAudioContext if needed.
    // We'll create normal AudioContext when user presses Play (some browsers block resume otherwise).

    // fetch + decode using a temporary AudioContext (may be created now)
    const tmpCtx = new (window.OfflineAudioContext || window.AudioContext || window.webkitAudioContext)(1, 1, 44100);

    for (const [key, url] of Object.entries(files)) {
      statusEl.textContent = `Loading ${key}…`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Failed fetching ${url} (status ${r.status})`);
      const ab = await r.arrayBuffer();
      // decode using tmpCtx.decodeAudioData for wide browser compatibility
      buffers[key] = await new Promise((res, rej) => {
        tmpCtx.decodeAudioData(ab.slice(0), res, err => rej(err));
      });
      masterDuration = Math.max(masterDuration, buffers[key].duration);
    }

    statusEl.textContent = "All stems loaded";
    document.getElementById('spinner').textContent = '✓';
    enableControls();
    updateTimeDisplay();
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Error loading stems — check file names and network. See console.";
  }
}

function enableControls(){
  playBtn.disabled = false;
  stopBtn.disabled = false;
  // build UI controls values from DOM
  trackRows.forEach(row => {
    const name = row.getAttribute('data-track');
    const vol = row.querySelector('.volume');
    const mute = row.querySelector('.mute');

    // Set initial slider value (1)
    vol.value = 1;
    mute.textContent = "Mute";

    // handlers wired below
    vol.addEventListener('input', () => {
      if (gainNodes[name]) gainNodes[name].gain.value = parseFloat(vol.value);
    });

    mute.addEventListener('click', () => {
      // toggle mute - reflect in button text and gain node
      const isMuted = mute.getAttribute('data-muted') === 'true';
      if (!isMuted) {
        mute.setAttribute('data-muted','true');
        mute.textContent = 'Unmute';
        if (gainNodes[name]) gainNodes[name].gain.value = 0;
      } else {
        mute.setAttribute('data-muted','false');
        mute.textContent = 'Mute';
        if (gainNodes[name]) gainNodes[name].gain.value = parseFloat(vol.value);
      }
    });
  });
}

// create new AudioContext and gainNodes before first play
function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // create per-track gainNodes
    for (const name of Object.keys(files)) {
      const g = audioCtx.createGain();
      g.gain.value = 1;
      g.connect(audioCtx.destination);
      gainNodes[name] = g;
    }
  }
}

// create BufferSource nodes and start them all in sync
function startPlayback() {
  if (!audioCtx) ensureAudioContext();

  // If audio context is suspended (autoplay policy), resume on user action
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(e => console.warn('resume failed', e));
  }

  // clear any previous sources and timeouts
  cancelScheduledEnd();

  sources = {};
  const now = audioCtx.currentTime;
  startTime = now - pauseOffset;

  for (const [name, buffer] of Object.entries(buffers)) {
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;

    // connect to per-track gain node (gainNodes[name] already exists)
    src.connect(gainNodes[name]);

    // start at the correct offset (pauseOffset)
    // Start at time 'now' and offset 'pauseOffset'
    try {
      src.start(now, pauseOffset);
    } catch(e) {
      // older Safari sometimes throws if offset equals duration exactly; clamp
      const safeOffset = Math.min(pauseOffset, Math.max(0, buffer.duration - 0.001));
      src.start(now, safeOffset);
    }

    sources[name] = src;
  }

  // schedule a UI update for end of longest buffer
  const remaining = Math.max(0, masterDuration - pauseOffset);
  scheduleEndIn(remaining);

  isPlaying = true;
  playBtn.textContent = '⏸ Pause';
  updateTimeTicker();
}

// stop all playing sources and record pauseOffset
function pausePlayback() {
  if (!audioCtx || !isPlaying) return;
  // compute pause offset relative to startTime
  const now = audioCtx.currentTime;
  pauseOffset = now - startTime;

  for (const src of Object.values(sources)) {
    try { src.stop(); } catch (e) { /* ignored */ }
  }
  sources = {};
  isPlaying = false;
  playBtn.textContent = '▶ Play';
  cancelScheduledEnd();
  updateTimeDisplay();
}

// stop and reset to beginning
function stopPlayback() {
  if (!audioCtx) ensureAudioContext();
  for (const src of Object.values(sources)) {
    try { src.stop(); } catch (e) {}
  }
  sources = {};
  isPlaying = false;
  pauseOffset = 0;
  startTime = 0;
  playBtn.textContent = '▶ Play';
  cancelScheduledEnd();
  updateTimeDisplay();
}

function scheduleEndIn(seconds) {
  cancelScheduledEnd();
  endTimeout = setTimeout(() => {
    // when the longest buffer ends, stop everything and reset
    stopPlayback();
  }, seconds * 1000 + 50); // small safety margin
}

function cancelScheduledEnd() {
  if (endTimeout) {
    clearTimeout(endTimeout);
    endTimeout = null;
  }
}

// UI: ticking display while playing
let uiTicker = null;
function updateTimeTicker() {
  cancelTicker();
  uiTicker = setInterval(updateTimeDisplay, 250);
}

function cancelTicker() {
  if (uiTicker) {
    clearInterval(uiTicker);
    uiTicker = null;
  }
}

function updateTimeDisplay() {
  const current = isPlaying && audioCtx ? (audioCtx.currentTime - startTime) : pauseOffset;
  const capped = Math.min(masterDuration, current);
  timeEl.textContent = `${fmt(capped)} / ${fmt(masterDuration || 0)}`;
  if (!isPlaying) cancelTicker();
}

// wire play / pause / stop buttons
playBtn.addEventListener('click', async () => {
  // ensure buffers loaded
  if (Object.keys(buffers).length === 0) return;
  ensureAudioContext();

  // chrome/safari will only allow resume on a user gesture — this click qualifies
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  if (!isPlaying) {
    startPlayback();
  } else {
    pausePlayback();
  }
});

stopBtn.addEventListener('click', () => {
  stopPlayback();
});

// When page is hidden, pause audio to avoid autoplay issues & battery
document.addEventListener('visibilitychange', () => {
  if (document.hidden && isPlaying) {
    pausePlayback();
  }
});

// initialize UI & load files
initAudio();
