// Database Webhook target for `video_jobs` UPDATE events — see
// HANDOFF_video_pipeline.md section 3.5.
//
// Database Webhooks aren't provisioned by SQL migrations; wire this up once,
// manually, after deploying this function:
//   Supabase Dashboard → Database → Webhooks → Create a new hook
//     Table:      video_jobs
//     Events:     Update
//     Type:       Supabase Edge Functions → notify-video-ready
//   (the dashboard's "Edge Functions" webhook type sets the service-role
//   auth header for you automatically)
//
// Deploy with: supabase functions deploy notify-video-ready

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface WebhookPayload {
  type: 'UPDATE';
  table: string;
  record: Record<string, any>;
  old_record: Record<string, any>;
}

Deno.serve(async (req) => {
  const payload: WebhookPayload = await req.json();
  const { record, old_record } = payload;

  // Database Webhooks fire on every UPDATE to the row, not just this one
  // transition — Supabase doesn't filter on a column *change* natively, so
  // that check happens here instead of in the webhook config.
  if (record?.status !== 'completed' || old_record?.status === 'completed') {
    return new Response('ignored: not a completion transition', { status: 200 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: profile } = await supabase
    .from('profiles')
    .select('expo_push_token')
    .eq('id', record.athlete_id)
    .single();

  const token = profile?.expo_push_token;
  if (!token) return new Response('ignored: athlete has no push token registered', { status: 200 });

  const pushRes = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      to: token,
      title: 'Your video is ready',
      body: 'Tap to see your movement analysis.',
      data: { jobId: record.id },
    }),
  });

  return new Response(await pushRes.text(), { status: pushRes.status });
});
