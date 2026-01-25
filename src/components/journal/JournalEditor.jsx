'use client';

import { useState, useEffect, useRef } from 'react';
import { journalService } from '@/services/journalService';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';

const DRAFT_STORAGE_KEY = 'journal_draft';

const createEntryId = () => {
    const cryptoObj = typeof crypto !== 'undefined' ? crypto : null;
    if (cryptoObj?.randomUUID) {
        return cryptoObj.randomUUID();
    }

    const bytes = new Uint8Array(16);
    if (cryptoObj?.getRandomValues) {
        cryptoObj.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i += 1) {
            bytes[i] = Math.floor(Math.random() * 256);
        }
    }

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
};

export default function JournalEditor({ onEntrySaved }) {
    const [content, setContent] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState(null);
    const [saveNotice, setSaveNotice] = useState('');
    const textareaRef = useRef(null);
    const pendingEntryIdRef = useRef(null);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const savedDraft = window.localStorage.getItem(DRAFT_STORAGE_KEY);
        if (savedDraft) {
            try {
                const parsed = JSON.parse(savedDraft);
                if (parsed && typeof parsed === 'object') {
                    if (parsed.entryId && typeof parsed.entryId === 'string') {
                        pendingEntryIdRef.current = parsed.entryId;
                    }
                    if (parsed.content && typeof parsed.content === 'string') {
                        setContent(parsed.content);
                        return;
                    }
                }
            } catch (error) {
                // Ignore draft parse errors and fall back to plain text.
            }

            setContent(savedDraft);
        }
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const handle = setTimeout(() => {
            if (content.trim()) {
                if (!pendingEntryIdRef.current) {
                    pendingEntryIdRef.current = createEntryId();
                }

                const payload = JSON.stringify({
                    content,
                    entryId: pendingEntryIdRef.current,
                });

                window.localStorage.setItem(DRAFT_STORAGE_KEY, payload);
            } else {
                pendingEntryIdRef.current = null;
                window.localStorage.removeItem(DRAFT_STORAGE_KEY);
            }
        }, 300);

        return () => clearTimeout(handle);
    }, [content]);

    const handleSave = async () => {
        if (!content.trim()) return;

        setIsSaving(true);
        setSaveNotice('');
        try {
            const entryId = pendingEntryIdRef.current || createEntryId();
            pendingEntryIdRef.current = entryId;
            const result = await journalService.saveEntry(content, entryId);
            const savedEntry = result?.data;
            const aiStatus = result?.aiStatus;
            setLastSaved(new Date());
            if (aiStatus === 'pending') {
                setSaveNotice('Saved. AI cleanup is running in the background.');
            } else if (aiStatus && aiStatus !== 'cleaned') {
                setSaveNotice('Saved without AI cleanup. Your original entry is safe.');
            }
            setContent(''); // Clear after save for fresh entry? Or keep? 
            pendingEntryIdRef.current = null;
            if (typeof window !== 'undefined') {
                window.localStorage.removeItem(DRAFT_STORAGE_KEY);
            }
            // User request: "open a plain text box and just write whatever I want to in"
            // Usually journal apps clear after "saving" an entry if it's treated as a discrete note, OR keep it if it's a daily log.
            // The DB schema is `id, content, created_at`. This implies discrete entries.
            // So I'll clear it and notify parent to refresh list.
            if (onEntrySaved) onEntrySaved(savedEntry);
        } catch (error) {
            console.error('Failed to save journal entry:', error);
            alert('Failed to save entry. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="relative">
                <Textarea
                    ref={textareaRef}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="What's on your mind today?"
                    className="h-64 p-4 sm:p-6 text-base !text-gray-900 !placeholder:text-gray-500/70"
                />
                <div className="absolute bottom-4 right-4 text-xs text-gray-500/70">
                    {content.length} characters
                </div>
            </div>

            <div className="flex items-center justify-between">
                <div className="text-sm text-[var(--text-secondary)]">
                    {lastSaved && `Last saved: ${lastSaved.toLocaleTimeString()}`}
                    {saveNotice && (
                        <div className="mt-1 text-xs text-amber-600">
                            {saveNotice}
                        </div>
                    )}
                </div>
                <Button
                    onClick={handleSave}
                    disabled={!content.trim() || isSaving}
                    isLoading={isSaving}
                    variant={!content.trim() ? "ghost" : "primary"}
                >
                    {isSaving ? 'Saving...' : 'Save Entry'}
                </Button>
            </div>
        </div>
    );
}
