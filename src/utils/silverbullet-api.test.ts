import { describe, it, expect } from 'vitest';
import {
	SilverBulletClient,
	SilverBulletError,
	SilverBulletSpace,
	buildPageName,
	encodePageName,
	insertContent,
	newJournalPage,
	pageFileUrl,
	pageViewUrl,
	sanitizePageSegment,
	saveClip,
} from './silverbullet-api';

const SPACE: SilverBulletSpace = {
	name: 'Notes',
	url: 'https://sb.example.com/notes/',
	token: 'secret-token',
	journalPrefix: 'Journal/',
};

interface FakeServerOptions {
	token?: string;
	/** Called after each GET of a page, to simulate someone else editing it. */
	afterGet?: (path: string, files: Map<string, string>) => void;
}

/** In-memory stand-in for SilverBullet's /.fs API, including conditional writes. */
function fakeServer(options: FakeServerOptions = {}) {
	const files = new Map<string, string>();
	const requests: { method: string; url: string; headers: Headers; credentials?: RequestCredentials }[] = [];
	const revision = (text: string) => `"sha256:${text.length}:${[...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)}"`;
	const base = 'https://sb.example.com/notes';

	const fetchImpl = async (input: string, init: RequestInit = {}): Promise<Response> => {
		const method = init.method || 'GET';
		const headers = new Headers(init.headers);
		requests.push({ method, url: input, headers, credentials: init.credentials });

		const expected = options.token ?? 'secret-token';
		if (headers.get('Authorization') !== `Bearer ${expected}`) {
			return new Response('Unauthorized', { status: 401 });
		}
		if (input === `${base}/.accounts`) {
			return new Response(JSON.stringify([{ username: 'alice', me: true }, { username: 'bob' }]), {
				headers: { 'Content-Type': 'application/json' },
			});
		}
		if (!input.startsWith(`${base}/.fs/`)) {
			return new Response('<!doctype html>', { status: 404, headers: { 'Content-Type': 'text/html' } });
		}
		const path = decodeURIComponent(input.slice(`${base}/.fs/`.length));

		if (method === 'GET') {
			const text = files.get(path);
			if (text === undefined) {
				return new Response('404 page not found', { status: 404 });
			}
			const response = new Response(text, { headers: { 'X-SilverBullet-Revision': revision(text) } });
			options.afterGet?.(path, files);
			return response;
		}
		if (method === 'PUT') {
			const current = files.get(path);
			if (headers.get('If-None-Match') === '*' && current !== undefined) {
				return new Response('', { status: 412 });
			}
			const ifMatch = headers.get('If-Match');
			if (ifMatch && (current === undefined || ifMatch !== revision(current))) {
				return new Response('', { status: 412 });
			}
			files.set(path, String(init.body));
			return new Response('', { status: 200 });
		}
		return new Response('', { status: 405 });
	};

	return { files, requests, fetchImpl };
}

describe('page names', () => {
	it('removes characters SilverBullet or reverse proxies reject', () => {
		expect(sanitizePageSegment('What is #1? A | B @ C [[x]] ^d; 50% off\\')).toBe('What is 1 A B C x d 50 off');
	});

	it('drops leading dots and a trailing .md', () => {
		expect(sanitizePageSegment('..hidden.md')).toBe('hidden');
	});

	it('joins the folder path and note name and drops empty, . and .. segments', () => {
		expect(buildPageName('Clippings/', 'My Article')).toBe('Clippings/My Article');
		expect(buildPageName('/a//b/../.', 'c')).toBe('a/b/c');
		expect(buildPageName('', 'Solo')).toBe('Solo');
	});

	it('rejects names that end up empty', () => {
		expect(() => buildPageName('', '#?|')).toThrow(SilverBulletError);
	});

	it('encodes each segment but keeps folder slashes', () => {
		expect(encodePageName('Clippings/A & B')).toBe('Clippings/A%20%26%20B');
		expect(pageFileUrl(SPACE.url, 'Clippings/A B')).toBe('https://sb.example.com/notes/.fs/Clippings/A%20B.md');
		expect(pageViewUrl(SPACE.url, 'Clippings/A B')).toBe('https://sb.example.com/notes/Clippings/A%20B');
	});
});

describe('insertContent', () => {
	it('appends after a blank line', () => {
		expect(insertContent('one\n\n', 'two\n', 'append')).toBe('one\n\ntwo\n');
	});

	it('prepends after frontmatter', () => {
		const page = '---\ntags: journal\n---\n* existing\n';
		expect(insertContent(page, 'new', 'prepend')).toBe('---\ntags: journal\n---\nnew\n\n* existing\n');
	});

	it('prepends at the top when there is no frontmatter', () => {
		expect(insertContent('* existing\n', 'new', 'prepend')).toBe('new\n\n* existing\n');
	});

	it('fills an empty page', () => {
		expect(insertContent('', 'new', 'append')).toBe('new\n');
	});
});

describe('newJournalPage', () => {
	it('adds journal frontmatter', () => {
		expect(newJournalPage('2026-11-25', 'clip')).toBe('---\ntags: journal\ndate: "2026-11-25"\n---\nclip\n');
	});

	it('keeps the clip as-is when it brings its own frontmatter', () => {
		expect(newJournalPage('2026-11-25', '---\ntitle: x\n---\nclip')).toBe('---\ntitle: x\n---\nclip\n');
	});
});

