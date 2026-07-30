import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getProfile, getSession, logout, signIn } from './src/api/auth';
import { getAthleteById } from './src/api/athletes';
import { addNotificationTapListener, registerForPushNotifications } from './src/api/pushNotifications';
import { syncLocalDataFromServer } from './src/api/sync';
import { AthleteViewModel } from './src/api/types';
import { generateJobId, uploadAndQueueVideoJob } from './src/api/videoJobs';
import CameraScreen from './src/screens/CameraScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import LoginScreen from './src/screens/LoginScreen';
import SignUpScreen from './src/screens/SignUpScreen';
import AthleteDetailPreview from './src/screens/manager/AthleteDetailPreview';
import ManagerHome from './src/screens/manager/ManagerHome';
import ManagerSettings from './src/screens/manager/ManagerSettings';
import ManagerTopBar from './src/screens/manager/ManagerTopBar';
import { addLocalUpload, markLocalUploadFailed } from './src/state/localUploads';
import { SettingsProvider, useSettings } from './src/state/SettingsContext';
import { VideoJobsProvider } from './src/state/VideoJobsContext';
import { ConfirmDialogHost } from './src/utils/confirm';
import { configureSound } from './src/utils/sound';

type Role = 'athlete' | 'manager';
type AthleteScreen = 'dashboard' | 'camera';
type ManagerScreen = 'manager-dashboard' | 'manager-athlete' | 'manager-settings';

// Must match CameraScreen.tsx's RECORD_SECONDS — this is the same cap
// applied to an uploaded/picked clip instead of a live recording.
const MAX_VIDEO_DURATION_SEC = 20;

function FadeScreen({ children }: { children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, []);
  return <Animated.View style={{ flex: 1, opacity }}>{children}</Animated.View>;
}

