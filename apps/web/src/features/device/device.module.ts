import { DEVICES } from '../../platform/devices.port'
import { defineModule } from '../../platform/module'
import { SESSION } from '../../platform/session.port'

import { DEVICES_SERVICE, DevicesService } from './application/devices.service'
import { DevicesContainer } from './presentation/pages/devices/devices.container'

/**
 * The devices of the signed-in identity: those it is signed in on, and signing one of them,
 * or every one, out.
 */
export const DeviceModule = defineModule({
  id: 'device',
  providers: [
    {
      provide: DEVICES_SERVICE,
      useFactory: (container) => new DevicesService(container.get(DEVICES), container.get(SESSION)),
    },
  ],
  declarations: { DevicesPage: DevicesContainer },
  routes: [{ path: '/devices', page: 'DevicesPage', guard: 'authenticated' }],
})
