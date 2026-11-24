-- The platform role of the identities whose email is in $emails, by email; an identity with no
-- platform role has no `role`.
SELECT email, role FROM identity WHERE email IN $emails;
