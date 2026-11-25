// Minimal client for SilverBullet's HTTP file API (/.fs), used to save clips.
// See https://docs.silverbullet.md/Integrations/HTTP%20API
//
// Kept free of extension APIs so it can be unit tested with a fake fetch.

export interface SilverBulletSpace {
	/** Label shown in the space picker; templates refer to spaces by this name. */
	name: string;
	/** Space base URL, e.g. https://sb.example.com or https://sb.example.com/myspace */
	url: string;
	/** Account API token, sent as a Bearer token. Empty means rely on the browser's session cookie. */
	token: string;
	/** Prefix for daily journal pages, matching the space's "Journal page prefix" setting. */
	journalPrefix: string;
}

export type SaveBehavior = 'create' | 'append-specific' | 'append-daily' | 'prepend-specific' | 'prepend-daily' | 'overwrite';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type SilverBulletErrorKind = 'auth' | 'forbidden' | 'not-found' | 'conflict' | 'network' | 'http' | 'invalid-name';

export class SilverBulletError extends Error {
	constructor(public kind: SilverBulletErrorKind, message: string, public status?: number) {
		super(message);
		this.name = 'SilverBulletError';
	}
}

export const DEFAULT_JOURNAL_PREFIX = 'Journal/';
export const JOURNAL_TAG = 'journal';

const MAX_CONFLICT_RETRIES = 5;
const MAX_NAME_SUFFIX = 50;

export function normalizeSpaceUrl(url: string): string {
	return url.trim().replace(/\/+$/, '');
}

/**
 * Makes a string safe to use as (part of) a SilverBullet page name.
 * Rules: https://docs.silverbullet.md/Reference/Concepts/Names
 * Also drops characters that reverse proxies such as Traefik reject when
 * percent-encoded in a path (`\`, `;`, `%`, `?`).
 */
