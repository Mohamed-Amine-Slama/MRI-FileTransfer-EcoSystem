import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import {
  updateProfileSchema,
  userPreferencesSchema,
  type UserPreferences,
} from '@mir/contracts';
import { RequiresRole } from '../../../shared/authz/access-metadata';
import { ProfileService, type ProfileRow } from './profile.service';

/**
 * A user's own profile and preferences.
 *
 * EVERY ROLE, including `applicant`. Someone waiting on a verification decision
 * still has a name to correct and a language to choose, and §5.1 P0 is explicit
 * that they must be able to look after themselves without contacting the
 * platform team. Listing a role here grants reachability only — row-level
 * security decides which row comes back, and for all five roles that is
 * exactly one: their own.
 */
@Controller('auth')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @RequiresRole('patient', 'libya_doctor', 'tunisia_doctor', 'admin', 'applicant', 'assistant')
  @Get('profile')
  async get(): Promise<ProfileRow> {
    return this.profile.get();
  }

  @RequiresRole('patient', 'libya_doctor', 'tunisia_doctor', 'admin', 'applicant', 'assistant')
  @Patch('profile')
  async update(@Body() body: unknown): Promise<ProfileRow> {
    return this.profile.update(updateProfileSchema.parse(body));
  }

  @RequiresRole('patient', 'libya_doctor', 'tunisia_doctor', 'admin', 'applicant', 'assistant')
  @Get('preferences')
  async preferences(): Promise<UserPreferences> {
    return this.profile.preferences();
  }

  /**
   * PUT, not PATCH: the settings screen holds the whole object and sends it
   * back. A partial update would need a merge rule, and the one place that rule
   * could be wrong — a toggle that silently reverts — is the least forgiving
   * place for it to be.
   */
  @RequiresRole('patient', 'libya_doctor', 'tunisia_doctor', 'admin', 'applicant', 'assistant')
  @Put('preferences')
  async setPreferences(@Body() body: unknown): Promise<UserPreferences> {
    return this.profile.setPreferences(userPreferencesSchema.parse(body));
  }
}
