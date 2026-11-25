// Lectura y modificacion del manifiesto maestro (master.m3u8) de un episodio ya publicado.
//
// Sirve para añadir (o reemplazar) una pista de audio sin volver a procesar el video: el
// manifiesto lista las pistas con lineas `#EXT-X-MEDIA:TYPE=AUDIO,...` y basta con añadir
// una linea y subir los segmentos nuevos a su propia carpeta.

const EOL = /\r?\n/;

const attr = (line, name) => new RegExp(`(?:^|[:,])${name}="([^"]*)"`).exec(line)?.[1] ?? null;
const isAudio = (line) => line.startsWith('#EXT-X-MEDIA:') && /[:,]TYPE=AUDIO(?:,|$)/.test(line);

// Pistas de audio declaradas: [{ index, lang, name, group, uri, dir, isDefault }]
const audioTracks = (master) =>
  master.split(EOL)
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => isAudio(line))
    .map(({ line, index }) => {
      const uri = attr(line, 'URI');
      return {
        index,
        lang: attr(line, 'LANGUAGE'),
        name: attr(line, 'NAME'),
        group: attr(line, 'GROUP-ID'),
        uri,
        dir: uri ? uri.split('/')[0] : null,
        isDefault: /[:,]DEFAULT=YES(?:,|$)/.test(line),
      };
    });

const GENERIC = /^audio_\d+$/;

// Nombre que el administrador le puso a la pista (el que se muestra en el reproductor), o null si es el genérico.
const customName = (track) => (track?.name && !GENERIC.test(track.name) ? track.name : null);

// Nombre de carpeta libre para una pista nueva. Con el codigo de idioma basta; si ya hay una
// carpeta asi (se esta reemplazando esa pista) se usa otra distinta: los segmentos se cachean
// "para siempre" (immutable) y sobrescribirlos dejaria a los espectadores con el audio viejo.
const freeDir = (master, lang, suffix = Date.now().toString(36)) => {
  const used = new Set(audioTracks(master).map((track) => track.dir));
  return used.has(lang) ? `${lang}-${suffix}` : lang;
};

// Devuelve { master, replaced }: el manifiesto con la pista nueva (y sin la anterior del mismo
// idioma, si la habia) y la pista que se reemplazo. La pista nueva no es la predeterminada,
// salvo que sustituya a la que lo era.
const withAudio = (master, { lang, dir }) => {
  const tracks = audioTracks(master);
  if (!tracks.length) throw new Error('El manifiesto del episodio no tiene pistas de audio: no es un paquete publicado por Zenkai');

  const lines = master.split(EOL);
  const replaced = tracks.find((track) => track.lang?.toLowerCase() === lang.toLowerCase()) ?? null;

  // NAME unico (audio_N): lo usa el reproductor solo como respaldo si no hay idioma.
  const number = Math.max(0, ...tracks.map((track) => Number(/^audio_(\d+)$/.exec(track.name ?? '')?.[1] ?? 0))) + 1;

  const entry = [
    '#EXT-X-MEDIA:TYPE=AUDIO',
    `GROUP-ID="${tracks[0].group}"`,
    `NAME="${customName(replaced) ?? `audio_${number}`}"`,
    `DEFAULT=${replaced?.isDefault ? 'YES' : 'NO'}`,
    `LANGUAGE="${lang}"`,
    `URI="${dir}/index.m3u8"`,
  ].join(',');

  const kept = lines.filter((_, index) => index !== replaced?.index);

  // Justo despues de la ultima pista de audio que queda; si era la unica y se reemplazo, en su sitio.
  const remaining = audioTracks(kept.join('\n'));
  const at = remaining.length ? remaining[remaining.length - 1].index + 1 : replaced.index;

  kept.splice(at, 0, entry);

  return { master: kept.join('\n'), replaced };
};

// Manifiesto sin la pista de audio que vive en la carpeta `dir`. Si era la predeterminada,
// pasa a serlo la primera que queda. Devuelve { master, removed }; no deja el episodio mudo.
const withoutAudio = (master, dir) => {
  const tracks = audioTracks(master);
  const removed = tracks.find((track) => track.dir === dir) ?? null;

  if (!removed) throw new Error('Ese audio no existe en el episodio');
  if (tracks.length === 1) throw new Error('No se puede quitar el unico audio del episodio');

  const lines = master.split(EOL).filter((_, index) => index !== removed.index);

  if (removed.isDefault) {
    const [first] = audioTracks(lines.join('\n'));
    lines[first.index] = lines[first.index].replace(/DEFAULT=NO/, 'DEFAULT=YES');
  }

  return { master: lines.join('\n'), removed };
};

// Manifiesto con `dir` como audio predeterminado (y los demas no).
const withDefaultAudio = (master, dir) => {
  const tracks = audioTracks(master);
  if (!tracks.some((track) => track.dir === dir)) throw new Error('Ese audio no existe en el episodio');

  const lines = master.split(EOL);

  for (const track of tracks) {
    lines[track.index] = lines[track.index].replace(/DEFAULT=(?:YES|NO)/, `DEFAULT=${track.dir === dir ? 'YES' : 'NO'}`);
  }

  return lines.join('\n');
};

// Manifiesto con el nombre que se muestra para el audio de la carpeta `dir`. NAME ha de ser único
// dentro del grupo. Un nombre vacío devuelve el genérico (audio_N), con lo que el reproductor vuelve
// a mostrar el idioma. Si se pasa `lang`, también cambia el código de idioma de la pista (no puede
// coincidir con el de otra pista: el reproductor las elige por idioma).
const withAudioName = (master, dir, name, lang = null) => {
  const tracks = audioTracks(master);
  const track = tracks.find((item) => item.dir === dir);

  if (!track) throw new Error('Ese audio no existe en el episodio');

  const clean = String(name ?? '').trim();
  let value = clean;

  if (!value) {
    const taken = new Set(tracks.map((item) => item.name));
    let n = 1;
    while (taken.has(`audio_${n}`)) n += 1;
    value = `audio_${n}`;
  } else if (tracks.some((item) => item !== track && item.name?.toLowerCase() === value.toLowerCase())) {
    throw new Error('Ya hay otro audio con ese nombre');
  }

  const code = lang ? String(lang).trim() : null;

  if (code && tracks.some((item) => item !== track && item.lang?.toLowerCase() === code.toLowerCase())) {
    throw new Error('Ya hay otro audio con ese idioma');
  }

  const lines = master.split(EOL);
  lines[track.index] = lines[track.index].replace(/NAME="[^"]*"/, () => `NAME="${value}"`);

  if (code) lines[track.index] = lines[track.index].replace(/LANGUAGE="[^"]*"/, () => `LANGUAGE="${code}"`);

  return lines.join('\n');
};

// Ruta de la lista de reproduccion del video (la linea que sigue a #EXT-X-STREAM-INF).
const videoUri = (master) => {
  const lines = master.split(EOL);
  const at = lines.findIndex((line) => line.startsWith('#EXT-X-STREAM-INF'));

  return at < 0 ? null : (lines.slice(at + 1).find((line) => line && !line.startsWith('#')) ?? null);
};

// Duracion total de una lista de reproduccion de medios (suma de los #EXTINF), en segundos.
const duration = (playlist) =>
  [...playlist.matchAll(/#EXTINF:([\d.]+)/g)].reduce((sum, match) => sum + Number(match[1]), 0);

module.exports = { audioTracks, customName, freeDir, withAudio, withoutAudio, withDefaultAudio, withAudioName, videoUri, duration };