function AppInner() {
  const { settings, refreshProfile } = useSettings();

  const [role,           setRole]           = useState<Role | null>(null);
  const [userId,         setUserId]         = useState<string | null>(null);
  const [teamId,         setTeamId]         = useState<string | null>(null);
  const [athleteName,    setAthleteName]    = useState<string>('');
  const [showSignUp,     setShowSignUp]     = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);

  // Athlete flow
  const [athleteScreen, setAthleteScreen] = useState<AthleteScreen>('dashboard');
  const [uploadedUri,   setUploadedUri]   = useState<string | null>(null);
  // Duration of an uploaded/picked clip, captured here since CameraScreen's
  // own duration-tracking (its recording timer, or its own dead pickVideo()
  // path) never runs for this flow — without threading it through explicitly,
  // CameraScreen's videoDurationSec stayed null and every upload silently
  // recorded duration_sec=0, regardless of the clip's real length.
  const [uploadedDurationSec, setUploadedDurationSec] = useState<number | null>(null);
  const [testMode] = useState(false);

  // Manager flow
  const [managerScreen,   setManagerScreen]   = useState<ManagerScreen>('manager-dashboard');
  const [selectedAthlete, setSelectedAthlete] = useState<AthleteViewModel | null>(null);

  // Bumped on every tapped video-ready notification — DashboardScreen watches
  // this to jump to Performance > Processing (see checklist item 9). A
  // counter, not a boolean, so tapping a second notification while already on
  // the dashboard still re-triggers the jump.
  const [processingDeepLinkToken, setProcessingDeepLinkToken] = useState(0);

  useEffect(() => { configureSound(settings.sound); }, [settings.sound]);

  // Push token registration is best-effort and safe to call once role/userId
  // settle, whether from a fresh sign-in or a restored session — see
  // api/pushNotifications.ts (no-ops in Expo Go, which has no remote push
  // support since SDK 53; real registration needs an EAS dev build).
  useEffect(() => {
    if (role === 'athlete' && userId) void registerForPushNotifications(userId);
  }, [role, userId]);

  // Tapping a "your video is ready" notification deep-links to Performance >
  // Processing — registered once, independent of which screen is showing.
  useEffect(() => {
    return addNotificationTapListener(() => {
      setAthleteScreen('dashboard');
      setProcessingDeepLinkToken((n) => n + 1);
    });
  }, []);

  // ── Restore session on mount (handles page refresh) ────────────────────────
  useEffect(() => {
    getSession()
      .then(async (session) => {
        if (session?.user) {
          const profile = await getProfile(session.user.id).catch(() => null);
          if (profile) {
            setUserId(session.user.id);
            setTeamId(profile.team_id);
            setAthleteName(profile.full_name);
            setRole(profile.role as Role);
          }
        }
      })
      .catch(() => {})
      .finally(() => setSessionChecked(true));
  }, []);

  // ── Auth ───────────────────────────────────────────────────────────────────
  // A genuine login/signup action (as opposed to the session-restore effect
  // above, which resumes an already-logged-in device) pulls history + profile
  // fresh from the DB before entering the app, so local storage — which is
  // device-scoped and may be empty or stale on this device — never shows the
  // wrong (or no) data for the first moment after signing in. Once inside the
  // app, everything reads from local storage as normal (see api/sync.ts).
  async function handleSignIn(email: string, password: string) {
    const user    = await signIn(email, password);
    const profile = await getProfile(user.id);
    if (!profile) throw new Error('Profile not found. Contact support.');
    if (profile.role === 'athlete') {
      await syncLocalDataFromServer(user.id);
      await refreshProfile();
    }
    setUserId(user.id);
    setTeamId(profile.team_id);
    setAthleteName(profile.full_name);
    setRole(profile.role as Role);
  }

  // A new signup is treated the same as a fresh login (sync runs regardless
  // of whether there's anything to pull yet — keeps the two paths identical
  // rather than relying on "a brand-new account has no data anyway").
  async function handleSignUpComplete(newUserId: string, newTeamId: string | null, newRole: Role, name: string) {
    if (newRole === 'athlete') {
      await syncLocalDataFromServer(newUserId);
      await refreshProfile();
    }
    setUserId(newUserId);
    setTeamId(newTeamId);
    setAthleteName(name);
    setRole(newRole);
    setShowSignUp(false);
  }

  // ── Athlete handlers ───────────────────────────────────────────────────────
  // Generic "Record"/"Upload" (AppBar) are free-record: no specific required
  // exercise attached, so AnalysisScreen shows its old unconditional Save
  // Analysis behavior.
  function goToCamera() {
    setUploadedUri(null);
    setUploadedDurationSec(null);
    setAthleteScreen('camera');
  }

  async function handleUpload() {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        quality: 1,
      });
      if (!res.canceled && res.assets?.[0]?.uri) {
        const asset = res.assets[0];
        // duration comes back in ms; expo-image-picker's videoMaxDuration
        // option only limits a NEW recording made through the picker's own
        // camera, not which existing library video can be selected — so an
        // over-length clip has to be caught here, after picking.
        if (asset.duration != null && asset.duration / 1000 > MAX_VIDEO_DURATION_SEC) {
          Alert.alert('Video too long', `Please choose a video ${MAX_VIDEO_DURATION_SEC} seconds or shorter.`);
          return;
        }
        setUploadedUri(asset.uri);
        setUploadedDurationSec(asset.duration != null ? asset.duration / 1000 : null);
        setAthleteScreen('camera');
      }
    } catch {}
  }

  // Tapping confirm (✓) on the review screen returns to the dashboard
  // immediately — the upload + video_jobs insert (api/videoJobs.ts /
  // HANDOFF_video_pipeline.md) runs in the background, not awaited by the
  // caller. CameraScreen used to await this and block the review screen on
  // the network round-trip; now it doesn't wait at all, so this function is
  // synchronous from CameraScreen's point of view. Local values that
  // setUploadedUri(null)/etc. below would otherwise clear are captured
  // into consts first.
  //
  // The job id is generated HERE, up front, instead of letting
  // uploadAndQueueVideoJob generate its own — addLocalUpload registers an
  // optimistic "N videos processing" entry under that id the instant this
  // runs (state/localUploads.ts; this component isn't a descendant of
  // VideoJobsProvider so it can't use the context directly), and reusing
  // the same id for the real row means useVideoJobs.ts can hand off from
  // the loader placeholder to the real card by id, not by some separate
  // matching heuristic.
  function handleVideoConfirmed(uri: string, durationSec: number) {
    if (!userId) {
      Alert.alert('Not signed in', 'Please sign in again and try recording once more.');
      return;
    }
    const athleteId = userId;
    const jobId = generateJobId();

    setUploadedUri(null);
    setAthleteScreen('dashboard');

    addLocalUpload({ id: jobId, durationSec });

    void (async () => {
      try {
        await uploadAndQueueVideoJob({ jobId, athleteId, localUri: uri, durationSec });
        // Deliberately does NOT call removeLocalUpload here on success.
        // This component isn't a descendant of VideoJobsProvider, so it has
        // no way to push the freshly-uploaded real job into the shared
        // `jobs` array directly — only useVideoJobs.ts's refetch (Realtime-
        // triggered, confirmed to sometimes take 5-6s end to end) can do
        // that. Removing the local upload's "processing" contribution the
        // instant THIS call resolves, ahead of that, would drop
        // processingCount to 0 for however long Realtime takes to catch up
        // — a real, confirmed-possible flicker, not a theoretical one.
        // Leaving it in place until useVideoJobs.ts's own reconciliation
        // (which prunes a local upload the moment a real job with the same
        // id shows up in `jobs`, in the very same refetch that adds it)
        // guarantees zero gap: the local "processing" slot only clears at
        // the exact moment the real one takes over.
      } catch (e) {
        console.warn('[APeX] Background video upload failed:', e);
        markLocalUploadFailed(jobId, e instanceof Error ? e.message : 'Upload failed');
      }
    })();
  }

  function handleAthleteLogout() {
    setAthleteScreen('dashboard');
    setRole(null);
    setUserId(null);
    setTeamId(null);
    void logout();
  }

  // ── Manager handlers ───────────────────────────────────────────────────────
  function handleAthleteSelect(athlete: AthleteViewModel) {
    setSelectedAthlete(athlete);
    setManagerScreen('manager-athlete');
  }

  async function handleNotifNavigate(athleteId: string | null) {
    if (!athleteId) return;
    try {
      const athlete = await getAthleteById(athleteId);
      if (athlete) handleAthleteSelect(athlete);
    } catch (e) {
      console.warn('Failed to load athlete for notification nav', e);
    }
  }

  function handleManagerLogout() {
    setManagerScreen('manager-dashboard');
    setRole(null);
    setUserId(null);
    setTeamId(null);
    void logout();
  }

  // ── Auth screens ───────────────────────────────────────────────────────────
  if (!sessionChecked) {
    return (
      <View style={{ flex: 1, backgroundColor: '#07101C', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#00D4BC" size="large" />
      </View>
    );
  }

  if (role === null) {
    if (showSignUp) {
      return (
        <>
          <StatusBar style="light" />
          <SignUpScreen
            onSuccess={handleSignUpComplete}
            onBack={() => setShowSignUp(false)}
          />
        </>
      );
    }
    return (
      <>
        <StatusBar style="light" />
        <LoginScreen
          onLogin={(email, password) => handleSignIn(email, password)}
          onSignUp={() => setShowSignUp(true)}
        />
      </>
    );
  }

  // ── Athlete app ────────────────────────────────────────────────────────────
  if (role === 'athlete') {
    return (
      <VideoJobsProvider athleteId={userId ?? undefined}>
        <StatusBar style="light" />

        {athleteScreen === 'dashboard' && (
          <FadeScreen>
            <DashboardScreen
              userId={userId ?? undefined}
              teamId={teamId ?? undefined}
              onRecord={goToCamera}
              onUpload={() => void handleUpload()}
              onLogout={handleAthleteLogout}
              jumpToProcessingSignal={processingDeepLinkToken}
            />
          </FadeScreen>
        )}

        {athleteScreen === 'camera' && (
          <FadeScreen>
            <CameraScreen
              pickOnMount={false}
              testMode={testMode}
              initialVideoUri={uploadedUri ?? undefined}
              initialVideoDurationSec={uploadedDurationSec ?? undefined}
              onVideoConfirmed={handleVideoConfirmed}
              onBack={() => { setUploadedUri(null); setUploadedDurationSec(null); setAthleteScreen('dashboard'); }}
            />
          </FadeScreen>
        )}
      </VideoJobsProvider>
    );
  }

  // ── Manager app ────────────────────────────────────────────────────────────
  if (!teamId || !userId) return null;

  return (
    <>
      <StatusBar style="light" />
      <View style={{ flex: 1, backgroundColor: '#07101C' }}>
        <ManagerTopBar
          screen={managerScreen}
          onBack={() => setManagerScreen('manager-dashboard')}
          teamId={teamId}
          managerId={userId}
          onNotifNavigate={(id) => void handleNotifNavigate(id)}
          onSettings={() => setManagerScreen('manager-settings')}
          onLogout={handleManagerLogout}
        />

        <View style={{ flex: 1 }}>
          {managerScreen === 'manager-dashboard' && (
            <FadeScreen>
              <ManagerHome teamId={teamId} onAthleteSelect={handleAthleteSelect} />
            </FadeScreen>
          )}

          {managerScreen === 'manager-athlete' && selectedAthlete && (
            <FadeScreen>
              <AthleteDetailPreview
                athlete={selectedAthlete}
                onStatusChanged={() => setManagerScreen('manager-dashboard')}
              />
            </FadeScreen>
          )}

          {managerScreen === 'manager-settings' && (
            <FadeScreen>
              <ManagerSettings teamId={teamId} onLogout={handleManagerLogout} />
            </FadeScreen>
          )}
        </View>
      </View>
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <AppInner />
        <ConfirmDialogHost />
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({});
