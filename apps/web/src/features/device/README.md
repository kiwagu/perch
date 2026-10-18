# My devices (module `device`)

## Role in the architecture

The platform's device module: the devices the signed-in identity is signed in on, and signing
one of them, or every one, out. It holds no data of its own on the device: the list and the
sign-outs go through the gateway's device routes over the `DEVICES` port (`devicesApi` in the
composition root, the access token and this device's id on every call). Layers:
`application/` holds the `DevicesService` over that port; `presentation/` the page, its view
and the i18n catalogs.

## Surface

- Route: `/devices` (guard `authenticated`) renders `DevicesPage`.
- No shapes or commands: the rows come from `GET /devices` (each device's session row id,
  label, when it was last seen and signed out, `current` for this device), a sign-out of
  another device is `DELETE /devices/:id` and "Sign out everywhere" is
  `POST /auth/sign-out-everywhere`.
- Providers: `DEVICES_SERVICE`.
- i18n namespace `device.*` (`presentation/i18n/device.en.json`, `device.es.json`); test ids
  `device.list.*`, `device.everywhere.*`, `device.page.status` and `device.notice`.
- Behaviour: every device signed in, and those signed out within 30 days, with the label each
  gave itself, when it was last seen (and signed out), this device marked "This device".
  Another device signs out from its row (its grant revoked, its channel closed), after which
  the list is read again; this device has no such button and signs out through its session
  (the profile's sign-out, which sends what it can first). "Sign out everywhere" asks first,
  then signs every device out, this one included: the page waits for the gateway's answer
  only, since the gateway closes this device's channel too and the session signs it out on
  that, which leads to the sign-in page. A call that fails says so in a notice; a sign-out
  that failed reads the list again, unless the gateway is out of reach (the read would fail
  too).

## Commands

- `bun run test` in `apps/web` runs this module's specs (`devices.service.spec.ts`,
  `devices.container.spec.tsx`, `devices.view.spec.tsx`, `device.module.spec.ts`).
- `bun run i18n:check` checks its keys against the catalogs.
