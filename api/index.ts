// Vercel compiles this root entrypoint as CommonJS, while web/server is ESM.
// Load the ESM request handler dynamically to avoid ERR_REQUIRE_ESM at startup.
export default {
  async fetch(request: Request): Promise<Response> {
    const { vercelRequest } = await import('../web/server/vercel.js');
    return vercelRequest(request);
  },
};
