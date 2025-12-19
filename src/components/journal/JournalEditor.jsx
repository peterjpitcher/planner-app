'use client';

import { useState, useEffect, useRef } from 'react';
import { journalService } from '@/services/journalService';

export default function JournalEditor({ onEntrySaved }) {
    const [content, setContent] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState(null);
    const textareaRef = useRef(null);

    const handleSave = async () => {
        if (!content.trim()) return;

        setIsSaving(true);
        try {
            await journalService.saveEntry(content);
            setLastSaved(new Date());
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
                <textarea
                    ref={textareaRef}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="What's on your mind today?"
                    className="w-full h-64 p-4 rounded-xl border border-gray-200 bg-white/50 backdrop-blur-sm focus:ring-2 focus:ring-[#0496c7]/20 focus:border-[#0496c7] resize-none transition-all outline-none text-[#052a3b] placeholder-gray-400"
                />
                <div className="absolute bottom-4 right-4 text-xs text-gray-400">
                    {content.length} characters
                </div>
            </div>

            <div className="flex items-center justify-between">
                <div className="text-sm text-gray-500">
                    {lastSaved && `Last saved: ${lastSaved.toLocaleTimeString()}`}
                </div>
                <button
                    onClick={handleSave}
                    disabled={!content.trim() || isSaving}
                    className={`
            px-6 py-2 rounded-full font-medium text-sm transition-all
            ${!content.trim() || isSaving
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'bg-[#0496c7] text-white hover:bg-[#0382ac] shadow-lg shadow-[#0496c7]/25'
                        }
          `}
                >
                    {isSaving ? 'Saving...' : 'Save Entry'}
                </button>
            </div>
        </div>
    );
}
