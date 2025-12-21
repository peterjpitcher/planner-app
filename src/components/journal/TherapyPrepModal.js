'use client';

import { Dialog } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';

const summaryTypeLabels = {
    weekly: 'Past week',
    monthly: 'Past month',
    annual: 'Past year',
    custom: 'Custom range',
};

export default function TherapyPrepModal({
    isOpen,
    onClose,
    summaryPoints = [],
    summaryType = 'weekly',
    periodLabel,
}) {
    const resolvedPeriodLabel = periodLabel || summaryTypeLabels[summaryType] || 'Recent entries';

    return (
        <Dialog open={isOpen} onClose={onClose} className="relative z-[80]">
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" aria-hidden="true" />

            <div className="fixed inset-0 flex items-center justify-center p-4 sm:p-6">
                <Dialog.Panel className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10">
                    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
                        <div>
                            <Dialog.Title className="text-xl font-semibold text-slate-900">
                                Therapy Prep Prompts
                            </Dialog.Title>
                            <p className="mt-1 text-sm text-slate-500">
                                {resolvedPeriodLabel} - Use these to guide your next session with Victoria.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0496c7]/40"
                            aria-label="Close therapy prep"
                        >
                            <XMarkIcon className="h-5 w-5" />
                        </button>
                    </div>

                    <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
                        {summaryPoints.length > 0 ? (
                            <ul className="list-disc space-y-4 pl-5 text-base leading-relaxed text-slate-700">
                                {summaryPoints.map((point, index) => (
                                    <li key={`${index}-${point.slice(0, 24)}`}>
                                        {point}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-sm text-slate-500">No discussion prompts available yet.</p>
                        )}
                    </div>

                    <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
                        >
                            Close
                        </button>
                    </div>
                </Dialog.Panel>
            </div>
        </Dialog>
    );
}
