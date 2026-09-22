// This route is intentionally disabled — week data is now served via +page.server.ts directly.
// Keeping this file as a placeholder to avoid 404s from any cached bookmarks.
import { json } from '@sveltejs/kit';
export async function GET() {
	return json({ error: 'Deprecated endpoint' }, { status: 410 });
}
