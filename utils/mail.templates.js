// Plantillas de los correos. HTML con tablas y estilos en linea (los clientes de correo no
// entienden CSS moderno) y siempre una version en texto plano.

const ACCENT = "#fcee0a";
const INK = "#07070a";

const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const shell = (preheader, content) => `<!doctype html>
<html lang="es">
<body style="margin:0;padding:0;background:#f2f2f4;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escape(preheader)}</span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f2f4;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="480" cellspacing="0" cellpadding="0" style="width:100%;max-width:480px;background:#ffffff;border:1px solid #e4e4e8;">
        <tr><td style="background:${INK};padding:20px 28px;">
          <span style="display:inline-block;background:${ACCENT};color:${INK};font:700 16px Arial,sans-serif;padding:6px 10px;">Z</span>
          <span style="color:#ffffff;font:700 18px Arial,sans-serif;letter-spacing:3px;margin-left:10px;vertical-align:middle;">ZENKAI</span>
        </td></tr>
        <tr><td style="padding:32px 28px;font:15px/1.6 Arial,sans-serif;color:#1b1b20;">${content}</td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #ececf0;font:12px/1.5 Arial,sans-serif;color:#80808a;">
          Si no has sido tú, ignora este correo: nadie podrá entrar en una cuenta sin el código.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

// Codigo para confirmar el correo al crear la cuenta.
const verification = ({ code, username, minutes }) => ({
  subject: `${code} es tu código de Zenkai`,
  text: `Hola ${username},\n\nTu código para verificar tu correo en Zenkai es: ${code}\n\nCaduca en ${minutes} minutos. Si no has creado una cuenta, ignora este correo.\n`,
  html: shell(
    `Tu código de verificación es ${code}`,
    `<p style="margin:0 0 8px;">Hola <strong>${escape(username)}</strong>,</p>
     <p style="margin:0 0 24px;">Usa este código para verificar tu correo y terminar de crear tu cuenta:</p>
     <p style="margin:0 0 24px;text-align:center;">
       <span style="display:inline-block;background:${ACCENT};color:${INK};font:700 34px 'Courier New',monospace;letter-spacing:10px;padding:14px 12px 14px 22px;">${escape(code)}</span>
     </p>
     <p style="margin:0;color:#5c5c66;">Caduca en ${minutes} minutos.</p>`,
  ),
});

// Codigo para restablecer la contrasena.
const recovery = ({ code, username, minutes }) => ({
  subject: `${code} es tu código para recuperar tu contraseña de Zenkai`,
  text: `Hola ${username},\n\nTu código para restablecer la contraseña de Zenkai es: ${code}\n\nCaduca en ${minutes} minutos. Si no lo has pedido tú, ignora este correo: tu contraseña no cambiará.\n`,
  html: shell(
    `Tu código para recuperar la contraseña es ${code}`,
    `<p style="margin:0 0 8px;">Hola <strong>${escape(username)}</strong>,</p>
     <p style="margin:0 0 24px;">Has pedido restablecer tu contraseña. Introduce este código en la página de recuperación:</p>
     <p style="margin:0 0 24px;text-align:center;">
       <span style="display:inline-block;background:${ACCENT};color:${INK};font:700 34px 'Courier New',monospace;letter-spacing:10px;padding:14px 12px 14px 22px;">${escape(code)}</span>
     </p>
     <p style="margin:0;color:#5c5c66;">Caduca en ${minutes} minutos. Si no lo has pedido tú, tu contraseña no cambiará.</p>`,
  ),
});

module.exports = { verification, recovery };
