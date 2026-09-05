import React from 'react';
import { render, screen, act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { test, vi, expect, afterEach } from 'vitest';
import AttachmentsPanel from '@/components/shared/AttachmentsPanel';
import { apiClient } from '@/lib/apiClient';
vi.mock('@/lib/apiClient', () => ({ apiClient: { getAttachments: vi.fn(), uploadAttachment: vi.fn(), deleteAttachment: vi.fn() } }));
afterEach(() => {cleanup(); vi.clearAllMocks();});
test('keeps current project files when an earlier project response arrives late', async () => {
 let resolveA, resolveB;
 apiClient.getAttachments.mockImplementation((type,id) => new Promise(resolve => { if(id==='a') resolveA=resolve; else resolveB=resolve; }));
 const {rerender} = render(<AttachmentsPanel parentType="project" parentId="a"/>);
 rerender(<AttachmentsPanel parentType="project" parentId="b"/>);
 await act(async () => { resolveB([{id:'bfile',file_name:'Project B file',size_bytes:1,created_at:'2026-09-01T12:00:00Z'}]); });
 expect(screen.getByText('Project B file')).toBeVisible();
 await act(async () => { resolveA([{id:'afile',file_name:'Project A file',size_bytes:1,created_at:'2026-09-01T12:00:00Z'}]); });
 expect(screen.queryByText('Project A file')).not.toBeInTheDocument();
 expect(screen.getByText('Project B file')).toBeVisible();
});

test('ignores old upload completion and does not start the remaining files after switching parent', async () => {
 let resolveUpload;
 apiClient.getAttachments.mockResolvedValue([]);
 apiClient.uploadAttachment.mockImplementation(() => new Promise(resolve => {resolveUpload=resolve;}));
 const {rerender}=render(<AttachmentsPanel parentType="project" parentId="a"/>);
 await screen.findByText('No files yet.');
 fireEvent.change(screen.getByLabelText('Add files to this project'),{target:{files:[new File(['a'],'first.txt'),new File(['b'],'second.txt')]}});
 expect(screen.getByText('first.txt')).toBeVisible();
 rerender(<AttachmentsPanel parentType="project" parentId="b"/>);
 await screen.findByText('No files yet.');
 await act(async () => {resolveUpload({});});
 expect(screen.queryByText('first.txt')).not.toBeInTheDocument();
 expect(apiClient.uploadAttachment).toHaveBeenCalledTimes(1);
 expect(apiClient.getAttachments.mock.calls.filter(([,id])=>id==='a')).toHaveLength(1);
});
test('does not show a previous project deletion error on the current project', async () => {
 let rejectDelete;
 apiClient.getAttachments.mockImplementation((_,id)=>Promise.resolve(id==='a'?[{id:'afile',file_name:'A file',created_at:'2026-09-01T12:00:00Z'}]:[]));
 apiClient.deleteAttachment.mockImplementation(()=>new Promise((_,reject)=>{rejectDelete=reject;}));
 const {rerender}=render(<AttachmentsPanel parentType="project" parentId="a"/>);
 fireEvent.click(await screen.findByRole('button',{name:'Delete A file'}));
 rerender(<AttachmentsPanel parentType="project" parentId="b"/>);
 await screen.findByText('No files yet.');
 await act(async ()=>{rejectDelete(new Error('Old project deletion failed'));});
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
