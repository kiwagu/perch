-- The identity (its key) whose passkey holds credential $credential, the id an authenticator names
-- the passkey by at a sign-in; none when no passkey holds it.
SELECT VALUE identity FROM passkey WHERE credential_id = $credential LIMIT 1;
