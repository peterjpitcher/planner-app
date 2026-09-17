import { describe, expect, it } from 'vitest';

import { outlookMessageLink } from '@/lib/outlookWebLink';

describe('outlookMessageLink', () => {
  it('matches the webLink Outlook itself gives for the same message', () => {
    // A connector id and the webLink Graph returned for it, from the live
    // mailbox. The "_" in the id is "+" (%2B) in the link.
    const connectorId =
      'AAMkADA3MjNiZjcwLWQyOTMtNDVlNS1hYzA1LTYyMDYzNDkxNjc5YgBGAAAAAACQkLarfGgaSbjrKqV4XhWQBwD6YqncJjPAR4rE09C0qE_GAAAAAAEMAAD6YqncJjPAR4rE09C0qE_GAAccNjhNAAA=';
    const webLink =
      'https://outlook.office365.com/owa/?ItemID=AAMkADA3MjNiZjcwLWQyOTMtNDVlNS1hYzA1LTYyMDYzNDkxNjc5YgBGAAAAAACQkLarfGgaSbjrKqV4XhWQBwD6YqncJjPAR4rE09C0qE%2BGAAAAAAEMAAD6YqncJjPAR4rE09C0qE%2BGAAccNjhNAAA%3D&exvsurl=1&viewmodel=ReadMessageItem';

    expect(outlookMessageLink(connectorId)).toBe(webLink);
  });

  it('turns a "-" back into "/"', () => {
    expect(outlookMessageLink('AAMk-x_y=')).toBe(
      'https://outlook.office365.com/owa/?ItemID=AAMk%2Fx%2By%3D&exvsurl=1&viewmodel=ReadMessageItem'
    );
  });

  it('gives no link without an id', () => {
    expect(outlookMessageLink(null)).toBeNull();
    expect(outlookMessageLink('  ')).toBeNull();
  });
});
