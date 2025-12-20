'use client';

import { useState, useEffect, useRef } from 'react';
import { journalService } from '@/services/journalService';
import Button from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';

export default function JournalEditor({ onEntrySaved }) {
    const [content, setContent] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState(null);
    const [saveNotice, setSaveNotice] = useState('');
    const textareaRef = useRef(null);

    const handleSave = async () => {
        if (!content.trim()) return;

        setIsSaving(true);
        setSaveNotice('');
        try {
            const result = await journalService.saveEntry(content);
            setLastSaved(new Date());
            if (result?.cleaned === false) {
                setSaveNotice('Saved without cleanup because AI was unavailable.');
            }
            setContent(''); // Clear after save for fresh entry? Or keep? 
            // User request: "open a plain text box and just write whatever I want to in"
            // Usually journal apps clear after "saving" an entry if it's treated as a discrete note, OR keep it if it's a daily log.
            // The DB schema is `id, content, created_at`. This implies discrete entries.
            // So I'll clear it and notify parent to refresh list.
            if (onEntrySaved) onEntrySaved();
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
                    className="h-64 p-4 sm:p-6 text-base"
                />
                <div className="absolute bottom-4 right-4 text-xs text-[var(--text-secondary)]/70">
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
                    {isSaving ? 'Cleaning...' : 'Save Entry'}
                </Button>
            </div>
        </div>
    );
}
