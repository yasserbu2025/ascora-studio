// Vercel Edge Middleware — gates the private admin routes behind HTTP Basic Auth.
// Credentials come from project environment variables (ADMIN_GATE_USER / ADMIN_GATE_PASS),
// so the password is never committed to the repo.
//
// Public marketing site (everything else) is unaffected.

export const config = {
  matcher: ['/admin', '/admin.html', '/dashboard'],
};

export default function middleware(request) {
  const user = process.env.ADMIN_GATE_USER;
  const pass = process.env.ADMIN_GATE_PASS;

  const header = request.headers.get('authorization') || '';
  if (user && pass && header.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6));
      const i = decoded.indexOf(':');
      const u = decoded.slice(0, i);
      const p = decoded.slice(i + 1);
      if (u === user && p === pass) {
        return; // authorized → continue to the requested page
      }
    } catch (_) { /* fall through to 401 */ }
  }

  return new Response('Authentication required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Ascora Studio — Private", charset="UTF-8"',
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-store',
    },
  });
}
