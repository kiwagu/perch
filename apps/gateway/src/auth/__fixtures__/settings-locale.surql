-- Settings of identity $identity (its key) in language $locale and the device's own theme, as
-- replication would store them.
CREATE settings SET
  identity = type::record('identity', $identity),
  locale = $locale,
  theme = 'system';
