import { NextResponse } from "next/server";
import { db } from "../../../../lib/db";
import { getCurrentUser } from "../../../../lib/server";

export async function GET(req: Request) {
  const user = await getCurrentUser(
    req.headers.get("authorization") ?? undefined,
    req.headers.get("cookie") ?? undefined
  );
  if (!user)
    return NextResponse.json(
      { error: "Unauthorized", code: "UNAUTH" },
      { status: 401 }
    );

  const prefs = await db.notificationPreference.findUnique({
    where: { userId: user.id },
  });
  if (!prefs) {
    return NextResponse.json({
      preferencesSaved: false,
      currentPreferences: {
        notifyOnStatusChange: true,
        notifyOnAllActions: false,
        emailNotifications: false,
      },
    });
  }

  return NextResponse.json({
    preferencesSaved: true,
    currentPreferences: {
      notifyOnStatusChange: prefs.notifyOnStatusChange,
      notifyOnAllActions: prefs.notifyOnAllActions,
      emailNotifications: prefs.emailNotifications,
    },
  });
}

export async function POST(req: Request) {
  const user = await getCurrentUser(
    req.headers.get("authorization") ?? undefined,
    req.headers.get("cookie") ?? undefined
  );
  if (!user)
    return NextResponse.json(
      { error: "Unauthorized", code: "UNAUTH" },
      { status: 401 }
    );

  const body = await req.json();
  const { notifyOnStatusChange, notifyOnAllActions, emailNotifications } = body;
  if (
    typeof notifyOnStatusChange !== "boolean" ||
    typeof notifyOnAllActions !== "boolean"
  ) {
    return NextResponse.json(
      { error: "Invalid payload", code: "INVALID_PAYLOAD" },
      { status: 400 }
    );
  }

  const prefs = await db.notificationPreference.upsert({
    where: { userId: user.id },
    update: {
      notifyOnStatusChange,
      notifyOnAllActions,
      emailNotifications: !!emailNotifications,
    },
    create: {
      userId: user.id,
      notifyOnStatusChange,
      notifyOnAllActions,
      emailNotifications: !!emailNotifications,
    },
  });

  return NextResponse.json({
    preferencesSaved: true,
    currentPreferences: {
      notifyOnStatusChange: prefs.notifyOnStatusChange,
      notifyOnAllActions: prefs.notifyOnAllActions,
      emailNotifications: prefs.emailNotifications,
    },
  });
}
