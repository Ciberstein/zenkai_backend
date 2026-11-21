const { v2: cloudinary } = require("cloudinary");

// Imagenes de usuario (por ahora, las fotos de perfil) en Cloudinary. Todo lo que sube Zenkai
// vive bajo una carpeta raiz propia, `zenkai/`, con una subcarpeta por tipo (`zenkai/avatars`),
// para no mezclarse con otros proyectos que compartan la misma cuenta.
//
//   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
//
// Sin ellas el servicio queda apagado (`enabled()` es false) y quien lo use responde que las
// subidas no estan configuradas.

const ROOT = "zenkai";

const enabled = () => Boolean(
  process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET,
);

const configure = () => cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// Sube un buffer (el de multer, en memoria) a `zenkai/<folder>` y devuelve su URL https. Se envia
// en flujo, sin pasarlo a base64 (que lo infla un tercio). `transformation` se aplica al guardar:
// asi nunca se almacena una imagen mas grande de lo que la web va a mostrar.
const upload = (buffer, folder, transformation = {}) => new Promise((resolve, reject) => {
  configure();

  const stream = cloudinary.uploader.upload_stream(
    { folder: `${ROOT}/${folder}`, resource_type: "image", transformation },
    (error, result) => (error ? reject(error) : resolve(result.secure_url)),
  );

  stream.end(buffer);
});

// public_id de una URL de Cloudinary, solo si es de NUESTRA cuenta y de nuestra carpeta raiz:
//   https://res.cloudinary.com/<cloud>/image/upload/v123/zenkai/avatars/abc.jpg → zenkai/avatars/abc
// Cualquier otra URL (un avatar antiguo alojado fuera, otra cuenta) devuelve null: no se toca.
const publicId = (url) => {
  const match = String(url ?? "").match(/^https:\/\/res\.cloudinary\.com\/([^/]+)\/image\/upload\/(?:v\d+\/)?(zenkai\/.+)\.[a-z0-9]+$/i);

  return match && match[1] === process.env.CLOUDINARY_CLOUD_NAME ? match[2] : null;
};

// Borra una imagen nuestra por su URL. No lanza: una foto que sobra no debe impedir cambiarla.
const destroy = async (url) => {
  const id = publicId(url);
  if (!id || !enabled()) return false;

  try {
    configure();
    await cloudinary.uploader.destroy(id, { resource_type: "image", invalidate: true });
    return true;
  } catch (err) {
    console.error(`[cloudinary] could not delete ${id}: ${err.message}`);
    return false;
  }
};

module.exports = { enabled, upload, destroy, publicId, ROOT };
