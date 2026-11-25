type Role = 'guest' | 'operator'
declare function grant(role: Role): void
const word = 'x'
grant('operator')

export { word }
