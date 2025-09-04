import { retryWithBackoff } from './apiClient';

/**
 * Wraps a Supabase query with timeout and retry logic
 * @param {Function} queryFn - Function that returns a Supabase query
 * @param {Object} options - Configuration options
 * @returns {Promise} Query result
 */
export async function supabaseRequest(queryFn, options = {}) {
  const {
    timeout = 10000, // 10 seconds default
    maxRetries = 2,
    retryOn = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'],
    operation = 'query'
  } = options;

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    // For idempotent operations, use retry logic
    if (['fetch', 'select'].includes(operation)) {
      return await retryWithBackoff(
        async () => {
          const query = queryFn();
          // Add abort signal if the query supports it
          if (query.abortSignal) {
            query.abortSignal(controller.signal);
          }
          const result = await query;
          
          // Check for errors
          if (result.error) {
            // Check if error is retryable
            const isRetryable = retryOn.some(code => 
              result.error.code === code || 
              result.error.message?.includes(code)
            );
            
            if (isRetryable) {
              throw new Error(result.error.message);
            }
            
            // Non-retryable error, return as-is
            return result;
          }
          
          return result;
        },
        maxRetries
      );
    } else {
      // For non-idempotent operations, don't retry
      const query = queryFn();
      if (query.abortSignal) {
        query.abortSignal(controller.signal);
      }
      return await query;
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      return {
        data: null,
        error: {
          code: 'TIMEOUT',
          message: `Request timeout after ${timeout}ms`
        }
      };
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Execute multiple Supabase queries in parallel with timeout
 * @param {Array<Function>} queryFns - Array of functions that return Supabase queries
 * @param {Object} options - Configuration options
 * @returns {Promise<Array>} Array of query results
 */
export async function supabaseBatch(queryFns, options = {}) {
  const promises = queryFns.map(queryFn => 
    supabaseRequest(queryFn, options)
  );
  
  return Promise.all(promises);
}

/**
 * Helper to handle pagination parameters
 * @param {Object} params - Query parameters
 * @returns {Object} Sanitized pagination params
 */
export function getPaginationParams(params) {
  const limit = Math.min(
    Math.max(1, parseInt(params.limit || 50)),
    200
  );
  
  const offset = Math.max(0, parseInt(params.offset || 0));
  
  return { limit, offset };
}

/**
 * Format pagination response
 * @param {Object} data - Query data
 * @param {number} count - Total count
 * @param {Object} params - Pagination params
 * @returns {Object} Formatted response with pagination metadata
 */
export function formatPaginationResponse(data, count, params) {
  const { limit, offset } = params;
  
  return {
    data: data || [],
    pagination: {
      total: count || 0,
      limit,
      offset,
      hasMore: (offset + limit) < (count || 0),
      page: Math.floor(offset / limit) + 1,
      totalPages: Math.ceil((count || 0) / limit)
    }
  };
}