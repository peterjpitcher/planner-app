'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import AppShell from '@/components/layout/AppShell';
import JournalEditor from '@/components/journal/JournalEditor';
import TherapyPrepModal from '@/components/journal/TherapyPrepModal';
import { journalService } from '@/services/journalService';
import { BookOpenIcon, SparklesIcon } from '@heroicons/react/24/outline';

export default function JournalPage() {
    const { data: session } = useSession();
    const [entries, setEntries] = useState([]);
    const [summaryPoints, setSummaryPoints] = useState([]);
    const [summaryNotice, setSummaryNotice] = useState('');
    const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);
    const [summaryContext, setSummaryContext] = useState({ type: 'weekly', dates: null });
    const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
    const [summaryType, setSummaryType] = useState('weekly'); // 'weekly', 'monthly', 'annual', 'custom'
    const [customDates, setCustomDates] = useState({ start: '', end: '' });
    const cleanupInFlightRef = useRef(new Set());
    const cleanupAttemptsRef = useRef(new Map());

    const formatDateLabel = (value) => {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return null;
        return parsed.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    };

    const summaryPeriodLabel = (() => {
        const { type, dates } = summaryContext || {};
        if (type === 'custom' && dates?.start && dates?.end) {
            const startLabel = formatDateLabel(dates.start);
            const endLabel = formatDateLabel(dates.end);
            if (startLabel && endLabel) {
                return `${startLabel} - ${endLabel}`;
            }
            return 'Custom range';
        }
        switch (type) {
            case 'weekly':
                return 'Past week';
            case 'monthly':
                return 'Past month';
            case 'annual':
                return 'Past year';
            case 'custom':
                return 'Custom range';
            default:
                return 'Recent entries';
        }
    })();

    const fetchEntries = async () => {
        try {
            const data = await journalService.getEntries();
            setEntries(data);
        } catch (error) {
            console.error('Failed to load entries:', error);
        }
    };

    const updateEntryState = useCallback((updatedEntry) => {
        if (!updatedEntry?.id) return;
        setEntries((prev) => prev.map((entry) => (
            entry.id === updatedEntry.id ? updatedEntry : entry
        )));
    }, [setEntries]);

    const requestCleanup = useCallback(async (entryId) => {
        if (!entryId) return;
        if (cleanupInFlightRef.current.has(entryId)) return;

        const attempts = cleanupAttemptsRef.current.get(entryId) || 0;
        if (attempts >= 3) return;

        cleanupInFlightRef.current.add(entryId);
        cleanupAttemptsRef.current.set(entryId, attempts + 1);

        try {
            const result = await journalService.cleanupEntry(entryId);
            if (result?.data) {
                updateEntryState(result.data);
            }

            if (result?.aiStatus === 'failed' && attempts + 1 < 3) {
                setTimeout(() => requestCleanup(entryId), 4000 * (attempts + 1));
            }
        } catch (error) {
            if (attempts + 1 < 3) {
                setTimeout(() => requestCleanup(entryId), 4000 * (attempts + 1));
            }
        } finally {
            cleanupInFlightRef.current.delete(entryId);
        }
    }, [updateEntryState]);

    const handleEntrySaved = (savedEntry) => {
        if (savedEntry?.id) {
            setEntries((prev) => {
                const filtered = prev.filter((entry) => entry.id !== savedEntry.id);
                return [savedEntry, ...filtered];
            });
            requestCleanup(savedEntry.id);
            return;
        }

        fetchEntries();
    };

    useEffect(() => {
        if (session?.user) {
            fetchEntries();
        }
    }, [session]);

    useEffect(() => {
        if (!session?.user || entries.length === 0) return;

        entries
            .filter((entry) => !entry.cleaned_content && ['pending', 'failed'].includes(entry.ai_status))
            .forEach((entry) => requestCleanup(entry.id));
    }, [entries, session, requestCleanup]);

    const handleGenerateSummary = async () => {
        setIsGeneratingSummary(true);
        setSummaryPoints([]);
        setSummaryNotice('');
        setIsSummaryModalOpen(false);
        try {
            const result = await journalService.getSummary(summaryType, customDates);
            setSummaryContext({
                type: summaryType,
                dates: summaryType === 'custom' ? { ...customDates } : null,
            });
            const points = Array.isArray(result.summary) ? result.summary : [];
            setSummaryPoints(points);
            if (points.length === 0) {
                setSummaryNotice(result.message || 'No discussion prompts were generated for this period.');
                return;
            }
            setIsSummaryModalOpen(true);
        } catch (error) {
            console.error('Failed to generate summary:', error);
            alert(error.message);
        } finally {
            setIsGeneratingSummary(false);
        }
    };

    return (
        <AppShell
            user={session?.user}
            title="Personal Journal"
            subtitle="Your safe space to reflect. AI-powered summaries help you prepare for therapy."
        >
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">

                {/* Main Content: Editor & Entries */}
                <div className="space-y-8">
                    <section>
                        <h2 className="text-xl font-semibold text-[#052a3b] mb-4 flex items-center gap-2">
                            <BookOpenIcon className="h-5 w-5" />
                            New Entry
                        </h2>
                        <JournalEditor onEntrySaved={handleEntrySaved} />
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-[#052a3b] mb-4">Recent Entries</h2>
                        <div className="space-y-4">
                            {entries.length === 0 ? (
                                <div className="text-center py-10 bg-white/50 rounded-2xl border border-dashed border-gray-300">
                                    <p className="text-gray-500">No entries yet. Start writing above!</p>
                                </div>
                            ) : (
                                entries.map((entry) => (
                                    <div key={entry.id} className="bg-white/70 backdrop-blur-sm p-6 rounded-2xl border border-[#0496c7]/10 hover:border-[#0496c7]/30 transition-all">
                                        <div className="text-xs font-medium text-[#0496c7] mb-2 uppercase tracking-wide">
                                            {new Date(entry.created_at).toLocaleDateString(undefined, {
                                                weekday: 'long',
                                                year: 'numeric',
                                                month: 'long',
                                                day: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            })}
                                        </div>
                                        <p className="text-[#052a3b] whitespace-pre-wrap leading-relaxed">
                                            {entry.cleaned_content || entry.content}
                                        </p>
                                    </div>
                                ))
                            )}
                        </div>
                    </section>
                </div>

                {/* Sidebar: AI Summary */}
                <div className="space-y-6">
                    <div className="glass-panel p-6 rounded-3xl border border-[#0496c7]/25 sticky top-8">
                        <div className="flex items-center gap-2 mb-4 text-[#0496c7]">
                            <SparklesIcon className="h-6 w-6" />
                            <h2 className="font-semibold text-lg">Therapy Prep</h2>
                        </div>

                        <p className="text-sm text-[#2f617a] mb-6">
                            Generate therapist-written discussion prompts based on your recent entries for your next session with Victoria.
                        </p>

                        <div className="grid grid-cols-2 gap-2 mb-4 bg-white/50 p-1 rounded-lg">
                            {['weekly', 'monthly', 'annual', 'custom'].map((type) => (
                                <button
                                    key={type}
                                    onClick={() => setSummaryType(type)}
                                    className={`py-1.5 text-xs font-medium rounded-md transition-all capitalize ${summaryType === type
                                        ? 'bg-white shadow-sm text-[#0496c7]'
                                        : 'text-gray-500 hover:text-[#0496c7]'
                                        }`}
                                >
                                    {type}
                                </button>
                            ))}
                        </div>

                        {summaryType === 'custom' && (
                            <div className="flex flex-col gap-3 mb-6 animate-in fade-in slide-in-from-top-2">
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-gray-500">Start Date</label>
                                    <input
                                        type="date"
                                        value={customDates.start}
                                        onChange={(e) => setCustomDates(prev => ({ ...prev, start: e.target.value }))}
                                        className="w-full px-3 py-2 bg-white/50 border border-gray-200 rounded-lg text-sm text-[#052a3b] focus:ring-2 focus:ring-[#0496c7]/20 outline-none"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-gray-500">End Date</label>
                                    <input
                                        type="date"
                                        value={customDates.end}
                                        onChange={(e) => setCustomDates(prev => ({ ...prev, end: e.target.value }))}
                                        className="w-full px-3 py-2 bg-white/50 border border-gray-200 rounded-lg text-sm text-[#052a3b] focus:ring-2 focus:ring-[#0496c7]/20 outline-none"
                                    />
                                </div>
                            </div>
                        )}

                        <button
                            onClick={handleGenerateSummary}
                            disabled={
                                isGeneratingSummary ||
                                entries.length === 0 ||
                                (summaryType === 'custom' && (!customDates.start || !customDates.end))
                            }
                            className={`
                                w-full py-3 px-4 rounded-xl flex items-center justify-center gap-2 font-medium transition-all
                                ${isGeneratingSummary || entries.length === 0 || (summaryType === 'custom' && (!customDates.start || !customDates.end))
                                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                    : 'bg-gradient-to-r from-[#0496c7] to-[#0382ac] text-white hover:shadow-lg hover:shadow-[#0496c7]/25'
                                }
                            `}
                        >
                            {isGeneratingSummary ? (
                                <>
                                    <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    <span>Analysing...</span>
                                </>
                            ) : (
                                <>
                                    <SparklesIcon className="h-5 w-5" />
                                    <span>Generate Prompts</span>
                                </>
                            )}
                        </button>

                        {summaryNotice && (
                            <div className="mt-4 text-xs text-[#2f617a]">
                                {summaryNotice}
                            </div>
                        )}

                        {summaryPoints.length > 0 && (
                            <div className="mt-4 flex items-center justify-between rounded-xl border border-[#0496c7]/10 bg-white/60 px-3 py-2 text-xs text-[#2f617a]">
                                <span>Therapy prep ready to review.</span>
                                <button
                                    type="button"
                                    onClick={() => setIsSummaryModalOpen(true)}
                                    className="font-semibold text-[#0496c7] hover:text-[#0382ac]"
                                >
                                    Open
                                </button>
                            </div>
                        )}
                    </div>
                </div>

            </div>
            <TherapyPrepModal
                isOpen={isSummaryModalOpen}
                onClose={() => setIsSummaryModalOpen(false)}
                summaryPoints={summaryPoints}
                summaryType={summaryContext?.type}
                periodLabel={summaryPeriodLabel}
            />
        </AppShell>
    );
}