describe('saveClip', () => {
	const request = (overrides: Partial<Parameters<typeof saveClip>[0]> = {}) => ({
		space: SPACE,
		behavior: 'create' as const,
		content: '# Clip\n',
		noteName: 'Article',
		path: 'Clippings',
		today: '2026-11-25',
		...overrides,
	});

	it('creates a page with the Bearer token and without cookies', async () => {
		const server = fakeServer();
		const page = await saveClip(request(), server.fetchImpl);
		expect(page).toBe('Clippings/Article');
		expect(server.files.get('Clippings/Article.md')).toBe('# Clip\n');
		const put = server.requests.find(r => r.method === 'PUT')!;
		expect(put.headers.get('Authorization')).toBe('Bearer secret-token');
		expect(put.headers.get('If-None-Match')).toBe('*');
		expect(put.credentials).toBe('omit');
	});

	it('picks a numbered name instead of overwriting an existing page', async () => {
		const server = fakeServer();
		server.files.set('Clippings/Article.md', 'old');
		server.files.set('Clippings/Article 1.md', 'old');
		const page = await saveClip(request(), server.fetchImpl);
		expect(page).toBe('Clippings/Article 2');
		expect(server.files.get('Clippings/Article.md')).toBe('old');
	});

	it('overwrites when the template says so', async () => {
		const server = fakeServer();
		server.files.set('Clippings/Article.md', 'old');
		await saveClip(request({ behavior: 'overwrite' }), server.fetchImpl);
		expect(server.files.get('Clippings/Article.md')).toBe('# Clip\n');
	});

	it('appends to an existing page using its revision', async () => {
		const server = fakeServer();
		server.files.set('Reading.md', '# Reading\n');
		await saveClip(request({ behavior: 'append-specific', path: '', noteName: 'Reading', content: '- new link' }), server.fetchImpl);
		expect(server.files.get('Reading.md')).toBe('# Reading\n\n- new link\n');
		expect(server.requests.find(r => r.method === 'PUT')!.headers.get('If-Match')).toMatch(/^"sha256:/);
	});

	it('creates the page when appending to one that does not exist', async () => {
		const server = fakeServer();
		await saveClip(request({ behavior: 'append-specific', path: '', noteName: 'Reading', content: '- new link' }), server.fetchImpl);
		expect(server.files.get('Reading.md')).toBe('- new link');
	});

	it('re-reads and retries when the page changes during an append', async () => {
		let edited = false;
		const server = fakeServer({
			afterGet: (path, files) => {
				if (!edited) {
					edited = true;
					files.set(path, files.get(path) + '- edit from elsewhere\n');
				}
			},
		});
		server.files.set('Reading.md', '# Reading\n');
		await saveClip(request({ behavior: 'append-specific', path: '', noteName: 'Reading', content: '- clip' }), server.fetchImpl);
		expect(server.files.get('Reading.md')).toBe('# Reading\n- edit from elsewhere\n\n- clip\n');
	});

	it('creates today\'s journal page with journal frontmatter', async () => {
		const server = fakeServer();
		const page = await saveClip(request({ behavior: 'append-daily', content: '- clipped [x](https://x)' }), server.fetchImpl);
		expect(page).toBe('Journal/2026-11-25');
		expect(server.files.get('Journal/2026-11-25.md')).toBe('---\ntags: journal\ndate: "2026-11-25"\n---\n- clipped [x](https://x)\n');
	});

	it('prepends to today\'s journal page below its frontmatter', async () => {
		const server = fakeServer();
		server.files.set('Journal/2026-11-25.md', '---\ntags: journal\ndate: "2026-11-25"\n---\n* morning\n');
		await saveClip(request({ behavior: 'prepend-daily', content: '- clip' }), server.fetchImpl);
		expect(server.files.get('Journal/2026-11-25.md')).toBe('---\ntags: journal\ndate: "2026-11-25"\n---\n- clip\n\n* morning\n');
	});

	it('uses the space\'s journal prefix', async () => {
		const server = fakeServer();
		const page = await saveClip(request({ space: { ...SPACE, journalPrefix: 'Daily ' }, behavior: 'append-daily' }), server.fetchImpl);
		expect(page).toBe('Daily 2026-11-25');
	});

	it('reports a rejected token as an auth error', async () => {
		const server = fakeServer({ token: 'other' });
		await expect(saveClip(request(), server.fetchImpl)).rejects.toMatchObject({ kind: 'auth' });
	});

	it('sends cookies instead of a token when no token is set', async () => {
		const server = fakeServer();
		await expect(saveClip(request({ space: { ...SPACE, token: '' } }), server.fetchImpl)).rejects.toMatchObject({ kind: 'auth' });
		expect(server.requests[0].credentials).toBe('include');
		expect(server.requests[0].headers.has('Authorization')).toBe(false);
	});

	it('reports network failures', async () => {
		const failing = async () => { throw new TypeError('Failed to fetch'); };
		await expect(saveClip(request(), failing)).rejects.toMatchObject({ kind: 'network' });
	});
});

describe('checkConnection', () => {
	it('returns the signed-in username', async () => {
		const server = fakeServer();
		await expect(new SilverBulletClient(SPACE, server.fetchImpl).checkConnection()).resolves.toBe('alice');
	});

	it('explains a URL that is not a space', async () => {
		const server = fakeServer();
		const client = new SilverBulletClient({ ...SPACE, url: 'https://sb.example.com' }, server.fetchImpl);
		await expect(client.checkConnection()).rejects.toMatchObject({ kind: 'not-found' });
	});
});
