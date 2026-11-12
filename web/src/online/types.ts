export interface Profile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  showOnline: boolean;
}

export type ProfileInput = Omit<Profile, 'id'>;
export type Friend = Profile & { online: boolean | null };
export type FriendRequest = { id: string; from: Profile; to: Profile; status: string };
export type Social = { friends: Friend[]; requests: FriendRequest[] };
export type Invite = { id: string; roomId: string; from: Profile; expiresAt: string; status: string };

export interface Room {
  id: string;
  code: string;
  hostId: string;
  capacity: number;
  status: 'lobby' | 'started' | 'closed';
  matchId: string | null;
  canStart: boolean;
  members: (Profile & { ready: boolean; connected: boolean })[];
}
