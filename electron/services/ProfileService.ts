import { DatabaseService } from './DatabaseService';
import type { LauncherProfile } from '../../shared/types';

/** Thin profile boundary used by IPC: validates inputs before touching persistent state. */
export class ProfileService {
  constructor(private readonly database: DatabaseService) {}

  list(): LauncherProfile[] {
    return this.database.getProfiles();
  }

  create(name: string): LauncherProfile {
    if (typeof name !== 'string') throw new Error('Profile name must be text.');
    return this.database.createProfile(name);
  }

  update(profileId: string, patch: Parameters<DatabaseService['updateProfile']>[1]): LauncherProfile {
    if (typeof profileId !== 'string' || !profileId) throw new Error('A profile is required.');
    return this.database.updateProfile(profileId, patch);
  }

  setActive(profileId: string): void {
    this.database.setActiveProfile(profileId);
  }

  delete(profileId: string): void {
    this.database.deleteProfile(profileId);
  }
}
