import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getServerSession } from 'next-auth/next';

import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import {
  exchangeCodeForToken,
  fetchMicrosoftProfile,
  getOrCreatePlannerList,
  createTodoSubscription,
  listTodoLists,
  createTodoList
} from '@/lib/microsoftGraphClient';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { updateSecret } from '@/lib/supabaseVault';
import { enqueueTaskSyncJob } from '@/services/taskSyncQueue';

const STATE_COOKIE_NAME = 'planner_outlook_oauth_state';

export async function GET(request) {
  const session = await getServerSession(authOptions);
  const url = new URL(request.url);
  const errorParam = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  const origin = url.origin;
  const redirectTarget = `${origin}/dashboard?outlook=`;

  if (!session?.user?.id) {
    return NextResponse.redirect(`${origin}/login?outlook=unauthorized`);
  }

  if (errorParam) {
    return NextResponse.redirect(`${redirectTarget}${encodeURIComponent(errorParam)}`);
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return NextResponse.redirect(`${redirectTarget}missing_code`);
  }

  const stateCookie = cookies().get(STATE_COOKIE_NAME);

  if (!stateCookie || stateCookie.value !== state) {
    return NextResponse.redirect(`${redirectTarget}state_mismatch`);
  }

  const redirectUri = `${origin}/api/integrations/outlook/callback`;

  try {
    const tokenResponse = await exchangeCodeForToken({ code, redirectUri });

    const accessToken = tokenResponse.access_token;
    const refreshToken = tokenResponse.refresh_token;
    const expiresIn = tokenResponse.expires_in || 3600;

    if (!accessToken || !refreshToken) {
      return NextResponse.redirect(`${redirectTarget}token_error`);
    }

    const [profile, plannerList] = await Promise.all([
      fetchMicrosoftProfile(accessToken),
      getOrCreatePlannerList(accessToken, 'Planner')
    ]);

    if (!plannerList?.id) {
      throw new Error('Planner list not available');
    }

    let subscription = null;
    if (process.env.OUTLOOK_WEBHOOK_URL) {
      const durationCandidate = parseInt(process.env.OUTLOOK_SUBSCRIPTION_DURATION_MIN || '60', 10);
      const subscriptionDuration = Number.isNaN(durationCandidate) ? 60 : durationCandidate;

      try {
        subscription = await createTodoSubscription(
          accessToken,
          plannerList.id,
          process.env.OUTLOOK_WEBHOOK_URL,
          subscriptionDuration
        );
      } catch (subscriptionError) {
        console.error('Failed to create Outlook subscription:', subscriptionError);
      }
    }

    const supabase = getSupabaseServiceRole();

    const { data: existingConnection, error: fetchError } = await supabase
      .from('outlook_connections')
      .select('refresh_token_secret, delta_token, subscription_id, subscription_expiration')
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (fetchError) {
      throw fetchError;
    }

    const refreshTokenSecretId = await updateSecret(
      existingConnection?.refresh_token_secret || null,
      refreshToken
    );

    const expiresAt = new Date(Date.now() + (expiresIn - 60) * 1000).toISOString();

    const { error: upsertError } = await supabase
      .from('outlook_connections')
      .upsert({
        user_id: session.user.id,
        microsoft_account_id: profile?.id || '',
        tenant_id: profile?.tenantId || null,
        planner_list_id: plannerList?.id,
        refresh_token_secret: refreshTokenSecretId,
        access_token: accessToken,
        access_token_expires_at: expiresAt,
        delta_token: existingConnection?.delta_token || null,
        subscription_id: subscription?.id || existingConnection?.subscription_id || null,
        subscription_expiration: subscription?.expirationDateTime || existingConnection?.subscription_expiration || null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

    if (upsertError) {
      throw upsertError;
    }

    try {
      const { data: projects } = await supabase
        .from('projects')
        .select('id, name')
        .eq('user_id', session.user.id);

      const existingMappings = await supabase
        .from('project_outlook_lists')
        .select('project_id, graph_list_id')
        .eq('user_id', session.user.id);

      const mappingSet = new Set((existingMappings.data || []).map((item) => item.project_id));
      const graphLists = await listTodoLists(accessToken);
      const listByName = new Map();
      if (Array.isArray(graphLists?.value)) {
        graphLists.value.forEach((list) => {
          if (list?.displayName) {
            listByName.set(list.displayName.toLowerCase(), list);
          }
        });
      }

      const desiredLists = (projects || []).filter((project) => !mappingSet.has(project.id));

      for (const project of desiredLists) {
        const displayName = (project.name || 'Planner Project').trim().slice(0, 120);
        let list = listByName.get(displayName.toLowerCase()) || null;

        if (!list) {
          list = await createTodoList(accessToken, displayName);
          listByName.set(displayName.toLowerCase(), list);
        }

        await supabase
          .from('project_outlook_lists')
          .upsert({
            user_id: session.user.id,
            project_id: project.id,
            graph_list_id: list.id,
            graph_etag: list?.['@odata.etag'] || null,
            is_active: true
          }, { onConflict: 'project_id' });
      }
    } catch (listInitError) {
      console.error('Failed to initialize Outlook lists for projects:', listInitError);
    }

    await enqueueTaskSyncJob({
      userId: session.user.id,
      action: 'full_sync',
      scheduleAt: new Date(Date.now() + 2000).toISOString()
    });

    const response = NextResponse.redirect(`${redirectTarget}connected`);
    response.cookies.set(STATE_COOKIE_NAME, '', {
      maxAge: 0,
      path: '/api/integrations/outlook'
    });
    return response;
  } catch (error) {
    console.error('Outlook callback error:', error);

    const response = NextResponse.redirect(
      errorDescription
        ? `${redirectTarget}${encodeURIComponent(errorDescription)}`
        : `${redirectTarget}callback_error`
    );

    response.cookies.set(STATE_COOKIE_NAME, '', {
      maxAge: 0,
      path: '/api/integrations/outlook'
    });

    return response;
  }
}
