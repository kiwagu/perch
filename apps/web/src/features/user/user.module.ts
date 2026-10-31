import { SHAPE_RUNNER } from '@workspace/data'

import { COMMANDS } from '../../platform/commands.port'
import { defineModule } from '../../platform/module'
import { SESSION } from '../../platform/session.port'

import { PROFILE_SERVICE, ProfileService } from './application/profile.service'
import { SIGN_IN_SERVICE, SignInService } from './application/sign-in.service'
import { ProfileContainer } from './presentation/pages/profile/profile.container'
import { profileCommands, profileShape } from './presentation/pages/profile/profile.model.gen'
import { SettingsContainer } from './presentation/pages/settings/settings.container'
import { SignInContainer } from './presentation/pages/sign-in/sign-in.container'

/** Accounts, profiles and settings: signing in or up, and the signed-in user's own profile page. */
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
  ],
  declarations: {
    SignInPage: SignInContainer,
    ProfilePage: ProfileContainer,
    SettingsPage: SettingsContainer,
  },
  routes: [
    { path: '/sign-in', page: 'SignInPage', guard: 'guest' },
    { path: '/me', page: 'ProfilePage', guard: 'authenticated' },
    { path: '/settings', page: 'SettingsPage', guard: 'authenticated' },
  ],
})
