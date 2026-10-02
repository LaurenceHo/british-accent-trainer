/**
 * THROWAWAY — Task 1 recorder UI, served at `/spike/recorder`.
 *
 * Records in the browser, converts to the 16 kHz / 16-bit / mono WAV that Azure requires,
 * and posts it for assessment. Served as a single inline page so the spike needs no build
 * step or static-asset config.
 *
 * The `AudioContext` decode + `OfflineAudioContext` resample approach here is the same
 * one Task 3 will use in `apps/web` — decode the audio rather than trusting the container,
 * which is also what makes Safari work.
 */
export const RECORDER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Engine Spike — Record Your Voice</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 46rem; margin: 0 auto; padding: 1.5rem; }
  h1 { font-size: 1.3rem; margin-bottom: .2rem; }
  .sub { opacity: .75; margin-top: 0; }
  fieldset { border: 1px solid #8884; border-radius: 8px; margin: 1rem 0; padding: 1rem; }
  legend { font-weight: 600; padding: 0 .4rem; }
  button { font: inherit; padding: .55rem 1rem; border-radius: 6px; border: 1px solid #8886;
           background: #8881; cursor: pointer; }
  button:hover:not(:disabled) { background: #8883; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  button.rec { background: #c0392b; color: #fff; border-color: #c0392b; }
  table { border-collapse: collapse; width: 100%; margin-top: .5rem; }
  th, td { text-align: left; padding: .4rem .5rem; border-bottom: 1px solid #8883; }
  th { font-weight: 600; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .hint { font-size: .87rem; opacity: .8; }
  .verdict { margin-top: 1rem; padding: .85rem 1rem; border-radius: 8px; border: 1px solid #8886; }
  .status { min-height: 1.5rem; font-size: .9rem; }
  code { background: #8882; padding: .1rem .3rem; border-radius: 3px; }
</style>
</head>
<body>
<h1>Engine Spike — Record Your Voice</h1>
<p class="sub">Tests whether Azure <code>en-GB</code> rewards British pronunciation over American.</p>

<fieldset>
<legend>How to do this</legend>
<p class="hint">Record each of the four clips below. Say the word <strong>twice</strong> in
each recording, with a short gap — one-word clips are very short and this gives the engine
more to work with.</p>
<ol class="hint">
  <li><strong>British</strong> — say it the way you want to sound. <em>car</em> = "kah",
      <em>water</em> = "waw-tuh". No "r" sound at the end.</li>
  <li><strong>American</strong> — deliberately exaggerate the "r". <em>car</em> = "karrr",
      <em>water</em> = "wah-derr".</li>
</ol>
<p class="hint">Quiet room, normal speaking volume, phone or laptop mic is fine.</p>
</fieldset>

<fieldset>
<legend>Recordings</legend>
<div id="controls"></div>
<p class="status" id="status"></p>
</fieldset>

<fieldset>
<legend>Results</legend>
<table id="results">
  <thead><tr><th>Clip</th><th class="num">Accuracy</th><th class="num">Pron</th>
  <th class="num">Sounds</th><th>Rhoticity verdict</th></tr></thead>
  <tbody></tbody>
</table>
<div class="verdict" id="verdict">Record all four clips to see the comparison.</div>
</fieldset>

<script>
const CLIPS = [
  { id: 'car-gb',    text: 'car',   label: 'car — British (no r)' },
  { id: 'car-us',    text: 'car',   label: 'car — American (rolled r)' },
  { id: 'water-gb',  text: 'water', label: 'water — British (waw-tuh)' },
  { id: 'water-us',  text: 'water', label: 'water — American (wah-derr)' },
];

const results = {};
const statusEl = document.getElementById('status');
const tbody = document.querySelector('#results tbody');

/** Encodes an AudioBuffer as 16-bit PCM mono WAV. */
function encodeWav(buffer) {
  const samples = buffer.getChannelData(0);
  const out = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(out);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

  str(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);        // PCM chunk size
  view.setUint16(20, 1, true);         // format = PCM
  view.setUint16(22, 1, true);         // channels = mono
  view.setUint32(24, 16000, true);     // sample rate
  view.setUint32(28, 16000 * 2, true); // byte rate
  view.setUint16(32, 2, true);         // block align
  view.setUint16(34, 16, true);        // bits per sample
  str(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/** Decodes any recorded container and resamples to 16 kHz mono. */
async function toWav(blob) {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  await ctx.close();
  const frames = Math.ceil(decoded.duration * 16000);
  const offline = new OfflineAudioContext(1, frames, 16000);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  return encodeWav(await offline.startRendering());
}

function render() {
  tbody.innerHTML = '';
  for (const c of CLIPS) {
    const r = results[c.id];
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + c.label + '</td>' +
      '<td class="num">' + (r ? r.accuracyScore : '—') + '</td>' +
      '<td class="num">' + (r ? r.pronScore : '—') + '</td>' +
      '<td class="num">' + (r ? r.phonemeCount : '—') + '</td>' +
      '<td>' + (r && r.rhotic ? r.rhotic.summary : '—') + '</td>';
    tbody.appendChild(tr);
  }
  verdict();
}

function verdict() {
  const el = document.getElementById('verdict');
  const pairs = [['car', 'car-gb', 'car-us'], ['water', 'water-gb', 'water-us']];
  const lines = [];
  let done = 0;
  for (const [word, gb, us] of pairs) {
    const a = results[gb], b = results[us];
    if (!a || !b) continue;
    done++;
    const d = a.accuracyScore - b.accuracyScore;
    const msg = d > 3 ? 'British scored HIGHER (+' + d + ') — Azure rewards RP here.'
      : d < -3 ? 'British scored LOWER (' + d + ') — Azure penalises correct RP.'
      : 'Near-identical (' + (d > 0 ? '+' : '') + d + ') — Azure cannot tell them apart.';
    lines.push('<strong>' + word + ':</strong> British ' + a.accuracyScore +
               ' vs American ' + b.accuracyScore + '. ' + msg);
  }
  el.innerHTML = done === 0
    ? 'Record all four clips to see the comparison.'
    : lines.join('<br>') + (done < 2 ? '<br><em>Record the other pair too.</em>' : '');
}

async function record(clip, btn) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    statusEl.textContent = 'Microphone denied or unavailable: ' + e.message;
    return;
  }
  const rec = new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);

  btn.classList.add('rec');
  btn.textContent = 'Stop';
  statusEl.textContent = 'Recording "' + clip.label + '" — say it twice, then press Stop.';

  await new Promise((resolve) => {
    rec.onstop = resolve;
    rec.start();
    btn.onclick = () => rec.stop();
  });

  stream.getTracks().forEach((t) => t.stop());
  btn.classList.remove('rec');
  btn.textContent = 'Re-record';
  statusEl.textContent = 'Converting and assessing…';

  try {
    const wav = await toWav(new Blob(chunks));
    const res = await fetch('/spike/assess-upload?text=' + encodeURIComponent(clip.text), {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: wav,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || res.status);
    if (json.recognitionStatus !== 'Success') {
      statusEl.textContent = 'Azure could not recognise that (' + json.recognitionStatus +
        '). Try again, louder and closer to the mic.';
      return;
    }
    results[clip.id] = json;
    statusEl.textContent = 'Done — ' + clip.label + ' scored ' + json.accuracyScore + '.';
    render();
  } catch (e) {
    statusEl.textContent = 'Failed: ' + e.message;
  }
  wire();
}

function wire() {
  const box = document.getElementById('controls');
  box.innerHTML = '';
  for (const clip of CLIPS) {
    const btn = document.createElement('button');
    btn.textContent = results[clip.id] ? 'Re-record' : 'Record';
    btn.style.margin = '.25rem .5rem .25rem 0';
    const wrap = document.createElement('div');
    wrap.style.margin = '.4rem 0';
    wrap.append(btn, document.createTextNode(' ' + clip.label));
    btn.onclick = () => record(clip, btn);
    box.appendChild(wrap);
  }
}

wire();
render();
</script>
</body>
</html>`;
