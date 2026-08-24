


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
        // The route reads the entries itself, scoped to the signed-in user. This
        // used to fetch every entry, filter them in the browser and POST the full
        // bodies back, which meant the server had no way to tell whose journal it
        // was summarising and sent whatever it was handed to OpenAI.
        const response = await fetch('/api/journal/summary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ type, dates }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
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
