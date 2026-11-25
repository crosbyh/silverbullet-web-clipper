import dayjs from 'dayjs';
import browser from './browser-polyfill';
import { Template } from '../types/types';
import { generalSettings } from './storage-utils';
import { pageViewUrl, saveClip } from './silverbullet-api';
import { resolveSpace } from './silverbullet-spaces';

export class NoSpaceConfiguredError extends Error {
	constructor() {
		super('Add a SilverBullet space in the extension settings first.');
		this.name = 'NoSpaceConfiguredError';
	}
}

/**
 * Saves a clip to SilverBullet over its HTTP API. Takes the place of
 * saveToObsidian. Returns the URL of the saved page.
 */
export async function saveToSilverBullet(
	fileContent: string,
	noteName: string,
	path: string,
	spaceName: string,
	behavior: Template['behavior'],
): Promise<string> {
	const space = await resolveSpace(spaceName);
	if (!space) {
		throw new NoSpaceConfiguredError();
	}

	const page = await saveClip({
		space,
		behavior,
		content: fileContent,
		noteName,
		path,
		today: dayjs().format('YYYY-MM-DD'),
	});

	return pageViewUrl(space.url, page);
}

/**
 * Opens a saved page in a new tab unless "save without opening" is on.
 * Call it last: focusing the new tab closes the popup.
 */
export async function openSavedPage(url: string): Promise<void> {
	if (!generalSettings.silentOpen) {
		await browser.tabs.create({ url, active: true });
	}
}
