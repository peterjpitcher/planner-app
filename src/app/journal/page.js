'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import JournalEditor from '@/components/journal/JournalEditor';
import TherapyPrepModal from '@/components/journal/TherapyPrepModal';
import { journalService } from '@/services/journalService';
import { BookOpenIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils'; // Ensure utility is present

const ButtonComponent = Button;

export default function JournalPage() {
    const { data: session } = useSession();
    const [entries, setEntries] = useState([]);
    const [summaryPoints, setSummaryPoints] = useState([]);
    const [summaryNotice, setSummaryNotice] = useState('');
    const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);
    const [summaryContext, setSummaryContext] = useState({ type: 'weekly', dates: null });
    const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
    const [summaryType, setSummaryType] = useState('weekly');
    const [customDates, setCustomDates] = useState({ start: '', end: '' });
    const cleanupInFlightRef = useRef(new Set());
    const cleanupAttemptsRef = useRef(new Map());

    // ... [Original formatDateLabel logic kept] ...
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
            if (startLabel && endLabel) return `${startLabel} - ${endLabel}`;
            return 'Custom range';
        }
        switch (type) {
            case 'weekly': return 'Past week';
            case 'monthly': return 'Past month';
            case 'annual': return 'Past year';
            case 'custom': return 'Custom range';
            default: return 'Recent entries';
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
        <div className="space-y-8">
            {/* Page Header */}
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Personal Journal</h1>
                <p className="text-muted-foreground">
                    Your safe space to reflect. AI-powered summaries help you prepare for therapy.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8 items-start">

                {/* Main Content: Editor & Entries */}
                <div className="space-y-8">
                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                            <BookOpenIcon className="h-5 w-5 text-primary" />
                            New Entry
                        </h2>
                        <JournalEditor onEntrySaved={handleEntrySaved} />
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-4">Recent Entries</h2>
                        <div className="space-y-4">
                            {entries.length === 0 ? (
                                <div className="text-center py-10 bg-muted/20 rounded-xl border border-dashed border-muted-foreground/30">
                                    <p className="text-muted-foreground">No entries yet. Start writing above!</p>
                                </div>
                            ) : (
                                entries.map((entry) => (
                                    <div key={entry.id} className="bg-card p-6 rounded-xl border border-border hover:border-primary/30 transition-all shadow-sm">
                                        <div className="text-xs font-bold text-primary mb-2 uppercase tracking-wide">
                                            {new Date(entry.created_at).toLocaleDateString(undefined, {
                                                weekday: 'long',
                                                year: 'numeric',
                                                month: 'long',
                                                day: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            })}
                                        </div>
                                        <p className="text-foreground whitespace-pre-wrap leading-relaxed">
                                            {entry.cleaned_content || entry.content}
                                        </p>
                                    </div>
                                ))
                            )}
                        </div>
                    </section>
                </div>

                {/* Sidebar: AI Summary */}
                <div className="sticky top-20">
                    <Card className="border-border/60 bg-card/50 backdrop-blur-sm">
                        <CardContent className="p-6">
                            <div className="flex items-center gap-2 mb-4 text-primary">
                                <SparklesIcon className="h-6 w-6" />
                                <h2 className="font-semibold text-lg">Therapy Prep</h2>
                            </div>

                            <p className="text-sm text-muted-foreground mb-6">
                                Generate therapist-written discussion prompts based on your recent entries.
                            </p>

                            <div className="grid grid-cols-2 gap-2 mb-4 bg-muted/50 p-1 rounded-lg">
                                {['weekly', 'monthly', 'annual', 'custom'].map((type) => (
                                    <button
                                        key={type}
                                        onClick={() => setSummaryType(type)}
                                        className={cn(
                                            "py-1.5 text-xs font-medium rounded-md transition-all capitalize",
                                            summaryType === type
                                                ? "bg-card shadow-sm text-primary"
                                                : "text-muted-foreground hover:text-primary"
                                        )}
                                    >
                                        {type}
                                    </button>
                                ))}
                            </div>

                            {summaryType === 'custom' && (
                                <div className="flex flex-col gap-3 mb-6 animate-in fade-in slide-in-from-top-2">
                                    <div className="space-y-1">
                                        <label className="text-xs font-medium text-muted-foreground">Start Date</label>
                                        <input
                                            type="date"
                                            value={customDates.start}
                                            onChange={(e) => setCustomDates(prev => ({ ...prev, start: e.target.value }))}
                                            className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm text-foreground focus:ring-1 focus:ring-ring outline-none"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-medium text-muted-foreground">End Date</label>
                                        <input
                                            type="date"
                                            value={customDates.end}
                                            onChange={(e) => setCustomDates(prev => ({ ...prev, end: e.target.value }))}
                                            className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm text-foreground focus:ring-1 focus:ring-ring outline-none"
                                        />
                                    </div>
                                </div>
                            )}

                            <ButtonComponent
                                onClick={handleGenerateSummary}
                                disabled={
                                    isGeneratingSummary ||
                                    entries.length === 0 ||
                                    (summaryType === 'custom' && (!customDates.start || !customDates.end))
                                }
                                className={cn(
                                    "w-full",
                                    isGeneratingSummary ? "opacity-70 cursor-wait" : ""
                                )}
                            >
                                {isGeneratingSummary ? (
                                    <>
                                        <div className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin mr-2" />
                                        <span>Analysing...</span>
                                    </>
                                ) : (
                                    <>
                                        <SparklesIcon className="h-4 w-4 mr-2" />
                                        <span>Generate Prompts</span>
                                    </>
                                )}
                            </ButtonComponent>

                            {summaryNotice && (
                                <div className="mt-4 text-xs text-muted-foreground">
                                    {summaryNotice}
                                </div>
                            )}

                            {summaryPoints.length > 0 && (
                                <div className="mt-4 flex items-center justify-between rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                                    <span>Therapy prep ready.</span>
                                    <button
                                        type="button"
                                        onClick={() => setIsSummaryModalOpen(true)}
                                        className="font-semibold hover:underline"
                                    >
                                        Open
                                    </button>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
            <TherapyPrepModal
                isOpen={isSummaryModalOpen}
                onClose={() => setIsSummaryModalOpen(false)}
                summaryPoints={summaryPoints}
                summaryType={summaryContext?.type}
                periodLabel={summaryPeriodLabel}
            />
        </div>
    );
}
