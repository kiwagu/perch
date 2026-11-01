-- Settings of identity $identity (its key) in language $locale, as replication would store them.
CREATE settings SET
  identity = type::record('identity', $identity),
  locale = $locale;
