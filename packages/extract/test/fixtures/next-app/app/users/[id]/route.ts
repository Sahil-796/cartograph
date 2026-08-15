// A Next.js app-router route handler file: one entrypoint per exported verb.
export function GET() {
  return new Response("ok");
}

export function POST() {
  return new Response("created");
}