export function sanitizePageSegment(segment: string): string {
	return segment
		.replace(/[\x00-\x1F\x7F]/g, '')
		.replace(/[|@#\[\]^\\;%?]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+/, '')
		.replace(/(\.md)+$/i, '')
		.trim();
}

/** Builds a page name from a folder path and a note name, sanitizing each segment. */
export function buildPageName(path: string, noteName: string): string {
	const segments = `${path}/${noteName}`
		.split('/')
		.map(sanitizePageSegment)
		.filter(segment => segment !== '' && segment !== '.' && segment !== '..');
	if (segments.length === 0) {
		throw new SilverBulletError('invalid-name', 'The note name is empty after removing characters SilverBullet does not allow.');
	}
	return segments.join('/');
}

export function journalPageName(prefix: string, date: string): string {
	return buildPageName('', `${prefix || ''}${date}`);
}

/** Percent-encodes a page name for a URL path, keeping `/` as the folder separator. */
export function encodePageName(page: string): string {
	return page.split('/').map(encodeURIComponent).join('/');
}

export function pageFileUrl(spaceUrl: string, page: string): string {
	return `${normalizeSpaceUrl(spaceUrl)}/.fs/${encodePageName(page)}.md`;
}

export function pageViewUrl(spaceUrl: string, page: string): string {
	return `${normalizeSpaceUrl(spaceUrl)}/${encodePageName(page)}`;
}

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/;

export function hasFrontmatter(text: string): boolean {
	return FRONTMATTER_RE.test(text);
}

/**
 * Adds content to an existing page. Appends go at the end after a blank line.
 * Prepends go after the page's frontmatter, if it has any, like Obsidian does.
 */
export function insertContent(existing: string, content: string, mode: 'append' | 'prepend'): string {
	const addition = content.replace(/^\s*\n/, '').replace(/\s+$/, '');
	if (existing.trim() === '') {
		return addition + '\n';
	}
	if (mode === 'append') {
		return existing.replace(/\s+$/, '') + '\n\n' + addition + '\n';
	}
	const match = existing.match(FRONTMATTER_RE);
	const head = match ? match[0].replace(/\r?\n?$/, '\n') : '';
	const body = existing.slice(match ? match[0].length : 0).replace(/^\s*\n/, '');
	return head + addition + '\n\n' + body;
}

/** Initial content for a journal page the clipper creates, matching SilverBullet's journal template frontmatter. */
export function newJournalPage(date: string, content: string): string {
	const body = content.replace(/^\s*\n/, '').replace(/\s+$/, '') + '\n';
	if (hasFrontmatter(body)) {
		return body;
	}
	return `---\ntags: ${JOURNAL_TAG}\ndate: "${date}"\n---\n${body}`;
}

export class SilverBulletClient {
	private readonly baseUrl: string;

	constructor(private space: SilverBulletSpace, private fetchImpl: FetchLike = (input, init) => fetch(input, init)) {
		this.baseUrl = normalizeSpaceUrl(space.url);
	}

	private async request(url: string, init: RequestInit = {}): Promise<Response> {
		const headers = new Headers(init.headers);
		if (this.space.token) {
			headers.set('Authorization', `Bearer ${this.space.token}`);
		}
		let response: Response;
		try {
			response = await this.fetchImpl(url, {
				...init,
				headers,
				credentials: this.space.token ? 'omit' : 'include',
				cache: 'no-store',
				redirect: 'manual',
			});
		} catch (error) {
			throw new SilverBulletError('network', `Could not reach SilverBullet at ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (response.status === 401 || response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
			throw new SilverBulletError('auth', this.space.token
				? 'SilverBullet rejected the API token. Issue a new one in the Dashboard and update the space in settings.'
				: 'SilverBullet asked for a sign-in. Add an API token for this space in settings, or sign in to SilverBullet in this browser.', 401);
		}
		if (response.status === 403) {
			throw new SilverBulletError('forbidden', 'This account does not have write access to the space.', 403);
		}
		return response;
	}

	private async fail(response: Response, action: string): Promise<never> {
		let detail = '';
		try {
			detail = (await response.text()).slice(0, 200).trim();
		} catch {
			// ignore
		}
		if (response.status === 404) {
			throw new SilverBulletError('not-found', `SilverBullet answered 404 when trying to ${action}. Check that the space URL includes the space's path.`, 404);
		}
		throw new SilverBulletError('http', `SilverBullet answered ${response.status} when trying to ${action}${detail ? `: ${detail}` : ''}`, response.status);
	}

	/** Checks the URL and credentials. Returns the signed-in username when the server reports one. */
	async checkConnection(): Promise<string | null> {
		const response = await this.request(`${this.baseUrl}/.accounts`, { headers: { Accept: 'application/json' } });
		const type = response.headers.get('content-type') || '';
		if (!response.ok || !type.includes('json')) {
			if (response.status === 404 || !type.includes('json')) {
				throw new SilverBulletError('not-found', `No SilverBullet space answered at ${this.baseUrl}. For a multi-space server, include the space's path (for example https://sb.example.com/myspace).`, response.status);
			}
			await this.fail(response, 'check the connection');
		}
		const accounts = await response.json().catch(() => []);
		const me = Array.isArray(accounts) ? accounts.find((account: any) => account?.me) : null;
		return me?.username ?? null;
	}

	/** Reads a page. Returns null if it doesn't exist. */
	async readPage(page: string): Promise<{ text: string; revision: string | null } | null> {
		const response = await this.request(pageFileUrl(this.baseUrl, page));
		if (response.status === 404) {
			return null;
		}
		if (!response.ok) {
			await this.fail(response, `read "${page}"`);
		}
		const revision = response.headers.get('X-SilverBullet-Revision') || response.headers.get('ETag');
		return { text: await response.text(), revision };
	}

	/**
	 * Writes a page. `condition` 'create' only writes if the page doesn't exist,
	 * a revision string only writes if the page is unchanged. Returns false when
	 * that precondition fails (HTTP 412).
	 */
	async writePage(page: string, text: string, condition?: 'create' | { revision: string }): Promise<boolean> {
		const headers: Record<string, string> = { 'Content-Type': 'text/markdown' };
		if (condition === 'create') {
			headers['If-None-Match'] = '*';
		} else if (condition) {
			headers['If-Match'] = condition.revision;
		}
		const response = await this.request(pageFileUrl(this.baseUrl, page), { method: 'PUT', headers, body: text });
		if (response.status === 412) {
			return false;
		}
		if (!response.ok) {
			await this.fail(response, `write "${page}"`);
		}
		return true;
	}

	/** Creates a page, adding " 1", " 2", … to the name if it is taken. Returns the name used. */
	async createUniquePage(page: string, text: string): Promise<string> {
		for (let i = 0; i <= MAX_NAME_SUFFIX; i++) {
			const candidate = i === 0 ? page : `${page} ${i}`;
			if (await this.writePage(candidate, text, 'create')) {
				return candidate;
			}
		}
		throw new SilverBulletError('conflict', `Pages named "${page}" through "${page} ${MAX_NAME_SUFFIX}" already exist.`);
	}

	/**
	 * Appends or prepends to a page, creating it with `initialText` if it is
	 * missing. Concurrent edits are detected with If-Match and retried.
	 */
	async addToPage(page: string, content: string, mode: 'append' | 'prepend', initialText: string): Promise<void> {
		for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt++) {
			const current = await this.readPage(page);
			if (!current) {
				if (await this.writePage(page, initialText, 'create')) {
					return;
				}
				continue;
			}
			const updated = insertContent(current.text, content, mode);
			const condition = current.revision ? { revision: current.revision } : undefined;
			if (await this.writePage(page, updated, condition)) {
				return;
			}
		}
		throw new SilverBulletError('conflict', `"${page}" kept changing while the clip was being saved. Try again.`);
	}
}

export interface SaveRequest {
	space: SilverBulletSpace;
	behavior: SaveBehavior;
	content: string;
	noteName: string;
	path: string;
	/** Today's date as YYYY-MM-DD, used for daily notes. */
	today: string;
}

/** Saves a clip according to the template's behavior. Returns the name of the page written. */
export async function saveClip(request: SaveRequest, fetchImpl?: FetchLike): Promise<string> {
	const client = new SilverBulletClient(request.space, fetchImpl);
	const { behavior, content } = request;

	if (behavior === 'append-daily' || behavior === 'prepend-daily') {
		const page = journalPageName(request.space.journalPrefix, request.today);
		const mode = behavior === 'append-daily' ? 'append' : 'prepend';
		await client.addToPage(page, content, mode, newJournalPage(request.today, content));
		return page;
	}

	const page = buildPageName(request.path, request.noteName);
	switch (behavior) {
		case 'overwrite':
			await client.writePage(page, content);
			return page;
		case 'append-specific':
			await client.addToPage(page, content, 'append', content);
			return page;
		case 'prepend-specific':
			await client.addToPage(page, content, 'prepend', content);
			return page;
		case 'create':
		default:
			return client.createUniquePage(page, content);
	}
}
