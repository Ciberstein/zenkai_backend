const { Resend } = require("resend");

// Correo transaccional con Resend (https://resend.com). Sin RESEND_API_KEY el servicio queda
// apagado (`enabled()` es false) y quien lo use decide que hacer: el registro, por ejemplo,
// sigue funcionando sin pedir verificacion para no romper un entorno sin configurar.
//
//   RESEND_API_KEY   clave de la API
//   MAIL_FROM        remitente, con un dominio verificado en Resend: "Zenkai <no-reply@tudominio.com>"

let client = null;

const enabled = () => Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);

// Devuelve { ok: true } o { ok: false, error }: nunca lanza, un correo caido no debe tumbar la peticion.
const send = async ({ to, subject, html, text }) => {
  if (!enabled()) return { ok: false, error: "Mail service is not configured" };

  try {
    client ??= new Resend(process.env.RESEND_API_KEY);

    const { error } = await client.emails.send({ from: process.env.MAIL_FROM, to, subject, html, text });

    if (error) return { ok: false, error: error.message ?? String(error) };

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

module.exports = { enabled, send };
