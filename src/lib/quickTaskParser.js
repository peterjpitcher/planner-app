// src/lib/quickTaskParser.js
//
// Adds customer resolution on top of the date grammar in quickTaskDateParser.
//
// This wraps rather than extends that module on purpose: the date grammar is
// subtle and well covered by its own tests, and mixing a second grammar into it
// would put both at risk for no benefit. The customer token is stripped first,
// then whatever remains goes to the date parser exactly as before.
//
// The two forms behave differently, deliberately:
//
//   @Name    is a command. Nobody types "@Northgate" by accident, so if it
//            matches nothing it creates that customer.
//   for Name is prose. "for" is far too common a word to trust, so it only ever
//            matches a customer that already exists, and never creates one.
//
// Without that asymmetry, "Buy flowers for the wedding tomorrow" would invent a
// customer called "the wedding".

import { parseQuickTaskDate } from './quickTaskDateParser';
import { getLondonDateKey } from './timezone';
import { normaliseName } from './validators';

/**
 * Characters allowed inside an unquoted customer name. Anything else ends it,
 * which is what stops "Check @Acme," from resolving to a customer called
 * "Acme,".
 */
const NAME_CHAR = "[\\p{L}\\p{N}&.'\\-/]";

/**
 * An @ token, anchored to the start of the line or to whitespace.
 *
 * The anchor is the single most important rule here. Without it,
 * "Email joe@acme.com about the quote" would create a customer called
 * "acme.com" the first time you typed it.
 */
const AT_TOKEN = new RegExp(`(^|\\s)@(?:"([^"]*)"|(${NAME_CHAR}+))`, 'gu');

/** A bare @ with nothing usable after it, so it can be reported rather than ignored. */
const BARE_AT = /(^|\s)@(?=\s|$)/u;

/** An unclosed quote, e.g. `@"Acme Ltd` with no closing mark. */
const UNCLOSED_QUOTE = /(^|\s)@"[^"]*$/u;

