// src/services/contactService.js
//
// The people registry.
//
// Called contacts, not customer_contacts, because it has to serve projects with
// no customer. customer_id is nullable: a contact can belong to a customer, or
// stand alone.

import { callRpc } from '@/lib/rpc';
import { normaliseName } from '@/lib/validators';

const CONTACT_COLUMNS =
  'id, user_id, customer_id, name, role, email, phone, notes, is_primary, archived_at, created_at, updated_at';

const CONTACT_FIELDS = ['customer_id', 'name', 'role', 'email', 'phone', 'notes'];

const LIMITS = { name: 120, role: 120, email: 320, phone: 40, notes: 2000 };

function pickContact(payload) {
  const picked = {};
  CONTACT_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(payload || {}, field)) {
      picked[field] = payload[field];
    }
  });
  if (typeof picked.name === 'string') picked.name = normaliseName(picked.name);
  if (typeof picked.email === 'string') picked.email = picked.email.trim().toLowerCase() || null;
  return picked;
}

/**
 * Validate a contact.
 *
 * Names are deliberately not unique. Two people at one company can share one,
 * and a name is not an identity, so SQL refusing to store a real person would
 * be the wrong trade. Probable duplicates are surfaced instead, see
 * findProbableDuplicates.
 */
export function validateContact(contact, isUpdate = false) {
  const errors = {};

  if (!isUpdate || Object.prototype.hasOwnProperty.call(contact, 'name')) {
    const name = normaliseName(contact?.name);
    if (name.length === 0) errors.name = 'Contact name is required';
    else if (name.length > LIMITS.name) errors.name = `Name must be ${LIMITS.name} characters or fewer`;
  }

  ['role', 'email', 'phone', 'notes'].forEach((field) => {
    const value = contact?.[field];
    if (typeof value === 'string' && value.length > LIMITS[field]) {
      errors[field] = `Must be ${LIMITS[field]} characters or fewer`;
    }
  });

  if (contact?.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
    errors.email = 'Invalid email address';
  }

  return { isValid: Object.keys(errors).length === 0, errors };
}

/**
 * Contacts that probably duplicate this one: same name AND a matching email or
 * phone. Name alone is not enough, because two people really can share a name.
 *
 * @returns {Array<Object>}
 */
export function findProbableDuplicates(candidate, existing = []) {
  const name = normaliseName(candidate?.name).toLowerCase();
  if (!name) return [];

  const email = (candidate?.email || '').trim().toLowerCase();
  const phone = (candidate?.phone || '').replace(/\D/g, '');

  return existing.filter((contact) => {
    if (contact.id === candidate?.id) return false;
    if (normaliseName(contact.name).toLowerCase() !== name) return false;

    const sameEmail = email && (contact.email || '').trim().toLowerCase() === email;
    const samePhone = phone && (contact.phone || '').replace(/\D/g, '') === phone;
    return Boolean(sameEmail || samePhone);
  });
}

export async function listContacts({ supabase, userId, customerId = null, includeArchived = false }) {
  let query = supabase.from('contacts').select(CONTACT_COLUMNS).eq('user_id', userId);

  if (customerId) query = query.eq('customer_id', customerId);
  if (!includeArchived) query = query.is('archived_at', null);

  const { data, error } = await query
    .order('is_primary', { ascending: false })
    .order('name', { ascending: true });

  if (error) return { data: null, error: { status: 500, message: error.message } };
  return { data: data || [], error: null };
}

export async function getContact({ supabase, userId, contactId }) {
  const { data, error } = await supabase
    .from('contacts')
    .select(CONTACT_COLUMNS)
    .eq('id', contactId)
    .maybeSingle();

  if (error) return { data: null, error: { status: 500, message: error.message } };
  if (!data) return { data: null, error: { status: 404, message: 'Contact not found' } };
  if (data.user_id !== userId) return { data: null, error: { status: 403, message: 'Forbidden' } };
  return { data, error: null };
}

export async function createContact({ supabase, userId, payload }) {
  const contact = pickContact(payload);

  const validation = validateContact(contact);
  if (!validation.isValid) {
    return { data: null, error: { status: 400, message: 'Validation failed', details: validation.errors } };
  }

  if (contact.customer_id) {
    const { data: customer } = await supabase
      .from('customers')
      .select('user_id')
      .eq('id', contact.customer_id)
      .maybeSingle();
    if (!customer) return { data: null, error: { status: 404, message: 'Customer not found' } };
    if (customer.user_id !== userId) return { data: null, error: { status: 403, message: 'Forbidden' } };
  }

  const { data, error } = await supabase
    .from('contacts')
    .insert({ ...contact, user_id: userId })
    .select(CONTACT_COLUMNS)
    .single();

  if (error) return { data: null, error: { status: 400, message: error.message } };
  return { data, error: null };
}

export async function updateContact({ supabase, userId, contactId, payload }) {
  const { data: existing, error: loadError } = await getContact({ supabase, userId, contactId });
  if (loadError) return { data: null, error: loadError };

  const updates = pickContact(payload);

  if (Object.prototype.hasOwnProperty.call(payload || {}, 'archived')) {
    updates.archived_at = payload.archived ? new Date().toISOString() : null;
    // An archived contact cannot be primary: the partial unique index excludes
    // archived rows, so leaving the flag set would make the customer look like
    // it has a primary contact that is not shown anywhere.
    if (payload.archived) updates.is_primary = false;
  }

  if (Object.keys(updates).length === 0) return { data: existing, error: null };

  const validation = validateContact({ ...existing, ...updates }, true);
  if (!validation.isValid) {
    return { data: null, error: { status: 400, message: 'Validation failed', details: validation.errors } };
  }

  const { data, error } = await supabase
    .from('contacts')
    .update(updates)
    .eq('id', contactId)
    .eq('user_id', userId)
    .select(CONTACT_COLUMNS)
    .single();

  if (error) return { data: null, error: { status: 400, message: error.message } };
  return { data, error: null };
}

export async function deleteContact({ supabase, userId, contactId }) {
  const { error: loadError } = await getContact({ supabase, userId, contactId });
  if (loadError) return { data: null, error: loadError };

  const { error } = await supabase.from('contacts').delete().eq('id', contactId).eq('user_id', userId);
  if (error) return { data: null, error: { status: 500, message: error.message } };
  return { data: { deleted: true }, error: null };
}

/**
 * Make one contact the primary for its customer.
 *
 * Through an RPC because two client PATCH calls would transiently break the
 * partial unique index: setting the new one before clearing the old leaves two
 * primaries for an instant, and the database refuses it.
 */
export async function setPrimaryContact({ supabase, userId, customerId, contactId }) {
  const { data, error } = await callRpc(supabase, 'set_primary_contact', {
    p_customer_id: customerId,
    p_contact_id: contactId,
    p_user_id: userId,
  });

  if (error) return { data: null, error };
  return { data, error: null };
}
