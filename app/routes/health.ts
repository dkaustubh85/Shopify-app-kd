import db from "../db.server";
export async function loader() {
  try {
    await db.$queryRawUnsafe("SELECT 1");
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
