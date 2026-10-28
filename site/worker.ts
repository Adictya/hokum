// hokum.app: static assets from dist/, www redirected to the apex, and a utf-8 charset on
// HTML and on the plain-text files agents read.
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
}

const types: [RegExp, string][] = [
  [/\.md$/, "text/markdown; charset=utf-8"],
  [/(\.txt|\.kdl)$/, "text/plain; charset=utf-8"],
]

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.hostname === "www.hokum.app") {
      url.hostname = "hokum.app"
      return Response.redirect(url.toString(), 301)
    }
    const response = await env.ASSETS.fetch(request)
    const current = response.headers.get("Content-Type") ?? ""
    const type = response.ok ? types.find(([pattern]) => pattern.test(url.pathname)) : undefined
    if (!type && !(current.startsWith("text/html") && !current.includes("charset"))) return response
    const headers = new Headers(response.headers)
    if (type) {
      headers.set("Content-Type", type[1])
      headers.set("Access-Control-Allow-Origin", "*")
    } else headers.set("Content-Type", "text/html; charset=utf-8")
    return new Response(response.body, { status: response.status, headers })
  },
}
