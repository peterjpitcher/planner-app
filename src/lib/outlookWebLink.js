/*
 * A link that opens one message in Outlook on the web.
 *
 * The follow-up tracker stores the message id the Microsoft 365 connector
 * returns. That id is Graph's URL-safe form: "+" is written "_" and "/" is
 * written "-". Outlook's own link (Graph's webLink) wants the standard form,
 * URL-encoded. Checked against the live mailbox on 17 Sep 2026: an id ending
 * "qE_GAAccNjhNAAA=" has the webLink ItemID "qE%2BGAAccNjhNAAA%3D". Using the
 * stored id as it is would not open the message.
 */

const OWA_READ_URL = 'https://outlook.office365.com/owa/';

/** The Outlook on the web link for a stored message id, or null. */
export function outlookMessageLink(messageId) {
  const id = typeof messageId === 'string' ? messageId.trim() : '';
  if (!id) return null;

  const standardId = id.replace(/_/g, '+').replace(/-/g, '/');
  return `${OWA_READ_URL}?ItemID=${encodeURIComponent(standardId)}&exvsurl=1&viewmodel=ReadMessageItem`;
}
