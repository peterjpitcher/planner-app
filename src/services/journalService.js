


export const journalService = {
    async saveEntry(content, entryId) {
        const response = await fetch('/api/journal/entries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ content, entryId }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Failed to save entry');
        }

        return response.json();
    },

    async getEntries() {
        const response = await fetch('/api/journal/entries', {
            cache: 'no-store',
            credentials: 'include',
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Failed to fetch entries');
        }

        const data = await response.json();
        if (Array.isArray(data)) {
            return data;
        }
        return data?.data || [];
    },

    async getSummary(type = 'weekly', dates = null) {
        // Fetch entries first to pass to API
        const entries = await this.getEntries();

        // Filter entries based on type
        const now = new Date();
        const filteredEntries = entries.filter(entry => {
            const entryDate = new Date(entry.created_at);

            if (type === 'custom' && dates?.start && dates?.end) {
                const start = new Date(dates.start);
                const end = new Date(dates.end);
                // Set end date to end of day to include entries on that day
                end.setHours(23, 59, 59, 999);
                return entryDate >= start && entryDate <= end;
            }

            const daysDiff = (now - entryDate) / (1000 * 60 * 60 * 24);
            switch (type) {
                case 'weekly': return daysDiff <= 7;
                case 'monthly': return daysDiff <= 30;
                case 'annual': return daysDiff <= 365;
                default: return daysDiff <= 7;
            }
        });

        if (filteredEntries.length === 0) {
            return { summary: [], message: 'No journal entries found for this period.' };
        }

        const response = await fetch('/api/journal/summary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ type, entries: filteredEntries }),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to generate summary');
        }

        return response.json();
    },

    async cleanupEntry(entryId) {
        const response = await fetch('/api/journal/entries/cleanup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ entryId }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Failed to clean entry');
        }

        return response.json();
    }
};
