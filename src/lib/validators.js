// Validation Utilities

import { VALIDATION, PRIORITY, PROJECT_STATUS } from './constants';

/**
 * Validate project data
 * @param {Object} project - Project data to validate
 * @returns {Object} { isValid: boolean, errors: Object }
 */
export function validateProject(project) {
  const errors = {};
  
  // Name validation
  if (!project.name || project.name.trim().length === 0) {
    errors.name = 'Project name is required';
  } else if (project.name.length > VALIDATION.PROJECT_NAME_MAX) {
    errors.name = `Project name must be less than ${VALIDATION.PROJECT_NAME_MAX} characters`;
  }
  
  // Priority validation
  if (project.priority && !Object.values(PRIORITY).includes(project.priority)) {
    errors.priority = 'Invalid priority level';
  }
  
  // Status validation
  if (project.status && !Object.values(PROJECT_STATUS).includes(project.status)) {
    errors.status = 'Invalid project status';
  }
  
  // Due date validation
  if (project.due_date) {
    const dueDate = new Date(project.due_date);
    if (isNaN(dueDate.getTime())) {
      errors.due_date = 'Invalid due date';
    }
  }
  
  // Stakeholders validation
  if (project.stakeholders && Array.isArray(project.stakeholders)) {
    if (project.stakeholders.length > VALIDATION.MAX_STAKEHOLDERS) {
      errors.stakeholders = `Maximum ${VALIDATION.MAX_STAKEHOLDERS} stakeholders allowed`;
    }
    const invalidStakeholders = project.stakeholders.filter(
      sh => !sh || sh.trim().length === 0 || sh.length > VALIDATION.STAKEHOLDER_MAX
    );
    if (invalidStakeholders.length > 0) {
      errors.stakeholders = 'Invalid stakeholder names';
    }
  }
  
  // Description validation
  if (project.description && project.description.length > VALIDATION.DESCRIPTION_MAX) {
    errors.description = `Description must be less than ${VALIDATION.DESCRIPTION_MAX} characters`;
  }
  
  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * Validate task data
 * @param {Object} task - Task data to validate
 * @returns {Object} { isValid: boolean, errors: Object }
 */
export function validateTask(task) {
  const errors = {};
  
  // Name validation
  if (!task.name || task.name.trim().length === 0) {
    errors.name = 'Task name is required';
  } else if (task.name.length > VALIDATION.TASK_NAME_MAX) {
    errors.name = `Task name must be less than ${VALIDATION.TASK_NAME_MAX} characters`;
  }
  
  // Priority validation
  if (task.priority && !Object.values(PRIORITY).includes(task.priority)) {
    errors.priority = 'Invalid priority level';
  }

  const validateScoreField = (fieldName, label) => {
    if (task[fieldName] === undefined || task[fieldName] === null || task[fieldName] === '') return;
    const numeric = typeof task[fieldName] === 'number' ? task[fieldName] : Number(task[fieldName]);
    if (!Number.isFinite(numeric)) {
      errors[fieldName] = `${label} must be a number between 0 and 100`;
      return;
    }
    const rounded = Math.round(numeric);
    if (rounded < 0 || rounded > 100) {
      errors[fieldName] = `${label} must be between 0 and 100`;
    }
  };

  validateScoreField('importance_score', 'Importance score');
  validateScoreField('urgency_score', 'Urgency score');
  
  // Due date validation
  if (task.due_date) {
    const dueDate = new Date(task.due_date);
    if (isNaN(dueDate.getTime())) {
      errors.due_date = 'Invalid due date';
    }
  }
  
  // Description validation
  if (task.description && task.description.length > VALIDATION.DESCRIPTION_MAX) {
    errors.description = `Description must be less than ${VALIDATION.DESCRIPTION_MAX} characters`;
  }
  
  // Project ID validation
  if (!task.project_id) {
    errors.project_id = 'Task must be associated with a project';
  }
  
  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * Validate note data
 * @param {Object} note - Note data to validate
 * @returns {Object} { isValid: boolean, errors: Object }
 */
export function validateNote(note) {
  const errors = {};
  
  // Content validation
  if (!note.content || note.content.trim().length === 0) {
    errors.content = 'Note content is required';
  } else if (note.content.length > VALIDATION.NOTE_MAX) {
    errors.content = `Note must be less than ${VALIDATION.NOTE_MAX} characters`;
  }
  
  // Parent validation
  if (!note.project_id && !note.task_id) {
    errors.parent = 'Note must be associated with a project or task';
  }
  
  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * Sanitize user input to prevent XSS
 * @param {string} input - User input to sanitize
 * @returns {string} Sanitized input
 */
export function sanitizeInput(input) {
  if (!input) return '';
  
  // Convert to string and trim
  const str = String(input).trim();
  
  // Remove any HTML tags
  const withoutTags = str.replace(/<[^>]*>/g, '');
  
  // Escape special HTML characters
  const escaped = withoutTags
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  
  return escaped;
}

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid email
 */
export function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate date is not in the past
 * @param {string|Date} date - Date to validate
 * @returns {boolean} True if date is today or in the future
 */
export function isValidFutureDate(date) {
  const inputDate = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return inputDate >= today;
}
