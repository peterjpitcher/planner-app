import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { useDocumentTitle } from '../useDocumentTitle';

function setHeadTitle(text) {
  document.head.querySelectorAll('title').forEach((node) => node.remove());
  const node = document.createElement('title');
  node.textContent = text;
  document.head.appendChild(node);
}

describe('useDocumentTitle', () => {
  beforeEach(() => setHeadTitle('Project'));
  afterEach(() => setHeadTitle(''));

  it('shows the title in the tab', () => {
    renderHook(() => useDocumentTitle('Menu refresh'));
    expect(document.title).toBe('Menu refresh');
  });

  it('puts the title back when the page inserts its own afterwards', async () => {
    renderHook(() => useDocumentTitle('Menu refresh'));

    // What Next.js streaming metadata does after the page has loaded.
    const late = document.createElement('title');
    late.textContent = 'Planner App';
    document.head.insertBefore(late, document.head.firstChild);

    await waitFor(() => expect(document.title).toBe('Menu refresh'));
  });

  it('puts the title back when the existing title text is rewritten', async () => {
    renderHook(() => useDocumentTitle('Menu refresh'));
    document.head.querySelector('title').firstChild.nodeValue = 'Planner App';

    await waitFor(() => expect(document.title).toBe('Menu refresh'));
  });

  it('leaves the page title alone when given nothing', () => {
    renderHook(() => useDocumentTitle(null));
    expect(document.title).toBe('Project');
  });

  it('restores the previous title and stops watching on unmount', async () => {
    const { unmount } = renderHook(() => useDocumentTitle('Menu refresh'));
    unmount();
    expect(document.title).toBe('Project');

    document.title = 'Something else';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.title).toBe('Something else');
  });
});
