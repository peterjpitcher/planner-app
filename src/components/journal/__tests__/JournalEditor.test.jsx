import React from 'react';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { test, vi, expect, afterEach } from 'vitest';
import JournalEditor from '@/components/journal/JournalEditor';
import { journalService } from '@/services/journalService';
vi.mock('@/services/journalService', () => ({ journalService: { saveEntry: vi.fn() } }));
vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
afterEach(() => {cleanup(); vi.clearAllMocks();});
test('preserves changes typed after saving started', async () => {
 let resolveSave;
 journalService.saveEntry.mockReturnValue(new Promise(resolve => { resolveSave = resolve; }));
 render(<JournalEditor/>);
 const textbox=screen.getByPlaceholderText("What's on your mind today?");
 fireEvent.change(textbox,{target:{value:'Original reflection'}});
 fireEvent.click(screen.getByRole('button',{name:'Save Entry'}));
 expect(journalService.saveEntry).toHaveBeenCalledWith('Original reflection',expect.any(String));
 expect(textbox).toBeEnabled();
 fireEvent.change(textbox,{target:{value:'Original reflection. New important thought.'}});
 await act(async () => { resolveSave({data:{id:'entry1',content:'Original reflection'}}); });
 expect(textbox).toHaveValue('Original reflection. New important thought.');
 expect(screen.getByText('The earlier text was saved. Your latest changes remain in the draft.')).toBeVisible();
 expect(localStorage.setItem).toHaveBeenCalledWith('journal_draft', expect.stringContaining('New important thought.'));
 expect(journalService.saveEntry).toHaveBeenCalledTimes(1);
});

test('keeps the draft when saving fails', async () => {
 vi.spyOn(window,'alert').mockImplementation(() => {});
 journalService.saveEntry.mockRejectedValue(new Error('Offline'));
 render(<JournalEditor/>);
 const textbox=screen.getByPlaceholderText("What's on your mind today?");
 fireEvent.change(textbox,{target:{value:'Keep my reflection'}});
 await act(async () => { fireEvent.click(screen.getByRole('button',{name:'Save Entry'})); });
 expect(textbox).toHaveValue('Keep my reflection');
 expect(window.alert).toHaveBeenCalledWith('Failed to save entry. Please try again.');
});
test('clears an unchanged draft only after the save succeeds', async () => {
 journalService.saveEntry.mockResolvedValue({data:{id:'entry2',content:'Saved reflection'}});
 render(<JournalEditor/>);
 const textbox=screen.getByPlaceholderText("What's on your mind today?");
 fireEvent.change(textbox,{target:{value:'Saved reflection'}});
 await act(async () => {fireEvent.click(screen.getByRole('button',{name:'Save Entry'}));});
 expect(textbox).toHaveValue('');
 expect(localStorage.removeItem).toHaveBeenCalledWith('journal_draft');
});
