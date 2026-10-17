CREATE identity SET email = $email, password = crypto::argon2::generate('x');
