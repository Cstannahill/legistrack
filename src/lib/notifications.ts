import { db } from "./db";
import { sendMail } from "./mailer";

export async function createNotification(
  userId: string,
  title: string,
  message: string,
  data?: any,
  viaEmail = false
) {
  const notif = await db.notification.create({
    data: { userId, title, message, data, viaEmail },
  });

  if (viaEmail) {
    try {
      const user = await db.user.findUnique({ where: { id: userId } });
      if (user?.email) {
        await sendMail({
          to: user.email,
          subject: title,
          text: message,
        });
      }
    } catch (_err) {
      // swallow email errors; notification remains in-app
    }
  }

  return notif;
}
