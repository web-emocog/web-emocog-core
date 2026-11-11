const nodemailer = require('nodemailer');

process.once('message', async ({ smtp, mail }) => {
  try {
    const transport = nodemailer.createTransport({ ...smtp, pool: false, requireTLS: true,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000, dnsTimeout: 5000,
      logger: false, debug: false, maxRecipients: 1, disableFileAccess: true, disableUrlAccess: true });
    await transport.sendMail(mail);
    process.send({ ok: true });
  } catch (_) { process.send({ ok: false }); }
});
