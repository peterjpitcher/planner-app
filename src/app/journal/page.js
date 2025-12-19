'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import AppShell from '@/components/layout/AppShell';
import JournalEditor from '@/components/journal/JournalEditor';
import { journalService } from '@/services/journalService';
import { BookOpenIcon, SparklesIcon, CalendarIcon } from '@heroicons/react/24/outline';

export default function JournalPage() {
    const { data: session } = useSession();
    const [entries, setEntries] = useState([]);
    const [summary, setSummary] = useState(null);
    const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
    const [summaryType, setSummaryType] = useState('weekly'); // 'weekly', 'monthly', 'annual', 'custom'
    const [customDates, setCustomDates] = useState({ start: '', end: '' });

    const fetchEntries = async () => {
        try {
            const data = await journalService.getEntries();
            setEntries(data || []);
        } catch (error) {
            console.error('Failed to load entries:', error);
        }
    };

    useEffect(() => {
        if (session?.user) {
            fetchEntries();
        }
    }, [session]);

    const handleGenerateSummary = async () => {
        setIsGeneratingSummary(true);
        setSummary(null);
        try {
            const result = await journalService.getSummary(summaryType, customDates);
            setSummary(result.summary);
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
                        <JournalEditor onEntrySaved={fetchEntries} />
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
                                        <p className="text-[#052a3b] whitespace-pre-wrap leading-relaxed">{entry.content}</p>
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
                            Generate a clinical summary of your recent journal entries to prepare for your session with Victoria.
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
                                    <span>Generate Summary</span>
                                </>
                            )}
                        </button>

                        {summary && (
                            <div className="mt-6 pt-6 border-t border-[#0496c7]/10 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <h3 className="text-sm font-semibold text-[#052a3b] mb-3 uppercase tracking-wider">
                                    Analysis for Victoria
                                </h3>
                                <div className="prose prose-sm prose-blue max-w-none bg-white/50 p-4 rounded-xl text-[#052a3b]/90 leading-relaxed">
                                    {summary}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

            </div>
        </AppShell>
    );
}
