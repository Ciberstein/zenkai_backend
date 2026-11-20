// Conversion de subtitulos a WebVTT, el unico formato de texto que reproduce el
// navegador. Acepta .ass / .ssa (Advanced SubStation), .srt (SubRip) y .vtt.
//
// Es JavaScript puro a proposito: la API no lleva ffmpeg (solo el worker), y convertir
// texto no lo necesita. Lo que se pierde al pasar de .ass es el estilo (colores,
// posicion, karaoke, dibujos vectoriales): los subtitulos salen como texto simple.

const MAX_CUES = 20000;

// ─── Codificacion ─────────────────────────────────────────────────────────────

// Los .srt y .ass antiguos vienen en Windows-1252 o UTF-16; leerlos siempre como UTF-8
// dejaria las tildes y las enes hechas ilegibles.
const decode = (buffer) => {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buffer.subarray(3));
  }

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
};

// ─── Tiempos ──────────────────────────────────────────────────────────────────

const pad = (n, size = 2) => String(n).padStart(size, '0');

// 3723456 → "01:02:03.456"
const formatTime = (ms) => {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);

  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(total % 1000, 3)}`;
};

// "1:02:03.45" (ASS, centesimas) y "01:02:03,456" (SRT, milesimas) → milisegundos.
// La parte decimal se lee como fraccion: ".45" son 450 ms y ".456" son 456 ms.
const parseTime = (text) => {
  const match = /^\s*(\d+):(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?\s*$/.exec(text);
  if (!match) return null;

  const [, h, m, s, fraction = '0'] = match;
  return (Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000 + Number(fraction.padEnd(3, '0'));
};

// ─── SubRip ───────────────────────────────────────────────────────────────────

const parseSrt = (text) => {
  const cues = [];

  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((line) => line.includes('-->'));
    if (at < 0) continue;

    const [from, to] = lines[at].split('-->');
    const start = parseTime(from);
    const end = parseTime(to.trim().split(/\s+/)[0]);
    if (start === null || end === null) continue;

    // Algunos .srt traen etiquetas de .ass entre llaves ({\an8}): no son texto.
    const body = lines.slice(at + 1).join('\n').replace(/\{[^}]*\}/g, '').trim();

    if (body) cues.push({ start, end, text: body });
  }

  return cues;
};

// ─── Advanced SubStation ──────────────────────────────────────────────────────

// Texto de un "Dialogue" sin las marcas de estilo. Devuelve null si no es texto: los
// dibujos vectoriales (\p1) se usan para rotulos y efectos, no son subtitulos.
const cleanAssText = (raw) => {
  if (/\\p[1-9]/.test(raw)) return null;

  const text = raw
    .replace(/\{[^}]*\}/g, '')   // etiquetas de estilo: {\i1}, {\an8}, {\k20}…
    .replace(/\\N/g, '\n')       // salto de linea
    .replace(/\\[nh]/g, ' ')     // salto blando y espacio duro
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

  return text || null;
};

const parseAss = (text) => {
  const cues = [];
  let inEvents = false;
  let fields = null;

  for (const line of text.split('\n')) {
    const section = /^\s*\[(.+?)\]\s*$/.exec(line);
    if (section) { inEvents = section[1].toLowerCase() === 'events'; continue; }
    if (!inEvents) continue;

    const format = /^\s*Format\s*:(.*)$/i.exec(line);
    if (format) { fields = format[1].split(',').map((name) => name.trim().toLowerCase()); continue; }

    const dialogue = /^\s*Dialogue\s*:\s?(.*)$/i.exec(line);
    if (!dialogue) continue;

    // El texto es el ultimo campo y puede llevar comas: se corta solo hasta ahi.
    const names = fields ?? ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    const parts = dialogue[1].split(',');
    const values = [...parts.slice(0, names.length - 1), parts.slice(names.length - 1).join(',')];
    const at = (name) => values[names.indexOf(name)];

    const start = parseTime(at('start') ?? '');
    const end = parseTime(at('end') ?? '');
    const body = cleanAssText(at('text') ?? '');
    if (start === null || end === null || !body) continue;

    cues.push({ start, end, text: body });
  }

  return cues;
};

// ─── Salida ───────────────────────────────────────────────────────────────────

// Un karaoke genera decenas de lineas con el mismo texto que se solapan (una por silaba):
// se funden en una sola, o el subtitulo saldria repetido varias veces a la vez.
const merge = (cues) => {
  const sorted = [...cues].sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];

  for (const cue of sorted) {
    // Solo si se solapan de verdad: dos frases iguales seguidas (una empieza donde acaba
    // la otra) son dos subtitulos distintos.
    const twin = out.findLast((other) => other.text === cue.text && cue.start < other.end);

    if (twin) twin.end = Math.max(twin.end, cue.end);
    else out.push({ ...cue });
  }

  return out;
};

// En WebVTT &, < y > van escapados; si no, un "<3" se leeria como una etiqueta.
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const serialize = (cues, { escapeText }) =>
  `WEBVTT\n\n${cues
    .map((cue, i) => `${i + 1}\n${formatTime(cue.start)} --> ${formatTime(cue.end)}\n${escapeText ? escape(cue.text) : cue.text}\n`)
    .join('\n')}`;

// ─── API ──────────────────────────────────────────────────────────────────────

const FORMATS = ['.ass', '.ssa', '.srt', '.vtt'];

// Devuelve { vtt, cues } o lanza un Error con un mensaje para el usuario.
const toVtt = (buffer, extension) => {
  const ext = String(extension).toLowerCase();
  if (!FORMATS.includes(ext)) throw new Error(`Formato no admitido: usa ${FORMATS.join(', ')}`);

  const text = decode(buffer).replace(/\r\n?/g, '\n');

  // Un .vtt ya es lo que necesitamos: se conserva tal cual (con su estilo y posiciones);
  // solo se normaliza la codificacion y se comprueba que de verdad lo sea.
  if (ext === '.vtt') {
    if (!/^\s*WEBVTT/.test(text)) throw new Error('El archivo .vtt no empieza por WEBVTT');

    const count = (text.match(/-->/g) ?? []).length;
    if (!count) throw new Error('No se encontró ningún subtítulo en el archivo');

    return { vtt: text.replace(/^\s+/, ''), cues: count };
  }

  const parsed = ext === '.srt' ? parseSrt(text) : parseAss(text);
  const cues = merge(parsed).filter((cue) => cue.end > cue.start);

  if (!cues.length) throw new Error('No se encontró ningún subtítulo en el archivo');
  if (cues.length > MAX_CUES) throw new Error(`El archivo tiene demasiados subtítulos (máximo ${MAX_CUES})`);

  return { vtt: serialize(cues, { escapeText: ext !== '.srt' }), cues: cues.length };
};

module.exports = { toVtt, FORMATS, decode, parseTime, formatTime };
