import nodemailer from "nodemailer";

type MailOptions = {
  to: string;
  subject: string;
  text?: string;
  html?: string;
};

export async function sendMail(opts: MailOptions) {
  const smtp = process.env.SMTP_URL;
  if (!smtp) return; // noop when SMTP not configured

  const transporter = nodemailer.createTransport(smtp);

  await transporter.sendMail({
    from: process.env.EMAIL_FROM ?? "no-reply@example.com",
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
}

export default sendMail;
