// Error Handling Utilities

import { ERROR_MESSAGES } from './constants';

/**
 * Handle errors consistently across the application
 * @param {Error} error - The error object
 * @param {string} context - Context where the error occurred
 * @param {Object} options - Additional options
 * @returns {string} User-friendly error message
 */
export function handleError(error, context, options = {}) {
  const { showAlert = false, fallbackMessage = ERROR_MESSAGES.GENERIC } = options;
  
  // Log error in development
  if (process.env.NODE_ENV === 'development') {
    console.error(`[${context}]:`, error);
  }
  
  // Determine user-friendly message
  let userMessage = fallbackMessage;
  
  if (error.message) {
    // Network errors
    if (error.message.includes('fetch') || error.message.includes('network')) {
      userMessage = ERROR_MESSAGES.NETWORK;
    }
    // Authentication errors
    else if (error.message.includes('auth') || error.message.includes('unauthorized')) {
      userMessage = ERROR_MESSAGES.AUTH;
    }
    // Not found errors
    else if (error.message.includes('not found') || error.code === 'PGRST116') {
      userMessage = ERROR_MESSAGES.NOT_FOUND;
    }
    // Validation errors
    else if (error.message.includes('validation') || error.message.includes('invalid')) {
      userMessage = ERROR_MESSAGES.VALIDATION;
    }
  }
  
  // Show alert if requested
  if (showAlert) {
    alert(userMessage);
  }
  
  return userMessage;
}

/**
 * Create a standardized error response
 * @param {string} message - Error message
 * @param {number} status - HTTP status code
 * @param {Object} details - Additional error details
 * @returns {Object} Error response object
 */
export function createErrorResponse(message, status = 500, details = {}) {
  return {
    error: true,
    message,
    status,
    details,
    timestamp: new Date().toISOString()
  };
}

/**
 * Wrap an async function with error handling
 * @param {Function} fn - Async function to wrap
 * @param {string} context - Context for error logging
 * @returns {Function} Wrapped function
 */
export function withErrorHandler(fn, context) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      const message = handleError(error, context);
      throw new Error(message);
    }
  };
}

/**
 * Handle Supabase errors specifically
 * @param {Object} error - Supabase error object
 * @param {string} operation - Operation that failed
 * @returns {string} User-friendly error message
 */
export function handleSupabaseError(error, operation) {
  if (!error) return null;
  
  const errorMessages = {
    // Auth errors
    'Invalid login credentials': ERROR_MESSAGES.AUTH,
    'User not found': ERROR_MESSAGES.AUTH,
    
    // Database errors
    'PGRST116': ERROR_MESSAGES.NOT_FOUND,
    'PGRST204': 'No data found',
    '23505': 'This item already exists',
    '23503': 'Cannot delete - item is referenced by other data',
    '22P02': ERROR_MESSAGES.VALIDATION,
    
    // Network errors
    'Failed to fetch': ERROR_MESSAGES.NETWORK,
    'NetworkError': ERROR_MESSAGES.NETWORK
  };
  
  // Check for specific error codes
  const message = errorMessages[error.code] || errorMessages[error.message] || null;
  
  if (message) return message;
  
  // Default messages by operation
  const operationMessages = {
    create: 'Failed to create item',
    update: 'Failed to update item',
    delete: 'Failed to delete item',
    fetch: 'Failed to load data'
  };
  
  return operationMessages[operation] || ERROR_MESSAGES.GENERIC;
}

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} delay - Initial delay in milliseconds
 * @returns {Promise} Result of the function
 */
export async function retryWithBackoff(fn, maxRetries = 3, delay = 1000) {
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Don't retry on client errors (4xx)
      if (error.status && error.status >= 400 && error.status < 500) {
        throw error;
      }
      
      // Wait before retrying
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
      }
    }
  }
  
  throw lastError;
}