// src/lib/rpc.js
//
// The one place lifecycle RPCs are called from.
//
// Why this exists at all: anything that changes more than one row has to be a
// single database transaction, and separate .update()/.insert() calls through
// the Supabase client are separate PostgREST requests, so they are separate
// transactions. A service function is not a transaction boundary. Closing a
// project touches the project, its tasks, its notes, its files, a close-out
// note and possibly some facts, so it is one Postgres function, not six calls.
//
// See docs/superpowers/specs/2026-09-01-customers-crm-design.md section 7.8.

/**
 * PostgreSQL error codes the lifecycle functions raise deliberately, mapped to
 * the HTTP status a route should return.
 *
 * The functions are SECURITY DEFINER and take p_user_id, so they check
 * ownership themselves and raise 42501 when it fails. Without this mapping a
 * route cannot tell "not yours" from "the database fell over", and would return
 * 500 for both.
 */
const PG_CODE_TO_STATUS = {
  '42501': 403, // insufficient_privilege, raised by the fn_assert_*_owner guards
  '23505': 409, // unique_violation, e.g. a customer name that already exists
  '23503': 409, // foreign_key_violation
  '23514': 400, // check_violation
  '22023': 400, // invalid_parameter_value, raised for missing required arguments
  P0002: 404, // no_data_found
};

/**
 * Conditions the functions raise by name rather than by code, where the code
 * alone would be ambiguous. Kept small on purpose: a growing list here means
 * the functions are signalling badly.
 */
const PG_MESSAGE_TO_STATUS = {
  project_closed: 409,
  not_owner: 403,
  stale_state: 409,
};

/**
 * Turn a Supabase RPC error into something a route can return directly.
 *
 * @param {object|null} error Supabase error object
 * @param {string} fnName Function that was called, for the log line
 * @returns {{status: number, message: string, code: string|null}}
 */
export function mapRpcError(error, fnName) {
  const code = error?.code || null;
  const rawMessage = String(error?.message || '');

  const byMessage = Object.keys(PG_MESSAGE_TO_STATUS).find((key) =>
    rawMessage.includes(key)
  );

  const status =
    PG_CODE_TO_STATUS[code] ||
    (byMessage ? PG_MESSAGE_TO_STATUS[byMessage] : null) ||
    500;

  // A 500 is ours to fix, so it gets logged with the detail. A 4xx is the
  // caller's to fix and its message goes back to them, so it must not leak
  // internals: the functions raise readable messages for those cases.
  if (status >= 500) {
    console.error(`RPC ${fnName} failed:`, error);
    return { status, message: 'Internal server error', code };
  }

  return { status, message: rawMessage || 'Request could not be completed', code };
}

/**
 * Call a lifecycle RPC.
 *
 * Returns { data, error } rather than throwing, matching how the rest of the
 * service layer reports failures, so routes keep their existing shape.
 *
 * @param {object} supabase Service-role Supabase client
 * @param {string} fnName Postgres function name
 * @param {object} params Named arguments, p_ prefixed
 * @returns {Promise<{data: any, error: {status: number, message: string, code: string|null}|null}>}
 */
export async function callRpc(supabase, fnName, params = {}) {
  const { data, error } = await supabase.rpc(fnName, params);

  if (error) {
    return { data: null, error: mapRpcError(error, fnName) };
  }

  return { data, error: null };
}
