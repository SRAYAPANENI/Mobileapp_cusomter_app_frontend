import React, { createContext, useContext, useState } from 'react';
import { JobChoice } from '@/services/job-shape';
import { CareSheet } from '@/services/care-sheet';

interface PostRequirementData {
  description: string;
  // The AI analysis's one-line summary of the problem (step 1) — '' until
  // the customer runs it, and cleared again when they change what it was
  // based on (the description or the photos).
  problemSummary: string;
  media: { uri: string; type: 'image' | 'video' }[];
  profession: string;
  skills: string[];
  skill_id: string | null;
  skill_ids: string[];
  jobType: 'Urgent' | 'Normal' | 'Book Slot';
  date: string;
  time: string;
  // Raw values behind the friendly date/time strings above ("Today",
  // "09:00 AM - 11:00 AM") — needed to build a real scheduled_at timestamp
  // to actually send to the backend, since the display strings alone can't
  // be reliably parsed back into a Date.
  dateISO: string | null;
  timeHour: string;
  timeMinute: string;
  timePeriod: string;
  // Location resolved from home screen
  address: string;
  lat: number | null;
  lng: number | null;
  // "STANDARD" (default, one location) or "PICKUP_DROPOFF" (this location
  // becomes the pickup point; dropoff* below is the second point). Only
  // meaningful when serviceMode is ON_SITE — a REMOTE job can't have a
  // physical pickup/dropoff.
  jobKind: 'STANDARD' | 'PICKUP_DROPOFF';
  pickupPlaceId: string | null;
  pickupPlaceType: string | null;
  dropoffAddress: string;
  dropoffLat: number | null;
  dropoffLng: number | null;
  // Where, how long, and what's left with the provider (services/job-shape.ts)
  // — chosen on the summary screen for an ordinary job. Skills that can't
  // share a job are posted as several (services/skill-groups.ts), so each
  // job has its own answers, kept under its first skill's id.
  jobChoices: Record<string, JobChoice>;
  // Skills the AI suggested (names), until step 2 has chosen from them — and
  // shown first there. A suggestion never adds to a price by itself.
  aiSkills: string[];
  aiSkillsPending: boolean;
  // The AI read the problem as something done online: each job starts there.
  startOnline: boolean;
  // What's left with the provider — each pet's needs, or the item
  // (services/care-sheet.ts); asked when "A pet" or "An item" is chosen.
  careSheets: Record<string, CareSheet>;
}

interface PostRequirementContextType {
  data: PostRequirementData;
  updateData: (updates: Partial<PostRequirementData>) => void;
  resetData: () => void;
}

const initialData: PostRequirementData = {
  description: '',
  problemSummary: '',
  media: [],
  profession: '',
  skills: [],
  skill_id: null,
  skill_ids: [],
  jobType: 'Urgent',
  date: 'Today',
  time: 'Select Time',
  dateISO: null,
  timeHour: '09',
  timeMinute: '00',
  timePeriod: 'AM',
  address: '',
  lat: null,
  lng: null,
  jobKind: 'STANDARD',
  pickupPlaceId: null,
  pickupPlaceType: null,
  dropoffAddress: '',
  dropoffLat: null,
  dropoffLng: null,
  jobChoices: {},
  startOnline: false,
  aiSkills: [],
  aiSkillsPending: false,
  careSheets: {},
};

const PostRequirementContext = createContext<PostRequirementContextType | undefined>(undefined);

export function PostRequirementProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<PostRequirementData>(initialData);

  const updateData = (updates: Partial<PostRequirementData>) => {
    setData((prev) => ({ ...prev, ...updates }));
  };

  const resetData = () => {
    setData(initialData);
  };

  return (
    <PostRequirementContext.Provider value={{ data, updateData, resetData }}>
      {children}
    </PostRequirementContext.Provider>
  );
}

export function usePostRequirement() {
  const context = useContext(PostRequirementContext);
  if (context === undefined) {
    throw new Error('usePostRequirement must be used within a PostRequirementProvider');
  }
  return context;
}
