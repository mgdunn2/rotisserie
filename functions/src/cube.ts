import type { Card } from "./engine";
export function cubeId(link: string): string {
  const url = new URL(link);
  if (
    url.protocol !== "https:" ||
    !["cubecobra.com", "www.cubecobra.com"].includes(url.hostname)
  )
    throw new Error("Use an https://cubecobra.com/cube/list/… link");
  const match = url.pathname.match(
    /^\/cube\/(?:list|overview|about)\/([a-zA-Z0-9_-]+)\/?$/,
  );
  if (!match) throw new Error("Use a CubeCobra cube list link");
  return match[1];
}
function safeImage(input: unknown): string {
  try {
    const u = new URL(String(input));
    return ["https:", "http:"].includes(u.protocol)
      ? u.href.replace(/^http:/, "https:")
      : "";
  } catch {
    return "";
  }
}
export function normalizeCube(raw: any): { name: string; cards: Card[] } {
  const list = raw?.cards?.mainboard;
  if (!Array.isArray(list) || list.length < 2 || list.length > 1500)
    throw new Error("Cube must have 2–1,500 mainboard entries");
  const cards: Card[] = list.map((c: any, i: number) => {
    const d = c.details || {};
    const name = String(c.custom_name || c.name || d.name || "").slice(0, 200);
    if (!name) throw new Error(`Missing card name at entry ${i + 1}`);
    return {
      id: `c${i}`,
      name,
      image: safeImage(
        c.imgUrl || c.image_normal || d.image_normal || d.image_small,
      ),
      back: safeImage(c.imgBackUrl || c.image_flip || d.image_flip),
      colors: (Array.isArray(c.colors) ? c.colors : d.colors || []).filter(
        (x: unknown) => typeof x === "string" && /^[WUBRGC]$/.test(x),
      ),
      cmc: Number(c.cmc ?? d.cmc) || 0,
      type: String(c.type_line || d.type || "").slice(0, 300),
      text: String(d.oracle_text || "").slice(0, 3000),
      custom: !!c.custom_name || c.cardID === "custom-card",
    };
  });
  if (Buffer.byteLength(JSON.stringify(cards)) > 750000)
    throw new Error("Cube export is too large");
  return { name: String(raw.name || "Imported cube").slice(0, 160), cards };
}
export async function fetchCube(link: string) {
  const id = cubeId(link);
  const r = await fetch(`https://cubecobra.com/cube/api/cubeJSON/${id}`, {
    headers: { "User-Agent": "Rotisserie/1.0 (github.com/mgdunn2/rotisserie)" },
    signal: AbortSignal.timeout(20000),
    redirect: "error",
  });
  if (!r.ok)
    throw new Error(
      `CubeCobra returned ${r.status}. Check that the cube is public.`,
    );
  // Bound response bytes before parsing, including chunked responses.
  let bytes = 0;
  const parts: Buffer[] = [];
  if (!r.body) throw new Error("Empty cube export");
  for await (const part of r.body as any) {
    bytes += part.length;
    if (bytes > 12000000) throw new Error("Cube export exceeds 12 MB");
    parts.push(Buffer.from(part));
  }
  return normalizeCube(JSON.parse(Buffer.concat(parts).toString("utf8")));
}
