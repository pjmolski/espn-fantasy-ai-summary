import { json } from '@sveltejs/kit';
import { CRON_SECRET } from '$env/static/private';
import { setEspnCookies } from '$lib/cookieStore';

export async function POST({ request }) {
	const auth = request.headers.get('authorization');
	if (auth !== `Bearer ${CRON_SECRET}`) {
		return new Response('Unauthorized', { status: 401 });
	}
	const body = await request.json();
	const { swid, espn_s2 } = body ?? {};
	if (!swid || !espn_s2) {
		return json({ error: 'Missing swid or espn_s2' }, { status: 400 });
	}
	await setEspnCookies(swid, espn_s2);
	return json({ ok: true, message: 'ESPN cookies stored.' });
}
