import FormData from "form-data"; // form-data v4.0.1
import Mailgun from "mailgun.js"; // mailgun.js v11.1.0
import dotenv from "dotenv";

dotenv.config();

async function sendSimpleMessage() {
  const emailDomain = process.env.MAILGUN_DOMAIN || "";
  const mailgunApiKey = process.env.MAILGUN_API_KEY || "";

  const mailgun = new Mailgun(FormData);
  const mg = mailgun.client({
    username: "api",
    key: mailgunApiKey,
  });

  try {
    const data = await mg.messages.create(emailDomain, {
      from: `LegisTrack <postmaster@${emailDomain}>`,
      to: ["Christian <ctan.dev@gmail.com>"],
      subject: "Hello Christian",
      text: "Congratulations Christian, you just sent an email with Mailgun! You are truly awesome!",
    });
  } catch (error) {
    console.error("Error sending email:", error);
  }
}
export { sendSimpleMessage };
