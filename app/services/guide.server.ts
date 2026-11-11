import db from "../db.server.ts";
export const GUIDE_VERSION = 1;
export const GUIDE_STEPS = 6;
export async function readGuide(shopId: string, userId: string) {
  const saved = await db.userGuide.findUnique({
    where: { shopId_userId: { shopId, userId } },
  });
  return saved && saved.version === GUIDE_VERSION
    ? { step: saved.step, status: saved.status }
    : { step: 0, status: "in_progress" };
}
export async function saveGuide(
  shopId: string,
  userId: string,
  step: number,
  status: string,
) {
  if (
    !Number.isInteger(step) ||
    step < 0 ||
    step >= GUIDE_STEPS ||
    !["in_progress", "completed", "dismissed"].includes(status)
  )
    throw new Error("Choose a valid guide step.");
  if (status === "completed" && step !== GUIDE_STEPS - 1)
    throw new Error("Finish the guide before marking it complete.");
  return db.userGuide.upsert({
    where: { shopId_userId: { shopId, userId } },
    create: { shopId, userId, step, status, version: GUIDE_VERSION },
    update: { step, status, version: GUIDE_VERSION },
  });
}
