import { lookupNotices } from "../js/lookup.mjs";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  try {
    const q = String(req.query?.q || "");
    const result = await lookupNotices(q);
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({
      query: req.query?.q || "",
      results: [],
      source: "error",
      warning: String(err?.message || err),
    });
  }
}
