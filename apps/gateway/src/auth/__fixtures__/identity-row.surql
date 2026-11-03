-- An identity row of key $key and email $email, written directly, as no sign-up would key it.
CREATE type::record('identity', $key) SET email = $email, name = 'Ann';
