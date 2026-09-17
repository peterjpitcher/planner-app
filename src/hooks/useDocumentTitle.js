'use client';

import { useEffect } from 'react';

/**
 * Show `title` in the browser tab while the component is mounted; pass null to
 * leave the page's own title alone.
 *
 * Setting document.title once is not enough under the App Router. Next.js
 * streams metadata, so its <title> can be inserted or rewritten after the page
 * has loaded, and a title set from an effect was overwritten in testing
 * (rendering React's own <title> lost the same race). So the head is watched
 * and the title put back whenever something else changes it. Unmounting stops
 * watching and restores what was there.
 */
export function useDocumentTitle(title) {
  useEffect(() => {
    if (!title) return undefined;

    const previous = document.title;
    const apply = () => {
      if (document.title !== title) document.title = title;
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });

    return () => {
      observer.disconnect();
      document.title = previous;
    };
  }, [title]);
}
