require("dotenv").config({ quiet: true });

const fs = require("fs");
const { pipeline } = require("stream/promises");
const {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectsCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// Cloudflare R2 (API compatible con S3). Un solo bucket basta:
//   · anime/<malId>/<episodio>/   los episodios ya convertidos (HLS), publicos.
//   · incoming/<token>/           los videos originales que se suben desde el admin
//                                 hasta que el worker los convierte. NO deben verse
//                                 desde fuera: el token de la ruta es aleatorio y el
//                                 dominio publico bloquea /incoming/ (ver el README).
// R2_UPLOAD_BUCKET es opcional: si se define, los originales van a otro bucket (privado).

const config = () => ({
  account: process.env.R2_ACCOUNT_ID,
  key: process.env.R2_ACCESS_KEY_ID,
  secret: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET,
  uploadBucket: process.env.R2_UPLOAD_BUCKET || process.env.R2_BUCKET,
  endpoint: process.env.R2_ENDPOINT,
  // Sin barra final y con protocolo: pegar "cdn.ejemplo.com" a secas dejaria URLs relativas en la base.
  base: (process.env.R2_PUBLIC_URL ?? "").trim().replace(/\/+$/, "").replace(/^(?!https?:\/\/)(?=.)/i, "https://"),
});

// Variables que faltan para lo que se quiere hacer.
const missing = (cfg = config(), { upload = false, publish = true } = {}) => [
  !cfg.endpoint && !cfg.account && "R2_ACCOUNT_ID",
  !cfg.key && "R2_ACCESS_KEY_ID",
  !cfg.secret && "R2_SECRET_ACCESS_KEY",
  publish && !cfg.bucket && "R2_BUCKET",
  publish && !cfg.base && "R2_PUBLIC_URL",
  upload && !cfg.uploadBucket && "R2_BUCKET",
].filter(Boolean);

let instance = null;

const client = () => {
  if (instance) return instance;

  const cfg = config();

  instance = new S3Client({
    region: "auto",
    endpoint: cfg.endpoint ?? `https://${cfg.account}.r2.cloudflarestorage.com`,
    forcePathStyle: Boolean(cfg.endpoint),
    credentials: { accessKeyId: cfg.key, secretAccessKey: cfg.secret },
    // R2 no admite los checksums extra que el SDK anade por defecto en las versiones recientes
    // (tambien romperian las URLs firmadas: el navegador no los envia).
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  return instance;
};

// URL temporal para que el navegador suba un archivo directo al bucket, sin pasar
// por el servidor: un video de varios gigas no cabe en una peticion a la API.
const presignPut = (bucket, key, expiresIn = 6 * 3600) =>
  getSignedUrl(client(), new PutObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });

// Tamano del objeto, o null si no existe.
const sizeOf = async (bucket, key) => {
  try {
    const head = await client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return head.ContentLength ?? 0;
  } catch (err) {
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
};

// Descarga a disco en flujo: un video de gigas no se carga entero en memoria.
const download = async (bucket, key, file) => {
  const { Body } = await client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  await pipeline(Body, fs.createWriteStream(file));
};

const remove = async (bucket, keys) => {
  if (!keys.length) return;

  for (let i = 0; i < keys.length; i += 1000) {
    await client().send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
    }));
  }
};

const removePrefix = async (bucket, prefix) => {
  let token;

  do {
    const page = await client().send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    await remove(bucket, (page.Contents ?? []).map((o) => o.Key));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
};

module.exports = { config, missing, client, presignPut, sizeOf, download, remove, removePrefix };
