// Serves public/ under https://anoma.ly/labs/hokum-anomaly/.
const PREFIX = "/labs/hokum-anomaly"

export default {
  async fetch(request: Request, env: { ASSETS: Fetcher }): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === PREFIX) return Response.redirect(`${url.origin}${PREFIX}/${url.search}`, 308)
    if (!url.pathname.startsWith(`${PREFIX}/`)) return new Response("Not found", { status: 404 })
    url.pathname = url.pathname.slice(PREFIX.length)
    const res = await env.ASSETS.fetch(new Request(url, request))
    const out = new Response(res.body, res)
    out.headers.set("Cache-Control", url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache")
    out.headers.set("X-Content-Type-Options", "nosniff")
    out.headers.set("Referrer-Policy", "no-referrer")
    out.headers.set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'")
    return out
  },
}
