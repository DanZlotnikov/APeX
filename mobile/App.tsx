import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getProfile, getSession, logout, signIn } from './src/api/auth';
import { getAthleteById } from './src/api/athletes';
import { addNotificationTapListener, registerForPushNotifications } from './src/api/pushNotifications';
import { syncLocalDataFromServer } from './src/api/sync';
import { AthleteViewModel, TargetExercise } from './src/api/types';
import { uploadAndQueueVideoJob } from './src/api/videoJobs';
import CameraScreen from './src/screens/CameraScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import LoginScreen from './src/screens/LoginScreen';
import SignUpScreen from './src/screens/SignUpScreen';
import AthleteDetailPreview from './src/screens/manager/AthleteDetailPreview';
import ManagerHome from './src/screens/manager/ManagerHome';
import ManagerSettings from './src/screens/manager/ManagerSettings';
import ManagerTopBar from './src/screens/manager/ManagerTopBar';
import { SettingsProvider, useSettings } from './src/state/SettingsContext';
import { ConfirmDialogHost } from './src/utils/confirm';
import { configureSound } from './src/utils/sound';

type Role = 'athlete' | 'manager';
type AthleteScreen = 'dashboard' | 'camera';
type ManagerScreen = 'manager-dashboard' | 'manager-athlete' | 'manager-settings';

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
  const [targetExercise, setTargetExercise] = useState<TargetExercise | null>(null);
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
    setTargetExercise(null);
    setAthleteScreen('camera');
  }

  async function handleUpload() {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        quality: 1,
      });
      if (!res.canceled && res.assets?.[0]?.uri) {
        setUploadedUri(res.assets[0].uri);
        setTargetExercise(null);
        setAthleteScreen('camera');
      }
    } catch {}
  }

  // Tapping a required task on the dashboard: same live-camera flow as
  // goToCamera, but carrying which exercise this attempt is for so
  // AnalysisScreen can compare what was actually performed against it.
  function goToCameraForTask(target: TargetExercise) {
    setUploadedUri(null);
    setTargetExercise(target);
    setAthleteScreen('camera');
  }

  // Upload + queue a video_jobs row for the server-side pipeline (see
  // api/videoJobs.ts / HANDOFF_video_pipeline.md) — no more on-device
  // analysis or synchronous "analysis" screen. Errors are left to propagate
  // so CameraScreen's own confirm handler can catch them and show its error
  // banner instead of the recording flow silently losing the clip.
  async function handleVideoConfirmed(uri: string, durationSec: number) {
    if (!userId) throw new Error('Not signed in.');
    await uploadAndQueueVideoJob({
      athleteId: userId,
      localUri: uri,
      durationSec,
      targetExerciseKey: targetExercise?.key ?? null,
    });
    setUploadedUri(null);
    setTargetExercise(null);
    setAthleteScreen('dashboard');
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
      <>
        <StatusBar style="light" />

        {athleteScreen === 'dashboard' && (
          <FadeScreen>
            <DashboardScreen
              userId={userId ?? undefined}
              teamId={teamId ?? undefined}
              onRecord={goToCamera}
              onUpload={() => void handleUpload()}
              onSelectTask={goToCameraForTask}
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
              targetLabel={targetExercise?.label}
              onVideoConfirmed={handleVideoConfirmed}
              onBack={() => { setUploadedUri(null); setTargetExercise(null); setAthleteScreen('dashboard'); }}
            />
          </FadeScreen>
        )}
      </>
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
              <ManagerSettings teamId={teamId} />
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
