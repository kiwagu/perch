-- Spends the reset link whose token is $link_token: deletes it and answers what it was (the
-- identity's key as its value, and its expiry), or nothing when no link holds the token. A link is
-- spent once, however many claims of it run at once.
DELETE verification
WHERE identifier = string::concat('reset-password:', $link_token)
RETURN BEFORE;
