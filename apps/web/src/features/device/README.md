# My devices (module `device`)

## Role in the architecture

The platform's device module: the devices the signed-in identity is signed in on, and signing
one of them, or every one, out. It holds no data of its own on the device: the list and the
sign-outs go through the gateway's device routes over the `DEVICES` port (`devicesApi` in the
composition root, the session token and this device's id on every call). Layers:
`application/` holds the `DevicesService` over that port and the page's machine
(`devices.machine.ts`); `presentation/` the page, its view and the i18n catalogs.

## Surface

- Route: `/devices` (guard `authenticated`) renders `DevicesPage`.
- No shapes or commands: the rows come from `GET /devices` (each device's session row id,
  label, when it was last seen and signed out, `current` for this device), a sign-out of
  another device is `DELETE /devices/:id` and "Sign out everywhere" is
  `POST /auth/sign-out-everywhere`.
- Providers: `DEVICES_SERVICE`, over the `DEVICES` port and the session (`SESSION`).
- i18n namespace `device.*` (`presentation/i18n/device.en.json`, `device.es.json`).
- Anchors: screen `device` in `contract/domain/screens/devices.yaml`.
- Behaviour: the page runs its screen's flow as its machine (`application/devices.machine.ts`,
  held to `contract/domain/screens/devices.yaml` by `platform/machines.spec.ts`) through the
  platform's `useScreenMachine`: a sign-out is an invoke of its action, the buttons are enabled
  while the machine's state takes them (none while a sign-out runs), the dialog is open while
  the flow confirms, and the hook runs the move to sign-in. Every device signed in, and those signed out within 30 days, with the label each
  gave itself, when it was last seen (and signed out), this device marked "This device".
  Another device signs out from its row (its session ended, its channel closed), after which
  the list is read again; this device has no such button and signs out through its session
  (the profile's sign-out, which sends what it can first). "Sign out everywhere" asks first,
  then signs every device out, this one included: once the gateway answered, the service has
  the session sign this device out (`signingOutEverywhere()`, named before the request goes,
  as on the channel's 4001, which a browser without a sync channel never hears), which leads to
  the sign-in page, where the flow leaves `signed-out-elsewhere` unless the session left a word on
  the device's data (`resend-after-sign-in`, `delete-pending`); an answer that comes once that
  session has ended signs nobody out. A call that
  fails says so in a notice; a sign-out that failed reads the list again, unless the gateway is
  out of reach (the read would fail too).

## Commands

- `bun run test` in `apps/web` runs this module's specs (`devices.service.spec.ts`,
  `devices.machine.spec.ts`, `devices.container.spec.tsx`, `devices.view.spec.tsx`, `device.module.spec.ts`).
- `bun run i18n:check` checks its keys against the catalogs.
