// src/utils/emailService.js
const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT),
    secure: false, // Use STARTTLS na porta 587
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    }
});

/**
 * Envia email com o código de recuperação
 * @param {string} to — destinatário
 * @param {string} code — código de 5 dígitos
 */
// src/utils/emailService.js (apenas a parte do mailOptions)
async function sendResetCode(to, code) {
    const mailOptions = {
        from: `"Rastreamento Veicular" <${process.env.EMAIL_USER}>`,
        to,
        subject: '🔒 Redefinição de Senha – PyDenTrack',
        text: `Seu código para redefinir a senha é: ${code}\n\nEste código expira em 15 minutos.`,
        html: `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.4;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="${process.env.BASE_URL}/assets/logo.png" alt="PyDenTrack" width="120" style="display:block; margin:0 auto;" />
        </div>
        <div style="background: #f7f7f7; padding: 20px; border-radius: 8px;">
          <h2 style="color: #007bff; margin-top: 0;">Recuperação de Senha</h2>
          <p>Olá,</p>
          <p>Recebemos uma solicitação para redefinir sua senha. Utilize o código abaixo:</p>
          <p style="
            display: inline-block;
            font-size: 1.6rem;
            font-weight: bold;
            background: #fff;
            padding: 10px 20px;
            border: 2px dashed #007bff;
            border-radius: 4px;
            margin: 20px 0;
          ">${code}</p>
          <p style="margin-bottom: 0;">Este código expira em 15 minutos.</p>
          <p style="margin-top: 20px; font-size: 0.9rem; color: #666;">
            Se você não solicitou essa alteração, basta ignorar este e-mail.
          </p>
        </div>
        <p style="text-align: center; font-size: 0.8rem; color: #999; margin-top: 30px;">
          © ${new Date().getFullYear()} PyDenTech. Todos os direitos reservados.
        </p>
      </div>
    `
    };

    await transporter.sendMail(mailOptions);
}


module.exports = { sendResetCode };