function stripRange(text, start, end) {
  return `${text.slice(0, start)}${text.slice(end)}`.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Longest existing-customer name that the text matches at `from`.
 *
 * Longest wins so "@Acme Ltd" resolves to the customer "Acme Ltd" rather than
 * creating a second one called "Acme" and leaving "Ltd" in the task name.
 *
 * @param {string} text
 * @param {number} from index just after the @
 * @param {Array<{id: string, name: string}>} customers
 * @returns {{customer: Object, length: number}|null}
 */
function matchLongestCustomerAt(text, from, customers) {
  const remainder = text.slice(from);
  const lowerRemainder = remainder.toLowerCase();

  let best = null;
  customers.forEach((customer) => {
    const name = normaliseName(customer.name);
    if (!name) return;
    const lowerName = name.toLowerCase();
    if (!lowerRemainder.startsWith(lowerName)) return;

    // The match has to end at a word boundary, so "Acme" does not match inside
    // "Acmecorp".
    const nextChar = remainder.charAt(name.length);
    if (nextChar && new RegExp(NAME_CHAR, 'u').test(nextChar)) return;

    if (!best || name.length > best.length) {
      best = { customer, length: name.length };
    }
  });

  return best;
}

/**
 * `for <existing customer>` anywhere in the line.
 *
 * Only exact matches against real customers, longest first, and it never
 * creates. Unmatched text is left in the task name rather than dropped.
 *
 * @returns {{customer: Object, start: number, end: number}|null}
 */
function matchForForm(text, customers) {
  const sorted = [...customers]
    .map((customer) => ({ customer, name: normaliseName(customer.name) }))
    .filter((entry) => entry.name.length > 0)
    .sort((a, b) => b.name.length - a.name.length);

  for (const { customer, name } of sorted) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|\\s)for\\s+${escaped}(?=$|[\\s,.;:!?])`, 'iu');
    const match = pattern.exec(text);
    if (match) {
      return {
        customer,
        start: match.index + match[1].length,
        end: match.index + match[0].length,
      };
    }
  }

  return null;
}

/**
 * Parse one capture line into a task.
 *
 * @param {string} input
 * @param {Object} [options]
 * @param {string} [options.baseDateKey] London date the relative phrases resolve against
 * @param {Array<{id: string, name: string, archived_at: string|null}>} [options.customers]
 * @param {boolean} [options.allowCreate] false on a project's input, where the
 *   task takes the project's customer and a token would be discarded by the trigger
 * @returns {{
 *   name: string,
 *   dueDate: string,
 *   customerId: string|null,
 *   customerName: string|null,
 *   createsCustomer: boolean,
 *   warning: string|null,
 *   error: string|null
 * }}
 */
export function parseQuickTask(input, options = {}) {
  const {
    baseDateKey = getLondonDateKey(),
    customers = [],
    allowCreate = true,
  } = options;

  const text = String(input || '').trim();
  const empty = {
    name: text,
    dueDate: baseDateKey,
    customerId: null,
    customerName: null,
    createsCustomer: false,
    warning: null,
    error: null,
  };

  if (!text) return empty;

  const tokens = [...text.matchAll(AT_TOKEN)];

  // More than one is an error, not a guess. Picking the first would file the
  // task somewhere the preview did not show.
  if (tokens.length > 1) {
    return { ...empty, error: 'More than one customer named. Use one @customer per task.' };
  }

  if (tokens.length === 0 && UNCLOSED_QUOTE.test(text)) {
    return { ...empty, error: 'Unclosed quote after @. Close it, or drop the quotes.' };
  }

  let working = text;
  let customerId = null;
  let customerName = null;
  let createsCustomer = false;
  let warning = null;

  if (tokens.length === 1) {
    const token = tokens[0];
    const leading = token[1] || '';
    const quoted = token[2];
    const bare = token[3];
    const tokenStart = token.index + leading.length;

    if (quoted !== undefined) {
      // Quoted is taken literally, which is how a multi-word new customer is
      // created without ambiguity.
      const name = normaliseName(quoted);
      const existing = customers.find(
        (customer) => normaliseName(customer.name).toLowerCase() === name.toLowerCase()
      );
      if (existing) {
        customerId = existing.id;
        customerName = existing.name;
      } else if (name) {
        customerName = name;
        createsCustomer = true;
      }
      working = stripRange(working, tokenStart, tokenStart + token[0].length - leading.length);
    } else {
      // Longest existing name first, so "@Acme Ltd" finds the customer "Acme
      // Ltd" rather than creating "Acme" and orphaning "Ltd" in the task name.
      const nameStart = tokenStart + 1;
      const longest = matchLongestCustomerAt(working, nameStart, customers);

      if (longest) {
        customerId = longest.customer.id;
        customerName = longest.customer.name;
        working = stripRange(working, tokenStart, nameStart + longest.length);
      } else {
        const name = normaliseName(bare);
        customerName = name;
        createsCustomer = Boolean(name);
        working = stripRange(working, tokenStart, nameStart + bare.length);
      }
    }

    if (createsCustomer && !allowCreate) {
      return {
        ...empty,
        error:
          "Tasks on a project take the project's customer. Set it on the project instead.",
      };
    }

    if (customerId && !allowCreate) {
      return {
        ...empty,
        error:
          "Tasks on a project take the project's customer. Set it on the project instead.",
      };
    }
  } else if (BARE_AT.test(text)) {
    warning = 'No customer name after the @.';
  } else {
    // No @ token, so try the prose form. Never creates.
    const forMatch = matchForForm(working, customers);
    if (forMatch) {
      if (!allowCreate) {
        return {
          ...empty,
          error:
            "Tasks on a project take the project's customer. Set it on the project instead.",
        };
      }
      customerId = forMatch.customer.id;
      customerName = forMatch.customer.name;
      working = stripRange(working, forMatch.start, forMatch.end);
    }
  }

  const parsed = parseQuickTaskDate(working, baseDateKey);

  if (customerId) {
    const customer = customers.find((entry) => entry.id === customerId);
    if (customer?.archived_at) {
      warning = `${customer.name} is archived and will be restored.`;
    }
  }

  return {
    name: parsed.name,
    dueDate: parsed.dueDate,
    customerId,
    customerName,
    createsCustomer,
    warning,
    error: null,
  };
}

/**
 * The closest existing customer to a name about to be created, for the "did you
 * mean" hint. A cheap edit-distance rather than a trigram index, because this
 * runs in the browser against a list of tens of names.
 *
 * @param {string} name
 * @param {Array<{id: string, name: string}>} customers
 * @returns {Object|null}
 */
export function findNearMiss(name, customers = []) {
  const target = normaliseName(name).toLowerCase();
  if (target.length < 3) return null;

  let best = null;

  customers.forEach((customer) => {
    const candidate = normaliseName(customer.name).toLowerCase();
    if (candidate === target) return;
    // Only worth comparing names of a similar length.
    if (Math.abs(candidate.length - target.length) > 2) return;

    const distance = editDistance(target, candidate);
    if (distance <= 2 && (!best || distance < best.distance)) {
      best = { customer, distance };
    }
  });

  return best ? best.customer : null;
}

function editDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, i) => i);

  for (let i = 1; i < rows; i += 1) {
    const current = [i];
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }

  return previous[cols - 1];
}
