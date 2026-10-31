import { SHAPE_RUNNER } from '@workspace/data'
import { z } from '@workspace/zod'

import { COMMANDS } from '../../platform/commands.port'
import { defineModule } from '../../platform/module'
import { SESSION } from '../../platform/session.port'

import { PROFILE_SERVICE, ProfileService } from './application/profile.service'
import { SETTINGS_SERVICE } from './application/settings/settings.service'
import { SIGN_IN_SERVICE, SignInService } from './application/sign-in.service'
import { VERIFY_EMAIL_SERVICE, VerifyEmailService } from './application/verify-email.service'
import { ProfileContainer } from './presentation/pages/profile/profile.container'
import { profileCommands, profileShape } from './presentation/pages/profile/profile.model.gen'
import { SettingsContainer } from './presentation/pages/settings/settings.container'
import { SignInContainer } from './presentation/pages/sign-in/sign-in.container'
import { VerifyEmailContainer } from './presentation/pages/verify-email/verify-email.container'

/**
 * Accounts, profiles and settings: signing in or up, verifying an account's email from the link of
 * its mail, and the signed-in user's own profile page.
 */
export const UserModule = defineModule({
  id: 'user',
  providers: [
    {
      provide: PROFILE_SERVICE,
      useFactory: (container) =>
        new ProfileService(container.get(SHAPE_RUNNER), container.get(COMMANDS), {
          shape: profileShape,
          commands: profileCommands,
        }),
    },
    {
      provide: SIGN_IN_SERVICE,
      useFactory: (container) => new SignInService(container.get(SESSION)),
    },
    {
      provide: VERIFY_EMAIL_SERVICE,
      useFactory: (container) =>
        new VerifyEmailService(
          container.get(SESSION),
          container.get(PROFILE_SERVICE),
          container.get(SETTINGS_SERVICE),
        ),
    },
  ],
  declarations: {
    SignInPage: SignInContainer,
    VerifyEmailPage: VerifyEmailContainer,
    ProfilePage: ProfileContainer,
    SettingsPage: SettingsContainer,
  },
  routes: [
    { path: '/sign-in', page: 'SignInPage', guard: 'guest' },
    {
      path: '/verify-email',
      page: 'VerifyEmailPage',
      guard: 'guest',
      search: z.object({ token: z.string().min(1).max(4096).optional() }),
    },
    { path: '/me', page: 'ProfilePage', guard: 'authenticated' },
    { path: '/settings', page: 'SettingsPage', guard: 'authenticated' },
  ],
})
