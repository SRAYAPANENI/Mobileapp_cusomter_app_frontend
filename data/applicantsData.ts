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
  inspectionFee: number;
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

export const DUMMY_APPLICANTS: Applicant[] = [
  {
    id: '1',
    name: 'Rajesh Kumar',
    profession: 'AC Technician',
    expertise: 'Expert',
    skillMatch: 92,
    distance: '1.4 mi away',
    inspectionFee: 499,
    rating: 4.8,
    jobsCompleted: 124,
    profileImage: 'https://randomuser.me/api/portraits/men/32.jpg',
    about: '8+ years of experience in AC servicing, repairs, and installations. Specializing in split and window AC units.',
    experience: '8 Years',
    memberSince: 'Oct 2021',
    skills: ['Deep Cleaning', 'Gas Refilling', 'PCB Repair', 'Installation'],
    workProof: [
      { id: '1', type: 'image', url: 'https://images.unsplash.com/photo-1581094288338-2314dddb7ecb?auto=format&fit=crop&q=80&w=800', skill: 'Installation' },
      { id: '2', type: 'video', url: 'https://sample-videos.com/video123/mp4/720/big_buck_bunny_720p_1mb.mp4', thumbnail: 'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&q=80&w=800', skill: 'Deep Cleaning' },
      { id: '3', type: 'image', url: 'https://images.unsplash.com/photo-1599939339720-30758411bc04?auto=format&fit=crop&q=80&w=800', skill: 'Gas Refilling' },
    ],
    reviews: [
      { id: '1', customer: 'Sumanth K.', rating: 5, date: '2 days ago', comment: 'Excellent work and very polite.', metrics: { behaviour: 5, negotiation: 5, clarity: 5 } },
      { id: '2', customer: 'Arun M.', rating: 4, date: '1 week ago', comment: 'Good service.', metrics: { behaviour: 4, negotiation: 4, clarity: 5 } },
    ]
  },
  {
    id: '2',
    name: 'Priya Singh',
    profession: 'Electrician',
    expertise: 'Expert',
    skillMatch: 60,
    distance: '2.5 mi away',
    inspectionFee: 350,
    rating: 4.5,
    jobsCompleted: 88,
    profileImage: 'https://randomuser.me/api/portraits/women/44.jpg',
    about: 'Certified electrician with 5 years experience in domestic and commercial wiring and appliance repair.',
    experience: '5 Years',
    memberSince: 'Mar 2022',
    skills: ['Wiring', 'Switchboard Repair', 'Fan Repair', 'MCB Setup'],
    workProof: [
      { id: '1', type: 'image', url: 'https://images.unsplash.com/photo-1621905252507-b354bcadc0d6?auto=format&fit=crop&q=80&w=800', skill: 'Wiring' },
      { id: '2', type: 'image', url: 'https://images.unsplash.com/photo-1544724123-dc194539660c?auto=format&fit=crop&q=80&w=800', skill: 'Switchboard Repair' },
    ],
    reviews: [
      { id: '1', customer: 'Deepika R.', rating: 4, date: '3 days ago', comment: 'Fixed the wiring issue quickly.', metrics: { behaviour: 5, negotiation: 3, clarity: 4 } },
    ]
  },
  {
    id: '3',
    name: 'Amit Patel',
    profession: 'Plumber',
    expertise: 'Beginner',
    skillMatch: 60,
    distance: '1.1 mi away',
    inspectionFee: 200,
    rating: 4.2,
    jobsCompleted: 45,
    profileImage: 'https://randomuser.me/api/portraits/men/85.jpg',
    about: 'Aspiring plumber with 1 year experience helping with basic plumbing needs like leaks and taps.',
    experience: '1 Year',
    memberSince: 'Jan 2024',
    skills: ['Tap Repair', 'Pipe Leakage', 'Sink Fix', 'Tank Cleaning'],
    workProof: [
      { id: '1', type: 'image', url: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?auto=format&fit=crop&q=80&w=800', skill: 'Tap Repair' },
    ],
    reviews: []
  },
];

export const getApplicantById = (id: string) => DUMMY_APPLICANTS.find(a => a.id === id);
