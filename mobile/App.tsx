import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getProfile, getSession, logout, signIn } from './src/api/auth';
import { getAthleteById } from './src/api/athletes';
import { AthleteViewModel } from './src/api/types';
import AnalysisScreen from './src/screens/AnalysisScreen';
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
type AthleteScreen = 'dashboard' | 'camera' | 'analysis';
type ManagerScreen = 'manager-dashboard' | 'manager-athlete' | 'manager-settings';

function FadeScreen({ children }: { children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, []);
  return <Animated.View style={{ flex: 1, opacity }}>{children}</Animated.View>;
}

function AppInner() {
  const { settings } = useSettings();

  const [role,           setRole]           = useState<Role | null>(null);
  const [userId,         setUserId]         = useState<string | null>(null);
  const [teamId,         setTeamId]         = useState<string | null>(null);
  const [athleteName,    setAthleteName]    = useState<string>('');
  const [showSignUp,     setShowSignUp]     = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);

  // Athlete flow
  const [athleteScreen, setAthleteScreen] = useState<AthleteScreen>('dashboard');
  const [uploadedUri,   setUploadedUri]   = useState<string | null>(null);
  const [videoUri,      setVideoUri]      = useState<string | null>(null);
  const [testMode] = useState(false);

  // Manager flow
  const [managerScreen,   setManagerScreen]   = useState<ManagerScreen>('manager-dashboard');
  const [selectedAthlete, setSelectedAthlete] = useState<AthleteViewModel | null>(null);

  useEffect(() => { configureSound(settings.sound); }, [settings.sound]);

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
  async function handleSignIn(email: string, password: string) {
    const user    = await signIn(email, password);
    const profile = await getProfile(user.id);
    if (!profile) throw new Error('Profile not found. Contact support.');
    setUserId(user.id);
    setTeamId(profile.team_id);
    setAthleteName(profile.full_name);
    setRole(profile.role as Role);
  }

  function handleSignUpComplete(newUserId: string, newTeamId: string, newRole: Role, name: string) {
    setUserId(newUserId);
    setTeamId(newTeamId);
    setAthleteName(name);
    setRole(newRole);
    setShowSignUp(false);
  }

  // ── Athlete handlers ───────────────────────────────────────────────────────
  function goToCamera() {
    setUploadedUri(null);
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
        setAthleteScreen('camera');
      }
    } catch {}
  }

  function handleVideoReady(uri: string) {
    setVideoUri(uri);
    setAthleteScreen('analysis');
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
    const showAnalysis = athleteScreen === 'analysis' && !!videoUri;
    return (
      <>
        <StatusBar style="light" />

        {athleteScreen === 'dashboard' && (
          <FadeScreen>
            <DashboardScreen
              onRecord={goToCamera}
              onUpload={() => void handleUpload()}
              onLogout={handleAthleteLogout}
            />
          </FadeScreen>
        )}

        {athleteScreen === 'camera' && (
          <FadeScreen>
            <CameraScreen
              pickOnMount={false}
              testMode={testMode}
              initialVideoUri={uploadedUri ?? undefined}
              onVideoReady={handleVideoReady}
              onBack={() => { setUploadedUri(null); setAthleteScreen('dashboard'); }}
            />
          </FadeScreen>
        )}

        {showAnalysis && (
          <AnalysisScreen
            videoUri={videoUri!}
            userId={userId ?? undefined}
            teamId={teamId ?? undefined}
            athleteName={athleteName}
            onHome={() => { setVideoUri(null); setAthleteScreen('dashboard'); }}
          />
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
