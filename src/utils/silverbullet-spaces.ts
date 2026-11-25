import browser from './browser-polyfill';
import { DEFAULT_JOURNAL_PREFIX, SilverBulletSpace, normalizeSpaceUrl } from './silverbullet-api';

// Spaces live in storage.local, not storage.sync, so API tokens stay on this
// device and are left out of "Export all settings" (which only reads sync).
const SPACES_KEY = 'silverbullet_spaces';

function sanitizeSpace(value: any): SilverBulletSpace | null {
	if (!value || typeof value !== 'object' || typeof value.name !== 'string' || typeof value.url !== 'string') {
		return null;
	}
	return {
		name: value.name,
		url: normalizeSpaceUrl(value.url),
		token: typeof value.token === 'string' ? value.token : '',
		journalPrefix: typeof value.journalPrefix === 'string' ? value.journalPrefix : DEFAULT_JOURNAL_PREFIX,
	};
}

export async function loadSpaces(): Promise<SilverBulletSpace[]> {
	const result = await browser.storage.local.get(SPACES_KEY) as Record<string, unknown>;
	const stored = result[SPACES_KEY];
	if (!Array.isArray(stored)) {
		return [];
	}
	return stored.map(sanitizeSpace).filter((space): space is SilverBulletSpace => space !== null);
}

export async function saveSpaces(spaces: SilverBulletSpace[]): Promise<void> {
	await browser.storage.local.set({ [SPACES_KEY]: spaces });
}

/** Finds a space by name, falling back to the first configured space. */
export async function resolveSpace(name: string | undefined): Promise<SilverBulletSpace | null> {
	const spaces = await loadSpaces();
	return spaces.find(space => space.name === name) ?? spaces[0] ?? null;
}
