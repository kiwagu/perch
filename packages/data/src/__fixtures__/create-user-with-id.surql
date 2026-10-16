CREATE $id SET
  email = $email,
  name = $name,
  password = crypto::argon2::generate('x');
