if (!process.env.WORKER_SECRET)
  throw new Error("Set WORKER_SECRET before starting the worker.");
const url =
  process.env.WORKER_URL ||
  (process.env.WORKER_HOSTPORT
    ? "http://" + process.env.WORKER_HOSTPORT + "/worker"
    : "http://127.0.0.1:3000/worker");
async function tick() {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer " + process.env.WORKER_SECRET },
      signal: AbortSignal.timeout(9 * 60 * 1000),
    });
    if (!r.ok) console.error("Worker returned", r.status);
  } catch (e) {
    console.error("Worker request failed:", e.message);
  }
  setTimeout(tick, 3000);
}
await tick();
