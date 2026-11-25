// Runs saveClip against a real SilverBullet space. Skipped unless both
// SB_LIVE_URL (space URL) and SB_LIVE_TOKEN (API token) are set:
//
//   SB_LIVE_URL=https://sb.example.com/notes SB_LIVE_TOKEN=... npx vitest run silverbullet-api.live
//
// Everything is written under "Inbox/Clipper live test <timestamp>/" and
// deleted again at the end.
import { describe, it, expect, afterAll } from 'vitest';
import { SilverBulletClient, SilverBulletSpace, pageFileUrl, saveClip } from './silverbullet-api';

const url = process.env.SB_LIVE_URL;
const token = process.env.SB_LIVE_TOKEN;

describe.skipIf(!url || !token)('saveClip against a live SilverBullet space', () => {
	const folder = `Inbox/Clipper live test ${Date.now()}`;
	const space: SilverBulletSpace = { name: 'live', url: url!, token: token!, journalPrefix: `${folder}/Journal/` };
	const created = new Set<string>();
	const base = { space, path: folder, today: '2026-01-01' };

	afterAll(async () => {
		for (const page of created) {
			await fetch(pageFileUrl(url!, page), { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
		}
	});

	it('checks the connection', async () => {
		const username = await new SilverBulletClient(space).checkConnection();
		expect(username === null || typeof username === 'string').toBe(true);
	});

	it('creates, dedupes, appends, prepends and writes the daily note', async () => {
		const client = new SilverBulletClient(space);

		const first = await saveClip({ ...base, behavior: 'create', noteName: 'Article: what? #1', content: '---\nsource: test\n---\n# Clip\n' });
		created.add(first);
		expect(first).toBe(`${folder}/Article: what 1`);

		const second = await saveClip({ ...base, behavior: 'create', noteName: 'Article: what? #1', content: 'second' });
		created.add(second);
		expect(second).toBe(`${first} 1`);

		await saveClip({ ...base, behavior: 'append-specific', noteName: 'Article: what? #1', content: 'appended' });
		await saveClip({ ...base, behavior: 'prepend-specific', noteName: 'Article: what? #1', content: 'prepended' });
		expect((await client.readPage(first))!.text).toBe('---\nsource: test\n---\nprepended\n\n# Clip\n\nappended\n');

		const daily = await saveClip({ ...base, behavior: 'append-daily', noteName: '', content: '- one' });
		created.add(daily);
		await saveClip({ ...base, behavior: 'append-daily', noteName: '', content: '- two' });
		expect(daily).toBe(`${folder}/Journal/2026-01-01`);
		expect((await client.readPage(daily))!.text).toBe('---\ntags: journal\ndate: "2026-01-01"\n---\n- one\n\n- two\n');
	});
});
