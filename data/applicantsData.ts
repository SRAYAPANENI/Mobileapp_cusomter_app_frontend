export interface Review {
  id: string;
  customer: string;
  rating: number;
  date: string;
  comment: string;
  metrics: { behaviour: number; negotiation: number; clarity: number };
}

export interface WorkProof {
  id: string;
  type: 'image' | 'video';
  url: string;
  thumbnail?: string;
  skill: string;
}

export interface Applicant {
  id: string;
  name: string;
  profession: string;
  expertise: 'Expert' | 'Beginner' | 'Intermediate';
  skillMatch: number;
  distance: string;
  rating: number;
  jobsCompleted: number;
  profileImage: string;
  about: string;
  skills: string[];
  experience: string;
  memberSince: string;
  workProof: WorkProof[];
  reviews: Review[];
  // Same per-dimension breakdown shown on the provider's own profile — null
  // until they have at least one real review.
  avgSkillRating?: number | null;
  avgPunctualityRating?: number | null;
  avgBehaviourRating?: number | null;
  avgCommunicationRating?: number | null;
  reviewCount?: number;
}

