export async function load(): Promise<number> {
  const { push } = await import(`./region/push`)

  return push()
}
