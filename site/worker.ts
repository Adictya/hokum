// hokum.app is one URL. `/` is the page: HTML for browsers, the same page as one markdown
// document (dist/page.md) for agents. Assets are served as they are; every other path, including
// the old /themes.md, /llms.txt and friends, redirects to `/`. www redirects to the apex.
interface Env {
  ASSETS: { fetch(request: Request | string): Promise<Response> }
}

const assets = /^\/(assets\/|(style\.css|favicon\.svg|story\.js|hero\.js|site\.js)$)/

// User agents that aren't browsers: HTTP libraries, command line tools and AI crawlers/fetchers.
const agents =
  /curl|wget|httpie|python-requests|python-urllib|aiohttp|httpx|node-fetch|undici|axios|got\b|okhttp|go-http-client|java\/|libwww|ruby|php|rust|reqwest|deno|bun\/|claude|anthropic|gptbot|chatgpt|oai-searchbot|openai|perplexity|cohere|gemini|google-extended|bytespider|ccbot|amazonbot|applebot-extended|meta-externalagent|mistral|duckassist|youbot|opencode|cursor|copilot|codex|aider|cline|windsurf|bot\b|spider|crawler|headless/i

/** Quality of the first Accept entry matching `type` (exact, then `type/*`, then `*\/*`). */
function quality(accept: string, type: string) {
  let best = -1
  let specificity = -1
  for (const part of accept.split(",")) {
    const [range, ...params] = part.trim().toLowerCase().split(";")
    const q = Number(params.find((p) => p.trim().startsWith("q="))?.split("=")[1] ?? 1)
    const s = range === type ? 2 : range === `${type.split("/")[0]}/*` ? 1 : range === "*/*" ? 0 : -1
    if (s > specificity) {
      specificity = s
      best = Number.isNaN(q) ? 1 : q
    }
  }
  return best
}

export function wantsMarkdown(request: Request) {
  const format = new URL(request.url).searchParams.get("format")
  if (format === "md" || format === "markdown") return true
  if (format === "html") return false
  const accept = request.headers.get("Accept") ?? ""
  const ua = request.headers.get("User-Agent") ?? ""
  const html = quality(accept, "text/html")
  const md = Math.max(quality(accept, "text/markdown"), quality(accept, "text/x-markdown"))
  const plain = quality(accept, "text/plain")
  // Markdown at least as welcome as HTML (curl's */* included), or plain text preferred to it.
  if ((md > 0 && md >= html) || (plain > 0 && plain > html)) return true
  // Browsers ask for text/html by name and say Mozilla; anything else is a tool or an agent.
  if (!/text\/html/i.test(accept)) return true
  if (agents.test(ua) || !/mozilla/i.test(ua)) return true
  return false
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.hostname === "www.hokum.app") {
      url.hostname = "hokum.app"
      return Response.redirect(url.toString(), 301)
    }
    if (assets.test(url.pathname)) return env.ASSETS.fetch(request)
    if (url.pathname !== "/") return Response.redirect(`${url.origin}/`, 301)

    const markdown = wantsMarkdown(request)
    const asset = await env.ASSETS.fetch(new Request(new URL(markdown ? "/page.md" : "/", url), request))
    const headers = new Headers(asset.headers)
    headers.set("Content-Type", markdown ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8")
    headers.set("Vary", "Accept, User-Agent")
    headers.set("Link", '</?format=md>; rel="alternate"; type="text/markdown"')
    if (markdown) headers.set("Access-Control-Allow-Origin", "*")
    return new Response(asset.body, { status: asset.status, headers })
  },
}
