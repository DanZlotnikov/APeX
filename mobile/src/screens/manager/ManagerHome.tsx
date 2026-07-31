import React from 'react';
import { AthleteViewModel } from '../../api/types';
import ManagerDashboard from './ManagerDashboard';

interface Props {
  teamId: string;
  onAthleteSelect: (athlete: AthleteViewModel) => void;
}

// Used to be a 2-tab Athletes/Routine bar — Routine was a team-wide default
// + per-athlete assignment grid, replaced by a genuinely per-athlete
// "Individual Routine" tab living on each athlete's own detail page
// (AthleteDetailPreview) instead (see supabase/migrations/
// 021_individual_routines.sql). With only one manager-level screen left,
// this renders ManagerDashboard directly rather than keeping a
// single-item tab bar around.
export default function ManagerHome({ teamId, onAthleteSelect }: Props) {
  return <ManagerDashboard teamId={teamId} onAthleteSelect={onAthleteSelect} />;
}
