import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { AUTOPILOT_LEVEL } from '@/lib/constants';
import { fetchAutomationHealth } from '@/services/automationStatusService';

// GET /api/automations — Wave 4 automation control panel + heartbeat.
// Returns the caller's automation toggles and one health row per automation.
// The settings, digest and Outlook rows are scoped by user_id. The three cron
// rows (autopilot/evening-tidy/weekly-tidy) come from cron_runs, which has no
// user_id — they are APP-GLOBAL operational status (this is a single-owner app
// where all crons run for the one DIGEST_USER). Never returns any Outlook
// token/secret ids.
export async function GET(request) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const supabase = getSupabaseServiceRole();

    // Toggle state. Missing row → autopilot off, digest on (mirrors the DB
    // default digest_enabled=true). The error is intentionally ignored so a
    // transient read still yields sensible defaults rather than a 500.
    const { data: settingsRow } = await supabase
      .from('user_settings')
      .select('autopilot_level, digest_enabled')
      .eq('user_id', userId)
      .maybeSingle();

    const autopilotLevel = settingsRow?.autopilot_level || AUTOPILOT_LEVEL.OFF;
    const digestEnabled = settingsRow?.digest_enabled ?? true;

    // Outlook sync toggle for the settings summary — null when not connected.
    // SAFE column only; the heartbeat reads the rest resiliently in the service.
    const { data: connectionRow } = await supabase
      .from('office365_connections')
      .select('sync_enabled')
      .eq('user_id', userId)
      .maybeSingle();

    const office365SyncEnabled = connectionRow ? connectionRow.sync_enabled : null;

    const settings = { autopilot_level: autopilotLevel, digest_enabled: digestEnabled };
    const health = await fetchAutomationHealth({ supabase, userId, settings, nowMs: Date.now() });

    return NextResponse.json({
      settings: {
        autopilot_level: autopilotLevel,
        digest_enabled: digestEnabled,
        office365_sync_enabled: office365SyncEnabled,
      },
      health,
    });
  } catch (error) {
    console.error('GET /api/automations error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
