import { SHAPE_RUNNER } from '@workspace/data'
import { z } from '@workspace/zod'

import { COMMANDS } from '../../platform/commands.port'
import { defineModule } from '../../platform/module'
import { PASSKEYS } from '../../platform/passkeys.port'
import { SESSION } from '../../platform/session.port'
import { TWO_FACTOR } from '../../platform/two-factor.port'

import { PASSKEYS_SERVICE, PasskeysService } from './application/passkeys.service'
import { PROFILE_SERVICE, ProfileService } from './application/profile.service'
import { qrSvg } from './application/qr-svg.policy'
import { SIGN_IN_SERVICE, SignInService } from './application/sign-in.service'
import { TWO_FACTOR_SERVICE, TwoFactorService } from './application/two-factor.service'
import { VERIFY_EMAIL_SERVICE, VerifyEmailService } from './application/verify-email.service'
import { ConfirmEmailContainer } from './presentation/pages/confirm-email/confirm-email.container'
import { DeleteAccountContainer } from './presentation/pages/delete-account/delete-account.container'
import { ForgotPasswordContainer } from './presentation/pages/forgot-password/forgot-password.container'
import { ProfileContainer } from './presentation/pages/profile/profile.container'
import { profileCommands, profileShape } from './presentation/pages/profile/profile.model.gen'
import { ResetPasswordContainer } from './presentation/pages/reset-password/reset-password.container'
import { SignInContainer } from './presentation/pages/sign-in/sign-in.container'
import { VerifyEmailContainer } from './presentation/pages/verify-email/verify-email.container'

/**
 * Accounts, profiles and settings: signing in or up, verifying an account's email from the link of
 * its mail, the signed-in user's own profile page, and the settings where the account turns its
 * second factor on or off and keeps its passkeys.
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
      useFactory: (container) => new VerifyEmailService(container.get(SESSION)),
    },
    {
      provide: TWO_FACTOR_SERVICE,
      useFactory: (container) => new TwoFactorService(container.get(TWO_FACTOR), qrSvg),
    },
    {
      provide: PASSKEYS_SERVICE,
      useFactory: (container) => new PasskeysService(container.get(PASSKEYS)),
    },
  ],
  // A dynamic import: the settings page is a screen a signed-in device opens rarely, so its code
  // loads when its route first opens, and no first frame carries it.
  declarations: {
    SignInPage: SignInContainer,
    VerifyEmailPage: VerifyEmailContainer,
    ForgotPasswordPage: ForgotPasswordContainer,
    ResetPasswordPage: ResetPasswordContainer,
    ConfirmEmailPage: ConfirmEmailContainer,
    DeleteAccountPage: DeleteAccountContainer,
    ProfilePage: ProfileContainer,
    SettingsPage: {
      load: () =>
        import('./presentation/pages/settings/settings.container').then(
          ({ SettingsContainer }) => SettingsContainer,
        ),
    },
  },
  routes: [
    // A page that moves here may carry the email typed there.
    {
      path: '/sign-in',
      page: 'SignInPage',
      guard: 'guest',
      roles: ['guest'],
      search: z.object({ email: z.string().max(254).optional() }),
    },
    {
      path: '/verify-email',
      page: 'VerifyEmailPage',
      guard: 'guest',
      roles: ['guest'],
      search: z.object({ token: z.string().min(1).max(4096).optional() }),
    },
    // A guest's: a signed-in account changes its password in its settings.
    {
      path: '/forgot-password',
      page: 'ForgotPasswordPage',
      guard: 'guest',
      roles: ['guest'],
      search: z.object({ email: z.string().max(254).optional() }),
    },
    // Open to anyone: a reset of the account signed in here signs this device out.
    {
      path: '/reset-password',
      page: 'ResetPasswordPage',
      roles: ['guest', 'identity'],
      search: z.object({ token: z.string().min(1).max(4096).optional() }),
    },
    // Open to anyone: the link changes the email whoever is signed in here.
    {
      path: '/confirm-email',
      page: 'ConfirmEmailPage',
      roles: ['guest', 'identity'],
      search: z.object({ token: z.string().min(1).max(4096).optional() }),
    },
    // Open to anyone: the link deletes the account its mail was sent to, whoever is signed in here.
    {
      path: '/delete-account',
      page: 'DeleteAccountPage',
      roles: ['guest', 'identity'],
      search: z.object({ token: z.string().min(1).max(4096).optional() }),
    },
    { path: '/me', page: 'ProfilePage', guard: 'authenticated', roles: ['identity'] },
    { path: '/settings', page: 'SettingsPage', guard: 'authenticated', roles: ['identity'] },
  ],
})
