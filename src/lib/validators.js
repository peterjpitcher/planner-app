// Validation Utilities

import { VALIDATION, PROJECT_STATUS, STATE, TODAY_SECTION, TASK_TYPE, CHIP_VALUES, IDEA_STATE, CUSTOMER_STATUS } from './constants';

// Characters that must never appear in a name: they break display and can
// make two different rows look identical.
const CTRL_RE = /[\u0000-\u001f\u007f]/;

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
 * Only http and https are allowed in a customer website.
 *
 * This is not pedantry. The value is rendered as an href on the customer
 * header, and an unvalidated one accepts `javascript:`, which executes on
 * click. A denylist of known-bad schemes would be the wrong shape: the set of
 * URL schemes is open-ended, so the allowlist has to be positive.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isSafeWebUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return false;

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    return false;
  }

  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

/**
 * Collapse runs of whitespace and trim, so "Acme   Ltd " and "Acme Ltd" are the
 * same customer rather than two that merely look alike. The unique index does
 * the same normalisation, so doing it here keeps the API's 409 and the
 * database's constraint talking about the same thing.
 *
 * @param {string} value
 * @returns {string}
 */
export function normaliseName(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Validate customer data.
 *
 * @param {Object} customer
 * @returns {Object} { isValid: boolean, errors: Object }
 */
export function validateCustomer(customer) {
  const errors = {};

  const name = normaliseName(customer?.name);
  if (name.length === 0) {
    errors.name = 'Customer name is required';
  } else if (name.length > VALIDATION.CUSTOMER_NAME_MAX) {
    errors.name = `Customer name must be ${VALIDATION.CUSTOMER_NAME_MAX} characters or fewer`;
  } else if (CTRL_RE.test(name)) {
    // Control characters break the display, and a name containing a newline
    // makes two visually identical rows in the customer picker.
    errors.name = 'Customer name contains invalid characters';
  }

  if (customer?.status && !Object.values(CUSTOMER_STATUS).includes(customer.status)) {
    errors.status = 'Invalid customer status';
  }

  if (customer?.summary && customer.summary.length > VALIDATION.CUSTOMER_SUMMARY_MAX) {
    errors.summary = `Summary must be ${VALIDATION.CUSTOMER_SUMMARY_MAX} characters or fewer`;
  }

  if (customer?.website) {
    if (customer.website.length > VALIDATION.CUSTOMER_WEBSITE_MAX) {
      errors.website = `Website must be ${VALIDATION.CUSTOMER_WEBSITE_MAX} characters or fewer`;
    } else if (!isSafeWebUrl(customer.website)) {
      errors.website = 'Website must be a full http or https address';
    }
  }

  if (customer?.area && customer.area.length > VALIDATION.STAKEHOLDER_MAX) {
    errors.area = `Area must be ${VALIDATION.STAKEHOLDER_MAX} characters or fewer`;
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

  // State validation
  if (task.state !== undefined && task.state !== null && task.state !== '') {
    if (!Object.values(STATE).includes(task.state)) {
      errors.state = 'Invalid state value';
    }
  }

  // Today section validation
  if (task.today_section !== undefined && task.today_section !== null && task.today_section !== '') {
    if (!Object.values(TODAY_SECTION).includes(task.today_section)) {
      errors.today_section = 'Invalid today_section value';
    }
  }

  // Chips validation
  if (task.chips !== undefined && task.chips !== null) {
    if (!Array.isArray(task.chips)) {
      errors.chips = 'Chips must be an array';
    } else if (task.chips.length > 5) {
      errors.chips = 'Maximum 5 chips allowed';
    } else {
      const validChips = Object.values(CHIP_VALUES);
      const invalidChips = task.chips.filter(c => !validChips.includes(c));
      if (invalidChips.length > 0) {
        errors.chips = 'Invalid chip value';
      } else {
        const unique = new Set(task.chips);
        if (unique.size !== task.chips.length) {
          errors.chips = 'Chips must not contain duplicates';
        }
      }
    }
  }

  // Task type validation
  if (task.task_type !== undefined && task.task_type !== null && task.task_type !== '') {
    if (!Object.values(TASK_TYPE).includes(task.task_type)) {
      errors.task_type = 'Invalid task type';
    }
  }

  // Area validation
  if (task.area !== undefined && task.area !== null && task.area !== '') {
    if (task.area.length > 100) {
      errors.area = 'Area must be less than 100 characters';
    }
  }

  // Waiting reason validation
  if (task.waiting_reason !== undefined && task.waiting_reason !== null && task.waiting_reason !== '') {
    if (task.waiting_reason.length > 500) {
      errors.waiting_reason = 'Waiting reason must be less than 500 characters';
    }
  }

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

  // project_id is nullable — no mandatory check

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

  // Parent validation — note must belong to a project, task, or idea
  if (!note.project_id && !note.task_id && !note.idea_id) {
    errors.parent = 'Note must be associated with a project, task, or idea';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * Validate idea data
 * @param {Object} idea - Idea data to validate
 * @returns {Object} { isValid: boolean, errors: Object }
 */
export function validateIdea(idea) {
  const errors = {};

  // Title validation
  if (!idea.title || idea.title.trim().length === 0) {
    errors.title = 'Idea title is required';
  } else if (idea.title.length > 255) {
    errors.title = 'Idea title must be less than 255 characters';
  }

  // Idea state validation
  if (idea.idea_state !== undefined && idea.idea_state !== null && idea.idea_state !== '') {
    if (!Object.values(IDEA_STATE).includes(idea.idea_state)) {
      errors.idea_state = 'Invalid idea state';
    }
  }

  // Area validation
  if (idea.area !== undefined && idea.area !== null && idea.area !== '') {
    if (idea.area.length > 100) {
      errors.area = 'Area must be less than 100 characters';
    }
  }

  // Why it matters validation
  if (idea.why_it_matters !== undefined && idea.why_it_matters !== null && idea.why_it_matters !== '') {
    if (idea.why_it_matters.length > 1000) {
      errors.why_it_matters = 'Why it matters must be less than 1000 characters';
    }
  }

  // Smallest step validation
  if (idea.smallest_step !== undefined && idea.smallest_step !== null && idea.smallest_step !== '') {
    if (idea.smallest_step.length > 1000) {
      errors.smallest_step = 'Smallest step must be less than 1000 characters';
    }
  }

  // Notes validation
  if (idea.notes !== undefined && idea.notes !== null && idea.notes !== '') {
    if (idea.notes.length > 1000) {
      errors.notes = 'Notes must be less than 1000 characters';
    }
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
